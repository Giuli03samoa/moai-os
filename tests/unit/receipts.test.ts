import { describe, expect, it } from "vitest";
import { refundedAmount, saleDescription, vatSplit } from "@/server/receipts/receipts";

describe("vatSplit", () => {
  it("unbundles 22% from a VAT-inclusive amount when the POS reports no VAT", () => {
    expect(vatSplit("75")).toEqual({ gross: "75.00", net: "61.48", vat: "13.52", rate: 22, fromPos: false });
    expect(vatSplit(120)).toMatchObject({ net: "98.36", vat: "21.64" });
    expect(vatSplit("20", 0)).toMatchObject({ net: "16.39", vat: "3.61", fromPos: false });
  });

  it("keeps net + vat equal to the gross to the cent", () => {
    for (const g of ["0.01", "19.99", "25", "33.33", "435", "1234.56"]) {
      const s = vatSplit(g);
      expect((Number(s.net) + Number(s.vat)).toFixed(2)).toBe(Number(g).toFixed(2));
    }
  });

  it("uses the VAT reported by the POS when it is plausible", () => {
    expect(vatSplit("75", 13.52)).toEqual({ gross: "75.00", net: "61.48", vat: "13.52", rate: 22, fromPos: true });
    expect(vatSplit("110", 10)).toMatchObject({ net: "100.00", vat: "10.00", rate: 10, fromPos: true });
  });

  it("ignores an implausible POS figure", () => {
    expect(vatSplit("50", 50).fromPos).toBe(false);
    expect(vatSplit("50", -3).fromPos).toBe(false);
    expect(vatSplit("50", "9.02").fromPos).toBe(false);
    expect(vatSplit("50", Number.NaN).fromPos).toBe(false);
  });
});

describe("saleDescription", () => {
  it("lists catalogue products with quantities", () => {
    expect(saleDescription({ products: [{ name: "Essential Fleece", quantity: 2 }, { name: "Motion Short", quantity: 1 }] })).toBe("2 × Essential Fleece, Motion Short");
  });
  it("falls back to the POS summary, then to nothing", () => {
    expect(saleDescription({ products: [], summary: " Importo personalizzato " })).toBe("Importo personalizzato");
    expect(saleDescription({ products: [{ name: null }] })).toBeNull();
    expect(saleDescription(null)).toBeNull();
  });
});

describe("refundedAmount", () => {
  it("reads only positive numbers", () => {
    expect(refundedAmount({ refundedAmount: 30 })).toBe(30);
    expect(refundedAmount({ refundedAmount: 0 })).toBe(0);
    expect(refundedAmount({ refundedAmount: "30" })).toBe(0);
    expect(refundedAmount(undefined)).toBe(0);
  });
});
