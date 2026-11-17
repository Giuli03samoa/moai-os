"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { MaterialKind, Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { parseAmount } from "../money";
import { MATERIAL_KINDS } from "../production/garments";

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max) || null;
const money = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v ? parseAmount(v, { decimalSeparator: "," }) ?? parseAmount(v) : null; };
const int = (f: FormData, k: string) => { const n = Number(f.get(k)); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

function go(path: string, msg: string, kind: "notice" | "error" = "notice"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}
const garmentPath = (id: string) => `/production/garments/${id}`;

async function ownGarment(orgId: string, id: string) {
  const g = await db.garmentSpec.findFirst({ where: { id, organizationId: orgId } });
  if (!g) go("/production", "Scheda capo non trovata", "error");
  return g;
}
async function ownSupplier(orgId: string, id: string | null) {
  if (!id) return null;
  return (await db.supplier.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }))?.id ?? null;
}

export async function createGarmentAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const productId = str(formData, "productId", 40);
  const product = productId ? await db.product.findFirst({ where: { id: productId, organizationId: auth.organizationId } }) : null;
  const name = product?.title ?? str(formData, "name", 120);
  if (!name || name.length < 2) go("/production", "Dai un nome al capo", "error");
  if (product && (await db.garmentSpec.findFirst({ where: { organizationId: auth.organizationId, productId: product.id, archivedAt: null } }))) go("/production", "Questo prodotto ha già una scheda", "error");
  const g = await db.garmentSpec.create({ data: { organizationId: auth.organizationId, productId: product?.id ?? null, name } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "garment.create", entityType: "GarmentSpec", entityId: g.id, metadata: { name } });
  revalidatePath("/production");
  go(garmentPath(g.id), "Scheda creata: aggiungi tessuti e costi.");
}

export async function updateGarmentAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const g = await ownGarment(auth.organizationId, String(formData.get("id") ?? ""));
  const name = str(formData, "name", 120) ?? g.name;
  const productId = str(formData, "productId", 40);
  const product = productId ? await db.product.findFirst({ where: { id: productId, organizationId: auth.organizationId }, select: { id: true } }) : null;
  const data: Prisma.GarmentSpecUncheckedUpdateInput = {
    name,
    productId: product?.id ?? null,
    modelCode: str(formData, "modelCode", 80),
    makerId: await ownSupplier(auth.organizationId, str(formData, "makerId", 40)),
    composition: str(formData, "composition", 200),
    sewingCost: money(formData, "sewingCost"),
    developmentCost: money(formData, "developmentCost"),
    lotSize: int(formData, "lotSize"),
    extraCost: money(formData, "extraCost"),
    extraCostNote: str(formData, "extraCostNote", 200),
    notes: str(formData, "notes", 2000),
  };
  await db.garmentSpec.update({ where: { id: g.id }, data });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "garment.update", entityType: "GarmentSpec", entityId: g.id });
  revalidatePath("/production");
  go(garmentPath(g.id), "Scheda salvata.");
}

export async function archiveGarmentAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const g = await ownGarment(auth.organizationId, String(formData.get("id") ?? ""));
  await db.garmentSpec.update({ where: { id: g.id }, data: { archivedAt: new Date() } });
  await db.productionOrder.updateMany({ where: { garmentSpecId: g.id }, data: { garmentSpecId: null } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "garment.archive", entityType: "GarmentSpec", entityId: g.id });
  revalidatePath("/production");
  go("/production", `Scheda «${g.name}» archiviata.`);
}

export async function addComponentAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const g = await ownGarment(auth.organizationId, String(formData.get("garmentId") ?? ""));
  const material = await db.material.findFirst({ where: { id: String(formData.get("materialId") ?? ""), organizationId: auth.organizationId } });
  if (!material) go(garmentPath(g.id), "Scegli un tessuto o materiale", "error");
  const count = await db.garmentComponent.count({ where: { garmentId: g.id } });
  await db.garmentComponent.create({ data: { organizationId: auth.organizationId, garmentId: g.id, materialId: material.id, role: str(formData, "role", 80), qtyPerUnit: money(formData, "qtyPerUnit"), estimated: formData.get("estimated") === "on", sortOrder: count } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "garment.component_add", entityType: "GarmentSpec", entityId: g.id, metadata: { material: material.name } });
  revalidatePath("/production");
  go(garmentPath(g.id), `${material.name} aggiunto.`);
}

export async function updateComponentAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const c = await db.garmentComponent.findFirst({ where: { id: String(formData.get("id") ?? ""), organizationId: auth.organizationId } });
  if (!c) go("/production", "Componente non trovato", "error");
  if (formData.get("remove") === "1") {
    await db.garmentComponent.delete({ where: { id: c.id } });
    await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "garment.component_remove", entityType: "GarmentSpec", entityId: c.garmentId });
    revalidatePath("/production");
    go(garmentPath(c.garmentId), "Componente tolto.");
  }
  await db.garmentComponent.update({ where: { id: c.id }, data: { role: str(formData, "role", 80), qtyPerUnit: money(formData, "qtyPerUnit"), estimated: formData.get("estimated") === "on" } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "garment.component_update", entityType: "GarmentSpec", entityId: c.garmentId });
  revalidatePath("/production");
  go(garmentPath(c.garmentId), "Consumo aggiornato.");
}

export async function linkProductionOrderAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const g = await ownGarment(auth.organizationId, String(formData.get("garmentId") ?? ""));
  const po = await db.productionOrder.findFirst({ where: { id: String(formData.get("productionOrderId") ?? ""), organizationId: auth.organizationId } });
  if (!po) go(garmentPath(g.id), "Scegli un ordine di produzione", "error");
  const unlink = formData.get("unlink") === "1";
  await db.productionOrder.update({ where: { id: po.id }, data: { garmentSpecId: unlink ? null : g.id } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: unlink ? "garment.lot_unlink" : "garment.lot_link", entityType: "ProductionOrder", entityId: po.id, metadata: { garment: g.name } });
  revalidatePath("/production");
  go(garmentPath(g.id), unlink ? `${po.reference} scollegato.` : `${po.reference} collegato.`);
}

export async function upsertMaterialAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = str(formData, "id", 40);
  const name = str(formData, "name", 120);
  if (!name || name.length < 2) go("/production?tab=materials", "Dai un nome al materiale", "error");
  const kindRaw = String(formData.get("kind") ?? "FABRIC");
  const weight = int(formData, "weightGsm");
  const width = int(formData, "widthCm");
  const unit = ["m", "pz", "foglio", "kg"].includes(String(formData.get("unit"))) ? String(formData.get("unit")) : "m";
  const data = {
    name,
    kind: (MATERIAL_KINDS as string[]).includes(kindRaw) ? (kindRaw as MaterialKind) : "FABRIC",
    variant: str(formData, "variant", 120),
    supplierId: await ownSupplier(auth.organizationId, str(formData, "supplierId", 40)),
    composition: str(formData, "composition", 200),
    weightGsm: weight,
    widthCm: width,
    unit,
    unitPrice: money(formData, "unitPrice"),
    invoiceMatch: str(formData, "invoiceMatch", 80),
    notes: str(formData, "notes", 1000),
  };
  let saved;
  if (id) {
    const existing = await db.material.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!existing) go("/production?tab=materials", "Materiale non trovato", "error");
    saved = await db.material.update({ where: { id }, data });
  } else {
    saved = await db.material.create({ data: { organizationId: auth.organizationId, ...data } });
  }
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: id ? "material.update" : "material.create", entityType: "Material", entityId: saved.id, metadata: { name } });
  revalidatePath("/production");
  go("/production?tab=materials", `${name} salvato.`);
}
