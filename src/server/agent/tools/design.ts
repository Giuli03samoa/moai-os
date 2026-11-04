import { z } from "zod/v4";
import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import { checkSvgBrand } from "../../design/brand-check";
import { resolveBrandTokens } from "../../design/assets";
import { renderMockup } from "../../design/mockup";
import { GARMENTS, PLACEMENTS } from "../../design/brand";
import { defineTool, plain, ToolError } from "./types";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STAGE = z.enum(["IDEA", "CONCEPT", "BRIEF", "SAMPLE", "APPROVED", "PRODUCTION", "ARCHIVED"]);
const LINE = z.enum(["ESSENTIALS", "MOTION", "CAPSULE", "MERCH"]);

export const createDesignProject = defineTool({
  name: "create_design_project",
  description: "Crea un progetto nel Design Studio (drop, capsule, singola grafica). Parti sempre dal concept in una frase; indica linea, capi e riferimenti di tendenza usati.",
  schema: z.object({ name: z.string().min(2).max(120), line: LINE, concept: z.string().min(5).max(500).describe("Il perché del drop in una frase"), narrative: z.string().max(4000).optional(), references: z.array(z.string().max(40)).max(7).optional(), garments: z.array(z.string().max(30)).max(10).optional(), targetDate: DATE.optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Nuovo progetto design "${i.name}" (${i.line})`,
  async run(ctx, input) {
    const p = await db.designProject.create({ data: { organizationId: ctx.organizationId, name: input.name, line: input.line, stage: "CONCEPT", concept: input.concept, narrative: input.narrative ?? null, references: input.references ?? [], garments: input.garments ?? [], targetDate: input.targetDate ? new Date(`${input.targetDate}T12:00:00Z`) : null, createdById: ctx.userId } });
    return plain({ id: p.id, name: p.name, stage: p.stage, url: `/design/${p.id}` });
  },
});

export const updateDesignProject = defineTool({
  name: "update_design_project",
  description: "Aggiorna un progetto di design: fase, concept, narrativa, brief (markdown per stampatore/designer), note, riferimenti, capi, data target.",
  schema: z.object({ id: z.string(), stage: STAGE.optional(), name: z.string().min(2).max(120).optional(), concept: z.string().max(500).optional(), narrative: z.string().max(4000).optional(), brief: z.string().max(12000).optional(), notes: z.string().max(4000).optional(), references: z.array(z.string().max(40)).max(7).optional(), garments: z.array(z.string().max(30)).max(10).optional(), targetDate: DATE.nullable().optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Aggiorna progetto design ${i.id}${i.stage ? ` → ${i.stage}` : ""}${i.brief ? " (brief)" : ""}`,
  async run(ctx, input) {
    const p = await db.designProject.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
    if (!p) throw new ToolError("Progetto non trovato");
    const { id, targetDate, ...rest } = input;
    const u = await db.designProject.update({ where: { id }, data: { ...rest, ...(targetDate !== undefined ? { targetDate: targetDate ? new Date(`${targetDate}T12:00:00Z`) : null } : {}), ...(input.stage === "ARCHIVED" ? { archivedAt: new Date() } : {}) } });
    return plain({ id: u.id, name: u.name, stage: u.stage, hasBrief: !!u.brief, url: `/design/${u.id}` });
  },
});

export const addDesignSketch = defineTool({
  name: "add_design_sketch",
  description: "Salva uno sketch SVG nel progetto dopo il brand check (palette, Geist, niente gradienti/script/riferimenti esterni). Usa i token {{ICON_CREAM}}, {{ICON_BLACK}}, {{LOGO_CREAM}}, {{LOGO_BLACK}}, {{PATTERN_CHEVRON_DEFS}} per il logo e il pattern ufficiali. Se il check fallisce, l'asset non viene salvato: correggi e riprova. Carica prima la skill sketch-svg.",
  schema: z.object({ projectId: z.string(), title: z.string().min(2).max(120), svg: z.string().min(20).max(300_000), garment: z.enum(GARMENTS).optional(), placement: z.enum(PLACEMENTS).optional(), intendedGarmentColor: z.enum(["blackout", "crocus"]).optional(), notes: z.string().max(1000).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Sketch "${i.title}" nel progetto ${i.projectId}`,
  async run(ctx, input) {
    const p = await db.designProject.findFirst({ where: { id: input.projectId, organizationId: ctx.organizationId } });
    if (!p) throw new ToolError("Progetto non trovato");
    const pre = checkSvgBrand(input.svg);
    if (!pre.ok) return { saved: false, brandCheck: pre, hint: "Correggi gli errori e richiama add_design_sketch." };
    const svg = resolveBrandTokens(input.svg);
    const post = checkSvgBrand(svg, { allowNeutral: true });
    if (!post.ok) return { saved: false, brandCheck: post, hint: "Il controllo dopo la sostituzione dei token ha trovato errori." };
    const a = await db.designAsset.create({ data: { organizationId: ctx.organizationId, projectId: p.id, kind: "SKETCH", title: input.title, svg, brandCheck: pre as unknown as Prisma.InputJsonValue, meta: { garment: input.garment ?? null, placement: input.placement ?? null, intendedGarmentColor: input.intendedGarmentColor ?? null, notes: input.notes ?? null } as Prisma.InputJsonValue, createdBy: "agent", createdById: ctx.userId } });
    if (p.stage === "IDEA") await db.designProject.update({ where: { id: p.id }, data: { stage: "CONCEPT" } });
    return { saved: true, assetId: a.id, viewUrl: `/api/design/assets/${a.id}`, projectUrl: `/design/${p.id}`, brandCheck: { ok: pre.ok, warnings: pre.issues.filter((i) => i.level === "warning").map((i) => i.message), colors: pre.colors.map((c) => c.name ?? c.hex) } };
  },
});

export const renderMockupTool = defineTool({
  name: "render_mockup",
  description: "Compone uno sketch salvato su un capo (tee, hoodie, tote) in Black Out o Early Crocus, nel punto indicato, e salva il mockup nel progetto. Restituisce l'URL da mostrare.",
  schema: z.object({ sketchAssetId: z.string(), garment: z.enum(["tee", "hoodie", "tote"]), color: z.enum(["blackout", "crocus"]), placement: z.enum(PLACEMENTS), view: z.enum(["front", "back"]).optional(), title: z.string().max(120).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Mockup ${i.garment} ${i.color} · ${i.placement}`,
  async run(ctx, input) {
    const sketch = await db.designAsset.findFirst({ where: { id: input.sketchAssetId, organizationId: ctx.organizationId, kind: "SKETCH" } });
    if (!sketch?.svg) throw new ToolError("Sketch non trovato");
    const svg = renderMockup({ sketchSvg: sketch.svg, garment: input.garment, color: input.color, placement: input.placement, view: input.view });
    const check = checkSvgBrand(svg, { allowNeutral: true });
    const a = await db.designAsset.create({ data: { organizationId: ctx.organizationId, projectId: sketch.projectId, kind: "MOCKUP", title: input.title ?? `${sketch.title} · ${input.garment} ${input.color} ${input.placement}`, svg, brandCheck: check as unknown as Prisma.InputJsonValue, meta: { sketchAssetId: sketch.id, garment: input.garment, color: input.color, placement: input.placement, view: input.view ?? (input.placement.startsWith("back") ? "back" : "front") } as Prisma.InputJsonValue, createdBy: "agent", createdById: ctx.userId } });
    return { assetId: a.id, viewUrl: `/api/design/assets/${a.id}`, projectUrl: `/design/${sketch.projectId}`, brandCheckOk: check.ok };
  },
});

export const DESIGN_TOOLS = [createDesignProject, updateDesignProject, addDesignSketch, renderMockupTool];
