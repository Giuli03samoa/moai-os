import { describe, expect, it } from "vitest";
import { computeAlerts, type MonitorSnapshot } from "@/server/agent/monitor";

const now = new Date("2026-11-04T10:00:00Z");
const base: MonitorSnapshot = {
  now, currency: "EUR", lateUnfulfilled: [], problemShipments: 0, unreconciledOldTx: 0, suggestedReconciliations: 0, invoicesDueSoon: [], invoicesOverdue: [], deadJobs: 0,
  connections: [], lowStock: [], lowStockThreshold: 3, budget: { spentUsd: 0, budgetUsd: 60 }, lateProduction: [], overdueTasks: 0, pendingApprovals: 0, ordersLast7d: 3, ordersPrev28d: 10, lastBackupAt: null,
};

describe("monitor rules", () => {
  it("is silent when everything is fine", () => {
    expect(computeAlerts(base)).toEqual([]);
  });
  it("escalates late unfulfilled orders after 5 days", () => {
    const warn = computeAlerts({ ...base, lateUnfulfilled: [{ name: "#1", processedAt: new Date(now.getTime() - 3 * 86_400_000), total: "10.00" }] });
    expect(warn[0]?.severity).toBe("WARNING");
    const crit = computeAlerts({ ...base, lateUnfulfilled: [{ name: "#1", processedAt: new Date(now.getTime() - 6 * 86_400_000), total: "10.00" }] });
    expect(crit[0]?.severity).toBe("CRITICAL");
    expect(crit[0]?.dedupeKey).toBe("orders.unfulfilled_late");
  });
  it("flags overdue invoices as critical with the total", () => {
    const r = computeAlerts({ ...base, invoicesOverdue: [{ number: "12", counterparty: "Stamperia", dueDate: new Date("2026-10-30"), amount: "1200.00" }, { number: "13", counterparty: "Tessuti", dueDate: new Date("2026-10-31"), amount: "300.50" }] });
    expect(r[0]?.severity).toBe("CRITICAL");
    expect(r[0]?.title).toContain("1500,50 EUR");
  });
  it("produces one alert per integration in error/blocked/stale", () => {
    const r = computeAlerts({ ...base, connections: [
      { key: "shopify", displayName: "Shopify", status: "ERROR", lastSyncAt: null, lastError: "401", blockedReason: null, scheduled: true },
      { key: "aruba", displayName: "Aruba", status: "BLOCKED", lastSyncAt: null, lastError: null, blockedReason: "Premium richiesto", scheduled: true },
      { key: "meta", displayName: "Meta", status: "CONNECTED", lastSyncAt: new Date(now.getTime() - 48 * 3_600_000), lastError: null, blockedReason: null, scheduled: true },
      { key: "telegram", displayName: "Telegram", status: "CONNECTED", lastSyncAt: null, lastError: null, blockedReason: null, scheduled: false },
    ] });
    expect(r.map((a) => a.dedupeKey)).toEqual(["integration.error:shopify", "integration.blocked:aruba", "integration.stale:meta"]);
  });
  it("tracks the agent budget at 80% and 100%", () => {
    expect(computeAlerts({ ...base, budget: { spentUsd: 40, budgetUsd: 60 } })).toEqual([]);
    expect(computeAlerts({ ...base, budget: { spentUsd: 50, budgetUsd: 60 } })[0]?.severity).toBe("INFO");
    expect(computeAlerts({ ...base, budget: { spentUsd: 61, budgetUsd: 60 } })[0]?.severity).toBe("WARNING");
  });
  it("warns on zero orders in a week only with real history", () => {
    expect(computeAlerts({ ...base, ordersLast7d: 0, ordersPrev28d: 2 })).toEqual([]);
    expect(computeAlerts({ ...base, ordersLast7d: 0, ordersPrev28d: 12 })[0]?.kind).toBe("sales.no_orders_7d");
  });
  it("warns when the daily backup stops, never before the first one", () => {
    expect(computeAlerts({ ...base, lastBackupAt: null })).toEqual([]);
    expect(computeAlerts({ ...base, lastBackupAt: new Date(now.getTime() - 30 * 3_600_000) })).toEqual([]);
    expect(computeAlerts({ ...base, lastBackupAt: new Date(now.getTime() - 3 * 86_400_000) })[0]?.kind).toBe("backup.stale");
  });
  it("low stock is WARNING when something is sold out", () => {
    expect(computeAlerts({ ...base, lowStock: [{ sku: "A", title: "A", qty: 2 }] })[0]?.severity).toBe("INFO");
    expect(computeAlerts({ ...base, lowStock: [{ sku: "A", title: "A", qty: 0 }] })[0]?.severity).toBe("WARNING");
  });
});
