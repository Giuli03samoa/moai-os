import { Prisma } from "@prisma/client";

/**
 * Pure, deterministic matching rules (no I/O) so they can be unit-tested exhaustively.
 *
 * Accounting principle enforced across MOAI OS:
 *   revenue  = orders (Shopify), net of refunds
 *   payments = evidence that an order was paid (never added to revenue)
 *   payouts  = transfers gateway → bank of money already counted (never revenue)
 *   fees     = cost, derived from the processor ledger
 * Reconciliation only LINKS these records; it never creates amounts.
 */

export type MatchOutcome<T> =
  | { kind: "auto"; target: T; rule: string; confidence: "EXACT"; explanation: string; difference: Prisma.Decimal }
  | { kind: "suggest"; targets: Array<{ target: T; confidence: "HIGH" | "LOW"; explanation: string; difference: Prisma.Decimal }>; rule: string }
  | { kind: "none"; reason: string };

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const TOL = D("0.01");

export function normalizeOrderRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const s = ref.trim().toUpperCase().replace(/^ORDER\s*|^ORDINE\s*/i, "").replace(/^#/, "").replace(/\s+/g, "");
  return s.length ? s : null;
}

/** Finds order references like "#1001", "ordine 1001", "order MOAI1001" inside free text. */
export function extractOrderRefs(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:#|ordine\s*n?\.?\s*|order\s*(?:no\.?|n\.?)?\s*#?)([A-Z]{0,6}\d{3,10})/gi)) out.add(m[1]!.toUpperCase());
  return [...out];
}

const DAY = 86_400_000;

// ───────────── processor transaction ↔ order ─────────────

export type ProcessorTx = {
  id: string;
  provider: string;
  amount: Prisma.Decimal;
  currency: string;
  processedAt: Date;
  orderRef: string | null;
  orderTransactionExternalId: string | null;
};

export type OrderCandidate = {
  id: string;
  name: string;
  currency: string;
  totalPrice: Prisma.Decimal;
  processedAt: Date;
  orderTransactions: Array<{ externalId: string; amount: Prisma.Decimal; gateway: string | null; kind: string }>;
};

export function matchPaymentToOrder(tx: ProcessorTx, orders: OrderCandidate[]): MatchOutcome<OrderCandidate> {
  // R1: the processor explicitly references the store's order transaction.
  if (tx.orderTransactionExternalId) {
    const o = orders.find((c) => c.orderTransactions.some((t) => t.externalId === tx.orderTransactionExternalId));
    if (o) {
      return { kind: "auto", target: o, rule: "R1_ORDER_TRANSACTION_ID", confidence: "EXACT", explanation: `Riferimento transazione ${tx.orderTransactionExternalId} presente nell'ordine ${o.name}`, difference: D(0) };
    }
  }

  // R2: explicit order reference + same currency.
  const ref = normalizeOrderRef(tx.orderRef);
  if (ref) {
    const byRef = orders.filter((o) => normalizeOrderRef(o.name) === ref && o.currency === tx.currency);
    if (byRef.length === 1) {
      const o = byRef[0]!;
      const matchesCapture = o.orderTransactions.some((t) => (t.kind === "CAPTURE" || t.kind === "SALE") && t.amount.minus(tx.amount).abs().lte(TOL));
      const diff = o.totalPrice.minus(tx.amount);
      if (matchesCapture || diff.abs().lte(TOL)) {
        return { kind: "auto", target: o, rule: "R2_ORDER_REF_AMOUNT", confidence: "EXACT", explanation: `Riferimento ordine ${o.name} e importo coincidenti`, difference: diff };
      }
      // Same reference, different amount: partial payment / split tender → human.
      return {
        kind: "suggest",
        rule: "R2_ORDER_REF_AMOUNT_MISMATCH",
        targets: [{ target: o, confidence: "HIGH", explanation: `Riferimento ${o.name} corretto ma importo diverso (differenza ${diff.toFixed(2)} ${tx.currency}): pagamento parziale o multiplo?`, difference: diff }],
      };
    }
    if (byRef.length > 1) {
      return { kind: "suggest", rule: "R2_ORDER_REF_AMBIGUOUS", targets: byRef.slice(0, 3).map((o) => ({ target: o, confidence: "LOW" as const, explanation: `Più ordini con riferimento ${ref}`, difference: o.totalPrice.minus(tx.amount) })) };
    }
  }

  // R3: no usable reference → same currency, same captured amount, ±3 days. Never automatic.
  const window = orders.filter(
    (o) =>
      o.currency === tx.currency &&
      Math.abs(o.processedAt.getTime() - tx.processedAt.getTime()) <= 3 * DAY &&
      (o.orderTransactions.some((t) => (t.kind === "CAPTURE" || t.kind === "SALE") && t.amount.minus(tx.amount).abs().lte(TOL)) || o.totalPrice.minus(tx.amount).abs().lte(TOL)),
  );
  if (window.length === 1) {
    const o = window[0]!;
    return { kind: "suggest", rule: "R3_AMOUNT_DATE_UNIQUE", targets: [{ target: o, confidence: "HIGH", explanation: `Unico ordine con importo ${tx.amount.toFixed(2)} ${tx.currency} entro 3 giorni (nessun riferimento esplicito)`, difference: D(0) }] };
  }
  if (window.length > 1) {
    return {
      kind: "suggest",
      rule: "R3_AMOUNT_DATE_AMBIGUOUS",
      targets: window
        .sort((a, b) => Math.abs(a.processedAt.getTime() - tx.processedAt.getTime()) - Math.abs(b.processedAt.getTime() - tx.processedAt.getTime()))
        .slice(0, 3)
        .map((o) => ({ target: o, confidence: "LOW" as const, explanation: `${window.length} ordini con stesso importo entro 3 giorni: scegli manualmente`, difference: D(0) })),
    };
  }
  return { kind: "none", reason: "Nessun ordine compatibile per riferimento, importo, valuta e data" };
}

// ───────────── payout ↔ bank credit ─────────────

export type PayoutLike = {
  id: string;
  provider: string;
  externalId: string;
  bankReference: string | null;
  netAmount: Prisma.Decimal;
  currency: string;
  issuedAt: Date;
  arrivalDate: Date | null;
};

export type BankCredit = {
  id: string;
  amount: Prisma.Decimal; // signed, credits > 0
  currency: string;
  bookingDate: Date;
  valueDate: Date | null;
  description: string;
  reference: string | null;
  counterparty: string | null;
};

const PROVIDER_KEYWORDS: Record<string, string[]> = {
  shopify_payments: ["SHOPIFY"],
  paypal: ["PAYPAL"],
  stripe: ["STRIPE"],
  satispay: ["SATISPAY"],
  klarna: ["KLARNA"],
  scalapay: ["SCALAPAY"],
  amazon_pay: ["AMAZON"],
};

export function matchPayoutToBank(p: PayoutLike, bank: BankCredit[]): MatchOutcome<BankCredit> {
  const credits = bank.filter((b) => b.amount.gt(0) && b.currency === p.currency);
  const sameAmount = credits.filter((b) => b.amount.minus(p.netAmount).abs().lte(TOL));
  const text = (b: BankCredit) => `${b.description} ${b.reference ?? ""} ${b.counterparty ?? ""}`.toUpperCase();

  // R1: payout identifier visible on the bank statement and amount equal.
  const ids = [p.externalId, p.bankReference].filter((x): x is string => !!x && x.length >= 6).map((x) => x.toUpperCase().replace(/^GID:\/\/SHOPIFY\/SHOPIFYPAYMENTSPAYOUT\//, ""));
  const byRef = sameAmount.filter((b) => ids.some((id) => text(b).includes(id)));
  if (byRef.length === 1) {
    return { kind: "auto", target: byRef[0]!, rule: "P1_PAYOUT_REF_AMOUNT", confidence: "EXACT", explanation: `Riferimento payout presente nella causale bancaria e importo netto coincidente`, difference: D(0) };
  }

  // R2: same net amount, provider keyword, date window [issued-1d, arrival|issued + 7d].
  const from = p.issuedAt.getTime() - DAY;
  const to = (p.arrivalDate ?? p.issuedAt).getTime() + 7 * DAY;
  const keywords = PROVIDER_KEYWORDS[p.provider] ?? [p.provider.toUpperCase()];
  const inWindow = sameAmount.filter((b) => {
    const t = (b.valueDate ?? b.bookingDate).getTime();
    return t >= from && t <= to;
  });
  const withKeyword = inWindow.filter((b) => keywords.some((k) => text(b).includes(k)));
  if (withKeyword.length === 1) {
    return { kind: "suggest", rule: "P2_AMOUNT_DATE_PROVIDER", targets: [{ target: withKeyword[0]!, confidence: "HIGH", explanation: `Importo netto e finestra date coincidono, causale cita ${keywords[0]}`, difference: D(0) }] };
  }
  const pool = withKeyword.length > 1 ? withKeyword : inWindow;
  if (pool.length >= 1) {
    return { kind: "suggest", rule: "P3_AMOUNT_DATE", targets: pool.slice(0, 3).map((b) => ({ target: b, confidence: "LOW" as const, explanation: pool.length > 1 ? `${pool.length} accrediti con stesso importo: scegli manualmente` : "Importo e data coincidono ma la causale non cita il gateway", difference: D(0) })) };
  }
  return { kind: "none", reason: "Nessun accredito bancario con importo netto, valuta e data compatibili" };
}

/** Checks that the transactions assigned to a payout add up to its net amount. */
export function payoutIntegrity(payoutNet: Prisma.Decimal, txs: Array<{ kind: string; amount: Prisma.Decimal; fee: Prisma.Decimal | null; net: Prisma.Decimal | null }>) {
  let computed = D(0);
  for (const t of txs) {
    const sign = ["REFUND", "CHARGEBACK", "FEE"].includes(t.kind) ? -1 : 1;
    const net = t.net ?? t.amount.minus(t.fee ?? 0);
    // Net is signed by some providers (refund net negative) and not by others: normalise by kind.
    // Adjustments can go either way, so their sign is taken as given.
    computed = computed.plus(t.kind === "ADJUSTMENT" ? net : net.abs().times(sign));
  }
  const difference = payoutNet.minus(computed);
  return { computed, difference, balanced: difference.abs().lte(TOL) };
}
