import fs from "fs";
import path from "path";

/**
 * Official brand files (public/brand/*.png, from the Softriver brand kit) exposed to sketches as
 * tokens, so the agent never has to describe the logo: it places the real file.
 *   {{LOGO_BLACK}} {{LOGO_CREAM}} {{ICON_BLACK}} {{ICON_CREAM}}  → data:image/png;base64,…
 *   {{PATTERN_CHEVRON_DEFS}}                                      → <defs> with pattern id="moai-chevron"
 * Data URIs keep the SVG self-contained: an SVG rendered through <img> cannot load external files.
 */
const FILES: Record<string, { file: string; w: number; h: number }> = {
  LOGO_BLACK: { file: "moai-logo-primary-black.png", w: 3127, h: 1040 },
  LOGO_CREAM: { file: "moai-logo-secondary-cream.png", w: 3127, h: 1040 },
  ICON_BLACK: { file: "moai-icon-black.png", w: 1360, h: 644 },
  ICON_CREAM: { file: "moai-icon-cream.png", w: 1360, h: 644 },
};

const cache = new Map<string, string>();

export function brandAssetDataUri(token: keyof typeof FILES | string): string | null {
  const def = FILES[token];
  if (!def) return null;
  let uri = cache.get(token);
  if (!uri) {
    const file = path.join(process.cwd(), "public", "brand", def.file);
    uri = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
    cache.set(token, uri);
  }
  return uri;
}

export function brandAssetAspect(token: string): number | null {
  const def = FILES[token];
  return def ? def.w / def.h : null;
}

export function chevronPatternDefs(id = "moai-chevron", color = "#6E7180", size = 40, strokeWidth = 3): string {
  const s = size;
  const d = `M0 ${s * 0.75} L${s * 0.25} ${s * 0.25} L${s * 0.5} ${s * 0.75} L${s * 0.75} ${s * 0.25} L${s} ${s * 0.75}`;
  return `<defs><pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse"><path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="miter"/></pattern></defs>`;
}

/** Replaces brand tokens with real assets. Unknown tokens are left untouched (the brand check reports them). */
export function resolveBrandTokens(svg: string): string {
  return svg
    .replace(/\{\{\s*PATTERN_CHEVRON_DEFS\s*\}\}/g, chevronPatternDefs())
    .replace(/\{\{\s*(LOGO_BLACK|LOGO_CREAM|ICON_BLACK|ICON_CREAM)\s*\}\}/g, (_, t: string) => brandAssetDataUri(t) ?? "");
}

export const BRAND_TOKENS = Object.keys(FILES).map((k) => `{{${k}}}`).concat("{{PATTERN_CHEVRON_DEFS}}");
