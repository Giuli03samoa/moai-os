import { ConnectorError, parseRetryAfter, sleep } from "../types";

/**
 * Aruba Fatturazione Elettronica — web services (read-only usage).
 * Docs: https://fatturazioneelettronica.aruba.it/apidoc/docs.html
 * - Auth: POST {auth}/auth/signin  (grant_type=password, form-encoded)  → token valido 30 min
 * - Ciclo attivo:  GET {ws}/services/invoice/out/findByUsername, /out/getByFilename
 * - Ciclo passivo: GET {ws}/services/invoice/in/findByUsername,  /in/getByFilename
 * Requirement: the web services are available to Premium accounts, or Base accounts
 * delegated to a Premium account. A plain Base account gets 401/403 on {ws}.
 * Sending invoices to SdI is intentionally NOT implemented in this MVP.
 */

export type ArubaEnv = "production" | "demo";

const BASES: Record<ArubaEnv, { auth: string; ws: string }> = {
  production: { auth: "https://auth.fatturazioneelettronica.aruba.it", ws: "https://ws.fatturazioneelettronica.aruba.it" },
  demo: { auth: "https://demoauth.fatturazioneelettronica.aruba.it", ws: "https://demows.fatturazioneelettronica.aruba.it" },
};

export type ArubaParty = { description?: string | null; countryCode?: string | null; vatCode?: string | null; fiscalCode?: string | null };
export type ArubaInvoiceItem = {
  id: string | number;
  filename: string;
  idSdi?: string | number | null;
  docType?: string | null;
  invoiceType?: string | null;
  file?: string | null; // base64
  pdfFile?: string | null;
  sender?: ArubaParty | null;
  receiver?: ArubaParty | null;
  invoices?: Array<{ invoiceDate?: string; number?: string; status?: string | number; statusDescription?: string }> | null;
  creationDate?: string | null;
  lastUpdate?: string | null;
  username?: string | null;
  pddAvailable?: boolean | null;
  errorCode?: string | null;
  errorDescription?: string | null;
};
export type ArubaPage = {
  errorCode?: string | null;
  errorDescription?: string | null;
  content: ArubaInvoiceItem[];
  last: boolean;
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
};

export const OUT_STATUS: Record<number, string> = {
  1: "Presa in carico", 2: "Errore elaborazione", 3: "Inviata", 4: "Scartata", 5: "Non consegnata",
  6: "Recapito impossibile", 7: "Consegnata", 8: "Accettata", 9: "Rifiutata", 10: "Decorrenza termini",
};

export class ArubaClient {
  private token: { access: string; refresh: string | null; exp: number } | null = null;
  private base: { auth: string; ws: string };

  constructor(
    private opts: { env: ArubaEnv; username: string; password: string; log?: (l: string) => void },
  ) {
    this.base = BASES[opts.env];
  }

  get username() {
    return this.opts.username;
  }

  async signin(): Promise<void> {
    const res = await fetch(`${this.base.auth}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "password", username: this.opts.username, password: this.opts.password }),
    });
    const text = await res.text();
    if (res.status === 400 || res.status === 401) throw new ConnectorError("Aruba: credenziali non valide (verifica username/password dell'account Fatturazione Elettronica)", { httpStatus: res.status });
    if (!res.ok) throw new ConnectorError(`Aruba auth HTTP ${res.status}: ${text.slice(0, 200)}`, { retryable: res.status >= 500 || res.status === 429, httpStatus: res.status });
    const json = JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in?: number };
    this.token = { access: json.access_token, refresh: json.refresh_token ?? null, exp: Date.now() + (json.expires_in ?? 1800) * 1000 };
  }

  private async ensureToken(force = false) {
    if (force || !this.token || this.token.exp - Date.now() < 60_000) await this.signin();
    return this.token!.access;
  }

  private async request<T>(path: string, params: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(`${this.base.ws}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    let attempt = 0;
    let force = false;
    for (;;) {
      attempt++;
      const token = await this.ensureToken(force);
      force = false;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (res.status === 401 && attempt === 1) { force = true; continue; }
      if (res.status === 401 || res.status === 403) {
        throw new ConnectorError("Aruba: accesso ai web service negato. I servizi API richiedono un account Premium (o un account Base con delega a un Premium).", { httpStatus: res.status });
      }
      if (res.status === 429 || res.status >= 500) {
        const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 1000 * 2 ** attempt;
        if (attempt >= 5) throw new ConnectorError(`Aruba HTTP ${res.status} dopo ${attempt} tentativi`, { retryable: true, retryAfterMs: wait, httpStatus: res.status });
        this.opts.log?.(`Aruba HTTP ${res.status}: attendo ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ConnectorError(`Aruba HTTP ${res.status}: ${text.slice(0, 300)}`, { httpStatus: res.status });
      const json = JSON.parse(text) as T & { errorCode?: string | null; errorDescription?: string | null };
      if (json.errorCode && json.errorCode !== "0000" && json.errorCode !== "0") {
        throw new ConnectorError(`Aruba [${json.errorCode}]: ${json.errorDescription ?? "errore"}`);
      }
      return json;
    }
  }

  async findInvoices(direction: "out" | "in", params: { page?: number; size?: number; startDate?: string; endDate?: string; country?: string; vatcode?: string }): Promise<ArubaPage> {
    const party = direction === "out" ? { countrySender: params.country, vatcodeSender: params.vatcode } : { countryReceiver: params.country, vatcodeReceiver: params.vatcode };
    const page = await this.request<ArubaPage>(`/services/invoice/${direction}/findByUsername`, {
      username: this.opts.username, page: params.page ?? 1, size: Math.min(params.size ?? 100, 100), startDate: params.startDate, endDate: params.endDate, ...party,
    });
    return { ...page, content: page.content ?? [] };
  }

  async getByFilename(direction: "out" | "in", filename: string, includeFile = true): Promise<ArubaInvoiceItem> {
    return this.request<ArubaInvoiceItem>(`/services/invoice/${direction}/getByFilename`, { filename, includeFile, includePdf: false });
  }
}

export function arubaDate(d: Date) {
  // ISO 8601 without milliseconds/offset, as in the Aruba examples.
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}
