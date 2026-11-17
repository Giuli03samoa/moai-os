/**
 * Turns Shopify variants ("Black / M") into a readable price list: one card per garment, colours by sizes.
 * Pure helpers, no database access.
 */

export type Gender = "MEN" | "WOMEN";
export const GENDER_LABEL: Record<Gender, string> = { MEN: "Uomo", WOMEN: "Donna" };

/** MOAI names the women's line with a trailing "W" (Motion Pant W). Everything else is the men's line. */
export function genderOf(title: string): Gender {
  return /\sW$/i.test(title.trim()) ? "WOMEN" : "MEN";
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "3XL", "4XL"];

export function sortSizes(sizes: string[]) {
  const rank = (s: string) => {
    const i = SIZE_ORDER.indexOf(s.toUpperCase());
    return i === -1 ? 100 : i;
  };
  return [...new Set(sizes)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "it"));
}

/** "Black / M" → colour Black, size M. A single option is read as a size when it looks like one, else as a colour. */
export function splitVariant(title: string): { color: string; size: string } {
  const parts = title.split(" / ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { color: parts[0]!, size: parts.slice(1).join(" / ") };
  const only = parts[0] ?? "";
  if (only && SIZE_ORDER.includes(only.toUpperCase())) return { color: "Unico", size: only };
  return { color: only && only !== "Default Title" ? only : "Unico", size: "Unica" };
}

export type VariantIn = { id: string; title: string; sku: string | null; price: { toString(): string }; inventoryQuantity: number | null; inventoryTracked: boolean | null };

export type Cell = { id: string; sku: string | null; qty: number | null; tracked: boolean; price: number };

export type Grid = {
  colors: string[];
  sizes: string[];
  cells: Record<string, Record<string, Cell | undefined>>; // colour → size → cell
  prices: { min: number; max: number };
  stock: number | null; // pieces in stock over tracked variants, null when none is tracked
  untracked: number;
  low: number; // tracked variants with 1–3 pieces
  out: number; // tracked variants at zero or below
};

export function variantGrid(variants: VariantIn[], lowThreshold = 3): Grid {
  const cells: Grid["cells"] = {};
  const colors: string[] = [];
  const sizes: string[] = [];
  let stock: number | null = null;
  let untracked = 0, low = 0, out = 0;
  let min = Infinity, max = -Infinity;
  for (const v of variants) {
    const { color, size } = splitVariant(v.title);
    if (!colors.includes(color)) colors.push(color);
    sizes.push(size);
    const price = Number(v.price.toString());
    if (Number.isFinite(price)) { min = Math.min(min, price); max = Math.max(max, price); }
    const tracked = v.inventoryTracked !== false && v.inventoryQuantity !== null;
    if (tracked) {
      stock = (stock ?? 0) + Math.max(0, v.inventoryQuantity!);
      if (v.inventoryQuantity! <= 0) out++;
      else if (v.inventoryQuantity! <= lowThreshold) low++;
    } else untracked++;
    (cells[color] ??= {})[size] = { id: v.id, sku: v.sku, qty: tracked ? v.inventoryQuantity : null, tracked, price };
  }
  return { colors, sizes: sortSizes(sizes), cells, prices: { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 }, stock, untracked, low, out };
}
