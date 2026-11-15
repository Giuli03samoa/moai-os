import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getDashboardMetrics } from "@/server/metrics/dashboard";
import { reconcilePayments } from "@/server/reconciliation/engine";
import { makeOrg } from "./helpers";

describe("in-person sales (SumUp)", () => {
  it("are reported on their own line and never matched to an online order of the same amount", async () => {
    const org = await makeOrg();
    const when = new Date("2026-11-14T18:00:00Z");
    // An online order of exactly the same amount, the same day: the classic false match.
    await db.order.create({ data: { organizationId: org.id, source: "SHOPIFY", externalId: "o-1", name: "#1001", currency: "EUR", subtotalPrice: "70", totalPrice: "70", financialStatus: "PAID", fulfillmentStatus: "UNFULFILLED", processedAt: when, sourceUpdatedAt: when } });
    const base = { organizationId: org.id, source: "PAYMENT_API" as const, ledger: "PROCESSOR" as const, provider: "sumup", currency: "EUR", processedAt: when, status: "SUCCESS" as const, inPerson: true };
    const sale = await db.paymentTransaction.create({ data: { ...base, externalId: "s-1", kind: "SALE", amount: "70", fee: "1.33", net: "68.67", orderRef: "TABC123" } });
    await db.paymentTransaction.create({ data: { ...base, externalId: "s-2", kind: "SALE", amount: "130", orderRef: "TDEF456" } });
    await db.paymentTransaction.create({ data: { ...base, externalId: "r-1", kind: "REFUND", amount: "30", orderRef: "TREF000" } });

    const r = await reconcilePayments(org.id);
    expect(r.examined).toBe(0);
    expect(await db.reconciliation.count({ where: { organizationId: org.id } })).toBe(0);
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: sale.id } })).orderId).toBeNull();

    const metrics = await getDashboardMetrics(org.id, { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-30T23:59:59Z") }, "EUR");
    const inPerson = metrics.find((m) => m.key === "inPerson")!;
    expect(inPerson.value).toBe("170.00"); // 70 + 130 − 30
    expect(inPerson.definition).toContain("2 vendite di persona");
    expect(metrics.find((m) => m.key === "gross")!.value).toBe("70.00"); // online only
    expect(metrics.find((m) => m.key === "unreconciled")!.value).toBe("0");
  });
});
