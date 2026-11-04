import { ConnectorError, parseRetryAfter, sleep } from "../types";

/**
 * Meta Graph API (Instagram Graph API + Marketing API), read-only.
 * Auth: a long-lived access token (System User token recommended) passed as `access_token`.
 * Permissions needed: instagram_basic, instagram_manage_insights, pages_read_engagement; ads_read for spend.
 * NOT collaudato on a real account yet: field names of insights change between API versions, so every
 * call reports what it got back and the sync tolerates missing metrics.
 */
export class MetaClient {
  constructor(private opts: { accessToken: string; version?: string; log?: (l: string) => void }) {}

  private base() {
    return `https://graph.facebook.com/${this.opts.version ?? "v23.0"}`;
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const q = new URLSearchParams({ ...params, access_token: this.opts.accessToken });
    let attempt = 0;
    for (;;) {
      attempt++;
      const res = await fetch(`${this.base()}${path}?${q}`, { headers: { Accept: "application/json" } });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 1500 * 2 ** attempt;
        if (attempt >= 4) throw new ConnectorError(`Meta HTTP ${res.status}`, { retryable: true, retryAfterMs: wait, httpStatus: res.status });
        await sleep(wait);
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ConnectorError(`Meta: risposta non JSON (${res.status})`, { httpStatus: res.status });
      }
      const err = (json as { error?: { message?: string; code?: number; type?: string } }).error;
      if (!res.ok || err) {
        const code = err?.code;
        if (code === 190 || res.status === 401) throw new ConnectorError("Meta: access token scaduto o non valido (code 190)", { httpStatus: 401 });
        if (code === 10 || code === 200 || res.status === 403) throw new ConnectorError(`Meta: permesso mancante — ${err?.message ?? ""}`.trim(), { httpStatus: 403 });
        throw new ConnectorError(`Meta HTTP ${res.status}: ${err?.message ?? text.slice(0, 200)}`, { httpStatus: res.status });
      }
      return json as T;
    }
  }
}

export type IgAccount = { id: string; username?: string; followers_count?: number; media_count?: number; name?: string };
export type IgMedia = { id: string; caption?: string; media_type?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number };
export type InsightsValue = { value?: number | Record<string, number>; end_time?: string };
export type Insights = { data?: Array<{ name: string; period?: string; values?: InsightsValue[]; total_value?: { value?: number } }> };
export type AdInsightsRow = { date_start?: string; date_stop?: string; spend?: string; impressions?: string; clicks?: string; reach?: string; cpc?: string; ctr?: string };
