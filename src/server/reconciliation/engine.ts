import { Prisma, type ReconciliationType } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { extractOrderRefs, matchPaymentToOrder, matchPayoutToBank, normalizeOrderRef, type MatchOutcome } from "./rules";

const DAY = 86_400_000;
const SETTLED = ["AUTO_MATCHED", "CONFIRMED"] as const;

async function saveOutcome<T extends { id: string }>(args: {
  organizationId: string;
  type: ReconciliationType;
  leftId: string;
  outcome: MatchOutcome<T>;
  link: (targetId: string) => Partial<Prisma.ReconciliationUncheckedCreateInput>;
}) {
  const { outcome } = args;
  if (outcome.kind === "none") return { auto: 0, suggested: 0 };
  const rows =
    outcome.kind === "auto"
      ? [{ status: "AUTO_MATCHED" as const, confidence: outcome.confidence, target: outcome.target, explanation: outcome.explanation, difference: outcome.difference }]
      : outcome.targets.map((t) => ({ status: "SUGGESTED" as const, confidence: t.confidence, target: t.target, explanation: t.explanation, difference: t.difference }));
  let auto = 0;
  let suggested = 0;
  for (const r of rows) {
    const pairKey = `${args.type}:${args.leftId}:${r.target.id}`;
    const existing = await db.reconciliation.findUnique({ where: { organizationId_pairKey: { organizationId: args.organizationId, pairKey } } });
    if (existing && (existing.status === "REJECTED" || existing.status === "CONFIRMED")) continue; // human decisions are final
    await db.reconciliation.upsert({
      where: { organizationId_pairKey: { organizationId: args.organizationId, pairKey } },
      create: {
        organizationId: args.organizationId,
        type: args.type,
        pairKey,
        status: r.status,
        confidence: r.confidence,
        rule: outcome.rule,
        explanation: r.explanation,
        amountDifference: r.difference,
        ...args.link(r.target.id),
      },
      update: { status: r.status, confidence: r.confidence, rule: outcome.rule, explanation: r.explanation, amountDifference: r.difference },
    });
    if (r.status === "AUTO_MATCHED") auto++;
    else suggested++;
  }
  return { auto, suggested };
}

/** Processor-ledger transactions ↔ orders. */
export async function reconcilePayments(organizationId: string) {
  const txs = await db.paymentTransaction.findMany({
    where: {
      organizationId,
      ledger: "PROCESSOR",
      deletedAt: null,
      kind: { in: ["CAPTURE", "SALE", "REFUND", "CHARGEBACK"] },
      status: "SUCCESS",
      reconciliations: { none: { type: "PAYMENT_ORDER", status: { in: [...SETTLED] } } },
    },
    take: 2000,
    orderBy: { processedAt: "desc" },
  });
  let auto = 0;
  let suggested = 0;
  for (const tx of txs) {
    const ref = normalizeOrderRef(tx.orderRef);
    const orders = await db.order.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          ...(ref ? [{ name: { in: [ref, `#${ref}`] } }] : []),
          ...(tx.orderTransactionExternalId ? [{ payments: { some: { ledger: "ORDER" as const, externalId: tx.orderTransactionExternalId } } }] : []),
          { processedAt: { gte: new Date(tx.processedAt.getTime() - 4 * DAY), lte: new Date(tx.processedAt.getTime() + 4 * DAY) }, currency: tx.currency },
        ],
      },
      include: { payments: { where: { ledger: "ORDER", status: "SUCCESS" }, select: { externalId: true, amount: true, gateway: true, kind: true } } },
      take: 200,
    });
    // Refunds/chargebacks match by reference only (amount ≠ order total by design).
    const candidates = orders.map((o) => ({ ...o, orderTransactions: o.payments }));
    const outcome =
      tx.kind === "CAPTURE" || tx.kind === "SALE"
        ? matchPaymentToOrder(tx, candidates)
        : refundOutcome(tx, candidates);
    const r = await saveOutcome({ organizationId, type: "PAYMENT_ORDER", leftId: tx.id, outcome, link: (orderId) => ({ paymentTransactionId: tx.id, orderId }) });
    if (outcome.kind === "auto") await db.paymentTransaction.update({ where: { id: tx.id }, data: { orderId: outcome.target.id } });
    auto += r.auto;
    suggested += r.suggested;
  }
  return { examined: txs.length, auto, suggested };
}

function refundOutcome(
  tx: { orderRef: string | null; orderTransactionExternalId: string | null; currency: string },
  orders: Array<{ id: string; name: string; currency: string; orderTransactions: Array<{ externalId: string }> }>,
): MatchOutcome<(typeof orders)[number]> {
  if (tx.orderTransactionExternalId) {
    const o = orders.find((c) => c.orderTransactions.some((t) => t.externalId === tx.orderTransactionExternalId));
    if (o) return { kind: "auto", target: o, rule: "R1_ORDER_TRANSACTION_ID", confidence: "EXACT", explanation: `Rimborso collegato alla transazione dell'ordine ${o.name}`, difference: new Prisma.Decimal(0) };
  }
  const ref = normalizeOrderRef(tx.orderRef);
  const byRef = ref ? orders.filter((o) => normalizeOrderRef(o.name) === ref && o.currency === tx.currency) : [];
  if (byRef.length === 1) return { kind: "suggest", rule: "R4_REFUND_ORDER_REF", targets: [{ target: byRef[0]!, confidence: "HIGH", explanation: `Rimborso/chargeback con riferimento ${byRef[0]!.name}`, difference: new Prisma.Decimal(0) }] };
  return { kind: "none", reason: "Rimborso senza riferimento ordine univoco" };
}

/** Gateway payouts ↔ bank credits. */
export async function reconcilePayouts(organizationId: string) {
  const payouts = await db.payout.findMany({
    where: { organizationId, deletedAt: null, status: { in: ["PAID", "IN_TRANSIT"] }, reconciliations: { none: { type: "PAYOUT_BANK", status: { in: [...SETTLED] } } } },
    take: 1000,
  });
  let auto = 0;
  let suggested = 0;
  for (const p of payouts) {
    const bank = await db.bankTransaction.findMany({
      where: {
        organizationId,
        deletedAt: null,
        currency: p.currency,
        amount: { gt: 0 },
        bookingDate: { gte: new Date(p.issuedAt.getTime() - 2 * DAY), lte: new Date((p.arrivalDate ?? p.issuedAt).getTime() + 10 * DAY) },
        reconciliations: { none: { type: "PAYOUT_BANK", status: { in: [...SETTLED] } } },
      },
    });
    const outcome = matchPayoutToBank(p, bank);
    const r = await saveOutcome({ organizationId, type: "PAYOUT_BANK", leftId: p.id, outcome, link: (bankTransactionId) => ({ payoutId: p.id, bankTransactionId }) });
    auto += r.auto;
    suggested += r.suggested;
  }
  return { examined: payouts.length, auto, suggested };
}

/** Active invoice ↔ order, by DatiOrdineAcquisto (exact) or order refs found in Causale/lines (suggested). */
export async function proposeInvoiceOrderMatch(organizationId: string, invoiceId: string) {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, organizationId }, include: { lines: { select: { description: true } } } });
  if (!inv || inv.orderId) return;
  const structured = normalizeOrderRef(inv.orderReference);
  const freeText = [inv.causale, ...inv.lines.map((l) => l.description)].flatMap(extractOrderRefs);
  const refs = [...new Set([structured, ...freeText].filter((x): x is string => !!x))];
  if (!refs.length) return;
  const orders = await db.order.findMany({ where: { organizationId, deletedAt: null, name: { in: refs.flatMap((r) => [r, `#${r}`]) } } });
  if (orders.length !== 1) {
    for (const o of orders.slice(0, 3)) {
      await saveOutcome({
        organizationId, type: "INVOICE_ORDER", leftId: inv.id,
        outcome: { kind: "suggest", rule: "I3_AMBIGUOUS", targets: [{ target: o, confidence: "LOW", explanation: "Più ordini citati nella fattura", difference: o.totalPrice.minus(inv.totalAmount) }] },
        link: (orderId) => ({ invoiceId: inv.id, orderId }),
      });
    }
    return;
  }
  const o = orders[0]!;
  const diff = o.totalPrice.minus(inv.totalAmount);
  const exact = structured && normalizeOrderRef(o.name) === structured && diff.abs().lte("0.01");
  await saveOutcome({
    organizationId,
    type: "INVOICE_ORDER",
    leftId: inv.id,
    outcome: exact
      ? { kind: "auto", target: o, rule: "I1_ORDER_REF_AMOUNT", confidence: "EXACT", explanation: `DatiOrdineAcquisto = ${o.name}, totale coincidente`, difference: diff }
      : { kind: "suggest", rule: "I2_ORDER_REF_TEXT", targets: [{ target: o, confidence: structured ? "HIGH" : "LOW", explanation: `Ordine ${o.name} citato in fattura${diff.abs().gt("0.01") ? `, differenza importo ${diff.toFixed(2)}` : ""}`, difference: diff }] },
    link: (orderId) => ({ invoiceId: inv.id, orderId }),
  });
  if (exact) await db.invoice.update({ where: { id: inv.id }, data: { orderId: o.id } });
}

export async function runReconciliation(organizationId: string) {
  const payments = await reconcilePayments(organizationId);
  const payouts = await reconcilePayouts(organizationId);
  const invoices = await db.invoice.findMany({ where: { organizationId, direction: "ACTIVE", orderId: null, deletedAt: null }, select: { id: true }, take: 2000 });
  for (const i of invoices) await proposeInvoiceOrderMatch(organizationId, i.id);
  return { payments, payouts, invoicesExamined: invoices.length };
}

/** Human decision on a suggestion. Confirming links records; nothing is ever posted externally. */
export async function decideReconciliation(organizationId: string, id: string, decision: "CONFIRM" | "REJECT", userId: string) {
  const rec = await db.reconciliation.findFirst({ where: { id, organizationId } });
  if (!rec) throw new Error("Riconciliazione non trovata");
  if (rec.status === "CONFIRMED" || rec.status === "REJECTED") throw new Error("Decisione già registrata");
  await db.$transaction(async (tx) => {
    await tx.reconciliation.update({
      where: { id },
      data: { status: decision === "CONFIRM" ? "CONFIRMED" : "REJECTED", decidedById: userId, decidedAt: new Date() },
    });
    if (decision === "CONFIRM") {
      if (rec.type === "PAYMENT_ORDER" && rec.paymentTransactionId) await tx.paymentTransaction.update({ where: { id: rec.paymentTransactionId }, data: { orderId: rec.orderId } });
      if (rec.type === "INVOICE_ORDER" && rec.invoiceId) await tx.invoice.update({ where: { id: rec.invoiceId }, data: { orderId: rec.orderId } });
      // Competing suggestions on either side are closed.
      const sides = [
        rec.paymentTransactionId && { paymentTransactionId: rec.paymentTransactionId },
        rec.payoutId && { payoutId: rec.payoutId },
        rec.bankTransactionId && { bankTransactionId: rec.bankTransactionId },
        rec.invoiceId && { invoiceId: rec.invoiceId },
      ].filter(Boolean) as Prisma.ReconciliationWhereInput[];
      await tx.reconciliation.updateMany({
        where: { organizationId, type: rec.type, status: "SUGGESTED", id: { not: id }, OR: sides },
        data: { status: "REJECTED", decidedById: userId, decidedAt: new Date(), explanation: "Chiusa: confermata un'altra corrispondenza" },
      });
    }
  });
  await audit({ organizationId, userId, action: `reconciliation.${decision.toLowerCase()}`, entityType: "Reconciliation", entityId: id, metadata: { type: rec.type, rule: rec.rule } });
}

/** Manual link created by a user from the "non riconciliati" list. */
export async function manualLink(organizationId: string, userId: string, args: { type: ReconciliationType; leftId: string; rightId: string }) {
  const link: Partial<Prisma.ReconciliationUncheckedCreateInput> =
    args.type === "PAYMENT_ORDER"
      ? { paymentTransactionId: args.leftId, orderId: args.rightId }
      : args.type === "PAYOUT_BANK"
        ? { payoutId: args.leftId, bankTransactionId: args.rightId }
        : { invoiceId: args.leftId, orderId: args.rightId };
  // Tenant check on both sides.
  const ok =
    args.type === "PAYMENT_ORDER"
      ? (await db.paymentTransaction.count({ where: { id: args.leftId, organizationId } })) && (await db.order.count({ where: { id: args.rightId, organizationId } }))
      : args.type === "PAYOUT_BANK"
        ? (await db.payout.count({ where: { id: args.leftId, organizationId } })) && (await db.bankTransaction.count({ where: { id: args.rightId, organizationId } }))
        : (await db.invoice.count({ where: { id: args.leftId, organizationId } })) && (await db.order.count({ where: { id: args.rightId, organizationId } }));
  if (!ok) throw new Error("Record non trovati");
  const pairKey = `${args.type}:${args.leftId}:${args.rightId}`;
  const rec = await db.reconciliation.upsert({
    where: { organizationId_pairKey: { organizationId, pairKey } },
    create: { organizationId, type: args.type, pairKey, status: "SUGGESTED", confidence: "LOW", rule: "MANUAL", explanation: "Collegamento manuale", ...link },
    update: { status: "SUGGESTED" },
  });
  await decideReconciliation(organizationId, rec.id, "CONFIRM", userId);
}
