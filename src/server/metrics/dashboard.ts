import { Prisma } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";

/**
 * Dashboard figures. Every metric carries its data source(s) and the time of the last sync
 * of the underlying table, so the UI can always say where a number comes from.
 *
 * Definitions (shown in the UI):
 *  - Vendite lorde   = Σ totale ordini (IVA e spedizione incluse), ordini non annullati e non di test
 *  - Vendite nette   = vendite lorde − rimborsi
 *  - Pagamenti acquisiti = Σ transazioni SALE/CAPTURE riuscite registrate sugli ordini (ledger ORDER)
 *  - Commissioni gateway = Σ fee dal ledger PROCESSOR (dove disponibile)
 *  - Accrediti liquidati = Σ netto payout con stato PAID (denaro già contato nelle vendite: NON è ricavo)
 */

export type Range = { from: Date; to: Date };

export type Metric = {
  key: string;
  label: string;
  value: string; // decimal string or integer string
  format: "money" | "count";
  currency?: string;
  sources: string[];
  updatedAt: Date | null;
  definition: string;
  href?: string;
};

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);

async function lastSync(orgId: string) {
  const [o, p, po, i, s, b] = await Promise.all([
    db.order.aggregate({ _max: { syncedAt: true }, where: { organizationId: orgId } }),
    db.paymentTransaction.aggregate({ _max: { syncedAt: true }, where: { organizationId: orgId } }),
    db.payout.aggregate({ _max: { syncedAt: true }, where: { organizationId: orgId } }),
    db.invoice.aggregate({ _max: { syncedAt: true }, where: { organizationId: orgId } }),
    db.shipment.aggregate({ _max: { syncedAt: true }, where: { organizationId: orgId } }),
    db.bankTransaction.aggregate({ _max: { syncedAt: true }, where: { organizationId: orgId } }),
  ]);
  return { orders: o._max.syncedAt, payments: p._max.syncedAt, payouts: po._max.syncedAt, invoices: i._max.syncedAt, shipments: s._max.syncedAt, bank: b._max.syncedAt };
}

async function sourcesOf(table: "order" | "paymentTransaction" | "payout" | "invoice" | "shipment", orgId: string): Promise<string[]> {
  const rows =
    table === "order" ? await db.order.groupBy({ by: ["source"], where: { organizationId: orgId } })
    : table === "paymentTransaction" ? await db.paymentTransaction.groupBy({ by: ["source"], where: { organizationId: orgId } })
    : table === "payout" ? await db.payout.groupBy({ by: ["source"], where: { organizationId: orgId } })
    : table === "invoice" ? await db.invoice.groupBy({ by: ["source"], where: { organizationId: orgId } })
    : await db.shipment.groupBy({ by: ["source"], where: { organizationId: orgId } });
  return rows.map((r) => r.source);
}

export async function getDashboardMetrics(orgId: string, range: Range, currency: string): Promise<Metric[]> {
  const sync = await lastSync(orgId);
  const [srcOrders, srcPayments, srcPayouts, srcInvoices, srcShipments] = await Promise.all([
    sourcesOf("order", orgId), sourcesOf("paymentTransaction", orgId), sourcesOf("payout", orgId), sourcesOf("invoice", orgId), sourcesOf("shipment", orgId),
  ]);
  const inRange = { gte: range.from, lte: range.to };
  const orderWhere = { organizationId: orgId, deletedAt: null, test: false, cancelledAt: null, processedAt: inRange };

  const orders = await db.order.aggregate({ _sum: { totalPrice: true, totalRefunded: true }, _count: { _all: true }, where: orderWhere });
  const refunded = await db.order.aggregate({ _count: { _all: true }, _sum: { totalRefunded: true }, where: { ...orderWhere, totalRefunded: { gt: 0 } } });
  const captured = await db.paymentTransaction.aggregate({ _sum: { amount: true }, where: { organizationId: orgId, deletedAt: null, ledger: "ORDER", status: "SUCCESS", kind: { in: ["SALE", "CAPTURE"] }, processedAt: inRange, isDemo: undefined } });
  const fees = await db.paymentTransaction.aggregate({ _sum: { fee: true }, where: { organizationId: orgId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", processedAt: inRange } });
  const payouts = await db.payout.aggregate({ _sum: { netAmount: true }, _count: { _all: true }, where: { organizationId: orgId, deletedAt: null, status: "PAID", OR: [{ arrivalDate: inRange }, { arrivalDate: null, issuedAt: inRange }] } });
  const invActive = await db.invoice.aggregate({ _sum: { totalAmount: true }, _count: { _all: true }, where: { organizationId: orgId, deletedAt: null, direction: "ACTIVE", issueDate: inRange, documentType: { notIn: ["TD04", "TD08"] } } });
  const invActiveCredit = await db.invoice.aggregate({ _sum: { totalAmount: true }, where: { organizationId: orgId, deletedAt: null, direction: "ACTIVE", issueDate: inRange, documentType: { in: ["TD04", "TD08"] } } });
  const invPassive = await db.invoice.aggregate({ _sum: { totalAmount: true }, _count: { _all: true }, where: { organizationId: orgId, deletedAt: null, direction: "PASSIVE", issueDate: inRange } });
  const toShip = await db.order.count({
    where: { organizationId: orgId, deletedAt: null, test: false, cancelledAt: null, financialStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID", "AUTHORIZED"] }, fulfillmentStatus: { in: ["UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "OPEN", "SCHEDULED", "ON_HOLD", "PENDING_FULFILLMENT"] } },
  });
  const unreconciledTx = await db.paymentTransaction.count({
    where: { organizationId: orgId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", kind: { in: ["SALE", "CAPTURE", "REFUND", "CHARGEBACK"] }, reconciliations: { none: { type: "PAYMENT_ORDER", status: { in: ["AUTO_MATCHED", "CONFIRMED"] } } } },
  });
  const unreconciledPayouts = await db.payout.count({ where: { organizationId: orgId, deletedAt: null, status: { in: ["PAID", "IN_TRANSIT"] }, reconciliations: { none: { type: "PAYOUT_BANK", status: { in: ["AUTO_MATCHED", "CONFIRMED"] } } } } });
  const pendingSuggestions = await db.reconciliation.count({ where: { organizationId: orgId, status: "SUGGESTED" } });

  const gross = D(orders._sum.totalPrice);
  const refunds = D(orders._sum.totalRefunded);
  return [
    { key: "gross", label: "Vendite lorde", value: gross.toFixed(2), format: "money", currency, sources: srcOrders, updatedAt: sync.orders, definition: "Σ totale ordini (IVA e spedizione incluse), esclusi annullati e test", href: "/orders" },
    { key: "net", label: "Vendite nette", value: gross.minus(refunds).toFixed(2), format: "money", currency, sources: srcOrders, updatedAt: sync.orders, definition: "Vendite lorde − importi rimborsati", href: "/orders" },
    { key: "orders", label: "Ordini ricevuti", value: String(orders._count._all), format: "count", sources: srcOrders, updatedAt: sync.orders, definition: "Ordini nel periodo, esclusi annullati e test", href: "/orders" },
    { key: "captured", label: "Pagamenti acquisiti", value: D(captured._sum.amount).toFixed(2), format: "money", currency, sources: srcPayments.filter((s) => s === "SHOPIFY" || s === "DEMO"), updatedAt: sync.payments, definition: "Σ transazioni SALE/CAPTURE riuscite registrate sugli ordini (ledger ordini). Non si somma alle vendite.", href: "/payments" },
    { key: "fees", label: "Commissioni gateway", value: D(fees._sum.fee).toFixed(2), format: "money", currency, sources: srcPayments.filter((s) => s !== "SHOPIFY"), updatedAt: sync.payments, definition: "Σ commissioni dal ledger dei gateway (API o CSV)", href: "/payments" },
    { key: "payouts", label: "Accrediti liquidati", value: D(payouts._sum.netAmount).toFixed(2), format: "money", currency, sources: srcPayouts, updatedAt: sync.payouts, definition: `Σ netto dei payout con stato PAID (${payouts._count._all} payout). È denaro già contato nelle vendite: non è ricavo aggiuntivo.`, href: "/payments?tab=payouts" },
    { key: "invoicesIssued", label: "Fatture emesse", value: D(invActive._sum.totalAmount).minus(D(invActiveCredit._sum.totalAmount)).toFixed(2), format: "money", currency, sources: srcInvoices, updatedAt: sync.invoices, definition: `${invActive._count._all} fatture emesse nel periodo, al netto delle note di credito`, href: "/invoices?direction=ACTIVE" },
    { key: "invoicesReceived", label: "Fatture ricevute", value: D(invPassive._sum.totalAmount).toFixed(2), format: "money", currency, sources: srcInvoices, updatedAt: sync.invoices, definition: `${invPassive._count._all} fatture passive nel periodo`, href: "/invoices?direction=PASSIVE" },
    { key: "toShip", label: "Spedizioni da preparare", value: String(toShip), format: "count", sources: srcOrders, updatedAt: sync.orders, definition: "Ordini pagati non ancora evasi (indipendente dal periodo)", href: "/shipping" },
    { key: "refunded", label: "Ordini rimborsati", value: String(refunded._count._all), format: "count", sources: srcOrders, updatedAt: sync.orders, definition: `Ordini con rimborsi nel periodo, per ${refunds.toFixed(2)} ${currency}`, href: "/orders?status=REFUNDED" },
    { key: "unreconciled", label: "Transazioni non riconciliate", value: String(unreconciledTx + unreconciledPayouts), format: "count", sources: [...new Set([...srcPayments, ...srcPayouts])], updatedAt: sync.payments, definition: `${unreconciledTx} transazioni gateway e ${unreconciledPayouts} payout senza corrispondenza confermata; ${pendingSuggestions} proposte da verificare`, href: "/payments?tab=reconciliation" },
  ];
}

/** Daily series for Analytics, bucketed in the organization timezone. */
export async function getDailySales(orgId: string, range: Range, tz: string) {
  const rows = await db.order.findMany({ where: { organizationId: orgId, deletedAt: null, test: false, cancelledAt: null, processedAt: { gte: range.from, lte: range.to } }, select: { processedAt: true, totalPrice: true, totalRefunded: true } });
  const buckets = new Map<string, { gross: Prisma.Decimal; refunds: Prisma.Decimal; orders: number }>();
  for (const r of rows) {
    const d = new TZDate(r.processedAt, tz);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const b = buckets.get(key) ?? { gross: D(0), refunds: D(0), orders: 0 };
    b.gross = b.gross.plus(r.totalPrice);
    b.refunds = b.refunds.plus(r.totalRefunded);
    b.orders++;
    buckets.set(key, b);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, gross: b.gross.toFixed(2), net: b.gross.minus(b.refunds).toFixed(2), orders: b.orders }));
}

export async function getTopProducts(orgId: string, range: Range, limit = 10) {
  const rows = await db.orderItem.groupBy({
    by: ["sku", "title"],
    where: { organizationId: orgId, order: { deletedAt: null, test: false, cancelledAt: null, processedAt: { gte: range.from, lte: range.to } } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });
  return rows.map((r) => ({ sku: r.sku, title: r.title, quantity: r._sum.quantity ?? 0 }));
}

export async function getGatewayBreakdown(orgId: string, range: Range) {
  const rows = await db.paymentTransaction.groupBy({
    by: ["provider"],
    where: { organizationId: orgId, deletedAt: null, ledger: "ORDER", status: "SUCCESS", kind: { in: ["SALE", "CAPTURE"] }, processedAt: { gte: range.from, lte: range.to } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  return rows.map((r) => ({ provider: r.provider, amount: D(r._sum.amount).toFixed(2), count: r._count._all })).sort((a, b) => Number(b.amount) - Number(a.amount));
}
