import { describe, expect, it } from "vitest";
import { checkSvgBrand, parseViewBox } from "@/server/design/brand-check";
import { normalizeHex } from "@/server/design/brand";
import { resolveBrandTokens } from "@/server/design/assets";

const ok = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect x="100" y="100" width="800" height="200" fill="#222222"/><text x="500" y="600" font-family="Geist, sans-serif" font-weight="500" fill="#EAE7E7" text-anchor="middle">DISCIPLINE OVER NOISE</text></svg>`;

describe("brand check", () => {
  it("accepts a palette-only Geist sketch", () => {
    const r = checkSvgBrand(ok);
    expect(r.ok).toBe(true);
    expect(r.colors.map((c) => c.name)).toEqual(["Black Out", "Early Crocus"]);
    expect(r.viewBox).toBe("0 0 1000 1000");
  });
  it("rejects off-palette colors, gradients and foreign fonts", () => {
    const r = checkSvgBrand(`<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="#ff0000" width="1" height="1"/><text font-family="Arial" fill="#222">x</text></svg>`);
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("off_palette");
    expect(codes).toContain("gradient");
    expect(codes).toContain("font_off_brand");
  });
  it("rejects scripts, event handlers and external references", () => {
    expect(checkSvgBrand(`<svg><script>alert(1)</script></svg>`).issues.some((i) => i.code === "script")).toBe(true);
    expect(checkSvgBrand(`<svg onload="x()"></svg>`).issues.some((i) => i.code === "event_handler")).toBe(true);
    expect(checkSvgBrand(`<svg><image href="https://evil/x.png"/></svg>`).issues.some((i) => i.code === "external_ref")).toBe(true);
    expect(checkSvgBrand(`<svg><foreignObject/></svg>`).ok).toBe(false);
  });
  it("normalises short hex, rgb() and rejects pure black/white", () => {
    expect(normalizeHex("#222")).toBe("#222222");
    expect(normalizeHex("rgb(234, 231, 231)")).toBe("#EAE7E7");
    expect(checkSvgBrand(`<svg viewBox="0 0 1 1"><rect fill="#000000"/></svg>`).ok).toBe(false);
    expect(checkSvgBrand(`<svg viewBox="0 0 1 1"><rect fill="white"/></svg>`).ok).toBe(false);
  });
  it("warns (does not reject) on opacity and rotations", () => {
    const r = checkSvgBrand(`<svg viewBox="0 0 10 10"><rect fill="#222222" opacity="0.5" transform="rotate(12)"/></svg>`);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["opacity", "rotation"]));
  });
  it("resolves brand tokens into self-contained data URIs that still pass", () => {
    const svg = resolveBrandTokens(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">{{PATTERN_CHEVRON_DEFS}}<rect width="200" height="20" fill="url(#moai-chevron)"/><image href="{{ICON_CREAM}}" x="20" y="60" width="160" height="76"/></svg>`);
    expect(svg).toContain("data:image/png;base64,");
    expect(svg).toContain('id="moai-chevron"');
    expect(svg).not.toContain("{{");
    expect(checkSvgBrand(svg, { allowNeutral: true }).ok).toBe(true);
  });
  it("parses viewBox", () => {
    expect(parseViewBox("0 0 1000 500")).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    expect(parseViewBox("0 0 0 5")).toBeNull();
    expect(parseViewBox(null)).toBeNull();
  });
});
