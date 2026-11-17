import { Prisma, type MaterialKind } from "@prisma/client";
import { db } from "../db";
import { CREDIT_NOTE_TYPES } from "../invoices/fatturapa";

/**
 * Production sheets: what each garment is made of and what one piece costs.
 * Costs are management estimates, VAT excluded. Nothing here is sent anywhere.
 */

export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = { FABRIC: "Tessuto", TRIM: "Costine e accessori", LABEL: "Etichette", PRINT: "Loghi e stampe", PACKAGING: "Packaging", OTHER: "Altro" };
export const MATERIAL_KINDS = Object.keys(MATERIAL_KIND_LABEL) as MaterialKind[];
export const DEFAULT_VAT = 22;

const D = (v: Prisma.Decimal | number | string | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

export type CostInput = {
  sewingCost: Prisma.Decimal | number | string | null;
  developmentCost: Prisma.Decimal | number | string | null;
  lotSize: number | null;
  extraCost: Prisma.Decimal | number | string | null;
  components: Array<{ id?: string; role?: string | null; qtyPerUnit: Prisma.Decimal | number | string | null; estimated: boolean; material: { name: string; variant?: string | null; unit: string; unitPrice: Prisma.Decimal | number | string | null; kind?: MaterialKind } }>;
};

export type CostLine = { id?: string; label: string; role: string | null; qty: string | null; unit: string; unitPrice: string | null; cost: string | null; estimated: boolean };

export type GarmentCost = {
  lines: CostLine[];
  materials: string; // sum of the components whose cost is known
  sewing: string | null;
  developmentPerUnit: string | null;
  extra: string | null;
  firstLot: string; // per piece, first lot (development spread on the lot)
  restock: string; // per piece, following lots (no development)
  missing: number; // components without quantity or price: the totals are too low
  estimated: boolean; // at least one quantity not confirmed by the maker
  noSewing: boolean;
  noFabric: boolean; // no fabric in the bill of materials: the main cost is missing
};

/** Cost of one piece. Unknown pieces are left out of the totals and counted in `missing`, never guessed. */
export function garmentCost(input: CostInput): GarmentCost {
  let materials = new Prisma.Decimal(0);
  let missing = 0;
  let estimated = false;
  const lines: CostLine[] = input.components.map((c) => {
    const qty = D(c.qtyPerUnit);
    const price = D(c.material.unitPrice);
    const cost = qty && price ? qty.times(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
    if (cost) materials = materials.plus(cost);
    else missing++;
    if (c.estimated && qty) estimated = true;
    return { id: c.id, label: [c.material.name, c.material.variant].filter(Boolean).join(" — "), role: c.role ?? null, qty: qty ? qty.toString() : null, unit: c.material.unit, unitPrice: price ? price.toFixed(2) : null, cost: cost ? cost.toFixed(2) : null, estimated: c.estimated };
  });
  const sewing = D(input.sewingCost);
  const dev = D(input.developmentCost);
  const devPerUnit = dev && input.lotSize && input.lotSize > 0 ? dev.div(input.lotSize).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
  const extra = D(input.extraCost);
  const restock = materials.plus(sewing ?? 0).plus(extra ?? 0);
  const firstLot = restock.plus(devPerUnit ?? 0);
  return {
    lines,
    materials: materials.toFixed(2),
    sewing: sewing ? sewing.toFixed(2) : null,
    developmentPerUnit: devPerUnit ? devPerUnit.toFixed(2) : null,
    extra: extra ? extra.toFixed(2) : null,
    firstLot: firstLot.toFixed(2),
    restock: restock.toFixed(2),
    missing,
    estimated,
    noSewing: !sewing,
    noFabric: !input.components.some((c) => c.material.kind === "FABRIC"),
  };
}

/** Gross margin on a VAT-inclusive shop price. */
export function margin(priceInclVat: Prisma.Decimal | number | string | null | undefined, cost: string | number, vat = DEFAULT_VAT) {
  const price = D(priceInclVat);
  if (!price || price.lte(0)) return null;
  const net = price.div(new Prisma.Decimal(100 + vat).div(100));
  const m = net.minus(cost);
  return { net: net.toFixed(2), amount: m.toFixed(2), pct: Number(m.div(net).times(100).toFixed(0)) };
}

/** Most common variant price of a product (VAT included), the reference for the margin. */
export function referencePrice(variants: Array<{ price: Prisma.Decimal; deletedAt?: Date | null }>) {
  const counts = new Map<string, number>();
  for (const v of variants) if (!v.deletedAt) counts.set(v.price.toFixed(2), (counts.get(v.price.toFixed(2)) ?? 0) + 1);
  let best: string | null = null;
  for (const [p, n] of counts) if (!best || n > counts.get(best)! || (n === counts.get(best)! && Number(p) > Number(best))) best = p;
  return best;
}

export type Purchase = { date: Date; invoice: string; supplier: string; qty: string | null; unitPrice: string; amount: string; credit: boolean };
export type PurchaseSummary = { qty: string; amount: string; purchases: Purchase[]; last: Purchase | null };

/** First word of the supplier name: enough to tell "Texprime srl" from the other senders. */
export function supplierKey(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Purchases of a material, read from the lines of the received invoices. Credit notes count as returns. */
export async function materialPurchases(organizationId: string, m: { invoiceMatch: string | null; supplier: { name: string } | null }): Promise<PurchaseSummary> {
  const match = m.invoiceMatch?.trim();
  if (!match) return { qty: "0", amount: "0.00", purchases: [], last: null };
  const key = supplierKey(m.supplier?.name);
  const rows = await db.invoiceLine.findMany({
    where: { organizationId, description: { contains: match, mode: "insensitive" }, invoice: { direction: "PASSIVE", deletedAt: null, ...(key ? { senderName: { contains: key, mode: "insensitive" } } : {}) } },
    include: { invoice: { select: { number: true, issueDate: true, documentType: true, senderName: true } } },
    orderBy: { invoice: { issueDate: "asc" } },
  });
  let qty = new Prisma.Decimal(0);
  let amount = new Prisma.Decimal(0);
  const purchases: Purchase[] = rows.map((r) => {
    const credit = CREDIT_NOTE_TYPES.includes(r.invoice.documentType);
    const sign = credit ? -1 : 1;
    if (r.quantity) qty = qty.plus(r.quantity.times(sign));
    amount = amount.plus(r.totalPrice.times(sign));
    return { date: r.invoice.issueDate, invoice: r.invoice.number, supplier: r.invoice.senderName, qty: r.quantity ? r.quantity.toString() : null, unitPrice: r.unitPrice.toFixed(2), amount: r.totalPrice.toFixed(2), credit };
  });
  const last = [...purchases].reverse().find((p) => !p.credit) ?? null;
  return { qty: qty.toString(), amount: amount.toFixed(2), purchases, last };
}

export const garmentInclude = {
  product: { select: { id: true, title: true, variants: { select: { price: true, deletedAt: true } } } },
  maker: { select: { id: true, name: true } },
  components: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { material: { include: { supplier: { select: { name: true } } } } } },
  productionOrders: { orderBy: { orderedAt: "desc" }, select: { id: true, reference: true, quantity: true, totalCost: true, status: true, orderedAt: true, receivedAt: true } },
} satisfies Prisma.GarmentSpecInclude;

export type GarmentWithAll = Prisma.GarmentSpecGetPayload<{ include: typeof garmentInclude }>;

export function summarizeGarment(g: GarmentWithAll) {
  const cost = garmentCost(g);
  const price = g.product ? referencePrice(g.product.variants) : null;
  return { cost, price, marginFirst: margin(price, cost.firstLot), marginRestock: margin(price, cost.restock) };
}
