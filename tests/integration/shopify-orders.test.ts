import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { upsertOrder } from "@/server/connectors/shopify/mappers";
import type { OrderNode } from "@/server/connectors/shopify/queries";
import { makeOrg } from "./helpers";

const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "EUR" } });

function node(over: Partial<OrderNode> = {}): OrderNode {
  return {
    id: "gid://shopify/Order/1001", name: "#1001", test: false, createdAt: "2026-10-01T10:00:00Z", processedAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", cancelledAt: null, closedAt: null,
    currencyCode: "EUR", presentmentCurrencyCode: "EUR", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", tags: ["drop01"], paymentGatewayNames: ["shopify_payments"],
    subtotalPriceSet: money("72.95"), totalDiscountsSet: money("0"), totalShippingPriceSet: money("0"), totalTaxSet: money("16.05"), totalPriceSet: money("89.00"), totalRefundedSet: money("0"),
    customer: { id: "gid://shopify/Customer/5", numberOfOrders: "3", amountSpent: { amount: "267.00", currencyCode: "EUR" }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", displayName: "Mario Rossi", email: "mario@example.com" },
    lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", sku: "MOT-TEE-BLK-M", title: "MOTION Tee", quantity: 1, variant: { id: "gid://shopify/ProductVariant/77" }, originalUnitPriceSet: money("89.00"), totalDiscountSet: money("0") }] },
    transactions: [{ id: "gid://shopify/OrderTransaction/501", kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", processedAt: "2026-10-01T10:00:05Z", paymentId: "p1", amountSet: money("89.00"), fees: [{ amount: { amount: "1.94", currencyCode: "EUR" } }], parentTransaction: null }],
    fulfillments: [],
    refunds: [],
    ...over,
  };
}

describe("Shopify order upsert", () => {
  it("is idempotent, respects PII settings and ignores stale updates", async () => {
    const org = await makeOrg();
    const r1 = await upsertOrder(org.id, node(), { storeCustomerPii: false });
    expect(r1.created).toBe(true);
    const r2 = await upsertOrder(org.id, node(), { storeCustomerPii: false });
    expect(r2.created).toBe(false);
    expect(await db.order.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await db.orderItem.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await db.paymentTransaction.count({ where: { organizationId: org.id, ledger: "ORDER" } })).toBe(1);
    const customer = await db.customer.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(customer.displayName).toBeNull(); // PII not stored unless enabled
    expect(customer.ordersCount).toBe(3);

    // Newer update: refund + fulfillment appear, line replaced.
    const updated = node({
      updatedAt: "2026-10-03T10:00:00Z", displayFinancialStatus: "PARTIALLY_REFUNDED", displayFulfillmentStatus: "FULFILLED", totalRefundedSet: money("10.00"),
      transactions: [...node().transactions, { id: "gid://shopify/OrderTransaction/502", kind: "REFUND", status: "SUCCESS", gateway: "shopify_payments", processedAt: "2026-10-03T09:00:00Z", paymentId: null, amountSet: money("10.00"), fees: [], parentTransaction: { id: "gid://shopify/OrderTransaction/501" } }],
      fulfillments: [{ id: "gid://shopify/Fulfillment/9", status: "SUCCESS", displayStatus: "IN_TRANSIT", createdAt: "2026-10-02T08:00:00Z", updatedAt: "2026-10-02T08:00:00Z", deliveredAt: null, inTransitAt: "2026-10-02T09:00:00Z", trackingInfo: [{ number: "1Z999", url: "https://track/1Z999", company: "UPS" }] }],
    });
    await upsertOrder(org.id, updated, { storeCustomerPii: false });
    const o = await db.order.findFirstOrThrow({ where: { organizationId: org.id }, include: { payments: true, shipments: true } });
    expect(o.financialStatus).toBe("PARTIALLY_REFUNDED");
    expect(o.totalRefunded.toFixed(2)).toBe("10.00");
    expect(o.payments).toHaveLength(2);
    expect(o.shipments[0]).toMatchObject({ trackingNumber: "1Z999", status: "IN_TRANSIT", carrier: "UPS", source: "SHOPIFY" });

    // A stale webhook (older updatedAt) must not roll the order back.
    const stale = await upsertOrder(org.id, node({ updatedAt: "2026-10-02T00:00:00Z" }), { storeCustomerPii: false });
    expect(stale.skipped).toBe(true);
    expect((await db.order.findFirstOrThrow({ where: { organizationId: org.id } })).financialStatus).toBe("PARTIALLY_REFUNDED");
  });
});
