import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { materialPurchases } from "@/server/production/garments";
import { makeOrg } from "./helpers";

describe("material purchases from supplier invoices", () => {
  it("sums matching lines of the right supplier, net of credit notes, and ignores archived invoices", async () => {
    const org = await makeOrg();
    const supplier = await db.supplier.create({ data: { organizationId: org.id, name: "Jersey Lomellina" } });
    let n = 0;
    const invoice = async (sender: string, type: string, date: string, lines: Array<[string, number, number]>, deleted = false) => {
      const total = lines.reduce((a, [, q, p]) => a + q * p, 0);
      const inv = await db.invoice.create({ data: { organizationId: org.id, source: "XML_UPLOAD", direction: "PASSIVE", dedupeKey: `k${++n}`, documentType: type, number: `N${n}`, issueDate: new Date(date), currency: "EUR", totalAmount: total, taxableAmount: total, taxAmount: 0, senderName: sender, receiverName: "Test", deletedAt: deleted ? new Date() : null } as never });
      let i = 0;
      for (const [d, q, p] of lines) await db.invoiceLine.create({ data: { organizationId: org.id, invoiceId: inv.id, lineNumber: ++i, description: d, quantity: q, unitPrice: p, totalPrice: q * p, vatRate: 22 } });
    };
    await invoice("JERSEY LOMELLINA S.p.A.", "TD24", "2026-07-31", [["RENEW GALAXY PER STAMPA BIANCO", 67, 3.5], ["Spese Trasporto Italia", 1, 15]]);
    await invoice("JERSEY LOMELLINA S.p.A.", "TD24", "2026-09-21", [["RENEW GALAXY PER STAMPA BIANCO", 70, 3.5]]);
    await invoice("JERSEY LOMELLINA S.p.A.", "TD04", "2026-09-30", [["RENEW GALAXY PER STAMPA BIANCO", 70, 3.5]]);
    await invoice("ALTRO FORNITORE srl", "TD01", "2026-08-01", [["RENEW GALAXY imitazione", 10, 1]]);
    await invoice("JERSEY LOMELLINA S.p.A.", "TD24", "2025-11-01", [["RENEW GALAXY PER STAMPA BIANCO", 5, 3.68]], true);

    const p = await materialPurchases(org.id, { invoiceMatch: "renew galaxy", supplier });
    expect(p.qty).toBe("67");
    expect(p.amount).toBe("234.50");
    expect(p.purchases).toHaveLength(3);
    expect(p.last?.invoice).toBe("N2"); // last real purchase, the credit note is not one
    expect((await materialPurchases(org.id, { invoiceMatch: null, supplier })).purchases).toHaveLength(0);
  });
});
