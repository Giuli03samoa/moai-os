import { ALLOWED_HEX, COLOR_BY_HEX, normalizeHex } from "./brand";

/**
 * Validates an SVG sketch against the MOAI brand rules and against what is safe to render.
 * Pure function (no DOM, no network): regex-based on purpose so it also runs in tests and in the agent loop.
 *
 *  errors   → the asset is rejected (saved only after the author fixes it)
 *  warnings → saved, but shown next to the asset
 */
export type BrandIssue = { level: "error" | "warning"; code: string; message: string };
export type BrandCheck = { ok: boolean; issues: BrandIssue[]; colors: Array<{ hex: string; name: string | null; allowed: boolean }>; fonts: string[]; viewBox: string | null };

const COLOR_ATTRS = /(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*["']([^"']+)["']/gi;
const COLOR_STYLE = /(?:fill|stroke|stop-color|background(?:-color)?|color)\s*:\s*([^;"'}]+)/gi;
const NEUTRAL = new Set(["none", "transparent", "currentcolor", "inherit"]);

export function checkSvgBrand(svg: string, opts: { allowNeutral?: boolean } = {}): BrandCheck {
  const issues: BrandIssue[] = [];
  const colorsFound = new Map<string, { hex: string; name: string | null; allowed: boolean }>();

  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) issues.push({ level: "error", code: "not_svg", message: "Il contenuto deve essere un documento SVG che inizia con <svg>." });
  if (svg.length > 400_000) issues.push({ level: "error", code: "too_large", message: "SVG troppo grande (max 400 KB)." });

  // Safety: the sketch is rendered in the app, so anything executable or remote is rejected.
  if (/<script[\s/>]/i.test(svg)) issues.push({ level: "error", code: "script", message: "Gli SVG non possono contenere <script>." });
  if (/<foreignObject[\s/>]/i.test(svg)) issues.push({ level: "error", code: "foreign_object", message: "<foreignObject> non è ammesso." });
  if (/\son[a-z]+\s*=/i.test(svg)) issues.push({ level: "error", code: "event_handler", message: "Attributi evento (onload, onclick…) non ammessi." });
  if (/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(svg)) issues.push({ level: "error", code: "external_ref", message: "Riferimenti esterni (http, //, javascript:) non ammessi: incorpora immagini come data URI PNG." });
  if (/href\s*=\s*["']\s*data:(?!image\/(?:png|jpeg|webp);base64,)/i.test(svg)) issues.push({ level: "error", code: "data_uri_type", message: "Solo data URI PNG/JPEG/WebP in base64." });
  if (/<(?:iframe|embed|object|link|meta|style[^>]*src)/i.test(svg)) issues.push({ level: "error", code: "forbidden_element", message: "Elementi iframe/embed/object/link/meta non ammessi." });
  if (/@import|url\(\s*["']?\s*https?:/i.test(svg)) issues.push({ level: "error", code: "css_import", message: "CSS @import o url() remoti non ammessi." });

  // Brand rules
  if (/<(?:linearGradient|radialGradient)[\s>]/i.test(svg)) issues.push({ level: "error", code: "gradient", message: "Gradienti vietati dalla brand guide: usa tinte piatte della palette." });
  if (/filter\s*=\s*["']url\(/i.test(svg) || /<filter[\s>]/i.test(svg)) issues.push({ level: "warning", code: "filter", message: "Filtri (blur, ombre) sconsigliati: l'estetica MOAI è piatta e pulita." });
  const opacity = [...svg.matchAll(/(?:fill-|stroke-)?opacity\s*[:=]\s*["']?\s*(0?\.\d+|0)\b/gi)];
  if (opacity.length) issues.push({ level: "warning", code: "opacity", message: `Trovate ${opacity.length} opacità < 1: vietate sul logo, da evitare in generale.` });
  if (/rotate\(\s*(?!0\b|360\b|90\b|180\b|270\b)-?\d/i.test(svg)) issues.push({ level: "warning", code: "rotation", message: "Rotazioni non ortogonali: il logo non va mai ruotato; per la grafica usale con parsimonia." });
  if (/\{\{\s*(?:LOGO|ICON)_[A-Z]+\s*\}\}[^>]*stroke\s*=\s*["'](?!none)/i.test(svg)) issues.push({ level: "error", code: "logo_outline", message: "Il logo non può avere contorni (outline)." });

  for (const re of [COLOR_ATTRS, COLOR_STYLE]) {
    for (const m of svg.matchAll(re)) {
      const raw = (m[1] ?? "").trim();
      if (!raw || raw.startsWith("url(") || raw.startsWith("{{")) continue;
      const lower = raw.toLowerCase();
      if (NEUTRAL.has(lower)) continue;
      const hex = normalizeHex(raw);
      if (!hex) {
        issues.push({ level: "warning", code: "color_unparsed", message: `Colore non riconosciuto: ${raw}` });
        continue;
      }
      if (!colorsFound.has(hex)) colorsFound.set(hex, { hex, name: COLOR_BY_HEX.get(hex) ?? null, allowed: ALLOWED_HEX.has(hex) });
    }
  }
  const offPalette = [...colorsFound.values()].filter((c) => !c.allowed);
  if (offPalette.length) issues.push({ level: "error", code: "off_palette", message: `Colori fuori palette: ${offPalette.map((c) => c.hex).join(", ")}. Ammessi: Black Out #222222, Early Crocus #EAE7E7, Graphite #6E7180, Space #9DA2B3, Steel #BCBFCC, Smoke #D3D6E0, Cloud #EDEFF7.` });
  if (!opts.allowNeutral && colorsFound.size === 0 && !/\{\{(?:LOGO|ICON)_/.test(svg)) issues.push({ level: "warning", code: "no_color", message: "Nessun colore esplicito: specifica fill/stroke con la palette per evitare il nero di default." });

  const fonts = [...new Set([...svg.matchAll(/font-family\s*[:=]\s*["']?([^;"'>]+)/gi)].map((m) => (m[1] ?? "").replace(/["']/g, "").trim()).filter(Boolean))];
  if (/<text[\s>]/i.test(svg)) {
    if (fonts.length === 0) issues.push({ level: "warning", code: "font_missing", message: "Il testo non dichiara font-family: usa Geist." });
    else if (!fonts.some((f) => /geist/i.test(f))) issues.push({ level: "error", code: "font_off_brand", message: `Font fuori brand: ${fonts.join(", ")}. Il font ufficiale è Geist (Regular/Medium).` });
  }

  const viewBox = /viewBox\s*=\s*["']([^"']+)["']/i.exec(svg)?.[1] ?? null;
  if (!viewBox) issues.push({ level: "warning", code: "viewbox", message: "Manca viewBox: aggiungilo (es. 0 0 1000 1000) per un ridimensionamento corretto." });

  return { ok: !issues.some((i) => i.level === "error"), issues, colors: [...colorsFound.values()], fonts, viewBox };
}

/** Parses "minX minY width height" from a viewBox attribute. */
export function parseViewBox(viewBox: string | null): { x: number; y: number; w: number; h: number } | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2]! <= 0 || parts[3]! <= 0) return null;
  return { x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! };
}
