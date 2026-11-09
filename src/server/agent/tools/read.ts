import { CREDIT_NOTE_TYPES, isCreditNote } from "@/server/invoices/fatturapa";
import { z } from "zod/v4";
import { Prisma } from "@prisma/client";
import { db } from "../../db";
import { getDashboardMetrics, getDailySales, getGatewayBreakdown, getTopProducts } from "../../metrics/dashboard";
import { listConnectors } from "../../connectors/registry";
import { resolvePeriod } from "../../../lib/periods";
import { SKILLS, loadSkill } from "../skills";
import { defineTool, plain, ToolError } from "./types";

const PERIOD = z.enum(["7d", "30d", "mtd", "last_month", "qtd", "ytd"]).describe("Periodo: 7d, 30d, mtd (mese corrente), last_month, qtd, ytd");
const LIMIT = z.number().int().min(1).max(50).optional().describe("Max risultati (default 20, max 50)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data YYYY-MM-DD");

function range(ctx: { timezone: string }, period?: string, from?: string, to?: string) {
  return resolvePeriod(from && to ? { period: "custom", from, to } : { period: period ?? "30d" }, ctx.timezone);
}
const lim = (n?: number) => Math.min(50, n ?? 20);

export const getBusinessOverview = defineTool({
  name: "get_business_overview",
  description: "Quadro generale del business nel periodo: vendite lorde/nette, ordini, pagamenti acquisiti, commissioni, accrediti, fatture, spedizioni da preparare, transazioni non riconciliate, più avvisi aperti, task e approvazioni in attesa. Ogni metrica riporta fonte e ultimo aggiornamento. Parti da qui per domande generali.",
  schema: z.object({ period: PERIOD.optional() }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Panoramica ${i.period ?? "30d"}`,
  async run(ctx, input) {
    const r = range(ctx, input.period);
    const [metrics, alerts, tasks, approvals, connections] = await Promise.all([
      getDashboardMetrics(ctx.organizationId, r, ctx.currency),
      db.alert.groupBy({ by: ["severity"], where: { organizationId: ctx.organizationId, status: "OPEN" }, _count: { _all: true } }),
      db.task.count({ where: { organizationId: ctx.organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      db.agentApproval.count({ where: { organizationId: ctx.organizationId, status: "PENDING" } }),
      db.integrationConnection.findMany({ where: { organizationId: ctx.organizationId }, select: { key: true, displayName: true, status: true, lastSyncAt: true, blockedReason: true } }),
    ]);
    return plain({
      period: { key: r.key, from: r.from, to: r.to, timezone: ctx.timezone },
      metrics: metrics.map((m) => ({ key: m.key, label: m.label, value: m.value, currency: m.currency, sources: m.sources, updatedAt: m.updatedAt, definition: m.definition })),
      openAlerts: Object.fromEntries(alerts.map((a) => [a.severity, a._count._all])),
      openTasks: tasks,
      pendingApprovals: approvals,
      integrations: connections,
      caveat: "Pagamenti acquisiti e accrediti liquidati sono viste dello stesso denaro già contato nelle vendite: non sommarli ai ricavi.",
    });
  },
});

export const getSalesTimeseries = defineTool({
  name: "get_sales_timeseries",
  description: "Serie giornaliera di vendite lorde/nette e ordini nel periodo, prodotti più venduti e ripartizione per gateway di pagamento.",
  schema: z.object({ period: PERIOD.optional(), from: DATE.optional(), to: DATE.optional() }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Serie vendite ${i.period ?? (i.from ? `${i.from}→${i.to}` : "30d")}`,
  async run(ctx, input) {
    const r = range(ctx, input.period, input.from, input.to);
    const [daily, top, gateways] = await Promise.all([getDailySales(ctx.organizationId, r, ctx.timezone), getTopProducts(ctx.organizationId, r, 10), getGatewayBreakdown(ctx.organizationId, r)]);
    return plain({ from: r.from, to: r.to, daily, topProducts: top, gateways, source: "Ordini Shopify/demo in MOAI OS" });
  },
});

export const searchOrders = defineTool({
  name: "search_orders",
  description: "Cerca ordini per numero, SKU, tag o email cliente, con filtro stato e periodo. Restituisce totale, stato pagamento ed evasione, gateway, spedizioni.",
  schema: z.object({
    query: z.string().max(100).optional().describe("Numero ordine (#1042), SKU, tag o email"),
    status: z.enum(["ALL", "PAID", "PENDING", "UNFULFILLED", "REFUNDED", "VOIDED"]).optional(),
    period: PERIOD.optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    limit: LIMIT,
  }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Ricerca ordini ${i.query ?? ""} ${i.status ?? ""}`.trim(),
  async run(ctx, input) {
    const r = range(ctx, input.period, input.from, input.to);
    const q = input.query?.trim();
    const where: Prisma.OrderWhereInput = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(q ? {} : { processedAt: { gte: r.from, lte: r.to } }),
      ...(input.status === "REFUNDED" ? { totalRefunded: { gt: 0 } } : input.status === "UNFULFILLED" ? { fulfillmentStatus: { in: ["UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "OPEN"] } } : input.status && input.status !== "ALL" ? { financialStatus: input.status } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { name: `#${q.replace(/^#/, "")}` }, { tags: { has: q } }, { items: { some: { sku: { contains: q, mode: "insensitive" } } } }, { customer: { email: { contains: q, mode: "insensitive" } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      db.order.findMany({ where, orderBy: { processedAt: "desc" }, take: lim(input.limit), include: { _count: { select: { items: true } }, shipments: { select: { status: true, trackingNumber: true, carrier: true } } } }),
      db.order.count({ where }),
    ]);
    return plain({
      total,
      shown: rows.length,
      orders: rows.map((o) => ({ id: o.id, name: o.name, processedAt: o.processedAt, total: o.totalPrice, refunded: o.totalRefunded, currency: o.currency, financialStatus: o.financialStatus, fulfillmentStatus: o.fulfillmentStatus, items: o._count.items, gateways: o.paymentGateways, tags: o.tags, shipments: o.shipments, source: o.source, isDemo: o.isDemo, syncedAt: o.syncedAt })),
    });
  },
});

export const getOrder = defineTool({
  name: "get_order",
  description: "Dettaglio completo di un ordine: righe, transazioni di entrambi i ledger, spedizioni, fatture collegate e riconciliazioni. Accetta id interno o numero ordine (#1042).",
  schema: z.object({ id: z.string().optional(), name: z.string().optional().describe("Numero ordine, es. #1042") }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Dettaglio ordine ${i.name ?? i.id ?? ""}`,
  async run(ctx, input) {
    if (!input.id && !input.name) throw new ToolError("Indica id o numero ordine");
    const name = input.name?.trim();
    const order = await db.order.findFirst({
      where: { organizationId: ctx.organizationId, ...(input.id ? { id: input.id } : { OR: [{ name }, { name: `#${name!.replace(/^#/, "")}` }] }) },
      include: { items: true, customer: { select: { email: true, displayName: true, ordersCount: true } }, payments: { orderBy: { processedAt: "asc" } }, shipments: true, invoices: { select: { id: true, number: true, documentType: true, totalAmount: true, paymentStatus: true, issueDate: true } }, reconciliations: { select: { type: true, status: true, rule: true, explanation: true, amountDifference: true } } },
    });
    if (!order) throw new ToolError("Ordine non trovato");
    return plain(order);
  },
});

export const listPayments = defineTool({
  name: "list_payments",
  description: "Transazioni di pagamento. ledger ORDER = registrate dal negozio; PROCESSOR = ledger del gateway (commissioni, netto, payout). unreconciledOnly mostra transazioni gateway senza corrispondenza confermata.",
  schema: z.object({ ledger: z.enum(["ORDER", "PROCESSOR"]).optional(), provider: z.string().max(40).optional(), unreconciledOnly: z.boolean().optional(), period: PERIOD.optional(), from: DATE.optional(), to: DATE.optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Pagamenti ${i.ledger ?? ""} ${i.unreconciledOnly ? "non riconciliati" : ""}`.trim(),
  async run(ctx, input) {
    const r = range(ctx, input.period, input.from, input.to);
    const where: Prisma.PaymentTransactionWhereInput = {
      organizationId: ctx.organizationId, deletedAt: null, processedAt: { gte: r.from, lte: r.to },
      ...(input.ledger ? { ledger: input.ledger } : {}), ...(input.provider ? { provider: { contains: input.provider, mode: "insensitive" } } : {}),
      ...(input.unreconciledOnly ? { ledger: "PROCESSOR", status: "SUCCESS", kind: { in: ["SALE", "CAPTURE", "REFUND", "CHARGEBACK"] }, reconciliations: { none: { type: "PAYMENT_ORDER", status: { in: ["AUTO_MATCHED", "CONFIRMED"] } } } } : {}),
    };
    const [rows, total, sums] = await Promise.all([
      db.paymentTransaction.findMany({ where, orderBy: { processedAt: "desc" }, take: lim(input.limit), include: { order: { select: { name: true } }, payout: { select: { externalId: true, status: true } } } }),
      db.paymentTransaction.count({ where }),
      db.paymentTransaction.aggregate({ where, _sum: { amount: true, fee: true, net: true } }),
    ]);
    return plain({ total, sums: sums._sum, transactions: rows.map((t) => ({ id: t.id, ledger: t.ledger, provider: t.provider, kind: t.kind, status: t.status, amount: t.amount, fee: t.fee, net: t.net, currency: t.currency, processedAt: t.processedAt, order: t.order?.name ?? null, orderRef: t.orderRef, payout: t.payout, source: t.source, isDemo: t.isDemo })) });
  },
});

export const listPayouts = defineTool({
  name: "list_payouts",
  description: "Payout dei gateway (accrediti attesi o liquidati in banca) con stato e riconciliazione bancaria.",
  schema: z.object({ status: z.enum(["SCHEDULED", "IN_TRANSIT", "PAID", "FAILED", "CANCELED"]).optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Payout ${i.status ?? ""}`.trim(),
  async run(ctx, input) {
    const rows = await db.payout.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, ...(input.status ? { status: input.status } : {}) }, orderBy: { issuedAt: "desc" }, take: lim(input.limit), include: { reconciliations: { where: { type: "PAYOUT_BANK" }, select: { status: true, rule: true } }, _count: { select: { transactions: true } } } });
    return plain(rows.map((p) => ({ id: p.id, provider: p.provider, externalId: p.externalId, status: p.status, issuedAt: p.issuedAt, arrivalDate: p.arrivalDate, net: p.netAmount, fee: p.feeAmount, gross: p.grossAmount, currency: p.currency, transactions: p._count.transactions, bankReconciliation: p.reconciliations, source: p.source, isDemo: p.isDemo })));
  },
});

export const listReconciliationItems = defineTool({
  name: "list_reconciliation_items",
  description: "Proposte e decisioni di riconciliazione (pagamento↔ordine, payout↔banca, fattura↔ordine) con regola, spiegazione e differenza di importo. Le SUGGESTED aspettano una persona.",
  schema: z.object({ status: z.enum(["SUGGESTED", "AUTO_MATCHED", "CONFIRMED", "REJECTED"]).optional(), type: z.enum(["PAYMENT_ORDER", "PAYOUT_BANK", "INVOICE_ORDER"]).optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Riconciliazioni ${i.status ?? ""} ${i.type ?? ""}`.trim(),
  async run(ctx, input) {
    const rows = await db.reconciliation.findMany({
      where: { organizationId: ctx.organizationId, ...(input.status ? { status: input.status } : { status: "SUGGESTED" }), ...(input.type ? { type: input.type } : {}) },
      orderBy: { createdAt: "desc" }, take: lim(input.limit),
      include: { paymentTransaction: { select: { provider: true, amount: true, currency: true, processedAt: true, orderRef: true } }, order: { select: { name: true, totalPrice: true, processedAt: true } }, payout: { select: { externalId: true, netAmount: true, arrivalDate: true } }, bankTransaction: { select: { description: true, amount: true, bookingDate: true } }, invoice: { select: { number: true, totalAmount: true } } },
    });
    return plain(rows);
  },
});

export const listInvoices = defineTool({
  name: "list_invoices",
  description: "Fatture elettroniche archiviate: emesse (ACTIVE) o ricevute (PASSIVE), stato pagamento, scadenze. dueWithinDays filtra le non pagate in scadenza; overdueOnly le scadute.",
  schema: z.object({ direction: z.enum(["ACTIVE", "PASSIVE"]).optional(), paymentStatus: z.enum(["UNKNOWN", "UNPAID", "PARTIAL", "PAID"]).optional(), dueWithinDays: z.number().int().min(0).max(365).optional(), overdueOnly: z.boolean().optional(), period: PERIOD.optional(), from: DATE.optional(), to: DATE.optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Fatture ${i.direction ?? ""} ${i.overdueOnly ? "scadute" : i.dueWithinDays !== undefined ? `in scadenza ${i.dueWithinDays}g` : ""}`.trim(),
  async run(ctx, input) {
    const now = new Date();
    const unpaid: Prisma.InvoiceWhereInput["paymentStatus"] = { in: ["UNPAID", "PARTIAL", "UNKNOWN"] };
    const dueFilter: Prisma.InvoiceWhereInput = input.overdueOnly
      ? { paymentStatus: unpaid, nextDueDate: { lt: now } }
      : input.dueWithinDays !== undefined
        ? { paymentStatus: unpaid, nextDueDate: { gte: now, lte: new Date(now.getTime() + input.dueWithinDays * 86_400_000) } }
        : {};
    const r = range(ctx, input.period, input.from, input.to);
    const where: Prisma.InvoiceWhereInput = { organizationId: ctx.organizationId, deletedAt: null, ...(input.direction ? { direction: input.direction } : {}), ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}), ...(Object.keys(dueFilter).length ? dueFilter : { issueDate: { gte: r.from, lte: r.to } }) };
    const [rows, total, sum] = await Promise.all([
      db.invoice.findMany({ where, orderBy: input.overdueOnly || input.dueWithinDays !== undefined ? { nextDueDate: "asc" } : { issueDate: "desc" }, take: lim(input.limit), include: { installments: { select: { position: true, dueDate: true, amount: true, paidAt: true } }, order: { select: { name: true } } } }),
      db.invoice.count({ where }),
      Promise.all([
        db.invoice.aggregate({ where: { AND: [where, { documentType: { notIn: CREDIT_NOTE_TYPES } }] }, _sum: { totalAmount: true } }),
        db.invoice.aggregate({ where: { AND: [where, { documentType: { in: CREDIT_NOTE_TYPES } }] }, _sum: { totalAmount: true } }),
      ]).then(([docs, credits]) => new Prisma.Decimal(docs._sum.totalAmount ?? 0).minus(credits._sum.totalAmount ?? 0)),
    ]);
    return plain({ total, sumTotal: sum, sumNote: "IVA inclusa, al netto delle note di credito (TD04/TD08)", invoices: rows.map((i) => ({ id: i.id, direction: i.direction, documentType: i.documentType, creditNote: isCreditNote(i.documentType), number: i.number, issueDate: i.issueDate, total: i.totalAmount, taxable: i.taxableAmount, tax: i.taxAmount, currency: i.currency, counterparty: i.direction === "ACTIVE" ? i.receiverName : i.senderName, paymentStatus: i.paymentStatus, nextDueDate: i.nextDueDate, installments: i.installments, order: i.order?.name ?? null, sdiStatus: i.sdiStatus, source: i.source, isDemo: i.isDemo })) });
  },
});

export const listShipments = defineTool({
  name: "list_shipments",
  description: "Spedizioni con stato, corriere, tracking, costo e anomalie (problemsOnly). Include gli ordini pagati da preparare se includeToShip è true.",
  schema: z.object({ status: z.enum(["PENDING", "READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION", "RETURNED", "CANCELLED", "UNKNOWN"]).optional(), problemsOnly: z.boolean().optional(), includeToShip: z.boolean().optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Spedizioni ${i.status ?? ""} ${i.problemsOnly ? "problematiche" : ""}`.trim(),
  async run(ctx, input) {
    const rows = await db.shipment.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, ...(input.status ? { status: input.status } : {}), ...(input.problemsOnly ? { problem: true } : {}) }, orderBy: [{ problem: "desc" }, { lastEventAt: "desc" }], take: lim(input.limit), include: { order: { select: { name: true, processedAt: true } } } });
    const toShip = input.includeToShip
      ? await db.order.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, test: false, cancelledAt: null, financialStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID", "AUTHORIZED"] }, fulfillmentStatus: { in: ["UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "OPEN", "SCHEDULED", "ON_HOLD", "PENDING_FULFILLMENT"] } }, orderBy: { processedAt: "asc" }, take: 50, select: { id: true, name: true, processedAt: true, totalPrice: true, currency: true } })
      : undefined;
    return plain({ shipments: rows.map((s) => ({ id: s.id, order: s.order?.name ?? null, orderDate: s.order?.processedAt ?? null, status: s.status, carrier: s.carrier, service: s.service, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, packlinkReference: s.packlinkReference, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, lastEventAt: s.lastEventAt, cost: s.cost, costCurrency: s.costCurrency, problem: s.problem, problemReason: s.problemReason, source: s.source })), ordersToShip: toShip });
  },
});

export const listProducts = defineTool({
  name: "list_products",
  description: "Catalogo: riepilogo di TUTTI i prodotti (varianti, scorte totali, se le scorte sono tracciate) più un elenco di varianti con prezzo e giacenza. Se tracked è false lo store non traccia le scorte: la quantità non significa esaurito. lowStockThreshold considera solo le varianti tracciate.",
  schema: z.object({ query: z.string().max(80).optional(), lowStockThreshold: z.number().int().min(0).max(1000).optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Prodotti ${i.query ?? ""} ${i.lowStockThreshold !== undefined ? `scorte ≤ ${i.lowStockThreshold}` : ""}`.trim(),
  async run(ctx, input) {
    const where: Prisma.ProductVariantWhereInput = { organizationId: ctx.organizationId, deletedAt: null, product: { deletedAt: null }, ...(input.lowStockThreshold !== undefined ? { inventoryTracked: true, inventoryQuantity: { lte: input.lowStockThreshold } } : {}), ...(input.query ? { OR: [{ sku: { contains: input.query, mode: "insensitive" } }, { title: { contains: input.query, mode: "insensitive" } }, { product: { title: { contains: input.query, mode: "insensitive" } } }] } : {}) };
    const take = lim(input.limit) * 2;
    const [variants, total, all] = await Promise.all([
      db.productVariant.findMany({ where, orderBy: [{ inventoryQuantity: "asc" }, { sku: "asc" }], take, include: { product: { select: { title: true, productType: true, status: true, handle: true } } } }),
      db.productVariant.count({ where }),
      db.productVariant.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, product: { deletedAt: null } }, select: { inventoryQuantity: true, inventoryTracked: true, syncedAt: true, product: { select: { title: true, status: true } } } }),
    ]);
    const byProduct = new Map<string, { product: string; status: string | null; variants: number; trackedVariants: number; stockOfTrackedVariants: number; trackedVariantsAtZero: number; checkedAt: Date }>();
    for (const v of all) {
      const e = byProduct.get(v.product.title) ?? { product: v.product.title, status: v.product.status, variants: 0, trackedVariants: 0, stockOfTrackedVariants: 0, trackedVariantsAtZero: 0, checkedAt: v.syncedAt };
      e.variants++;
      if (v.inventoryTracked) {
        e.trackedVariants++;
        e.stockOfTrackedVariants += v.inventoryQuantity ?? 0;
        if ((v.inventoryQuantity ?? 0) <= 0) e.trackedVariantsAtZero++;
      }
      if (v.syncedAt > e.checkedAt) e.checkedAt = v.syncedAt;
      byProduct.set(v.product.title, e);
    }
    return plain({
      productsTotal: byProduct.size,
      summary: [...byProduct.values()],
      variantsMatching: total,
      variantsShown: variants.length,
      note: "tracked=false: lo store non controlla le scorte di quella variante, quindi inventory non indica disponibilità né esaurimento. checkedAt/syncedAt è l'ultima lettura da Shopify.",
      variants: variants.map((v) => ({ id: v.id, product: v.product.title, type: v.product.productType, productStatus: v.product.status, variant: v.title, sku: v.sku, price: v.price, currency: v.currency, inventory: v.inventoryTracked === false ? null : v.inventoryQuantity, tracked: v.inventoryTracked, source: v.source, syncedAt: v.syncedAt, isDemo: v.isDemo })),
    });
  },
});

export const searchCustomers = defineTool({
  name: "search_customers",
  description: "Clienti per email o nome (solo se la sincronizzazione dei dati personali è attiva), con numero ordini e spesa totale.",
  schema: z.object({ query: z.string().min(2).max(80), limit: LIMIT }),
  risk: "read",
  minRole: "OPERATIONS",
  summarize: (i) => `Clienti "${i.query}"`,
  async run(ctx, input) {
    const rows = await db.customer.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, piiRedactedAt: null, OR: [{ email: { contains: input.query, mode: "insensitive" } }, { displayName: { contains: input.query, mode: "insensitive" } }] }, take: lim(input.limit), orderBy: { amountSpent: "desc" } });
    return plain(rows.map((c) => ({ id: c.id, email: c.email, name: c.displayName, ordersCount: c.ordersCount, amountSpent: c.amountSpent, currency: c.currency, source: c.source })));
  },
});

export const getIntegrationsStatus = defineTool({
  name: "get_integrations_status",
  description: "Stato di ogni connettore (Shopify, Aruba, Packlink, gateway, Meta, GA4, Klaviyo, Telegram): connesso/bloccato/errore, ultima sync, scope, capacità verificate, requisiti.",
  schema: z.object({}),
  risk: "read",
  minRole: "VIEWER",
  summarize: () => "Stato integrazioni",
  async run(ctx) {
    const conns = await db.integrationConnection.findMany({ where: { organizationId: ctx.organizationId } });
    return plain(listConnectors().map((def) => {
      const c = conns.find((x) => x.key === def.key);
      return { key: def.key, name: def.displayName, status: c?.status ?? "NOT_CONFIGURED", lastVerifiedAt: c?.lastVerifiedAt ?? null, lastSyncAt: c?.lastSyncAt ?? null, lastError: c?.lastError ?? null, blockedReason: c?.blockedReason ?? null, grantedScopes: c?.grantedScopes ?? [], capabilities: c?.capabilities ?? {}, jobs: def.jobs.map((j) => j.type), notes: def.notes };
    }));
  },
});

export const listSyncJobs = defineTool({
  name: "list_sync_jobs",
  description: "Job di sincronizzazione recenti con stato, tentativi, errore ed esito. I job DEAD richiedono intervento.",
  schema: z.object({ status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"]).optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Job ${i.status ?? "recenti"}`,
  async run(ctx, input) {
    const rows = await db.syncJob.findMany({ where: { organizationId: ctx.organizationId, ...(input.status ? { status: input.status } : {}) }, orderBy: { createdAt: "desc" }, take: lim(input.limit), include: { connection: { select: { displayName: true } } } });
    return plain(rows.map((j) => ({ id: j.id, type: j.type, connection: j.connection?.displayName ?? null, status: j.status, attempts: `${j.attempts}/${j.maxAttempts}`, triggeredBy: j.triggeredBy, createdAt: j.createdAt, finishedAt: j.finishedAt, lastError: j.lastError, result: j.result })));
  },
});

export const listAlerts = defineTool({
  name: "list_alerts",
  description: "Avvisi generati dal monitor (ordini in ritardo, fatture in scadenza, integrazioni in errore, scorte basse, job falliti…), con gravità e stato.",
  schema: z.object({ status: z.enum(["OPEN", "ACKNOWLEDGED", "SNOOZED", "RESOLVED"]).optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Avvisi ${i.status ?? "aperti"}`,
  async run(ctx, input) {
    const rows = await db.alert.findMany({ where: { organizationId: ctx.organizationId, status: input.status ?? "OPEN" }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: lim(input.limit) });
    return plain(rows.map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, status: a.status, title: a.title, body: a.body, href: a.href, data: a.data, firstSeenAt: a.firstSeenAt, lastSeenAt: a.lastSeenAt })));
  },
});

export const listTasks = defineTool({
  name: "list_tasks",
  description: "Task operativi (aperti, in corso, fatti) con priorità, scadenza e collegamenti.",
  schema: z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(), overdueOnly: z.boolean().optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Task ${i.status ?? "aperti"}`,
  async run(ctx, input) {
    const rows = await db.task.findMany({ where: { organizationId: ctx.organizationId, ...(input.status ? { status: input.status } : { status: { in: ["OPEN", "IN_PROGRESS"] } }), ...(input.overdueOnly ? { dueAt: { lt: new Date() } } : {}) }, orderBy: [{ priority: "desc" }, { dueAt: "asc" }], take: lim(input.limit) });
    return plain(rows);
  },
});

export const getMarketingOverview = defineTool({
  name: "get_marketing_overview",
  description: "Ultimi dati marketing per canale (instagram, facebook, meta_ads, web/GA4, email/Klaviyo): follower, reach, sessioni, spesa ads, campagne; più i post recenti con like e commenti. Solo se i connettori sono collegati.",
  schema: z.object({ days: z.number().int().min(1).max(90).optional().describe("Finestra in giorni (default 14)") }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Marketing ultimi ${i.days ?? 14} giorni`,
  async run(ctx, input) {
    const days = input.days ?? 14;
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const [snapshots, posts] = await Promise.all([
      db.marketingSnapshot.findMany({ where: { organizationId: ctx.organizationId, date: { gte: since } }, orderBy: { date: "asc" } }),
      db.socialPost.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { publishedAt: "desc" }, take: 15 }),
    ]);
    const byChannel: Record<string, { latest: unknown; days: number; series: Array<{ date: string; metrics: unknown }> }> = {};
    for (const s of snapshots) {
      const c = (byChannel[s.channel] ??= { latest: null, days: 0, series: [] });
      c.series.push({ date: s.date, metrics: s.metrics });
      c.latest = { date: s.date, ...(s.metrics as Record<string, unknown>), syncedAt: s.syncedAt };
      c.days++;
    }
    return plain({ since, channels: byChannel, posts: posts.map((p) => ({ channel: p.channel, publishedAt: p.publishedAt, mediaType: p.mediaType, caption: p.caption?.slice(0, 160), metrics: p.metrics, permalink: p.permalink })), note: snapshots.length ? undefined : "Nessun dato marketing: collega Meta, GA4 o Klaviyo in Integrazioni." });
  },
});

export const listDesignProjects = defineTool({
  name: "list_design_projects",
  description: "Progetti del Design Studio (drop, capsule, grafiche) con linea, fase, concept e numero di asset.",
  schema: z.object({ stage: z.enum(["IDEA", "CONCEPT", "BRIEF", "SAMPLE", "APPROVED", "PRODUCTION", "ARCHIVED"]).optional() }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Progetti design ${i.stage ?? ""}`.trim(),
  async run(ctx, input) {
    const rows = await db.designProject.findMany({ where: { organizationId: ctx.organizationId, archivedAt: null, ...(input.stage ? { stage: input.stage } : {}) }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { assets: true } } } });
    return plain(rows.map((p) => ({ id: p.id, name: p.name, line: p.line, stage: p.stage, concept: p.concept, garments: p.garments, references: p.references, targetDate: p.targetDate, assets: p._count.assets, hasBrief: !!p.brief, updatedAt: p.updatedAt })));
  },
});

export const getDesignProject = defineTool({
  name: "get_design_project",
  description: "Dettaglio di un progetto di design: concept, narrativa, brief, note e asset (sketch, mockup, riferimenti) con esito del brand check. Gli SVG non vengono restituiti interi: usa gli id.",
  schema: z.object({ id: z.string() }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Progetto design ${i.id}`,
  async run(ctx, input) {
    const p = await db.designProject.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, include: { assets: { orderBy: { createdAt: "desc" } }, productionOrders: { select: { reference: true, status: true, quantity: true, totalCost: true, expectedAt: true } } } });
    if (!p) throw new ToolError("Progetto non trovato");
    return plain({ ...p, assets: p.assets.map((a) => ({ id: a.id, kind: a.kind, title: a.title, brandCheck: a.brandCheck, meta: a.meta, createdBy: a.createdBy, createdAt: a.createdAt, svgChars: a.svg?.length ?? 0, viewUrl: `/api/design/assets/${a.id}` })) });
  },
});

export const listProductionOrders = defineTool({
  name: "list_production_orders",
  description: "Ordini di produzione ai fornitori con stato, quantità, costo e date attese/ricevute; elenco fornitori con lead time.",
  schema: z.object({ status: z.enum(["PLANNED", "QUOTED", "ORDERED", "IN_PRODUCTION", "SHIPPED", "RECEIVED", "CANCELLED"]).optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Produzione ${i.status ?? ""}`.trim(),
  async run(ctx, input) {
    const [orders, suppliers] = await Promise.all([
      db.productionOrder.findMany({ where: { organizationId: ctx.organizationId, ...(input.status ? { status: input.status } : {}) }, orderBy: [{ status: "asc" }, { expectedAt: "asc" }], take: lim(input.limit), include: { supplier: { select: { name: true } }, designProject: { select: { name: true } } } }),
      db.supplier.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: "asc" } }),
    ]);
    return plain({ orders, suppliers });
  },
});

export const listExpenses = defineTool({
  name: "list_expenses",
  description: "Spese registrate (COGS, campioni, marketing, logistica, software, commissioni, foto, consulenze) nel periodo, con totali per categoria.",
  schema: z.object({ category: z.enum(["COGS", "SAMPLES", "MARKETING", "LOGISTICS", "SOFTWARE", "FEES", "PHOTOGRAPHY", "CONSULTING", "OTHER"]).optional(), period: PERIOD.optional(), from: DATE.optional(), to: DATE.optional(), limit: LIMIT }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Spese ${i.category ?? ""} ${i.period ?? ""}`.trim(),
  async run(ctx, input) {
    const r = range(ctx, input.period, input.from, input.to);
    const where: Prisma.ExpenseWhereInput = { organizationId: ctx.organizationId, date: { gte: r.from, lte: r.to }, ...(input.category ? { category: input.category } : {}) };
    const [rows, byCat] = await Promise.all([db.expense.findMany({ where, orderBy: { date: "desc" }, take: lim(input.limit) }), db.expense.groupBy({ by: ["category"], where, _sum: { amount: true }, _count: { _all: true } })]);
    return plain({ from: r.from, to: r.to, byCategory: byCat.map((c) => ({ category: c.category, total: c._sum.amount, count: c._count._all })), expenses: rows });
  },
});

export const getPnlEstimate = defineTool({
  name: "get_pnl_estimate",
  description: "Stima del margine nel periodo: vendite nette − commissioni gateway − costi spedizione − spese registrate − produzione ricevuta. È una STIMA gestionale (non contabile) e indica cosa manca.",
  schema: z.object({ period: PERIOD.optional(), from: DATE.optional(), to: DATE.optional() }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Stima margine ${i.period ?? "30d"}`,
  async run(ctx, input) {
    const r = range(ctx, input.period, input.from, input.to);
    const orgId = ctx.organizationId;
    const inRange = { gte: r.from, lte: r.to };
    const orderWhere = { organizationId: orgId, deletedAt: null, test: false, cancelledAt: null, processedAt: inRange };
    const [orders, fees, shipping, shippingMissing, expenses, production] = await Promise.all([
      db.order.aggregate({ where: orderWhere, _sum: { totalPrice: true, totalRefunded: true, totalShipping: true, totalTax: true }, _count: { _all: true } }),
      db.paymentTransaction.aggregate({ where: { organizationId: orgId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", processedAt: inRange }, _sum: { fee: true } }),
      db.shipment.aggregate({ where: { organizationId: orgId, deletedAt: null, cost: { not: null }, OR: [{ shippedAt: inRange }, { shippedAt: null, syncedAt: inRange }] }, _sum: { cost: true }, _count: { _all: true } }),
      db.shipment.count({ where: { organizationId: orgId, deletedAt: null, cost: null, status: { notIn: ["CANCELLED"] }, OR: [{ shippedAt: inRange }, { shippedAt: null, syncedAt: inRange }] } }),
      db.expense.groupBy({ by: ["category"], where: { organizationId: orgId, date: inRange }, _sum: { amount: true } }),
      db.productionOrder.aggregate({ where: { organizationId: orgId, status: "RECEIVED", receivedAt: inRange }, _sum: { totalCost: true }, _count: { _all: true } }),
    ]);
    const n = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);
    const gross = n(orders._sum.totalPrice);
    const net = gross - n(orders._sum.totalRefunded);
    const feeTotal = n(fees._sum.fee);
    const shipCost = n(shipping._sum.cost);
    const expTotal = expenses.reduce((a, e) => a + n(e._sum.amount), 0);
    const prodCost = n(production._sum.totalCost);
    const margin = net - feeTotal - shipCost - expTotal - prodCost;
    return {
      period: { from: r.from, to: r.to },
      currency: ctx.currency,
      revenue: { gross: gross.toFixed(2), refunds: n(orders._sum.totalRefunded).toFixed(2), net: net.toFixed(2), orders: orders._count._all, taxIncluded: n(orders._sum.totalTax).toFixed(2), shippingChargedToCustomers: n(orders._sum.totalShipping).toFixed(2) },
      costs: { gatewayFees: feeTotal.toFixed(2), shipping: shipCost.toFixed(2), shipmentsWithCost: shipping._count._all, shipmentsWithoutCost: shippingMissing, expensesByCategory: expenses.map((e) => ({ category: e.category, total: n(e._sum.amount).toFixed(2) })), expensesTotal: expTotal.toFixed(2), productionReceived: prodCost.toFixed(2), productionOrders: production._count._all },
      estimatedMargin: margin.toFixed(2),
      estimatedMarginPct: net ? ((margin / net) * 100).toFixed(1) : null,
      aov: orders._count._all ? (net / orders._count._all).toFixed(2) : null,
      caveats: ["Stima gestionale, non bilancio: le vendite includono IVA se gli ordini la includono.", shippingMissing ? `${shippingMissing} spedizioni senza costo registrato (importa il CSV Packlink).` : null, expenses.length ? null : "Nessuna spesa registrata nel periodo: il margine è sovrastimato.", "Le commissioni gateway sono quelle presenti nel ledger PROCESSOR (API o CSV)."].filter(Boolean),
    };
  },
});

export const searchMemory = defineTool({
  name: "search_memory",
  description: "Cerca nella memoria dell'assistente (fatti durevoli salvati su MOAI: fornitori, obiettivi, preferenze, decisioni). Usala all'inizio quando l'argomento è ricorrente.",
  schema: z.object({ query: z.string().max(80).optional().describe("Parola chiave; vuoto = tutte") }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Memoria "${i.query ?? "*"}"`,
  async run(ctx, input) {
    const q = input.query?.trim();
    const rows = await db.agentMemory.findMany({ where: { organizationId: ctx.organizationId, ...(q ? { OR: [{ key: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }] } : {}) }, orderBy: { updatedAt: "desc" }, take: 40 });
    return plain(rows.map((m) => ({ key: m.key, category: m.category, content: m.content, source: m.source, updatedAt: m.updatedAt })));
  },
});

export const listSkills = defineTool({
  name: "list_skills",
  description: "Elenca le skill (playbook) disponibili con descrizione.",
  schema: z.object({}),
  risk: "read",
  minRole: "VIEWER",
  summarize: () => "Elenco skill",
  async run() {
    return SKILLS.map((s) => ({ name: s.name, description: s.description }));
  },
});

export const loadSkillTool = defineTool({
  name: "load_skill",
  description: "Carica il contenuto completo di una skill (brand-guide, design-direction, sketch-svg, finance-analysis, reconciliation-playbook, drop-launch-checklist, customer-care, brand-story, design-moodboard, brand-guide-full). Caricala prima di lavorare su quell'argomento.",
  schema: z.object({ name: z.string().max(60) }),
  risk: "read",
  minRole: "VIEWER",
  summarize: (i) => `Skill ${i.name}`,
  async run(_ctx, input) {
    const content = loadSkill(input.name);
    if (!content) throw new ToolError(`Skill sconosciuta: ${input.name}. Disponibili: ${SKILLS.map((s) => s.name).join(", ")}`);
    return { name: input.name, content };
  },
});

export const getAuditRecent = defineTool({
  name: "get_audit_recent",
  description: "Ultime azioni dall'audit log (accessi, modifiche, approvazioni, export). Solo ADMIN/OWNER.",
  schema: z.object({ limit: LIMIT, action: z.string().max(60).optional().describe("Filtro sul nome azione, es. agent.approval") }),
  risk: "read",
  minRole: "ADMIN",
  summarize: (i) => `Audit ${i.action ?? "recente"}`,
  async run(ctx, input) {
    const rows = await db.auditLog.findMany({ where: { organizationId: ctx.organizationId, ...(input.action ? { action: { contains: input.action } } : {}) }, orderBy: { createdAt: "desc" }, take: lim(input.limit), include: { user: { select: { name: true } } } });
    return plain(rows.map((a) => ({ at: a.createdAt, who: a.user?.name ?? "sistema", action: a.action, entity: a.entityType ? `${a.entityType} ${a.entityId ?? ""}` : null, metadata: a.metadata })));
  },
});

export const READ_TOOLS = [
  getBusinessOverview, getSalesTimeseries, searchOrders, getOrder, listPayments, listPayouts, listReconciliationItems, listInvoices, listShipments, listProducts, searchCustomers,
  getIntegrationsStatus, listSyncJobs, listAlerts, listTasks, getMarketingOverview, listDesignProjects, getDesignProject, listProductionOrders, listExpenses, getPnlEstimate,
  searchMemory, listSkills, loadSkillTool, getAuditRecent,
];
