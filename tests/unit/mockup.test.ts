import { describe, expect, it } from "vitest";
import { innerSvg, placementBox, renderMockup } from "@/server/design/mockup";
import { checkSvgBrand } from "@/server/design/brand-check";

const sketch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect x="10" y="10" width="180" height="180" fill="#EAE7E7"/><text x="100" y="110" font-family="Geist" fill="#222222" text-anchor="middle">M</text></svg>`;

describe("mockup renderer", () => {
  it("strips the outer wrapper and keeps the viewBox", () => {
    const { inner, viewBox } = innerSvg(sketch);
    expect(inner).toContain("<rect");
    expect(inner).not.toContain("<svg");
    expect(viewBox).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });
  it("nests the sketch in the placement box for every garment and passes the brand check", () => {
    for (const garment of ["tee", "hoodie", "tote"] as const) {
      for (const color of ["blackout", "crocus"] as const) {
        const svg = renderMockup({ sketchSvg: sketch, garment, color, placement: "chest-left" });
        const box = placementBox(garment, "chest-left");
        expect(svg).toContain(`<svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" viewBox="0 0 200 200"`);
        expect(svg.startsWith("<svg xmlns")).toBe(true);
        expect(checkSvgBrand(svg, { allowNeutral: true }).ok).toBe(true);
      }
    }
  });
  it("defaults the view to back for back placements and escapes labels", () => {
    expect(renderMockup({ sketchSvg: sketch, garment: "tee", color: "blackout", placement: "back-center" })).toContain("retro");
    expect(renderMockup({ sketchSvg: sketch, garment: "tee", color: "blackout", placement: "back-center", label: "<b>x</b>" })).not.toContain("<b>");
  });
  it("rejects non-SVG input", () => {
    expect(() => innerSvg("<div/>")).toThrow();
  });
});
