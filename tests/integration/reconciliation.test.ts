import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { decideReconciliation, runReconciliation } from "@/server/reconciliation/engine";
import { makeOrg, makeUser } from "./helpers";

const D = (v: string) => new Prisma.Decimal(v);

describe("reconciliation engine (DB)", () => {
  it("links processor transactions, payouts and bank credits without double counting", async () => {
    const org = await makeOrg();
    const user = await makeUser(org.id);
    const at = new Date("2026-10-01T10:00:00Z");
    const order = await db.order.create({
      data: { organizationId: org.id, source: "SHOPIFY", externalId: "gid://shopify/Order/1", name: "#1042", currency: "EUR", subtotalPrice: D("72.95"), totalTax: D("16.05"), totalPrice: D("89.00"), financialStatus: "PAID", fulfillmentStatus: "UNFULFILLED", processedAt: at, sourceUpdatedAt: at,
        payments: { create: [{ organizationId: org.id, source: "SHOPIFY", ledger: "ORDER", provider: "shopify_payments", externalId: "gid://shopify/OrderTransaction/501", kind: "SALE", status: "SUCCESS", amount: D("89.00"), currency: "EUR", processedAt: at, orderRef: "#1042" }] } },
    });
    const order2 = await db.order.create({ data: { organizationId: org.id, source: "SHOPIFY", externalId: "gid://shopify/Order/2", name: "#1043", currency: "EUR", subtotalPrice: D("50"), totalPrice: D("50.00"), financialStatus: "PAID", fulfillmentStatus: "UNFULFILLED", processedAt: at, sourceUpdatedAt: at } });

    // Processor ledger: exact (R1), partial (R2 mismatch) and ambiguous (R3).
    await db.paymentTransaction.createMany({
      data: [
        { organizationId: org.id, source: "PAYMENT_API", ledger: "PROCESSOR", provider: "shopify_payments", externalId: "bt_1", kind: "SALE", status: "SUCCESS", amount: D("89.00"), fee: D("1.94"), net: D("87.06"), currency: "EUR", processedAt: at, orderTransactionExternalId: "gid://shopify/OrderTransaction/501", payoutExternalId: "po_1A2B3C4D" },
        { organizationId: org.id, source: "PAYMENT_CSV", ledger: "PROCESSOR", provider: "paypal", externalId: "pp_1", kind: "SALE", status: "SUCCESS", amount: D("25.00"), fee: D("1.00"), net: D("24.00"), currency: "EUR", processedAt: at, orderRef: "#1043" },
        { organizationId: org.id, source: "PAYMENT_CSV", ledger: "PROCESSOR", provider: "paypal", externalId: "pp_2", kind: "SALE", status: "SUCCESS", amount: D("50.00"), fee: D("1.50"), net: D("48.50"), currency: "EUR", processedAt: at },
      ],
    });
    const payout = await db.payout.create({ data: { organizationId: org.id, source: "PAYMENT_API", provider: "shopify_payments", externalId: "po_1A2B3C4D", status: "PAID", issuedAt: new Date("2026-10-03"), arrivalDate: new Date("2026-10-05"), netAmount: D("87.06"), currency: "EUR" } });
    await db.bankTransaction.createMany({
      data: [
        { organizationId: org.id, source: "BANK_CSV", accountLabel: "Conto", externalId: "b1", bookingDate: new Date("2026-10-05"), amount: D("87.06"), currency: "EUR", description: "ACCREDITO SHOPIFY PAYMENTS po_1A2B3C4D" },
        { organizationId: org.id, source: "BANK_CSV", accountLabel: "Conto", externalId: "b2", bookingDate: new Date("2026-10-05"), amount: D("-20.00"), currency: "EUR", description: "CANONE" },
      ],
    });

    const r = await runReconciliation(org.id);
    expect(r.payments.auto).toBe(1);
    expect(r.payments.suggested).toBeGreaterThanOrEqual(2);
    expect(r.payouts.auto).toBe(1);

    const bt1 = await db.paymentTransaction.findUniqueOrThrow({ where: { organizationId_provider_ledger_externalId: { organizationId: org.id, provider: "shopify_payments", ledger: "PROCESSOR", externalId: "bt_1" } } });
    expect(bt1.orderId).toBe(order.id);
    const recs = await db.reconciliation.findMany({ where: { organizationId: org.id }, include: { paymentTransaction: true } });
    const partial = recs.find((x) => x.paymentTransaction?.externalId === "pp_1")!;
    expect(partial.status).toBe("SUGGESTED");
    expect(partial.rule).toBe("R2_ORDER_REF_AMOUNT_MISMATCH");
    expect(partial.amountDifference?.toFixed(2)).toBe("25.00");
    const r3 = recs.find((x) => x.paymentTransaction?.externalId === "pp_2")!;
    expect(r3.status).toBe("SUGGESTED");
    expect(r3.orderId).toBe(order2.id);
    const payoutRec = recs.find((x) => x.payoutId === payout.id)!;
    expect(payoutRec.status).toBe("AUTO_MATCHED");
    expect(payoutRec.rule).toBe("P1_PAYOUT_REF_AMOUNT");

    // Human confirms R3 → the transaction is linked; running again changes nothing.
    await decideReconciliation(org.id, r3.id, "CONFIRM", user.id);
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: r3.paymentTransactionId! } })).orderId).toBe(order2.id);
    await expect(decideReconciliation(org.id, r3.id, "REJECT", user.id)).rejects.toThrow(/già/);
    const again = await runReconciliation(org.id);
    expect(again.payments.auto).toBe(0);
    expect(await db.reconciliation.count({ where: { organizationId: org.id, status: "CONFIRMED" } })).toBe(1);

    // Revenue sanity: orders total is 139, payments and payouts are views of the same money.
    const orders = await db.order.aggregate({ _sum: { totalPrice: true }, where: { organizationId: org.id } });
    expect(orders._sum.totalPrice!.toFixed(2)).toBe("139.00");
  });
});
