import { parseViewBox } from "./brand-check";
import type { Garment, Placement } from "./brand";

/**
 * Composes a sketch onto a garment silhouette as a single self-contained SVG (1000×1200).
 * Silhouettes are schematic on purpose: the mockup is a placement/scale check for the team and
 * the printer, not a product photo. Colors are only from the palette.
 */
export type GarmentColor = "blackout" | "crocus";
export type View = "front" | "back";

const FILL: Record<GarmentColor, { body: string; line: string; bg: string }> = {
  blackout: { body: "#222222", line: "#6E7180", bg: "#EDEFF7" },
  crocus: { body: "#EAE7E7", line: "#BCBFCC", bg: "#D3D6E0" },
};

type Box = { x: number; y: number; w: number; h: number };

const TEE_BOXES: Record<Placement, Box> = {
  "chest-left": { x: 575, y: 330, w: 120, h: 120 },
  "chest-center": { x: 350, y: 320, w: 300, h: 300 },
  "back-center": { x: 300, y: 380, w: 400, h: 420 },
  "back-top": { x: 330, y: 290, w: 340, h: 170 },
  sleeve: { x: 815, y: 320, w: 95, h: 95 },
  hem: { x: 560, y: 900, w: 190, h: 90 },
};
const HOODIE_BOXES: Record<Placement, Box> = {
  "chest-left": { x: 585, y: 420, w: 120, h: 120 },
  "chest-center": { x: 360, y: 400, w: 280, h: 200 },
  "back-center": { x: 300, y: 420, w: 400, h: 420 },
  "back-top": { x: 330, y: 360, w: 340, h: 170 },
  sleeve: { x: 835, y: 420, w: 95, h: 95 },
  hem: { x: 560, y: 940, w: 190, h: 90 },
};
const TOTE_BOXES: Record<Placement, Box> = {
  "chest-left": { x: 300, y: 380, w: 130, h: 130 },
  "chest-center": { x: 330, y: 480, w: 340, h: 340 },
  "back-center": { x: 330, y: 480, w: 340, h: 340 },
  "back-top": { x: 330, y: 400, w: 340, h: 170 },
  sleeve: { x: 560, y: 380, w: 130, h: 130 },
  hem: { x: 420, y: 860, w: 160, h: 80 },
};

function teeSilhouette(c: GarmentColor, view: View) {
  const f = FILL[c];
  const neck = view === "front" ? `<path d="M400 230 Q500 330 600 230" fill="none" stroke="${f.line}" stroke-width="4"/>` : `<path d="M410 230 Q500 270 590 230" fill="none" stroke="${f.line}" stroke-width="4"/>`;
  return `
  <path d="M400 230 L250 300 L170 520 L300 560 L300 1040 L700 1040 L700 560 L830 520 L750 300 L600 230 Q500 300 400 230 Z" fill="${f.body}" stroke="${f.line}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M300 560 L300 1040" stroke="${f.line}" stroke-width="2" opacity="1"/>
  <path d="M700 560 L700 1040" stroke="${f.line}" stroke-width="2"/>
  ${neck}
  <path d="M310 1030 L690 1030" stroke="${f.line}" stroke-width="2" stroke-dasharray="6 8"/>`;
}

function hoodieSilhouette(c: GarmentColor, view: View) {
  const f = FILL[c];
  const hood = view === "front"
    ? `<path d="M400 300 Q420 170 500 160 Q580 170 600 300 Q560 360 500 370 Q440 360 400 300 Z" fill="${f.body}" stroke="${f.line}" stroke-width="4"/>`
    : `<path d="M390 300 Q420 150 500 140 Q580 150 610 300 Q560 350 500 360 Q440 350 390 300 Z" fill="${f.body}" stroke="${f.line}" stroke-width="4"/>`;
  const pocket = view === "front" ? `<path d="M330 820 L330 1000 L670 1000 L670 820" fill="none" stroke="${f.line}" stroke-width="3"/>` : "";
  const strings = view === "front" ? `<path d="M470 380 L465 520 M530 380 L535 520" stroke="${f.line}" stroke-width="3"/>` : "";
  return `
  <path d="M400 300 L240 360 L150 600 L290 640 L290 1080 L710 1080 L710 640 L850 600 L760 360 L600 300 Q500 380 400 300 Z" fill="${f.body}" stroke="${f.line}" stroke-width="4" stroke-linejoin="round"/>
  ${hood}
  <path d="M290 640 L290 1080 M710 640 L710 1080" stroke="${f.line}" stroke-width="2"/>
  ${pocket}${strings}
  <path d="M300 1068 L700 1068" stroke="${f.line}" stroke-width="2" stroke-dasharray="6 8"/>`;
}

function toteSilhouette(c: GarmentColor) {
  const f = FILL[c];
  return `
  <path d="M330 180 Q330 90 420 90 Q500 90 500 180 M500 180 Q500 90 580 90 Q670 90 670 180" fill="none" stroke="${f.line}" stroke-width="10" stroke-linecap="round"/>
  <rect x="250" y="300" width="500" height="720" rx="6" fill="${f.body}" stroke="${f.line}" stroke-width="4"/>
  <path d="M330 300 L330 180 M420 300 L420 180 M580 300 L580 180 M670 300 L670 180" stroke="${f.line}" stroke-width="10" stroke-linecap="round"/>
  <path d="M265 1005 L735 1005" stroke="${f.line}" stroke-width="2" stroke-dasharray="6 8"/>`;
}

/** Strips the outer <svg> wrapper and returns the inner markup plus its viewBox. */
export function innerSvg(svg: string): { inner: string; viewBox: { x: number; y: number; w: number; h: number } } {
  const open = /<svg\b[^>]*>/i.exec(svg);
  const closeIdx = svg.lastIndexOf("</svg>");
  if (!open || closeIdx < 0) throw new Error("Lo sketch non è un SVG valido");
  const vb = parseViewBox(/viewBox\s*=\s*["']([^"']+)["']/i.exec(open[0])?.[1] ?? null) ?? (() => {
    const w = Number(/\swidth\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(open[0])?.[1] ?? 1000);
    const h = Number(/\sheight\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(open[0])?.[1] ?? 1000);
    return { x: 0, y: 0, w, h };
  })();
  return { inner: svg.slice(open.index + open[0].length, closeIdx), viewBox: vb };
}

export function placementBox(garment: Garment, placement: Placement): Box {
  const table = garment === "hoodie" ? HOODIE_BOXES : garment === "tote" ? TOTE_BOXES : TEE_BOXES;
  return table[placement];
}

export function renderMockup(args: { sketchSvg: string; garment: Garment; color: GarmentColor; placement: Placement; view?: View; label?: string }): string {
  const view: View = args.view ?? (args.placement.startsWith("back") ? "back" : "front");
  const f = FILL[args.color];
  const { inner, viewBox } = innerSvg(args.sketchSvg);
  const box = placementBox(args.garment, args.placement);
  const silhouette = args.garment === "hoodie" ? hoodieSilhouette(args.color, view) : args.garment === "tote" ? toteSilhouette(args.color) : teeSilhouette(args.color, view);
  const label = (args.label ?? `${args.garment.toUpperCase()} · ${view === "front" ? "fronte" : "retro"} · ${args.placement}`).replace(/[<>&]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1200" width="1000" height="1200">
  <rect width="1000" height="1200" fill="${f.bg}"/>
  ${silhouette}
  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="${f.line}" stroke-width="1" stroke-dasharray="4 6"/>
  <svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}" preserveAspectRatio="xMidYMid meet" overflow="visible">${inner}</svg>
  <text x="40" y="1160" font-family="Geist, sans-serif" font-size="22" fill="#6E7180" letter-spacing="-0.4">${label}</text>
  <text x="960" y="1160" font-family="Geist, sans-serif" font-size="22" fill="#6E7180" text-anchor="end">MOAI OS · Design Studio</text>
</svg>`;
}
