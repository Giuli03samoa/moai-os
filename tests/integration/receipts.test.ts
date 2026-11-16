import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { clearFiscalDoc, countPendingReceipts, markFiscalDoc } from "@/server/receipts/receipts";
import { makeOrg, makeUser } from "./helpers";

describe("receipts checklist for in-person sales", () => {
  it("counts only successful face-to-face sales, and ticking one is audited and reversible", async () => {
    const org = await makeOrg();
    const other = await makeOrg("09876543210");
    const user = await makeUser(org.id);
    const when = new Date("2026-11-14T18:00:00Z");
    const base = { organizationId: org.id, source: "PAYMENT_API" as const, ledger: "PROCESSOR" as const, provider: "sumup", currency: "EUR", processedAt: when };
    const sale = await db.paymentTransaction.create({ data: { ...base, externalId: "s-1", kind: "SALE", status: "SUCCESS", inPerson: true, amount: "75" } });
    await db.paymentTransaction.create({ data: { ...base, externalId: "s-2", kind: "SALE", status: "SUCCESS", inPerson: true, amount: "20" } });
    // None of these needs a receipt from this list: failed sale, refund row, online payment, another organization.
    await db.paymentTransaction.create({ data: { ...base, externalId: "f-1", kind: "SALE", status: "FAILURE", inPerson: true, amount: "100" } });
    await db.paymentTransaction.create({ data: { ...base, externalId: "r-1", kind: "REFUND", status: "SUCCESS", inPerson: true, amount: "20" } });
    await db.paymentTransaction.create({ data: { ...base, externalId: "e-1", kind: "SALE", status: "SUCCESS", inPerson: false, amount: "60" } });
    const foreign = await db.paymentTransaction.create({ data: { ...base, organizationId: other.id, externalId: "s-1", kind: "SALE", status: "SUCCESS", inPerson: true, amount: "75" } });

    expect(await countPendingReceipts(org.id)).toBe(2);

    await markFiscalDoc(org.id, user.id, sale.id, { kind: "RECEIPT", ref: "  DCW2026/0001-0001  " });
    const marked = await db.paymentTransaction.findUniqueOrThrow({ where: { id: sale.id } });
    expect(marked.fiscalDocKind).toBe("RECEIPT");
    expect(marked.fiscalDocRef).toBe("DCW2026/0001-0001");
    expect(marked.fiscalDocAt).toBeInstanceOf(Date);
    expect(marked.amount.toFixed(2)).toBe("75.00"); // the takings themselves are never touched
    expect(await countPendingReceipts(org.id)).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "receipt.marked", entityId: sale.id } })).toBe(1);

    // Another organization's sale cannot be ticked from here.
    await expect(markFiscalDoc(org.id, user.id, foreign.id, { kind: "RECEIPT" })).rejects.toThrow(/non trovato/);
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: foreign.id } })).fiscalDocAt).toBeNull();

    await clearFiscalDoc(org.id, user.id, sale.id);
    const cleared = await db.paymentTransaction.findUniqueOrThrow({ where: { id: sale.id } });
    expect([cleared.fiscalDocKind, cleared.fiscalDocRef, cleared.fiscalDocAt]).toEqual([null, null, null]);
    expect(await countPendingReceipts(org.id)).toBe(2);
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "receipt.unmarked" } })).toBe(1);
  });
});
