import { ConnectorError, parseRetryAfter, sleep } from "../types";

/**
 * Packlink PRO API client (read-only usage).
 * Base URL https://api.packlink.com (sandbox: https://apisandbox.packlink.com), header `Authorization: <API key>`.
 * Publicly documented and used here:
 *   GET /v1/services?from[...]&to[...]&packages[0][...]   → used only as a credential probe
 *   GET /v1/shipments/{reference}                          → shipment details (state, carrier, trackings, price)
 *   GET /v1/shipments/{reference}/track                    → tracking events
 * NOT used: shipment creation (the official Shopify–Packlink PRO integration creates shipments;
 * MOAI OS must never create duplicates). Listing all shipments is not part of the documented
 * public API: shipment references enter MOAI OS from Shopify fulfillments, CSV export or manual entry.
 */

export type PacklinkEnv = "production" | "sandbox";
const BASES: Record<PacklinkEnv, string> = { production: "https://api.packlink.com", sandbox: "https://apisandbox.packlink.com" };

export type PacklinkShipment = {
  reference?: string;
  state?: string;
  status?: string;
  carrier?: string;
  service?: string;
  service_id?: number | string;
  trackings?: string[];
  tracking_codes?: string[];
  tracking_url?: string;
  price?: { base_price?: number | string; total_price?: number | string; currency?: string } | number | string;
  currency?: string;
  created_at?: string;
  order_date?: string;
  delivery?: { estimated?: string };
  [k: string]: unknown;
};

export type PacklinkTrackingEvent = { timestamp?: string; description?: string; city?: string; [k: string]: unknown };

export class PacklinkClient {
  private base: string;
  constructor(private opts: { apiKey: string; env?: PacklinkEnv; log?: (l: string) => void }) {
    this.base = BASES[opts.env ?? "production"];
  }

  private async request<T>(path: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt++;
      const res = await fetch(`${this.base}${path}`, { headers: { Authorization: this.opts.apiKey, Accept: "application/json" } });
      if (res.status === 401 || res.status === 403) throw new ConnectorError("Packlink: API key non valida o non abilitata per questo account PRO", { httpStatus: res.status });
      if (res.status === 404) throw new ConnectorError("Packlink: risorsa non trovata", { httpStatus: 404 });
      if (res.status === 429 || res.status >= 500) {
        const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 1000 * 2 ** attempt;
        if (attempt >= 5) throw new ConnectorError(`Packlink HTTP ${res.status}`, { retryable: true, retryAfterMs: wait, httpStatus: res.status });
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ConnectorError(`Packlink HTTP ${res.status}: ${text.slice(0, 300)}`, { httpStatus: res.status });
      return JSON.parse(text) as T;
    }
  }

  /** Credential probe: a services quote for a domestic parcel. No side effects. */
  async probe() {
    const q = new URLSearchParams({
      "from[country]": "IT", "from[zip]": "20121", "to[country]": "IT", "to[zip]": "00184",
      "packages[0][weight]": "1", "packages[0][length]": "20", "packages[0][width]": "15", "packages[0][height]": "10",
    });
    const services = await this.request<unknown[]>(`/v1/services?${q}`);
    return Array.isArray(services) ? services.length : 0;
  }

  getShipment(reference: string) {
    return this.request<PacklinkShipment>(`/v1/shipments/${encodeURIComponent(reference)}`);
  }

  getTracking(reference: string) {
    return this.request<PacklinkTrackingEvent[]>(`/v1/shipments/${encodeURIComponent(reference)}/track`);
  }
}

export function mapPacklinkState(state: string | undefined) {
  const s = (state ?? "").toUpperCase();
  if (/DELIVERED/.test(s)) return "DELIVERED" as const;
  if (/OUT_FOR_DELIVERY/.test(s)) return "OUT_FOR_DELIVERY" as const;
  if (/IN_TRANSIT|CARRIER_OK|PICKED/.test(s)) return "IN_TRANSIT" as const;
  if (/READY|LABEL/.test(s)) return "READY" as const;
  if (/INCIDENT|EXCEPTION|PROBLEM|FAILED|DELAY/.test(s)) return "EXCEPTION" as const;
  if (/RETURN/.test(s)) return "RETURNED" as const;
  if (/CANCEL/.test(s)) return "CANCELLED" as const;
  if (/AWAITING|PENDING|DRAFT|PURCHASE/.test(s)) return "PENDING" as const;
  return "UNKNOWN" as const;
}
