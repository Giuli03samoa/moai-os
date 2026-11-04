/**
 * MOAI Athletics brand system as structured data (source: Softriver brand guidelines 2026).
 * Used by the brand checker, the mockup renderer, the Design Studio UI and the agent.
 */
export const PALETTE = {
  primary: [
    { name: "Black Out", hex: "#222222" },
    { name: "Early Crocus", hex: "#EAE7E7" },
  ],
  secondary: [
    { name: "Graphite", hex: "#6E7180" },
    { name: "Space", hex: "#9DA2B3" },
    { name: "Steel", hex: "#BCBFCC" },
    { name: "Smoke", hex: "#D3D6E0" },
    { name: "Cloud", hex: "#EDEFF7" },
  ],
} as const;

export const ALL_COLORS = [...PALETTE.primary, ...PALETTE.secondary];
export const ALLOWED_HEX = new Set(ALL_COLORS.map((c) => c.hex.toUpperCase()));
export const COLOR_BY_HEX = new Map(ALL_COLORS.map((c) => [c.hex.toUpperCase(), c.name]));

export const TYPOGRAPHY = {
  family: "Geist",
  weights: ["Regular", "Medium"],
  hierarchy: [
    { level: "Display", px: 150, tracking: "-3%" },
    { level: "H1", px: 100, tracking: "-3%" },
    { level: "H2", px: 75, tracking: "-3%" },
    { level: "H3", px: 60, tracking: "-3%" },
    { level: "H4", px: 36, tracking: "-3%" },
    { level: "Paragraph", px: 24, tracking: "-2%" },
    { level: "Caption", px: 20, tracking: "0%" },
  ],
} as const;

export const LOGO_RULES = [
  "Solo colori della palette",
  "Nessuna variazione di opacità",
  "Nessun gradiente",
  "Nessuna rotazione",
  "Nessuno stiramento o alterazione delle proporzioni",
  "Nessun contorno (outline)",
  "Posizionamento: agli angoli o centrato",
];

export const BRAND_IDEA = "Quiet strength — forza silenziosa, mai gridata.";
export const PAYOFF = "Discipline Over Noise";
export const MARKETING_ANGLES = ["Quiet Mastery", "Seamless Transitions", "Empowerment Through Precision"];
export const PRODUCT_TAGLINES = {
  upper: ["Made to Endure", "Built on Discipline"],
  lower: ["Movement with Purpose.", "Timeless Performance."],
};

export const LINES: Record<string, { label: string; description: string }> = {
  ESSENTIALS: { label: "ESSENTIALS", description: "Linea cotone everyday (ex CORE)." },
  MOTION: { label: "MOTION", description: "Linea tecnica da performance." },
  CAPSULE: { label: "Capsule", description: "Drop limitati con concept proprio; l'unico spazio per direzioni più espressive." },
  MERCH: { label: "Merch", description: "Tote, accessori e materiale di supporto." },
};

export const GARMENTS = ["tee", "hoodie", "tote", "short", "tight", "pant", "cap"] as const;
export type Garment = (typeof GARMENTS)[number];

export const PLACEMENTS = ["chest-left", "chest-center", "back-center", "back-top", "sleeve", "hem"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Trend references and the lesson each one teaches (moai-graphic-design skill). */
export const REFERENCES = [
  { name: "UVU", lesson: "Grafica sobria, drop legati a un'occasione precisa invece di collezioni generiche." },
  { name: "Patencials", lesson: "Prima il concept narrativo e una palette ridottissima, poi la grafica." },
  { name: "On Running", lesson: "Disciplina sistemica: stessi elementi (font, chevron) ripetuti su ogni capo." },
  { name: "Satisfy", lesson: "Espressività punk/vintage solo per capsule limited, mai sulla linea core." },
  { name: "District Vision", lesson: "Minimalismo giapponese, molto spazio vuoto, la tipografia pesa quanto la grafica." },
  { name: "Represent 247", lesson: "Branding quasi invisibile: la percezione premium viene dai dettagli." },
  { name: "Soar Running", lesson: "Il pattern chevron come dettaglio tecnico discreto, mai stampa invadente." },
];

export function normalizeHex(input: string): string | null {
  const s = input.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toUpperCase();
  const m6 = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m6) return `#${m6[1]}`.toUpperCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  const named: Record<string, string> = { black: "#000000", white: "#FFFFFF", gray: "#808080", grey: "#808080", red: "#FF0000", blue: "#0000FF", green: "#008000" };
  const n = named[s.toLowerCase()];
  return n ?? null;
}
