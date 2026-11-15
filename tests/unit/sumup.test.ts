import { describe, expect, it } from "vitest";
import { SumUpClient } from "@/server/connectors/sumup/client";
import { groupPayouts, isInPerson, mapKind, mapStatus, mapTransaction } from "@/server/connectors/sumup/map";
import { syncStart } from "@/server/connectors/sumup/sync";

describe("sumup mapping", () => {
  it("maps a card sale at an event with fee, VAT and products", () => {
    const m = mapTransaction(
      { id: "tx-1", transaction_code: "TABC123", amount: 70, currency: "EUR", timestamp: "2026-11-14T18:30:00.000Z", status: "SUCCESSFUL", payment_type: "POS", entry_mode: "contactless", card_type: "VISA", type: "PAYMENT" },
      { fee_amount: 1.33, vat_amount: 12.62, products: [{ name: "Motion Short", quantity: 1, price_with_vat: 70, total_with_vat: 70, vat_rate: 0.22 }] },
    )!;
    expect(m.externalId).toBe("tx-1");
    expect(m.kind).toBe("SALE");
    expect(m.status).toBe("SUCCESS");
    expect(m.inPerson).toBe(true);
    expect(m.amount.toFixed(2)).toBe("70.00");
    expect(m.fee!.toFixed(2)).toBe("1.33");
    expect(m.net!.toFixed(2)).toBe("68.67");
    expect(m.orderRef).toBe("TABC123");
    expect(m.gateway).toBe("POS · contactless · VISA");
    expect((m.raw as { products: Array<{ name: string }> }).products[0]!.name).toBe("Motion Short");
  });

  it("keeps a refunded sale as a successful sale and maps the refund as its own positive row", () => {
    expect(mapStatus("REFUNDED")).toBe("SUCCESS");
    const refund = mapTransaction({ id: "tx-2", amount: -70, currency: "EUR", timestamp: "2026-11-15T10:00:00Z", status: "SUCCESSFUL", payment_type: "POS", type: "REFUND" })!;
    expect(refund.kind).toBe("REFUND");
    expect(refund.amount.toFixed(2)).toBe("70.00");
    expect(refund.net).toBeNull();
  });

  it("maps statuses and kinds, and treats only e-commerce as online", () => {
    expect([mapStatus("PENDING"), mapStatus("FAILED"), mapStatus("CANCELLED"), mapStatus("boh")]).toEqual(["PENDING", "FAILURE", "VOIDED", "ERROR"]);
    expect([mapKind("PAYMENT"), mapKind("CHARGE_BACK"), mapKind(undefined)]).toEqual(["SALE", "CHARGEBACK", "SALE"]);
    expect([isInPerson("POS"), isInPerson("CASH"), isInPerson("ECOM"), isInPerson(undefined)]).toEqual([true, true, false, true]);
  });

  it("skips items without id or timestamp", () => {
    expect(mapTransaction({ amount: 10 })).toBeNull();
  });

  it("groups payout records into one bank transfer per reference and date", () => {
    const g = groupPayouts([
      { id: 1, type: "PAYOUT", amount: 68.67, fee: 1.33, date: "2026-11-17", currency: "EUR", status: "SUCCESSFUL", reference: "P-1", transaction_code: "TABC123" },
      { id: 2, type: "PAYOUT", amount: 127.53, fee: 2.47, date: "2026-11-17", currency: "EUR", status: "SUCCESSFUL", reference: "P-1", transaction_code: "TDEF456" },
      { id: 3, type: "REFUND_DEDUCTION", amount: 70, fee: 0, date: "2026-11-17", currency: "EUR", status: "SUCCESSFUL", reference: "P-1", transaction_code: "TOLD000" },
      { id: 4, type: "PAYOUT", amount: 19.62, fee: 0.38, date: "2026-11-18", currency: "EUR", status: "SUCCESSFUL", reference: "P-2", transaction_code: "TGHI789" },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]!.externalId).toBe("P-1|2026-11-17");
    expect(g[0]!.grossAmount.toFixed(2)).toBe("200.00");
    expect(g[0]!.feeAmount.toFixed(2)).toBe("3.80");
    expect(g[0]!.netAmount.toFixed(2)).toBe("126.20"); // 68.67 + 127.53 − 70.00
    expect(g[0]!.transactions.map((t) => t.transactionCode)).toEqual(["TABC123", "TDEF456"]);
    expect(g[1]!.status).toBe("PAID");
  });

  it("defaults the import start to 90 days and honours the configured date", () => {
    expect(syncStart({ syncFrom: "2026-01-01" }).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    const d = syncStart({});
    expect(Math.round((Date.now() - d.getTime()) / 86_400_000)).toBe(90);
  });
});

describe("sumup client", () => {
  it("only sends GET requests with the bearer key and follows the next link as given", async () => {
    const calls: Array<{ url: string; method?: string; auth?: string }> = [];
    const pages = [
      { items: [{ id: "a" }, { id: "b" }], links: [{ rel: "next", href: "limit=2&oldest_ref=b&order=ascending" }] },
      { items: [{ id: "c" }], links: [] },
    ];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, auth: (init?.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
    }) as typeof fetch;
    const client = new SumUpClient({ apiKey: "sup_sk_test", merchantCode: "MC 1", fetchImpl });
    const ids: string[] = [];
    for await (const page of client.history({ oldestTime: new Date("2026-11-01T00:00:00Z"), pageSize: 2 })) ids.push(...page.map((i) => i.id!));
    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.method === "GET" && c.auth === "Bearer sup_sk_test")).toBe(true);
    expect(calls[0]!.url).toContain("/v2.1/merchants/MC%201/transactions/history?order=ascending&limit=2&oldest_time=2026-11-01");
    expect(calls[1]!.url.endsWith("/transactions/history?limit=2&oldest_ref=b&order=ascending")).toBe(true);
  });

  it("reports an invalid key clearly", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(new SumUpClient({ apiKey: "x", merchantCode: "M", fetchImpl }).listPayouts("2026-11-01", "2026-11-15")).rejects.toThrow(/chiave API non valida/);
  });
});
