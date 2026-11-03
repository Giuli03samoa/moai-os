import Papa from "papaparse";
import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import type { PaymentKind, PaymentStatus, PayoutStatus, ShipmentStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { parseAmount } from "../money";
import { sha256Hex } from "../crypto";

/**
 * Configurable CSV mapping. Each gateway/bank exports a different layout, so the mapping
 * (column names, number/date format, value dictionaries) is data, not code.
 * Presets below are STARTING POINTS based on publicly documented export layouts:
 * always check the preview against a real export before committing.
 */

export const mappingSchema = z.object({
  kind: z.enum(["PAYMENTS", "PAYOUTS", "BANK", "SHIPMENTS"]),
  provider: z.string().min(1).max(40).optional(),
  delimiter: z.enum([",", ";", "\t", "auto"]).default("auto"),
  decimalSeparator: z.enum([".", ","]).default("."),
  dateFormat: z.enum(["ISO", "DD/MM/YYYY", "MM/DD/YYYY", "DD.MM.YYYY"]).default("ISO"),
  timezone: z.string().default("Europe/Rome"),
  columns: z.record(z.string(), z.string()), // targetField → CSV header
  valueMaps: z.record(z.string(), z.record(z.string(), z.string())).default({}), // field → (csv value → enum)
  defaults: z.record(z.string(), z.string()).default({}),
  skipWhen: z.record(z.string(), z.array(z.string())).default({}), // CSV header → values that mark a row to ignore
  absoluteAmounts: z.boolean().default(true),
});
export type CsvMapping = z.infer<typeof mappingSchema>;

export const FIELDS: Record<CsvMapping["kind"], { required: string[]; optional: string[] }> = {
  PAYMENTS: { required: ["externalId", "amount", "date"], optional: ["time", "kind", "status", "fee", "net", "currency", "orderRef", "payoutId", "parentExternalId", "gateway"] },
  PAYOUTS: { required: ["externalId", "netAmount", "date"], optional: ["arrivalDate", "status", "grossAmount", "feeAmount", "currency", "bankReference"] },
  BANK: { required: ["bookingDate", "amount", "description"], optional: ["externalId", "valueDate", "currency", "counterparty", "reference", "credit", "debit"] },
  SHIPMENTS: { required: ["reference"], optional: ["orderRef", "trackingNumber", "carrier", "service", "status", "cost", "currency", "shippedAt", "deliveredAt"] },
};

export const PRESETS: Record<string, CsvMapping> = {
  "stripe-balance-history": {
    kind: "PAYMENTS",
    provider: "stripe",
    delimiter: ",",
    decimalSeparator: ".",
    dateFormat: "ISO",
    timezone: "UTC",
    columns: { externalId: "id", kind: "Type", amount: "Amount", fee: "Fee", net: "Net", currency: "Currency", date: "Created (UTC)", orderRef: "Description", payoutId: "Transfer" },
    valueMaps: { kind: { charge: "SALE", payment: "SALE", refund: "REFUND", payment_refund: "REFUND", adjustment: "ADJUSTMENT", dispute: "CHARGEBACK", stripe_fee: "FEE" } },
    defaults: { status: "SUCCESS" },
    skipWhen: { Type: ["payout", "transfer"] },
    absoluteAmounts: true,
  },
  "paypal-activity": {
    kind: "PAYMENTS",
    provider: "paypal",
    delimiter: "auto",
    decimalSeparator: ",",
    dateFormat: "DD/MM/YYYY",
    timezone: "Europe/Rome",
    columns: { externalId: "Codice transazione", date: "Data", time: "Orario", kind: "Tipo", status: "Stato", currency: "Valuta", amount: "Lordo", fee: "Tariffa", net: "Netto", orderRef: "Numero fattura", parentExternalId: "Codice transazione di riferimento" },
    valueMaps: {
      kind: { "Pagamento Express Checkout": "SALE", "Pagamento sul sito web": "SALE", "Pagamento con carta di credito o debito": "SALE", Rimborso: "REFUND", "Rimborso pagamento": "REFUND", Chargeback: "CHARGEBACK", Storno: "CHARGEBACK" },
      status: { Completata: "SUCCESS", Completato: "SUCCESS", "In sospeso": "PENDING", Rimborsato: "SUCCESS", Negata: "FAILURE" },
    },
    defaults: {},
    skipWhen: { Tipo: ["Bonifico bancario generico", "Trasferimento standard al conto bancario", "Conversione di valuta generica", "Prelievo generico con carta"] },
    absoluteAmounts: true,
  },
  "stripe-payouts": {
    kind: "PAYOUTS",
    provider: "stripe",
    delimiter: ",",
    decimalSeparator: ".",
    dateFormat: "ISO",
    timezone: "UTC",
    columns: { externalId: "id", netAmount: "Amount", currency: "Currency", date: "Created (UTC)", arrivalDate: "Arrival Date (UTC)", status: "Status" },
    valueMaps: { status: { paid: "PAID", in_transit: "IN_TRANSIT", pending: "SCHEDULED", failed: "FAILED", canceled: "CANCELED" } },
    defaults: {},
    skipWhen: {},
    absoluteAmounts: true,
  },
  "banca-generico-it": {
    kind: "BANK",
    delimiter: ";",
    decimalSeparator: ",",
    dateFormat: "DD/MM/YYYY",
    timezone: "Europe/Rome",
    columns: { bookingDate: "Data contabile", valueDate: "Data valuta", amount: "Importo", description: "Descrizione" },
    valueMaps: {},
    defaults: { currency: "EUR" },
    skipWhen: {},
    absoluteAmounts: false,
  },
  "packlink-pro-spedizioni": {
    kind: "SHIPMENTS",
    provider: "packlink",
    delimiter: "auto",
    decimalSeparator: ",",
    dateFormat: "DD/MM/YYYY",
    timezone: "Europe/Rome",
    columns: { reference: "Riferimento", orderRef: "Riferimento ordine", trackingNumber: "Numero di tracking", carrier: "Corriere", service: "Servizio", status: "Stato", cost: "Prezzo", shippedAt: "Data" },
    valueMaps: { status: { Consegnato: "DELIVERED", "In transito": "IN_TRANSIT", "Pronto per la spedizione": "READY", "In attesa": "PENDING", Incidenza: "EXCEPTION", Annullato: "CANCELLED", Restituito: "RETURNED" } },
    defaults: { currency: "EUR" },
    skipWhen: {},
    absoluteAmounts: true,
  },
};

export type RowError = { row: number; message: string };

export type NormalizedPayment = {
  externalId: string; kind: PaymentKind; status: PaymentStatus; amount: Prisma.Decimal; fee: Prisma.Decimal | null; net: Prisma.Decimal | null;
  currency: string; processedAt: Date; orderRef: string | null; payoutExternalId: string | null; parentExternalId: string | null; gateway: string | null; raw: Record<string, string>;
};
export type NormalizedPayout = {
  externalId: string; status: PayoutStatus; netAmount: Prisma.Decimal; grossAmount: Prisma.Decimal | null; feeAmount: Prisma.Decimal | null;
  currency: string; issuedAt: Date; arrivalDate: Date | null; bankReference: string | null;
};
export type NormalizedBank = {
  externalId: string; bookingDate: Date; valueDate: Date | null; amount: Prisma.Decimal; currency: string; description: string; counterparty: string | null; reference: string | null;
};
export type NormalizedShipment = {
  reference: string; orderRef: string | null; trackingNumber: string | null; carrier: string | null; service: string | null; status: ShipmentStatus; rawStatus: string | null;
  cost: Prisma.Decimal | null; currency: string; shippedAt: Date | null; deliveredAt: Date | null;
};

export type ParseResult<T> = { headers: string[]; rows: T[]; errors: RowError[]; skipped: number; total: number };

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;

export function readCsv(text: string, delimiter: CsvMapping["delimiter"]) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const res = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: delimiter === "auto" ? "" : delimiter,
    transformHeader: (h) => h.trim().replace(/^"|"$/g, ""),
  });
  if (res.data.length > MAX_CSV_ROWS) throw new Error(`Troppe righe (max ${MAX_CSV_ROWS})`);
  return { headers: res.meta.fields ?? [], data: res.data, parseErrors: res.errors.slice(0, 20).map((e) => ({ row: (e.row ?? 0) + 2, message: e.message })) };
}

export function parseDate(value: string | undefined, format: CsvMapping["dateFormat"], tz: string, time?: string): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (format === "ISO") {
    // "2026-10-01 12:30:00" without offset is interpreted in the mapping timezone.
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?/);
    if (!m) return null;
    if (m[7]) return new Date(v.replace(" ", "T"));
    return plain(new TZDate(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), tz === "UTC" ? "UTC" : tz));
  }
  const m = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [d, mo] = format === "MM/DD/YYYY" ? [+m[2]!, +m[1]!] : [+m[1]!, +m[2]!];
  let y = +m[3]!;
  if (y < 100) y += 2000;
  let hh = +(m[4] ?? 0), mi = +(m[5] ?? 0), ss = +(m[6] ?? 0);
  const t = time?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (t) [hh, mi, ss] = [+t[1]!, +t[2]!, +(t[3] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return plain(new TZDate(y, mo - 1, d, hh, mi, ss, tz));
}

/** TZDate carries its own offset in toISOString(); downstream code and Prisma get a plain UTC Date. */
function plain(d: Date): Date {
  return new Date(d.getTime());
}

function getter(m: CsvMapping, row: Record<string, string>) {
  return (field: string): string | undefined => {
    const col = m.columns[field];
    const v = col ? row[col]?.trim() : undefined;
    return v === undefined || v === "" ? m.defaults[field] : v;
  };
}

function mapValue(m: CsvMapping, field: string, raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const dict = m.valueMaps[field];
  if (!dict) return raw.toUpperCase();
  return dict[raw] ?? dict[raw.toLowerCase()] ?? undefined;
}

function shouldSkip(m: CsvMapping, row: Record<string, string>) {
  return Object.entries(m.skipWhen).some(([col, values]) => values.includes((row[col] ?? "").trim()));
}

function amount(m: CsvMapping, raw: string | undefined) {
  const d = parseAmount(raw, { decimalSeparator: m.decimalSeparator });
  return d && m.absoluteAmounts ? d.abs() : d;
}

export function missingColumns(m: CsvMapping, headers: string[]) {
  return FIELDS[m.kind].required.filter((f) => !(f in m.defaults) && !(m.columns[f] && headers.includes(m.columns[f]!)));
}

const PAYMENT_KINDS = ["AUTHORIZATION", "CAPTURE", "SALE", "REFUND", "CHARGEBACK", "CHARGEBACK_REVERSAL", "FEE", "ADJUSTMENT", "VOID"];
const PAYMENT_STATUS = ["PENDING", "SUCCESS", "FAILURE", "ERROR", "VOIDED"];

export function parsePayments(text: string, m: CsvMapping): ParseResult<NormalizedPayment> {
  const { headers, data, parseErrors } = readCsv(text, m.delimiter);
  const errors: RowError[] = [...parseErrors];
  const missing = missingColumns(m, headers);
  if (missing.length) return { headers, rows: [], errors: [{ row: 1, message: `Colonne obbligatorie mancanti: ${missing.join(", ")}` }], skipped: 0, total: data.length };
  const rows: NormalizedPayment[] = [];
  let skipped = 0;
  data.forEach((row, i) => {
    const n = i + 2;
    if (shouldSkip(m, row)) return void skipped++;
    const g = getter(m, row);
    const rawKind = g("kind");
    const kind = rawKind === undefined ? "SALE" : mapValue(m, "kind", rawKind);
    if (!kind || !PAYMENT_KINDS.includes(kind)) return void errors.push({ row: n, message: `Tipo "${rawKind}" non mappato` });
    const status = g("status") === undefined ? "SUCCESS" : mapValue(m, "status", g("status"));
    if (!status || !PAYMENT_STATUS.includes(status)) return void errors.push({ row: n, message: `Stato "${g("status")}" non mappato` });
    const amt = amount(m, g("amount"));
    const date = parseDate(g("date"), m.dateFormat, m.timezone, g("time"));
    const externalId = g("externalId");
    if (!externalId) return void errors.push({ row: n, message: "Identificativo transazione mancante" });
    if (!amt) return void errors.push({ row: n, message: `Importo non valido: "${g("amount")}"` });
    if (!date) return void errors.push({ row: n, message: `Data non valida: "${g("date")}"` });
    const fee = amount(m, g("fee"));
    const net = amount(m, g("net"));
    rows.push({
      externalId, kind: kind as PaymentKind, status: status as PaymentStatus, amount: amt, fee, net: net ?? (fee ? amt.minus(fee) : null),
      currency: (g("currency") ?? "EUR").toUpperCase(), processedAt: date, orderRef: g("orderRef") ?? null, payoutExternalId: g("payoutId") ?? null,
      parentExternalId: g("parentExternalId") ?? null, gateway: g("gateway") ?? m.provider ?? null, raw: row,
    });
  });
  return { headers, rows, errors, skipped, total: data.length };
}

export function parsePayouts(text: string, m: CsvMapping): ParseResult<NormalizedPayout> {
  const { headers, data, parseErrors } = readCsv(text, m.delimiter);
  const errors: RowError[] = [...parseErrors];
  const missing = missingColumns(m, headers);
  if (missing.length) return { headers, rows: [], errors: [{ row: 1, message: `Colonne obbligatorie mancanti: ${missing.join(", ")}` }], skipped: 0, total: data.length };
  const rows: NormalizedPayout[] = [];
  let skipped = 0;
  data.forEach((row, i) => {
    const n = i + 2;
    if (shouldSkip(m, row)) return void skipped++;
    const g = getter(m, row);
    const net = amount(m, g("netAmount"));
    const date = parseDate(g("date"), m.dateFormat, m.timezone);
    const externalId = g("externalId");
    const status = g("status") === undefined ? "PAID" : mapValue(m, "status", g("status"));
    if (!externalId || !net || !date) return void errors.push({ row: n, message: "ID, importo netto o data non validi" });
    if (!status || !["SCHEDULED", "IN_TRANSIT", "PAID", "FAILED", "CANCELED"].includes(status)) return void errors.push({ row: n, message: `Stato "${g("status")}" non mappato` });
    rows.push({
      externalId, status: status as PayoutStatus, netAmount: net, grossAmount: amount(m, g("grossAmount")), feeAmount: amount(m, g("feeAmount")),
      currency: (g("currency") ?? "EUR").toUpperCase(), issuedAt: date, arrivalDate: parseDate(g("arrivalDate"), m.dateFormat, m.timezone), bankReference: g("bankReference") ?? null,
    });
  });
  return { headers, rows, errors, skipped, total: data.length };
}

export function parseBank(text: string, m: CsvMapping): ParseResult<NormalizedBank> {
  const { headers, data, parseErrors } = readCsv(text, m.delimiter);
  const errors: RowError[] = [...parseErrors];
  // Banks either give one signed "Importo" column or separate Dare/Avere columns.
  const hasSplit = m.columns.credit && m.columns.debit;
  const req = hasSplit ? { ...m, columns: { ...m.columns, amount: m.columns.credit! } } : m;
  const missing = missingColumns(req, headers);
  if (missing.length) return { headers, rows: [], errors: [{ row: 1, message: `Colonne obbligatorie mancanti: ${missing.join(", ")}` }], skipped: 0, total: data.length };
  const rows: NormalizedBank[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  data.forEach((row, i) => {
    const n = i + 2;
    if (shouldSkip(m, row)) return void skipped++;
    const g = getter(m, row);
    let amt: Prisma.Decimal | null;
    if (hasSplit) {
      const c = parseAmount(g("credit"), { decimalSeparator: m.decimalSeparator });
      const d = parseAmount(g("debit"), { decimalSeparator: m.decimalSeparator });
      amt = c && !c.isZero() ? c.abs() : d ? d.abs().negated() : null;
    } else amt = parseAmount(g("amount"), { decimalSeparator: m.decimalSeparator });
    const bookingDate = parseDate(g("bookingDate"), m.dateFormat, m.timezone);
    const description = g("description") ?? "";
    if (!amt || !bookingDate) return void errors.push({ row: n, message: "Data o importo non validi" });
    // Stable id when the bank gives none: hash of the row content + occurrence index (identical rows stay distinct, re-imports stay idempotent).
    let externalId = g("externalId");
    if (!externalId) {
      const base = sha256Hex([bookingDate.toISOString(), amt.toFixed(2), description, g("valueDate") ?? ""].join("|")).slice(0, 32);
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      externalId = `${base}-${k}`;
    }
    rows.push({ externalId, bookingDate, valueDate: parseDate(g("valueDate"), m.dateFormat, m.timezone), amount: amt, currency: (g("currency") ?? "EUR").toUpperCase(), description, counterparty: g("counterparty") ?? null, reference: g("reference") ?? null });
  });
  return { headers, rows, errors, skipped, total: data.length };
}

const SHIP_STATUS = ["PENDING", "READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION", "RETURNED", "CANCELLED", "UNKNOWN"];

export function parseShipments(text: string, m: CsvMapping): ParseResult<NormalizedShipment> {
  const { headers, data, parseErrors } = readCsv(text, m.delimiter);
  const errors: RowError[] = [...parseErrors];
  const missing = missingColumns(m, headers);
  if (missing.length) return { headers, rows: [], errors: [{ row: 1, message: `Colonne obbligatorie mancanti: ${missing.join(", ")}` }], skipped: 0, total: data.length };
  const rows: NormalizedShipment[] = [];
  data.forEach((row, i) => {
    const g = getter(m, row);
    const reference = g("reference");
    if (!reference) return void errors.push({ row: i + 2, message: "Riferimento spedizione mancante" });
    const rawStatus = g("status") ?? null;
    const mapped = rawStatus ? mapValue(m, "status", rawStatus) : undefined;
    rows.push({
      reference, orderRef: g("orderRef") ?? null, trackingNumber: g("trackingNumber") ?? null, carrier: g("carrier") ?? null, service: g("service") ?? null,
      status: (mapped && SHIP_STATUS.includes(mapped) ? mapped : "UNKNOWN") as ShipmentStatus, rawStatus,
      cost: amount(m, g("cost")), currency: (g("currency") ?? "EUR").toUpperCase(),
      shippedAt: parseDate(g("shippedAt"), m.dateFormat, m.timezone), deliveredAt: parseDate(g("deliveredAt"), m.dateFormat, m.timezone),
    });
  });
  return { headers, rows, errors, skipped: 0, total: data.length };
}
