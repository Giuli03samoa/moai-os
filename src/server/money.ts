import { Prisma } from "@prisma/client";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export type MoneyInput = string | number | Prisma.Decimal | null | undefined;

/** Parses amounts from APIs/CSV. Accepts "1.234,56", "1,234.56", "-12.5", "€ 10,00". Never uses floats. */
export function parseAmount(input: MoneyInput, opts: { decimalSeparator?: "." | "," } = {}): Prisma.Decimal | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Prisma.Decimal) return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return new Prisma.Decimal(input.toString());
  }
  let s = input.trim().replace(/[\s€$£ ]|EUR|USD|GBP|CHF/gi, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  const sep = opts.decimalSeparator ?? detectDecimalSeparator(s);
  if (sep === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  const d = new Prisma.Decimal(s);
  return negative ? d.negated() : d;
}

function detectDecimalSeparator(s: string): "." | "," {
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastComma > lastDot) {
    // "1.234,56" or "12,5"; but "1,234" (thousands, 3 digits, no dot) is ambiguous → treat as decimal comma only if not exactly 3 trailing digits with no dot
    const decimals = s.length - lastComma - 1;
    if (lastDot === -1 && decimals === 3 && /^\d{1,3}(,\d{3})+$/.test(s.replace(/^[-+]/, ""))) return ".";
    return ",";
  }
  return ".";
}

export function sum(values: Array<MoneyInput>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => {
    const d = parseAmount(v);
    return d ? acc.plus(d) : acc;
  }, new Prisma.Decimal(0));
}

export function eq(a: MoneyInput, b: MoneyInput, tolerance = "0.005"): boolean {
  const x = parseAmount(a);
  const y = parseAmount(b);
  if (!x || !y) return false;
  return x.minus(y).abs().lte(tolerance);
}

export function toNumber(v: MoneyInput): number {
  const d = parseAmount(v);
  return d ? d.toNumber() : 0;
}

export function formatMoney(v: MoneyInput, currency = "EUR", locale = "it-IT"): string {
  const d = parseAmount(v) ?? new Prisma.Decimal(0);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(d.toNumber());
}
