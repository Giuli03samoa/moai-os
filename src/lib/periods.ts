import { TZDate } from "@date-fns/tz";

export type PeriodKey = "7d" | "30d" | "mtd" | "qtd" | "ytd" | "last_month" | "custom";

export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "7d", label: "7 giorni" },
  { key: "30d", label: "30 giorni" },
  { key: "mtd", label: "Mese corrente" },
  { key: "last_month", label: "Mese scorso" },
  { key: "qtd", label: "Trimestre" },
  { key: "ytd", label: "Anno" },
];

/** Resolves a period into UTC instants, with day boundaries in the organization timezone. */
export function resolvePeriod(params: { period?: string; from?: string; to?: string }, tz: string): { from: Date; to: Date; key: PeriodKey } {
  const r = resolve(params, tz);
  return { key: r.key, from: new Date(r.from.getTime()), to: new Date(r.to.getTime()) };
}

function resolve(params: { period?: string; from?: string; to?: string }, tz: string): { from: Date; to: Date; key: PeriodKey } {
  const now = new TZDate(Date.now(), tz);
  const startOfDay = (d: TZDate) => new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, tz);
  const endOfToday = new TZDate(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999, tz);
  const key = (params.period ?? "30d") as PeriodKey;
  if (key === "custom" || (params.from && params.to)) {
    const f = params.from?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = params.to?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (f && t) {
      return { key: "custom", from: new TZDate(+f[1]!, +f[2]! - 1, +f[3]!, 0, 0, 0, tz), to: new TZDate(+t[1]!, +t[2]! - 1, +t[3]!, 23, 59, 59, 999, tz) };
    }
  }
  switch (key) {
    case "7d": return { key, from: startOfDay(new TZDate(now.getTime() - 6 * 86_400_000, tz)), to: endOfToday };
    case "mtd": return { key, from: new TZDate(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, tz), to: endOfToday };
    case "last_month": return { key, from: new TZDate(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, tz), to: new TZDate(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999, tz) };
    case "qtd": return { key, from: new TZDate(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1, 0, 0, 0, tz), to: endOfToday };
    case "ytd": return { key, from: new TZDate(now.getFullYear(), 0, 1, 0, 0, 0, tz), to: endOfToday };
    default: return { key: "30d", from: startOfDay(new TZDate(now.getTime() - 29 * 86_400_000, tz)), to: endOfToday };
  }
}

export function toInputDate(d: Date, tz: string) {
  const z = new TZDate(d, tz);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
}
