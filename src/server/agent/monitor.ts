import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { agentMonthlyBudgetUsd } from "./config";
import { monthSpendUsd } from "./engine";
import { expirePendingApprovals } from "./approvals";
import { sendTelegram, telegramEnabled } from "../notify/telegram";

/**
 * Proactive monitor: rule-based (no LLM), runs every scheduler cycle. Each rule produces alerts
 * with a stable dedupeKey so they update instead of piling up, and auto-resolve when the condition
 * disappears. Pure `computeAlerts` is unit-tested; `runMonitor` only gathers data and persists.
 */
export type Severity = "INFO" | "WARNING" | "CRITICAL";
export type AlertCandidate = { dedupeKey: string; kind: string; severity: Severity; title: string; body: string; href?: string; data?: Record<string, unknown> };

export type MonitorSnapshot = {
  now: Date;
  currency: string;
  lateUnfulfilled: Array<{ name: string; processedAt: Date; total: string }>;
  problemShipments: number;
  unreconciledOldTx: number;
  suggestedReconciliations: number;
  invoicesDueSoon: Array<{ number: string; counterparty: string; dueDate: Date; amount: string }>;
  invoicesOverdue: Array<{ number: string; counterparty: string; dueDate: Date; amount: string }>;
  deadJobs: number;
  connections: Array<{ key: string; displayName: string; status: string; lastSyncAt: Date | null; lastError: string | null; blockedReason: string | null; scheduled: boolean }>;
  lowStock: Array<{ sku: string | null; title: string; qty: number }>;
  lowStockThreshold: number;
  budget: { spentUsd: number; budgetUsd: number };
  lateProduction: Array<{ reference: string; expectedAt: Date; supplier: string | null; status: string }>;
  overdueTasks: number;
  pendingApprovals: number;
  ordersLast7d: number;
  ordersPrev28d: number;
};

const DAY = 86_400_000;
const fmt = (n: number | string) => Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function computeAlerts(s: MonitorSnapshot): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  if (s.lateUnfulfilled.length) {
    const oldest = Math.max(...s.lateUnfulfilled.map((o) => (s.now.getTime() - o.processedAt.getTime()) / DAY));
    out.push({ dedupeKey: "orders.unfulfilled_late", kind: "orders.unfulfilled_late", severity: oldest > 5 ? "CRITICAL" : "WARNING", title: `${s.lateUnfulfilled.length} ordini pagati da più di 48 ore non ancora evasi`, body: `Il più vecchio aspetta da ${Math.floor(oldest)} giorni: ${s.lateUnfulfilled.slice(0, 5).map((o) => o.name).join(", ")}${s.lateUnfulfilled.length > 5 ? "…" : ""}.`, href: "/orders?status=UNFULFILLED", data: { orders: s.lateUnfulfilled.slice(0, 20) } });
  }
  if (s.problemShipments) out.push({ dedupeKey: "shipments.problems", kind: "shipments.problems", severity: "WARNING", title: `${s.problemShipments} spedizioni problematiche`, body: "Ferme da oltre 7 giorni o con eccezione del corriere. Controlla il tracking e contatta il cliente se serve.", href: "/shipping?filter=problems" });
  if (s.unreconciledOldTx) out.push({ dedupeKey: "payments.unreconciled_old", kind: "payments.unreconciled_old", severity: s.unreconciledOldTx > 10 ? "WARNING" : "INFO", title: `${s.unreconciledOldTx} transazioni gateway da oltre 7 giorni senza ordine corrispondente`, body: "Importa i CSV mancanti o verifica le proposte di riconciliazione.", href: "/payments?tab=reconciliation" });
  if (s.suggestedReconciliations) out.push({ dedupeKey: "reconciliation.suggested", kind: "reconciliation.suggested", severity: "INFO", title: `${s.suggestedReconciliations} proposte di riconciliazione da verificare`, body: "Conferma o scarta le corrispondenze suggerite: la decisione è sempre umana.", href: "/payments?tab=reconciliation" });
  if (s.invoicesOverdue.length) {
    const total = s.invoicesOverdue.reduce((a, i) => a + Number(i.amount), 0);
    out.push({ dedupeKey: "invoices.overdue", kind: "invoices.overdue", severity: "CRITICAL", title: `${s.invoicesOverdue.length} fatture passive scadute e non segnate pagate (${fmt(total)} ${s.currency})`, body: s.invoicesOverdue.slice(0, 5).map((i) => `${i.counterparty} n. ${i.number} (${fmt(i.amount)})`).join("; "), href: "/invoices?direction=PASSIVE", data: { invoices: s.invoicesOverdue.slice(0, 20) } });
  }
  if (s.invoicesDueSoon.length) {
    const total = s.invoicesDueSoon.reduce((a, i) => a + Number(i.amount), 0);
    out.push({ dedupeKey: "invoices.due_soon", kind: "invoices.due_soon", severity: "WARNING", title: `${s.invoicesDueSoon.length} fatture in scadenza entro 7 giorni (${fmt(total)} ${s.currency})`, body: s.invoicesDueSoon.slice(0, 5).map((i) => `${i.counterparty} n. ${i.number} il ${i.dueDate.toISOString().slice(0, 10)}`).join("; "), href: "/invoices?direction=PASSIVE", data: { invoices: s.invoicesDueSoon.slice(0, 20) } });
  }
  if (s.deadJobs) out.push({ dedupeKey: "sync.dead_jobs", kind: "sync.dead_jobs", severity: "CRITICAL", title: `${s.deadJobs} sincronizzazioni fallite definitivamente`, body: "Apri Sync, leggi l'errore e riprova dopo aver risolto la causa (credenziali, scope, rete).", href: "/sync?status=DEAD" });
  for (const c of s.connections) {
    if (c.status === "ERROR") out.push({ dedupeKey: `integration.error:${c.key}`, kind: "integration.error", severity: "CRITICAL", title: `${c.displayName}: connessione in errore`, body: c.lastError ?? "Verifica le credenziali.", href: `/integrations/${c.key}` });
    else if (c.status === "BLOCKED") out.push({ dedupeKey: `integration.blocked:${c.key}`, kind: "integration.blocked", severity: "WARNING", title: `${c.displayName}: bloccato`, body: c.blockedReason ?? "Requisito mancante.", href: `/integrations/${c.key}` });
    else if (c.status === "CONNECTED" && c.scheduled && c.lastSyncAt && s.now.getTime() - c.lastSyncAt.getTime() > 36 * 3_600_000) out.push({ dedupeKey: `integration.stale:${c.key}`, kind: "integration.stale", severity: "WARNING", title: `${c.displayName}: nessuna sincronizzazione da ${Math.floor((s.now.getTime() - c.lastSyncAt.getTime()) / 3_600_000)} ore`, body: "Il worker potrebbe essere fermo o il job fallisce: controlla Sync.", href: "/sync" });
  }
  if (s.lowStock.length) out.push({ dedupeKey: "inventory.low_stock", kind: "inventory.low_stock", severity: s.lowStock.some((v) => v.qty <= 0) ? "WARNING" : "INFO", title: `${s.lowStock.length} varianti con giacenza ≤ ${s.lowStockThreshold}`, body: s.lowStock.slice(0, 6).map((v) => `${v.sku ?? v.title}: ${v.qty}`).join(", ") + (s.lowStock.length > 6 ? "…" : ""), href: "/products", data: { variants: s.lowStock.slice(0, 30) } });
  if (s.budget.budgetUsd > 0 && s.budget.spentUsd >= s.budget.budgetUsd * 0.8) out.push({ dedupeKey: "agent.budget", kind: "agent.budget", severity: s.budget.spentUsd >= s.budget.budgetUsd ? "WARNING" : "INFO", title: `Assistente: usato ${s.budget.spentUsd.toFixed(2)} di ${s.budget.budgetUsd} USD questo mese`, body: s.budget.spentUsd >= s.budget.budgetUsd ? "Budget esaurito: l'assistente non risponde finché non alzi AGENT_MONTHLY_BUDGET_USD." : "Oltre l'80% del budget mensile.", href: "/settings" });
  if (s.lateProduction.length) out.push({ dedupeKey: "production.late", kind: "production.late", severity: "WARNING", title: `${s.lateProduction.length} ordini di produzione oltre la data attesa`, body: s.lateProduction.slice(0, 5).map((p) => `${p.reference}${p.supplier ? ` (${p.supplier})` : ""} atteso il ${p.expectedAt.toISOString().slice(0, 10)}`).join("; "), href: "/production" });
  if (s.overdueTasks) out.push({ dedupeKey: "tasks.overdue", kind: "tasks.overdue", severity: "INFO", title: `${s.overdueTasks} task oltre la scadenza`, body: "Riprogramma o chiudi i task scaduti.", href: "/tasks?filter=overdue" });
  if (s.pendingApprovals) out.push({ dedupeKey: "agent.approvals", kind: "agent.approvals", severity: "INFO", title: `${s.pendingApprovals} proposte dell'assistente in attesa di approvazione`, body: "Approva o rifiuta in Assistente → Approvazioni.", href: "/assistant/approvals" });
  if (s.ordersLast7d === 0 && s.ordersPrev28d >= 8) out.push({ dedupeKey: "sales.no_orders_7d", kind: "sales.no_orders_7d", severity: "WARNING", title: "Nessun ordine negli ultimi 7 giorni", body: `Nei 28 giorni precedenti ce n'erano ${s.ordersPrev28d}. Controlla negozio, campagne e che la sync Shopify funzioni.`, href: "/orders" });
  return out;
}

export async function collectSnapshot(organizationId: string): Promise<MonitorSnapshot> {
  const now = new Date();
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const lowStockThreshold = Math.max(0, Number(process.env.LOW_STOCK_THRESHOLD ?? 3) || 3);
  const [late, problemShipments, unreconciledOldTx, suggested, dueSoon, overdue, deadJobs, connections, lowStock, lateProduction, overdueTasks, pendingApprovals, ordersLast7d, ordersPrev28d, spentUsd] = await Promise.all([
    db.order.findMany({ where: { organizationId, deletedAt: null, test: false, cancelledAt: null, processedAt: { lt: new Date(now.getTime() - 2 * DAY) }, financialStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID", "AUTHORIZED"] }, fulfillmentStatus: { in: ["UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "OPEN", "SCHEDULED", "ON_HOLD", "PENDING_FULFILLMENT"] } }, orderBy: { processedAt: "asc" }, take: 50, select: { name: true, processedAt: true, totalPrice: true } }),
    db.shipment.count({ where: { organizationId, deletedAt: null, problem: true } }),
    db.paymentTransaction.count({ where: { organizationId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", kind: { in: ["SALE", "CAPTURE", "REFUND", "CHARGEBACK"] }, processedAt: { lt: new Date(now.getTime() - 7 * DAY) }, reconciliations: { none: { type: "PAYMENT_ORDER", status: { in: ["AUTO_MATCHED", "CONFIRMED"] } } } } }),
    db.reconciliation.count({ where: { organizationId, status: "SUGGESTED" } }),
    db.invoice.findMany({ where: { organizationId, deletedAt: null, direction: "PASSIVE", paymentStatus: { in: ["UNPAID", "PARTIAL", "UNKNOWN"] }, nextDueDate: { gte: now, lte: new Date(now.getTime() + 7 * DAY) } }, select: { number: true, senderName: true, nextDueDate: true, totalAmount: true }, take: 50 }),
    db.invoice.findMany({ where: { organizationId, deletedAt: null, direction: "PASSIVE", paymentStatus: { in: ["UNPAID", "PARTIAL", "UNKNOWN"] }, nextDueDate: { lt: now } }, select: { number: true, senderName: true, nextDueDate: true, totalAmount: true }, take: 50 }),
    db.syncJob.count({ where: { organizationId, status: "DEAD" } }),
    db.integrationConnection.findMany({ where: { organizationId } }),
    db.productVariant.findMany({ where: { organizationId, deletedAt: null, isDemo: false, inventoryQuantity: { not: null, lte: lowStockThreshold }, product: { deletedAt: null, status: { in: ["ACTIVE", "active"] } } }, select: { sku: true, title: true, inventoryQuantity: true, product: { select: { title: true } } }, take: 100 }),
    db.productionOrder.findMany({ where: { organizationId, status: { in: ["ORDERED", "IN_PRODUCTION", "SHIPPED"] }, expectedAt: { lt: now } }, include: { supplier: { select: { name: true } } }, take: 20 }),
    db.task.count({ where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
    db.agentApproval.count({ where: { organizationId, status: "PENDING" } }),
    db.order.count({ where: { organizationId, deletedAt: null, test: false, cancelledAt: null, isDemo: false, processedAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.order.count({ where: { organizationId, deletedAt: null, test: false, cancelledAt: null, isDemo: false, processedAt: { gte: new Date(now.getTime() - 35 * DAY), lt: new Date(now.getTime() - 7 * DAY) } } }),
    monthSpendUsd(organizationId),
  ]);
  const { getConnector } = await import("../connectors/registry");
  return {
    now,
    currency: org.baseCurrency,
    lateUnfulfilled: late.map((o) => ({ name: o.name, processedAt: o.processedAt, total: o.totalPrice.toFixed(2) })),
    problemShipments,
    unreconciledOldTx,
    suggestedReconciliations: suggested,
    invoicesDueSoon: dueSoon.map((i) => ({ number: i.number, counterparty: i.senderName, dueDate: i.nextDueDate!, amount: i.totalAmount.toFixed(2) })),
    invoicesOverdue: overdue.map((i) => ({ number: i.number, counterparty: i.senderName, dueDate: i.nextDueDate!, amount: i.totalAmount.toFixed(2) })),
    deadJobs,
    connections: connections.map((c) => {
      let scheduled = false;
      try {
        scheduled = getConnector(c.key).jobs.some((j) => j.scheduled);
      } catch {}
      return { key: c.key, displayName: c.displayName, status: c.status, lastSyncAt: c.lastSyncAt, lastError: c.lastError, blockedReason: c.blockedReason, scheduled };
    }),
    lowStock: lowStock.map((v) => ({ sku: v.sku, title: `${v.product.title} ${v.title}`.trim(), qty: v.inventoryQuantity ?? 0 })),
    lowStockThreshold,
    budget: { spentUsd, budgetUsd: agentMonthlyBudgetUsd() },
    lateProduction: lateProduction.map((p) => ({ reference: p.reference, expectedAt: p.expectedAt!, supplier: p.supplier?.name ?? null, status: p.status })),
    overdueTasks,
    pendingApprovals,
    ordersLast7d,
    ordersPrev28d,
  };
}

export async function runMonitor(organizationId: string): Promise<{ created: number; updated: number; resolved: number; notified: number }> {
  await expirePendingApprovals();
  const snapshot = await collectSnapshot(organizationId);
  const candidates = computeAlerts(snapshot);
  const existing = await db.alert.findMany({ where: { organizationId } });
  const byKey = new Map(existing.map((a) => [a.dedupeKey, a]));
  let created = 0, updated = 0, resolved = 0, notified = 0;
  const newCritical: AlertCandidate[] = [];
  for (const c of candidates) {
    const prev = byKey.get(c.dedupeKey);
    const data = (c.data ?? {}) as Prisma.InputJsonValue;
    if (!prev) {
      await db.alert.create({ data: { organizationId, dedupeKey: c.dedupeKey, kind: c.kind, severity: c.severity, title: c.title, body: c.body, href: c.href ?? null, data } });
      created++;
      if (c.severity === "CRITICAL") newCritical.push(c);
    } else {
      const reopen = prev.status === "RESOLVED" || (prev.status === "SNOOZED" && prev.snoozedUntil && prev.snoozedUntil < snapshot.now);
      const escalated = prev.severity !== "CRITICAL" && c.severity === "CRITICAL";
      await db.alert.update({ where: { id: prev.id }, data: { severity: c.severity, title: c.title, body: c.body, href: c.href ?? null, data, lastSeenAt: snapshot.now, ...(reopen ? { status: "OPEN", resolvedAt: null, snoozedUntil: null, firstSeenAt: snapshot.now } : {}) } });
      updated++;
      if ((reopen || escalated) && c.severity === "CRITICAL") newCritical.push(c);
    }
  }
  const currentKeys = new Set(candidates.map((c) => c.dedupeKey));
  for (const a of existing) {
    if (!currentKeys.has(a.dedupeKey) && a.status !== "RESOLVED") {
      await db.alert.update({ where: { id: a.id }, data: { status: "RESOLVED", resolvedAt: snapshot.now } });
      resolved++;
    }
  }
  if (newCritical.length && (await telegramEnabled(organizationId, "sendCriticalAlerts"))) {
    const text = `MOAI OS · avvisi critici\n\n${newCritical.map((c) => `• ${c.title}\n  ${c.body}`).join("\n\n")}`;
    const r = await sendTelegram(organizationId, text, { reason: "monitor.critical" });
    if (r.ok) notified = newCritical.length;
  }
  return { created, updated, resolved, notified };
}
