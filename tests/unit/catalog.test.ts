import { describe, expect, it } from "vitest";
import { genderOf, sortSizes, splitVariant, variantGrid } from "@/server/products/catalog";

describe("catalog helpers", () => {
  it("reads the women's line from the trailing W", () => {
    expect(genderOf("Motion Tight W")).toBe("WOMEN");
    expect(genderOf("Motion Tight")).toBe("MEN");
    expect(genderOf("Wave Tee")).toBe("MEN");
  });
  it("splits colour and size", () => {
    expect(splitVariant("Black / M")).toEqual({ color: "Black", size: "M" });
    expect(splitVariant("XL")).toEqual({ color: "Unico", size: "XL" });
    expect(splitVariant("Default Title")).toEqual({ color: "Unico", size: "Unica" });
  });
  it("orders sizes the way a shop shows them", () => {
    expect(sortSizes(["XL", "S", "M", "XS", "L", "S"])).toEqual(["XS", "S", "M", "L", "XL"]);
  });
  it("builds the colour × size grid with stock, low and sold-out counts", () => {
    const v = (id: string, title: string, qty: number | null, tracked: boolean | null = true, price = 95) => ({ id, title, sku: id, price, inventoryQuantity: qty, inventoryTracked: tracked });
    const g = variantGrid([v("1", "Black / M", 5), v("2", "Black / S", 2), v("3", "Graphite / M", 0), v("4", "Graphite / L", 9, false, 99)]);
    expect(g.colors).toEqual(["Black", "Graphite"]);
    expect(g.sizes).toEqual(["S", "M", "L"]);
    expect(g.stock).toBe(7);
    expect([g.low, g.out, g.untracked]).toEqual([1, 1, 1]);
    expect(g.prices).toEqual({ min: 95, max: 99 });
    expect(g.cells.Graphite?.L).toMatchObject({ tracked: false, qty: null });
    expect(variantGrid([v("5", "Black / M", null, null)]).stock).toBeNull();
  });
});
