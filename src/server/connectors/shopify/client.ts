import { ConnectorError, parseRetryAfter, sleep } from "../types";
import { patchSecrets, type LoadedConnection } from "../registry";

/**
 * Shopify GraphQL Admin API client.
 * - Auth: client credentials grant (Dev Dashboard app installed on the brand's own store;
 *   24h tokens, refreshed automatically) or a legacy admin-created custom app token.
 * - Rate limits: honours 429 Retry-After and the cost-based THROTTLED error using
 *   extensions.cost.throttleStatus; retries 5xx with backoff.
 * - Never logs tokens.
 */

export function normalizeShopDomain(input: string): string {
  let s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!s) throw new ConnectorError("Dominio negozio mancante");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) throw new ConnectorError(`Dominio Shopify non valido: ${s} (atteso <negozio>.myshopify.com)`);
  return s;
}

export function apiVersion() {
  return process.env.SHOPIFY_API_VERSION ?? "2026-10";
}

type TokenResponse = { access_token: string; expires_in?: number; scope?: string };

export async function getShopifyAccessToken(loaded: LoadedConnection, force = false): Promise<string> {
  const { secrets, config, connection } = loaded;
  const mode = String(config.authMode ?? "client_credentials");
  if (mode === "access_token") {
    if (!secrets.accessToken) throw new ConnectorError("Access token Shopify mancante");
    return secrets.accessToken;
  }
  const exp = Number(secrets._cachedTokenExpiresAt ?? 0);
  if (!force && secrets._cachedToken && exp - Date.now() > 10 * 60_000) return secrets._cachedToken;
  if (!secrets.clientId || !secrets.clientSecret) throw new ConnectorError("Client ID / Client secret Shopify mancanti");
  const shop = normalizeShopDomain(String(config.shopDomain ?? ""));
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: secrets.clientId, client_secret: secrets.clientSecret }),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = /shop_not_permitted/.test(text)
      ? " — l'app e il negozio devono appartenere alla stessa organizzazione nel Dev Dashboard"
      : /invalid_client|invalid_request/.test(text)
        ? " — verifica Client ID e Client secret"
        : "";
    throw new ConnectorError(`Shopify OAuth ${res.status}${hint}: ${text.slice(0, 200)}`, { retryable: res.status >= 500, httpStatus: res.status });
  }
  const json = JSON.parse(text) as TokenResponse;
  const expiresAt = Date.now() + (json.expires_in ?? 86399) * 1000;
  await patchSecrets(connection.id, { _cachedToken: json.access_token, _cachedTokenExpiresAt: String(expiresAt), _cachedTokenScope: json.scope ?? "" });
  secrets._cachedToken = json.access_token;
  secrets._cachedTokenExpiresAt = String(expiresAt);
  return json.access_token;
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string; [k: string]: unknown } }>;
  extensions?: { cost?: { requestedQueryCost?: number; actualQueryCost?: number; throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number } } };
};

export class ShopifyClient {
  private shop: string;
  constructor(
    private loaded: LoadedConnection,
    private log: (l: string) => void = () => {},
  ) {
    this.shop = normalizeShopDomain(String(loaded.config.shopDomain ?? ""));
  }

  get shopDomain() {
    return this.shop;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const url = `https://${this.shop}/admin/api/${apiVersion()}/graphql.json`;
    let attempt = 0;
    let forceToken = false;
    for (;;) {
      attempt++;
      const token = await getShopifyAccessToken(this.loaded, forceToken);
      forceToken = false;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query, variables }),
        });
      } catch (e) {
        if (attempt >= 5) throw new ConnectorError(`Shopify irraggiungibile: ${(e as Error).message}`, { retryable: true });
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        if (attempt === 1 && String(this.loaded.config.authMode ?? "client_credentials") !== "access_token") {
          this.log("Token Shopify rifiutato: rinnovo e riprovo");
          forceToken = true;
          continue;
        }
        throw new ConnectorError(`Shopify ha rifiutato le credenziali (HTTP ${res.status}). Verifica token/scope e che l'app sia installata sul negozio.`, { httpStatus: res.status });
      }
      if (res.status === 429 || res.status >= 500) {
        const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 1000 * 2 ** attempt;
        if (attempt >= 5) throw new ConnectorError(`Shopify HTTP ${res.status} dopo ${attempt} tentativi`, { retryable: true, retryAfterMs: wait, httpStatus: res.status });
        this.log(`Shopify HTTP ${res.status}: attendo ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ConnectorError(`Shopify HTTP ${res.status}: ${text.slice(0, 300)}`, { httpStatus: res.status });
      const json = JSON.parse(text) as GraphQLResponse<T>;
      const cost = json.extensions?.cost;
      if (json.errors?.some((e) => e.extensions?.code === "THROTTLED")) {
        const ts = cost?.throttleStatus;
        const need = Math.max(0, (cost?.requestedQueryCost ?? 200) - (ts?.currentlyAvailable ?? 0));
        const wait = Math.max(1000, Math.ceil(need / (ts?.restoreRate ?? 50)) * 1000 + 500);
        if (attempt >= 8) throw new ConnectorError("Shopify: limite di costo API raggiunto ripetutamente", { retryable: true, retryAfterMs: wait });
        this.log(`Shopify THROTTLED: attendo ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (json.errors?.length) {
        const codes = json.errors.map((e) => e.extensions?.code).filter(Boolean).join(",");
        throw new ConnectorError(`Shopify GraphQL${codes ? ` [${codes}]` : ""}: ${json.errors.map((e) => e.message).join("; ").slice(0, 500)}`);
      }
      if (!json.data) throw new ConnectorError("Shopify: risposta senza dati");
      // Stay well inside the bucket so other consumers (webhooks, admin) are not starved.
      const ts = cost?.throttleStatus;
      if (ts && ts.currentlyAvailable < 250) await sleep(Math.ceil((250 - ts.currentlyAvailable) / ts.restoreRate) * 1000);
      return json.data;
    }
  }
}
