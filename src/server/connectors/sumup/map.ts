import { Prisma, type PaymentKind, type PaymentStatus, type PayoutStatus } from "@prisma/client";
import type { SumUpHistoryItem, SumUpPayoutRecord, SumUpTransaction } from "./client";

const D = (n: number | string | null | undefined) => new Prisma.Decimal(n ?? 0);

/** Everything except e-commerce links is a face-to-face sale: there is no online order to match. */
export function isInPerson(paymentType: string | undefined) {
  return (paymentType ?? "").toUpperCase() !== "ECOM";
}

export function mapKind(type: string | undefined): PaymentKind {
  switch ((type ?? "PAYMENT").toUpperCase()) {
    case "REFUND": return "REFUND";
    case "CHARGE_BACK": return "CHARGEBACK";
    default: return "SALE";
  }
}

/** A sale later refunded keeps SUCCESS: the refund is its own row and must not erase the sale. */
export function mapStatus(status: string | undefined): PaymentStatus {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESSFUL":
    case "REFUNDED":
    case "PAID_OUT": return "SUCCESS";
    case "PENDING": return "PENDING";
    case "CANCELLED": return "VOIDED";
    case "FAILED": return "FAILURE";
    default: return "ERROR";
  }
}

export type MappedTransaction = {
  externalId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal | null;
  net: Prisma.Decimal | null;
  currency: string;
  processedAt: Date;
  gateway: string;
  orderRef: string | null;
  inPerson: boolean;
  raw: Prisma.InputJsonValue;
};

/** History item (+ optional detail) → PROCESSOR-ledger row. Returns null when the item cannot be identified. */
export function mapTransaction(item: SumUpHistoryItem, detail?: SumUpTransaction | null): MappedTransaction | null {
  const externalId = item.id ?? item.transaction_id;
  if (!externalId || !item.timestamp) return null;
  const amount = D(item.amount).abs();
  const feeRaw = detail?.fee_amount ?? detail?.events?.find((e) => e.type === "PAYOUT" && typeof e.fee_amount === "number")?.fee_amount;
  const fee = typeof feeRaw === "number" ? D(feeRaw).abs() : null;
  const kind = mapKind(item.type);
  const method = [item.payment_type, item.entry_mode && item.entry_mode !== "na" && item.entry_mode !== "none" ? item.entry_mode : null, item.card_type && item.card_type !== "UNKNOWN" ? item.card_type : null].filter(Boolean).join(" · ");
  return {
    externalId,
    kind,
    status: mapStatus(item.status),
    amount,
    fee,
    net: fee && kind === "SALE" ? amount.minus(fee) : null,
    currency: (item.currency ?? "EUR").toUpperCase(),
    processedAt: new Date(item.timestamp),
    gateway: method || "sumup",
    orderRef: item.transaction_code ?? null,
    inPerson: isInPerson(item.payment_type),
    raw: {
      transactionCode: item.transaction_code ?? null,
      type: item.type ?? null,
      status: item.status ?? null,
      paymentType: item.payment_type ?? null,
      entryMode: item.entry_mode ?? null,
      cardType: item.card_type ?? null,
      summary: item.product_summary ?? null,
      refundedAmount: item.refunded_amount ?? null,
      payoutDate: item.payout_date ?? null,
      ...(detail
        ? {
            vatAmount: detail.vat_amount ?? null,
            tipAmount: detail.tip_amount ?? null,
            products: (detail.products ?? []).slice(0, 50).map((p) => ({ name: p.name ?? null, quantity: p.quantity ?? null, priceWithVat: p.price_with_vat ?? p.price ?? null, totalWithVat: p.total_with_vat ?? p.total_price ?? null, vatRate: p.vat_rate ?? null })),
            vatRates: (detail.vat_rates ?? []).slice(0, 10).map((v) => ({ rate: v.rate ?? null, net: v.net ?? null, vat: v.vat ?? null, gross: v.gross ?? null })),
          }
        : {}),
    } as Prisma.InputJsonValue,
  };
}

export type MappedPayout = {
  externalId: string;
  status: PayoutStatus;
  issuedAt: Date;
  grossAmount: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  currency: string;
  bankReference: string | null;
  /** transaction_code → fee charged on that sale inside this payout */
  transactions: Array<{ transactionCode: string; fee: Prisma.Decimal; amount: Prisma.Decimal }>;
};

/**
 * SumUp lists one record per transaction; records with the same reference and date are one bank transfer.
 * PAYOUT.amount is what reaches the bank for that sale (already net of `fee`); deduction records
 * (refunds, chargebacks, balance adjustments) reduce the transfer.
 */
export function groupPayouts(records: SumUpPayoutRecord[]): MappedPayout[] {
  const groups = new Map<string, SumUpPayoutRecord[]>();
  for (const r of records) {
    if (!r || !r.date) continue;
    const key = `${r.reference || "payout"}|${r.date}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: MappedPayout[] = [];
  for (const [key, rows] of groups) {
    const payouts = rows.filter((r) => r.type === "PAYOUT");
    const deductions = rows.filter((r) => r.type !== "PAYOUT");
    const paid = payouts.reduce((s, r) => s.plus(D(r.amount)), D(0));
    const fees = payouts.reduce((s, r) => s.plus(D(r.fee).abs()), D(0));
    const deducted = deductions.reduce((s, r) => s.plus(D(r.amount).abs()), D(0));
    const allFailed = rows.every((r) => r.status === "FAILED");
    out.push({
      externalId: key,
      status: allFailed ? "FAILED" : "PAID",
      issuedAt: new Date(`${rows[0]!.date}T12:00:00Z`),
      grossAmount: paid.plus(fees),
      feeAmount: fees,
      netAmount: paid.minus(deducted),
      currency: (rows[0]!.currency ?? "EUR").toUpperCase(),
      bankReference: rows[0]!.reference || null,
      transactions: payouts.filter((r) => r.transaction_code).map((r) => ({ transactionCode: r.transaction_code, fee: D(r.fee).abs(), amount: D(r.amount) })),
    });
  }
  return out.sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());
}
