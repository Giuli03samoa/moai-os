import { describe, expect, it } from "vitest";
import { bestSupplier, detailCsv, supplierGroup } from "@/server/reports/annual-detail";

describe("annual detail helpers", () => {
  it("groups spellings of the same supplier", () => {
    expect(supplierGroup("JERSEY LOMELLINA S.p.A.")).toBe(supplierGroup("Jersey Lomellina"));
    expect(supplierGroup("STUDIOTRENTATRE SRL")).toBe(supplierGroup("Studio 33"));
    expect(supplierGroup("STRANGE SRL  UNIPERSONALE")).toBe(supplierGroup("Strange"));
  });
  it("matches a bank counterparty on distinctive words, not on generic ones", () => {
    const sup = [{ name: "STUDIOTRENTATRE SRL" }, { name: "Benedetta Mazzeo" }, { name: "JERSEY LOMELLINA S.p.A." }];
    expect(bestSupplier("STUDIO NOTARILE BENEDETTA MAZZEO", sup)?.name).toBe("Benedetta Mazzeo");
    expect(bestSupplier("JERSEY LOMELLINA SPA", sup)?.name).toBe("JERSEY LOMELLINA S.p.A.");
    expect(bestSupplier("STUDIO ROSSI", sup)).toBeUndefined();
  });
  it("writes a semicolon CSV with Italian decimals and a BOM for Excel", () => {
    const csv = detailCsv({
      revenue: [{ id: "r", date: new Date("2026-02-06T12:00:00Z"), source: "INVOICE", party: 'Cliente "A"', description: "Divise", net: "2500.00", vat: "550.00", gross: "3050.00", collectedAt: new Date("2026-02-25T12:00:00Z"), document: "Fattura FPR 1/26", href: null }],
      costs: [{ id: "c", date: new Date("2026-04-08T12:00:00Z"), category: "COGS", categoryLabel: "Produzione", supplier: "Texprime", description: "Tessuto", net: "-12.50", document: null, href: null, paidAt: null, origin: "MANUAL" }],
      suppliers: [], bank: [], totals: { revenue: "2500.00", costs: "-12.50" },
    });
    expect(csv.startsWith("﻿Tipo;Data")).toBe(true);
    expect(csv).toContain('Ricavo;2026-02-06;Fatture emesse;"Cliente ""A""";"Divise";2500,00;550,00;3050,00;"Fattura FPR 1/26";2026-02-25');
    expect(csv).toContain('Costo;2026-04-08;"Produzione";"Texprime";"Tessuto";-12,50;;;"";');
  });
});
