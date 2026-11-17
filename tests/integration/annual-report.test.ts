import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { annualReport } from "@/server/reports/annual";
import { makeOrg } from "./helpers";

describe("annual report", () => {
  it("adds VAT-free revenue and costs, cash with VAT, and nets credit notes", async () => {
    const org = await makeOrg();
    const base = { organizationId: org.id, source: "PAYMENT_API" as const, ledger: "PROCESSOR" as const, provider: "sumup", currency: "EUR", status: "SUCCESS" as const, inPerson: true };
    await db.paymentTransaction.create({ data: { ...base, externalId: "s1", kind: "SALE", amount: "122", fee: "2.38", processedAt: new Date("2026-11-14T15:00:00Z") } });
    await db.paymentTransaction.create({ data: { ...base, externalId: "s0", kind: "SALE", amount: "61", processedAt: new Date("2025-12-20T15:00:00Z") } }); // other year
    await db.payout.create({ data: { organizationId: org.id, source: "PAYMENT_API", provider: "sumup", externalId: "p1", status: "PAID", issuedAt: new Date("2026-11-15T08:00:00Z"), netAmount: "119.62", currency: "EUR" } });
    await db.expense.create({ data: { organizationId: org.id, category: "COGS", amount: 1000, description: "tessuto", date: new Date("2026-04-08T12:00:00Z") } });
    await db.expense.create({ data: { organizationId: org.id, category: "COGS", amount: -100, description: "nota di credito", date: new Date("2026-09-30T12:00:00Z") } });
    const inv = async (n: string, type: string, total: number, tax: number, paidAt: Date) => {
      const i = await db.invoice.create({ data: { organizationId: org.id, source: "XML_UPLOAD", direction: "PASSIVE", dedupeKey: n, documentType: type, number: n, issueDate: paidAt, currency: "EUR", totalAmount: total, taxableAmount: total - tax, taxAmount: tax, senderName: "Fornitore", receiverName: "Test" } as never });
      await db.invoiceInstallment.create({ data: { organizationId: org.id, invoiceId: i.id, position: 1, amount: total, dueDate: paidAt, paidAt } as never });
    };
    await inv("F1", "TD01", 1220, 220, new Date("2026-04-08T12:00:00Z"));
    await inv("NC1", "TD04", 122, 22, new Date("2026-09-30T12:00:00Z"));

    const r = await annualReport(org.id, 2026);
    expect(r.revenue.inPerson).toBe("100.00"); // 122 with 22% VAT
    expect(r.revenue.total).toBe("100.00");
    expect(r.costs.total).toBe("902.38"); // 1000 − 100 + 2.38 SumUp fee
    expect(r.result).toBe("-802.38");
    expect(r.cash).toMatchObject({ in: "119.62", out: "1098.00" }); // 1220 − 122
    expect(r.vat).toEqual({ onSales: "22.00", onPurchases: "198.00", balance: "176.00" });
    expect(r.months[3]!.costs).toBe("1000.00");
    expect(r.months[10]!.revenue).toBe("100.00");
    expect(r.missing[0]).toMatch(/Estratto conto/);
  });
});
