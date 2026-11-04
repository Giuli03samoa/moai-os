"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { DesignLine, DesignStage, Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { checkSvgBrand } from "../design/brand-check";
import { resolveBrandTokens } from "../design/assets";
import { renderMockup } from "../design/mockup";
import { GARMENTS, PLACEMENTS, type Garment, type Placement } from "../design/brand";
import { MAX_UPLOAD_BYTES, storeDocument } from "../storage";

const LINES: DesignLine[] = ["ESSENTIALS", "MOTION", "CAPSULE", "MERCH"];
const STAGES: DesignStage[] = ["IDEA", "CONCEPT", "BRIEF", "SAMPLE", "APPROVED", "PRODUCTION", "ARCHIVED"];
function back(path: string, msg: string, kind: "notice" | "error" = "notice"): never {
  redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
}

export async function createDesignProjectAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (name.length < 2) back("/design", "Nome troppo corto", "error");
  const line = String(formData.get("line") ?? "MOTION") as DesignLine;
  const target = String(formData.get("targetDate") ?? "");
  const p = await db.designProject.create({ data: { organizationId: auth.organizationId, name, line: LINES.includes(line) ? line : "MOTION", concept: String(formData.get("concept") ?? "").trim().slice(0, 500) || null, garments: String(formData.get("garments") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10), targetDate: /^\d{4}-\d{2}-\d{2}$/.test(target) ? new Date(`${target}T12:00:00Z`) : null, createdById: auth.userId } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "design.project.create", entityType: "DesignProject", entityId: p.id });
  redirect(`/design/${p.id}`);
}

export async function updateDesignProjectAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const p = await db.designProject.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!p) redirect("/design");
  const stage = String(formData.get("stage") ?? p.stage) as DesignStage;
  const target = String(formData.get("targetDate") ?? "");
  const data: Prisma.DesignProjectUpdateInput = {
    name: String(formData.get("name") ?? p.name).trim().slice(0, 120) || p.name,
    line: LINES.includes(String(formData.get("line")) as DesignLine) ? (String(formData.get("line")) as DesignLine) : p.line,
    stage: STAGES.includes(stage) ? stage : p.stage,
    concept: String(formData.get("concept") ?? "").trim().slice(0, 500) || null,
    narrative: String(formData.get("narrative") ?? "").trim().slice(0, 4000) || null,
    brief: String(formData.get("brief") ?? "").trim().slice(0, 12000) || null,
    notes: String(formData.get("notes") ?? "").trim().slice(0, 4000) || null,
    references: String(formData.get("references") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 7),
    garments: String(formData.get("garments") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10),
    targetDate: /^\d{4}-\d{2}-\d{2}$/.test(target) ? new Date(`${target}T12:00:00Z`) : null,
    archivedAt: stage === "ARCHIVED" ? p.archivedAt ?? new Date() : null,
  };
  await db.designProject.update({ where: { id }, data });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "design.project.update", entityType: "DesignProject", entityId: id, metadata: { stage } });
  revalidatePath(`/design/${id}`);
  back(`/design/${id}`, "Progetto aggiornato.");
}

export async function addSketchAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const projectId = String(formData.get("projectId") ?? "");
  const p = await db.designProject.findFirst({ where: { id: projectId, organizationId: auth.organizationId } });
  if (!p) redirect("/design");
  const title = String(formData.get("title") ?? "Sketch").trim().slice(0, 120) || "Sketch";
  const raw = String(formData.get("svg") ?? "");
  const pre = checkSvgBrand(raw);
  if (!pre.ok) back(`/design/${projectId}`, `Sketch rifiutato dal brand check: ${pre.issues.filter((i) => i.level === "error").map((i) => i.message).join(" · ")}`, "error");
  const svg = resolveBrandTokens(raw);
  const post = checkSvgBrand(svg, { allowNeutral: true });
  if (!post.ok) back(`/design/${projectId}`, "Sketch rifiutato dopo la sostituzione dei token.", "error");
  const a = await db.designAsset.create({ data: { organizationId: auth.organizationId, projectId, kind: "SKETCH", title, svg, brandCheck: pre as unknown as Prisma.InputJsonValue, meta: {}, createdBy: "user", createdById: auth.userId } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "design.asset.create", entityType: "DesignAsset", entityId: a.id, metadata: { kind: "SKETCH" } });
  revalidatePath(`/design/${projectId}`);
  back(`/design/${projectId}`, pre.issues.length ? `Sketch salvato con ${pre.issues.length} avvertenze.` : "Sketch salvato.");
}

export async function renderMockupAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const sketchId = String(formData.get("sketchId") ?? "");
  const sketch = await db.designAsset.findFirst({ where: { id: sketchId, organizationId: auth.organizationId, kind: "SKETCH" } });
  if (!sketch?.svg) redirect("/design");
  const garment = String(formData.get("garment") ?? "tee") as Garment;
  const color = formData.get("color") === "crocus" ? "crocus" : "blackout";
  const placement = String(formData.get("placement") ?? "chest-left") as Placement;
  if (!GARMENTS.includes(garment) || !PLACEMENTS.includes(placement)) back(`/design/${sketch.projectId}`, "Parametri mockup non validi", "error");
  const g = (["tee", "hoodie", "tote"] as const).includes(garment as "tee") ? (garment as "tee" | "hoodie" | "tote") : "tee";
  const svg = renderMockup({ sketchSvg: sketch.svg, garment: g, color, placement });
  const check = checkSvgBrand(svg, { allowNeutral: true });
  const a = await db.designAsset.create({ data: { organizationId: auth.organizationId, projectId: sketch.projectId, kind: "MOCKUP", title: `${sketch.title} · ${g} ${color} ${placement}`, svg, brandCheck: check as unknown as Prisma.InputJsonValue, meta: { sketchAssetId: sketch.id, garment: g, color, placement }, createdBy: "user", createdById: auth.userId } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "design.asset.create", entityType: "DesignAsset", entityId: a.id, metadata: { kind: "MOCKUP" } });
  revalidatePath(`/design/${sketch.projectId}`);
  back(`/design/${sketch.projectId}`, "Mockup generato.");
}

export async function uploadReferenceAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const projectId = String(formData.get("projectId") ?? "");
  const p = await db.designProject.findFirst({ where: { id: projectId, organizationId: auth.organizationId } });
  if (!p) redirect("/design");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back(`/design/${projectId}`, "Nessun file", "error");
  if (file.size > MAX_UPLOAD_BYTES) back(`/design/${projectId}`, "File troppo grande (max 10 MB)", "error");
  const mime = file.type;
  if (!/^image\/(png|jpeg|webp|gif)$|^application\/pdf$/.test(mime)) back(`/design/${projectId}`, "Formati ammessi: PNG, JPEG, WebP, GIF, PDF", "error");
  const content = Buffer.from(await file.arrayBuffer());
  const { document } = await storeDocument({ organizationId: auth.organizationId, kind: "DESIGN_ASSET", filename: file.name, mimeType: mime, content, uploadedById: auth.userId });
  const a = await db.designAsset.create({ data: { organizationId: auth.organizationId, projectId, kind: formData.get("kind") === "TECHPACK" ? "TECHPACK" : "REFERENCE", title: String(formData.get("title") ?? file.name).trim().slice(0, 120) || file.name, documentId: document.id, mimeType: mime, meta: {}, createdBy: "user", createdById: auth.userId } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "design.asset.upload", entityType: "DesignAsset", entityId: a.id, metadata: { mime, size: file.size } });
  revalidatePath(`/design/${projectId}`);
  back(`/design/${projectId}`, "Riferimento caricato.");
}

export async function deleteAssetAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const a = await db.designAsset.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!a) redirect("/design");
  await db.designAsset.delete({ where: { id } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "design.asset.delete", entityType: "DesignAsset", entityId: id, metadata: { title: a.title, kind: a.kind } });
  revalidatePath(`/design/${a.projectId}`);
  back(`/design/${a.projectId}`, "Asset eliminato.");
}
