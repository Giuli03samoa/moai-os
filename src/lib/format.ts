// Client-safe formatting helpers (no server imports).

export function fmtMoney(value: string | number | null | undefined, currency = "EUR", locale = "it-IT") {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

export function fmtNumber(value: number | string, locale = "it-IT") {
  return new Intl.NumberFormat(locale).format(Number(value));
}

export function fmtDate(d: Date | string | null | undefined, tz = "Europe/Rome", withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}

export function fmtRelative(d: Date | string | null | undefined) {
  if (!d) return "mai";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h fa`;
  return `${Math.round(h / 24)} giorni fa`;
}

