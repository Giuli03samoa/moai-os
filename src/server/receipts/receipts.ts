import { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";

/**
 * Fiscal documents for in-person sales (POS at events).
 * MOAI OS never issues them: the documento commerciale is typed by hand on the AdE portal, an invoice goes through
 * the usual channel. Here every in-person takings row is only ticked off, so that none is forgotten.
 */

export const FISCAL_DOC_KINDS = ["RECEIPT", "INVOICE"] as const;
export type FiscalDocKind = (typeof FISCAL_DOC_KINDS)[number];
export const FISCAL_DOC_LABEL: Record<FiscalDocKind, string> = { RECEIPT: "Scontrino", INVOICE: "Fattura" };

/** Standard rate for clothing: used only when the POS did not report the VAT of the sale. */
export const DEFAULT_VAT_RATE = 22;

/** Successful face-to-face sales: the rows that need a fiscal document. Refunds are separate rows and are not listed. */
export function inPersonSalesWhere(organizationId: string): Prisma.PaymentTransactionWhereInput {
  return { organizationId, deletedAt: null, ledger: "PROCESSOR", inPerson: true, status: "SUCCESS", kind: { in: ["SALE", "CAPTURE"] } };
}

export function pendingReceiptsWhere(organizationId: string): Prisma.PaymentTransactionWhereInput {
  return { ...inPersonSalesWhere(organizationId), fiscalDocAt: null };
}

export function countPendingReceipts(organizationId: string) {
  return db.paymentTransaction.count({ where: pendingReceiptsWhere(organizationId) });
}

export type VatSplit = { gross: string; net: string; vat: string; rate: number; fromPos: boolean };

/**
 * Splits a VAT-inclusive amount into taxable amount and VAT, the two figures the AdE form shows.
 * The VAT reported by the POS wins when it is plausible; otherwise the default rate is unbundled from the total.
 */
export function vatSplit(amount: Prisma.Decimal | number | string, posVat?: unknown, rate = DEFAULT_VAT_RATE): VatSplit {
  const gross = new Prisma.Decimal(amount);
  const reported = typeof posVat === "number" && Number.isFinite(posVat) ? new Prisma.Decimal(posVat) : null;
  if (reported && reported.gt(0) && reported.lt(gross)) {
    const net = gross.minus(reported);
    return { gross: gross.toFixed(2), net: net.toFixed(2), vat: reported.toFixed(2), rate: Number(reported.div(net).times(100).toFixed(0)), fromPos: true };
  }
  const net = gross.div(new Prisma.Decimal(100 + rate).div(100)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { gross: gross.toFixed(2), net: net.toFixed(2), vat: gross.minus(net).toFixed(2), rate, fromPos: false };
}

type RawSale = { vatAmount?: unknown; refundedAmount?: unknown; products?: { name?: string | null; quantity?: number | null }[] | null; summary?: string | null };

/** What was sold, as far as the POS knows: product names when the sale used the catalogue, else its summary line. */
export function saleDescription(raw: unknown): string | null {
  const r = (raw ?? {}) as RawSale;
  const names = (r.products ?? []).map((p) => (p?.name ? `${p.quantity && p.quantity > 1 ? `${p.quantity} × ` : ""}${p.name}` : null)).filter(Boolean);
  if (names.length) return names.join(", ");
  return typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : null;
}

export function refundedAmount(raw: unknown): number {
  const v = ((raw ?? {}) as RawSale).refundedAmount;
  return typeof v === "number" && v > 0 ? v : 0;
}

export function posVatAmount(raw: unknown): unknown {
  return ((raw ?? {}) as RawSale).vatAmount;
}

/** Ticks a sale as certified. Always a human statement about something done elsewhere: audited, reversible. */
export async function markFiscalDoc(organizationId: string, userId: string, id: string, input: { kind: FiscalDocKind; ref?: string | null }) {
  const tx = await db.paymentTransaction.findFirst({ where: { ...inPersonSalesWhere(organizationId), id } });
  if (!tx) throw new Error("Incasso non trovato tra le vendite in presenza");
  if (!FISCAL_DOC_KINDS.includes(input.kind)) throw new Error("Tipo di documento non valido");
  const ref = input.ref?.trim().slice(0, 60) || null;
  await db.paymentTransaction.update({ where: { id }, data: { fiscalDocKind: input.kind, fiscalDocRef: ref, fiscalDocAt: new Date() } });
  await audit({ organizationId, userId, action: "receipt.marked", entityType: "PaymentTransaction", entityId: id, metadata: { kind: input.kind, ref, amount: tx.amount.toFixed(2) } });
}

export async function clearFiscalDoc(organizationId: string, userId: string, id: string) {
  const tx = await db.paymentTransaction.findFirst({ where: { ...inPersonSalesWhere(organizationId), id } });
  if (!tx) throw new Error("Incasso non trovato tra le vendite in presenza");
  await db.paymentTransaction.update({ where: { id }, data: { fiscalDocKind: null, fiscalDocRef: null, fiscalDocAt: null } });
  await audit({ organizationId, userId, action: "receipt.unmarked", entityType: "PaymentTransaction", entityId: id, metadata: { was: tx.fiscalDocKind, ref: tx.fiscalDocRef } });
}
