import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { extractOrderRefs, matchPaymentToOrder, matchPayoutToBank, normalizeOrderRef, payoutIntegrity, type OrderCandidate, type ProcessorTx } from "@/server/reconciliation/rules";

const D = (v: string | number) => new Prisma.Decimal(v);
const day = (n: number) => new Date(Date.UTC(2026, 9, n));

const order = (over: Partial<OrderCandidate> = {}): OrderCandidate => ({
  id: "o1", name: "#1042", currency: "EUR", totalPrice: D("89.00"), processedAt: day(1),
  orderTransactions: [{ externalId: "gid://shopify/OrderTransaction/1", amount: D("89.00"), gateway: "shopify_payments", kind: "SALE" }],
  ...over,
});
const tx = (over: Partial<ProcessorTx> = {}): ProcessorTx => ({ id: "t1", provider: "shopify_payments", amount: D("89.00"), currency: "EUR", processedAt: day(1), orderRef: null, orderTransactionExternalId: null, ...over });

describe("order reference helpers", () => {
  it("normalises and extracts refs", () => {
    expect(normalizeOrderRef(" #1042 ")).toBe("1042");
    expect(normalizeOrderRef("Order MOAI1042")).toBe("MOAI1042");
    expect(extractOrderRefs("Vendita online - ordine Shopify #1042 e #1043")).toEqual(["1042", "1043"]);
    expect(extractOrderRefs("nothing here")).toEqual([]);
  });
});

describe("payment ↔ order", () => {
  it("R1: matches on the order transaction id even with a different amount", () => {
    const r = matchPaymentToOrder(tx({ orderTransactionExternalId: "gid://shopify/OrderTransaction/1", amount: D("80") }), [order()]);
    expect(r.kind).toBe("auto");
    if (r.kind === "auto") expect(r.rule).toBe("R1_ORDER_TRANSACTION_ID");
  });
  it("R2: matches on explicit order reference + amount", () => {
    const r = matchPaymentToOrder(tx({ provider: "paypal", orderRef: "#1042" }), [order({ orderTransactions: [] })]);
    expect(r.kind).toBe("auto");
    if (r.kind === "auto") expect(r.rule).toBe("R2_ORDER_REF_AMOUNT");
  });
  it("R2: same reference but different amount is only suggested", () => {
    const r = matchPaymentToOrder(tx({ orderRef: "1042", amount: D("50") }), [order({ orderTransactions: [] })]);
    expect(r.kind).toBe("suggest");
    if (r.kind === "suggest") {
      expect(r.rule).toBe("R2_ORDER_REF_AMOUNT_MISMATCH");
      expect(r.targets[0]!.difference.toFixed(2)).toBe("39.00");
    }
  });
  it("R3: amount+date only ever suggests, and is ambiguous with two candidates", () => {
    const one = matchPaymentToOrder(tx(), [order({ orderTransactions: [] })]);
    expect(one.kind).toBe("suggest");
    if (one.kind === "suggest") expect(one.rule).toBe("R3_AMOUNT_DATE_UNIQUE");
    const two = matchPaymentToOrder(tx(), [order({ orderTransactions: [] }), order({ id: "o2", name: "#1043", orderTransactions: [] })]);
    expect(two.kind).toBe("suggest");
    if (two.kind === "suggest") {
      expect(two.rule).toBe("R3_AMOUNT_DATE_AMBIGUOUS");
      expect(two.targets.every((t) => t.confidence === "LOW")).toBe(true);
    }
  });
  it("never matches across currencies or far dates", () => {
    expect(matchPaymentToOrder(tx({ currency: "USD" }), [order({ orderTransactions: [] })]).kind).toBe("none");
    expect(matchPaymentToOrder(tx({ processedAt: day(20) }), [order({ orderTransactions: [] })]).kind).toBe("none");
  });
});

describe("payout ↔ bank", () => {
  const payout = { id: "p1", provider: "shopify_payments", externalId: "gid://shopify/ShopifyPaymentsPayout/987654321", bankReference: null, netAmount: D("1234.56"), currency: "EUR", issuedAt: day(3), arrivalDate: day(5) };
  const credit = (over: Partial<Parameters<typeof matchPayoutToBank>[1][number]> = {}) => ({ id: "b1", amount: D("1234.56"), currency: "EUR", bookingDate: day(5), valueDate: null, description: "ACCREDITO SHOPIFY PAYMENTS", reference: null, counterparty: null, ...over });
  it("P1: payout id in the bank description → automatic", () => {
    const r = matchPayoutToBank(payout, [credit({ description: "BONIFICO SHOPIFY 987654321" })]);
    expect(r.kind).toBe("auto");
  });
  it("P2: amount + window + provider keyword → high suggestion", () => {
    const r = matchPayoutToBank(payout, [credit()]);
    expect(r.kind).toBe("suggest");
    if (r.kind === "suggest") expect(r.targets[0]!.confidence).toBe("HIGH");
  });
  it("P3: amount + window without keyword → low suggestion; debits never match", () => {
    const r = matchPayoutToBank(payout, [credit({ description: "GIROCONTO" })]);
    expect(r.kind).toBe("suggest");
    if (r.kind === "suggest") expect(r.targets[0]!.confidence).toBe("LOW");
    expect(matchPayoutToBank(payout, [credit({ amount: D("-1234.56") })]).kind).toBe("none");
    expect(matchPayoutToBank(payout, [credit({ bookingDate: day(25) })]).kind).toBe("none");
  });
});

describe("payout integrity", () => {
  it("adds charges and subtracts refunds/fees, flags imbalance", () => {
    const ok = payoutIntegrity(D("150.00"), [
      { kind: "SALE", amount: D("100"), fee: D("2"), net: D("98") },
      { kind: "SALE", amount: D("60"), fee: D("1"), net: D("59") },
      { kind: "REFUND", amount: D("7"), fee: null, net: D("-7") },
    ]);
    expect(ok.computed.toFixed(2)).toBe("150.00");
    expect(ok.balanced).toBe(true);
    const bad = payoutIntegrity(D("160.00"), [{ kind: "SALE", amount: D("100"), fee: D("2"), net: null }]);
    expect(bad.balanced).toBe(false);
    expect(bad.difference.toFixed(2)).toBe("62.00");
  });
});
