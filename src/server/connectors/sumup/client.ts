import { ConnectorError, parseRetryAfter, sleep } from "../types";

/**
 * SumUp API client — READ ONLY.
 * Base https://api.sumup.com, header `Authorization: Bearer <API key>` (key created by the merchant in
 * me.sumup.com → Impostazioni → Per sviluppatori → Chiavi API).
 * Used here:
 *   GET /v2.1/merchants/{code}/transactions/history   → sales, refunds, chargebacks (paginated by `links`)
 *   GET /v2.1/merchants/{code}/transactions?id=…       → one transaction with fee, VAT and product lines
 *   GET /v1.0/merchants/{code}/payouts                 → payouts and deductions, one record per transaction
 *   GET /v0.1/me                                       → merchant code discovery (legacy profile endpoint)
 * NOT used, by design: checkouts, payments, refunds (POST …/refunds) and any other write endpoint.
 * MOAI OS never charges, refunds or changes anything on SumUp.
 */

export type SumUpHistoryItem = {
  id?: string;
  transaction_id?: string;
  transaction_code?: string;
  amount?: number;
  currency?: string;
  timestamp?: string;
  status?: "SUCCESSFUL" | "CANCELLED" | "FAILED" | "PENDING" | "REFUNDED" | string;
  payment_type?: string;
  entry_mode?: string;
  type?: "PAYMENT" | "REFUND" | "CHARGE_BACK" | string;
  card_type?: string;
  product_summary?: string;
  payout_date?: string;
  refunded_amount?: number;
  installments_count?: number;
  [k: string]: unknown;
};

export type SumUpProduct = { name?: string; price?: number; vat_rate?: number; price_with_vat?: number; vat_amount?: number; quantity?: number; total_price?: number; total_with_vat?: number };

export type SumUpTransaction = SumUpHistoryItem & {
  vat_amount?: number;
  tip_amount?: number;
  fee_amount?: number;
  products?: SumUpProduct[];
  vat_rates?: Array<{ rate?: number; net?: number; vat?: number; gross?: number }>;
  events?: Array<{ type?: string; status?: string; amount?: number; fee_amount?: number; timestamp?: string }>;
  simple_status?: string;
};

export type SumUpPayoutRecord = {
  id: number | string;
  type: "PAYOUT" | "CHARGE_BACK_DEDUCTION" | "REFUND_DEDUCTION" | "DD_RETURN_DEDUCTION" | "BALANCE_DEDUCTION" | string;
  amount: number;
  date: string;
  currency: string;
  fee: number;
  status: "SUCCESSFUL" | "FAILED" | string;
  reference: string;
  transaction_code: string;
};

type HistoryPage = { items?: SumUpHistoryItem[]; links?: Array<{ rel?: string; href?: string }> };

export class SumUpClient {
  private base = "https://api.sumup.com";
  constructor(private opts: { apiKey: string; merchantCode?: string; log?: (l: string) => void; fetchImpl?: typeof fetch }) {}

  get merchantCode() {
    return this.opts.merchantCode;
  }

  private async request<T>(path: string): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch;
    let attempt = 0;
    for (;;) {
      attempt++;
      const res = await f(`${this.base}${path}`, { method: "GET", headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: "application/json" } });
      if (res.status === 401) throw new ConnectorError("SumUp: chiave API non valida o revocata", { httpStatus: 401 });
      if (res.status === 403) throw new ConnectorError("SumUp: la chiave non ha accesso a questa risorsa", { httpStatus: 403 });
      if (res.status === 404) throw new ConnectorError("SumUp: risorsa non trovata (controlla il codice esercente)", { httpStatus: 404 });
      if (res.status === 429 || res.status >= 500) {
        const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 1000 * 2 ** attempt;
        if (attempt >= 5) throw new ConnectorError(`SumUp HTTP ${res.status}`, { retryable: true, retryAfterMs: wait, httpStatus: res.status });
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ConnectorError(`SumUp HTTP ${res.status}: ${text.slice(0, 200)}`, { httpStatus: res.status });
      return JSON.parse(text) as T;
    }
  }

  private code() {
    if (!this.opts.merchantCode) throw new ConnectorError("SumUp: codice esercente mancante");
    return encodeURIComponent(this.opts.merchantCode);
  }

  /** Legacy profile endpoint: returns the merchant code of the account the key belongs to. */
  async discoverMerchantCode(): Promise<{ merchantCode: string | null; name: string | null; currency: string | null }> {
    const me = await this.request<{ merchant_profile?: { merchant_code?: string; company_name?: string; default_currency?: string } }>("/v0.1/me");
    const p = me.merchant_profile ?? {};
    return { merchantCode: p.merchant_code ?? null, name: p.company_name ?? null, currency: p.default_currency ?? null };
  }

  /**
   * Walks the transaction history oldest → newest. `changesSince` returns also older transactions
   * whose status changed (a sale refunded later), so one cursor covers both new and updated rows.
   */
  async *history(args: { oldestTime?: Date; changesSince?: Date; pageSize?: number; maxPages?: number }): AsyncGenerator<SumUpHistoryItem[]> {
    const q = new URLSearchParams({ order: "ascending", limit: String(args.pageSize ?? 100) });
    if (args.changesSince) q.set("changes_since", args.changesSince.toISOString());
    else if (args.oldestTime) q.set("oldest_time", args.oldestTime.toISOString());
    let query: string | null = q.toString();
    let pages = 0;
    while (query && pages < (args.maxPages ?? 50)) {
      const page: HistoryPage = await this.request<HistoryPage>(`/v2.1/merchants/${this.code()}/transactions/history?${query}`);
      pages++;
      const items = page.items ?? [];
      if (items.length) yield items;
      // The API hands back the next query string: use it as is, never build the refs by hand.
      const next = (page.links ?? []).find((l) => l.rel === "next")?.href ?? null;
      query = next && items.length ? next.replace(/^\?/, "") : null;
    }
  }

  getTransaction(id: string) {
    return this.request<SumUpTransaction>(`/v2.1/merchants/${this.code()}/transactions?id=${encodeURIComponent(id)}`);
  }

  listPayouts(start: string, end: string) {
    const q = new URLSearchParams({ start_date: start, end_date: end, format: "json", limit: "9999", order: "asc" });
    return this.request<SumUpPayoutRecord[]>(`/v1.0/merchants/${this.code()}/payouts?${q}`);
  }
}
