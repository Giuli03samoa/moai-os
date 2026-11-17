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

describe("annual report with B2B invoices and a bank statement", () => {
  it("counts issued invoices as revenue and takes cash from the bank up to its last movement", async () => {
    const org = await makeOrg();
    const day = (d: string) => new Date(`${d}T12:00:00Z`);
    const a = await db.invoice.create({ data: { organizationId: org.id, source: "XML_UPLOAD", direction: "ACTIVE", dedupeKey: "A1", documentType: "TD01", number: "FPR 1/26", issueDate: day("2026-02-06"), currency: "EUR", totalAmount: 3050, taxableAmount: 2500, taxAmount: 550, senderName: "Noi", receiverName: "Cliente" } as never });
    await db.invoiceInstallment.create({ data: { organizationId: org.id, invoiceId: a.id, position: 1, amount: 3050, dueDate: day("2026-02-06"), paidAt: day("2026-02-25") } as never });
    const late = await db.invoice.create({ data: { organizationId: org.id, source: "XML_UPLOAD", direction: "ACTIVE", dedupeKey: "A2", documentType: "TD01", number: "FPR 2/26", issueDate: day("2026-10-01"), currency: "EUR", totalAmount: 610, taxableAmount: 500, taxAmount: 110, senderName: "Noi", receiverName: "Cliente" } as never });
    await db.invoiceInstallment.create({ data: { organizationId: org.id, invoiceId: late.id, position: 1, amount: 610, dueDate: day("2026-10-01"), paidAt: day("2026-10-20") } as never });
    const bt = (id: string, d: string, amount: string) => db.bankTransaction.create({ data: { organizationId: org.id, source: "BANK_CSV", accountLabel: "Conto", externalId: id, bookingDate: day(d), amount, currency: "EUR", description: id } });
    await bt("b1", "2026-02-25", "3050");
    await bt("b2", "2026-03-01", "-200");
    await bt("b3", "2026-09-30", "-60");

    const r = await annualReport(org.id, 2026);
    expect(r.revenue.invoiced).toBe("3000.00");
    expect(r.revenue.total).toBe("3000.00");
    expect(r.vat.onSales).toBe("660.00");
    // Bank up to 30/09 (3050 in, 260 out), then the invoice collected on 20/10 (610): never counted twice.
    expect(r.cash).toMatchObject({ in: "3660.00", out: "260.00" });
    expect(r.cash.bankUntil?.toISOString().slice(0, 10)).toBe("2026-09-30");
  });
});
