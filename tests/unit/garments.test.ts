import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { garmentCost, margin, referencePrice, supplierKey } from "@/server/production/garments";

const mat = (unitPrice: number | null, unit = "m") => ({ name: "X", unit, unitPrice });

describe("garmentCost", () => {
  it("adds materials, sewing and the development spread on the first lot", () => {
    const c = garmentCost({
      sewingCost: 19, developmentCost: 104.5, lotSize: 20, extraCost: null,
      components: [
        { qtyPerUnit: 1.4, estimated: true, material: mat(9.5) },
        { qtyPerUnit: 0.15, estimated: true, material: mat(9) },
        { qtyPerUnit: 1, estimated: false, material: mat(0.69, "pz") },
        { qtyPerUnit: 1, estimated: false, material: mat(0.12, "pz") },
        { qtyPerUnit: 1, estimated: false, material: mat(0.41, "pz") },
      ],
    });
    expect(c.materials).toBe("15.87");
    expect(c.developmentPerUnit).toBe("5.23");
    expect(c.firstLot).toBe("40.10");
    expect(c.restock).toBe("34.87");
    expect(c.missing).toBe(0);
    expect(c.estimated).toBe(true);
    expect(c.noFabric).toBe(true); // test materials carry no kind
    expect(garmentCost({ sewingCost: 1, developmentCost: null, lotSize: null, extraCost: null, components: [{ qtyPerUnit: 1, estimated: false, material: { ...mat(2), kind: "FABRIC" } }] }).noFabric).toBe(false);
  });

  it("never guesses: unknown consumption or price is counted as missing and left out", () => {
    const c = garmentCost({ sewingCost: null, developmentCost: 100, lotSize: null, extraCost: "2.5", components: [{ qtyPerUnit: null, estimated: true, material: mat(4) }, { qtyPerUnit: 1, estimated: false, material: mat(null) }] });
    expect(c.missing).toBe(2);
    expect(c.noSewing).toBe(true);
    expect(c.developmentPerUnit).toBeNull(); // no lot size, nothing to spread on
    expect(c.firstLot).toBe("2.50");
    expect(c.estimated).toBe(false); // an estimate needs a quantity
  });
});

describe("margin and price", () => {
  it("computes the gross margin on the VAT-free shop price", () => {
    expect(margin("130", "40.10")).toEqual({ net: "106.56", amount: "66.46", pct: 62 });
    expect(margin(new Prisma.Decimal(70), 31.69)).toEqual({ net: "57.38", amount: "25.69", pct: 45 });
    expect(margin(null, 10)).toBeNull();
  });
  it("takes the most common live variant price", () => {
    const v = (p: number, deletedAt: Date | null = null) => ({ price: new Prisma.Decimal(p), deletedAt });
    expect(referencePrice([v(70), v(70), v(80)])).toBe("70.00");
    expect(referencePrice([v(99, new Date()), v(65)])).toBe("65.00");
    expect(referencePrice([])).toBeNull();
  });
  it("reduces a supplier name to the word that identifies the invoice sender", () => {
    expect(supplierKey("Texprime srl")).toBe("Texprime");
    expect(supplierKey(null)).toBe("");
  });
});
