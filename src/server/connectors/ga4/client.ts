import { createSign } from "crypto";
import { ConnectorError } from "../types";

/**
 * Google Analytics 4 Data API, read-only, authenticated with a service account (JWT → access token).
 * The service account must be added as Viewer on the GA4 property. No Google SDK: a signed JWT and two fetches.
 */
export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(json) as Partial<ServiceAccount>;
  } catch {
    throw new ConnectorError("GA4: il JSON del service account non è valido");
  }
  if (!parsed.client_email || !parsed.private_key) throw new ConnectorError("GA4: il JSON deve contenere client_email e private_key");
  return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri };
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function buildJwt(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key).toString("base64url");
  return `${header}.${claims}.${sig}`;
}

export class Ga4Client {
  private token: { value: string; exp: number } | null = null;
  constructor(private sa: ServiceAccount, private propertyId: string) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const res = await fetch(this.sa.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: buildJwt(this.sa) }),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !json.access_token) throw new ConnectorError(`GA4: autenticazione fallita — ${json.error_description ?? json.error ?? res.status}`, { httpStatus: res.status });
    this.token = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  async runReport(args: { startDate: string; endDate: string; metrics: string[]; dimensions?: string[] }): Promise<Ga4Report> {
    const token = await this.accessToken();
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(this.propertyId)}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dateRanges: [{ startDate: args.startDate, endDate: args.endDate }], metrics: args.metrics.map((name) => ({ name })), dimensions: (args.dimensions ?? ["date"]).map((name) => ({ name })), limit: 1000 }),
    });
    const text = await res.text();
    if (res.status === 403) throw new ConnectorError("GA4: accesso negato — aggiungi il service account come Viewer sulla proprietà", { httpStatus: 403 });
    if (res.status === 429) throw new ConnectorError("GA4: quota superata", { retryable: true, retryAfterMs: 60_000, httpStatus: 429 });
    if (!res.ok) throw new ConnectorError(`GA4 HTTP ${res.status}: ${text.slice(0, 200)}`, { httpStatus: res.status, retryable: res.status >= 500 });
    return JSON.parse(text) as Ga4Report;
  }
}

export type Ga4Report = {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type?: string }>;
  rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>;
  rowCount?: number;
};

export function reportToRows(report: Ga4Report): Array<Record<string, string>> {
  const dims = report.dimensionHeaders?.map((d) => d.name) ?? [];
  const mets = report.metricHeaders?.map((m) => m.name) ?? [];
  return (report.rows ?? []).map((r) => {
    const o: Record<string, string> = {};
    dims.forEach((d, i) => (o[d] = r.dimensionValues?.[i]?.value ?? ""));
    mets.forEach((m, i) => (o[m] = r.metricValues?.[i]?.value ?? ""));
    return o;
  });
}

/** GA4 returns dates as YYYYMMDD. */
export function ga4Date(d: string) {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}
