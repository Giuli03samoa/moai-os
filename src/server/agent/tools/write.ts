import { z } from "zod/v4";
import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import { enqueue } from "../../jobs/queue";
import { getConnector, loadConnection } from "../../connectors/registry";
import { parseAmount } from "../../money";
import { defineTool, plain, ToolError } from "./types";

/** Internal, reversible writes: run immediately, always audited by the registry. */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data YYYY-MM-DD");
const date = (s?: string | null) => (s ? new Date(`${s}T12:00:00Z`) : null);

export const createTask = defineTool({
  name: "create_task",
  description: "Crea un task operativo (cosa fare, priorità, scadenza, eventuale collegamento a ordine/fattura/spedizione/progetto/avviso). Proponilo quando emerge un'azione concreta.",
  schema: z.object({ title: z.string().min(3).max(160), description: z.string().max(2000).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), dueAt: DATE.optional(), linkedType: z.enum(["Order", "Invoice", "Shipment", "DesignProject", "Alert", "ProductionOrder", "Reconciliation", "IntegrationConnection"]).optional(), linkedId: z.string().optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Crea task "${i.title}"`,
  async run(ctx, input) {
    const t = await db.task.create({ data: { organizationId: ctx.organizationId, title: input.title, description: input.description ?? null, priority: input.priority ?? "NORMAL", dueAt: date(input.dueAt), linkedType: input.linkedType ?? null, linkedId: input.linkedId ?? null, createdById: ctx.userId, createdBy: ctx.channel === "system" ? "monitor" : "agent" } });
    return plain({ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt, url: "/tasks" });
  },
});

export const updateTask = defineTool({
  name: "update_task",
  description: "Aggiorna un task: stato (OPEN, IN_PROGRESS, DONE, CANCELLED), priorità, scadenza, titolo o descrizione.",
  schema: z.object({ id: z.string(), status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), dueAt: DATE.nullable().optional(), title: z.string().min(3).max(160).optional(), description: z.string().max(2000).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Aggiorna task ${i.id}${i.status ? ` → ${i.status}` : ""}`,
  async run(ctx, input) {
    const t = await db.task.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
    if (!t) throw new ToolError("Task non trovato");
    const u = await db.task.update({ where: { id: t.id }, data: { ...(input.status ? { status: input.status, completedAt: input.status === "DONE" ? new Date() : null } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.dueAt !== undefined ? { dueAt: date(input.dueAt) } : {}), ...(input.title ? { title: input.title } : {}), ...(input.description !== undefined ? { description: input.description } : {}) } });
    return plain({ id: u.id, title: u.title, status: u.status, priority: u.priority, dueAt: u.dueAt });
  },
});

export const updateAlert = defineTool({
  name: "update_alert",
  description: "Prende in carico (ACKNOWLEDGED), posticipa (SNOOZED di N giorni) o chiude (RESOLVED) un avviso. Il monitor lo riaprirà se la condizione persiste dopo lo snooze.",
  schema: z.object({ id: z.string(), status: z.enum(["ACKNOWLEDGED", "SNOOZED", "RESOLVED", "OPEN"]), snoozeDays: z.number().int().min(1).max(60).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Avviso ${i.id} → ${i.status}`,
  async run(ctx, input) {
    const a = await db.alert.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
    if (!a) throw new ToolError("Avviso non trovato");
    const u = await db.alert.update({ where: { id: a.id }, data: { status: input.status, acknowledgedById: input.status === "ACKNOWLEDGED" ? ctx.userId : a.acknowledgedById, resolvedAt: input.status === "RESOLVED" ? new Date() : null, snoozedUntil: input.status === "SNOOZED" ? new Date(Date.now() + (input.snoozeDays ?? 3) * 86_400_000) : null } });
    return plain({ id: u.id, title: u.title, status: u.status, snoozedUntil: u.snoozedUntil });
  },
});

export const remember = defineTool({
  name: "remember",
  description: "Salva un fatto durevole nella memoria (chiave breve in kebab-case + contenuto). Solo informazioni che l'utente ha dichiarato o confermato, utili nelle prossime settimane (fornitori, obiettivi, preferenze, decisioni). Mai dati personali di clienti.",
  schema: z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/).describe("Slug kebab-case, es. fornitore-stampa"), content: z.string().min(3).max(1500), category: z.enum(["general", "business", "preference", "contact", "decision"]).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Ricorda "${i.key}"`,
  async run(ctx, input) {
    const m = await db.agentMemory.upsert({ where: { organizationId_key: { organizationId: ctx.organizationId, key: input.key } }, create: { organizationId: ctx.organizationId, key: input.key, content: input.content, category: input.category ?? "general", source: "agent", createdById: ctx.userId }, update: { content: input.content, category: input.category ?? "general" } });
    return { key: m.key, saved: true };
  },
});

export const forget = defineTool({
  name: "forget",
  description: "Elimina un fatto dalla memoria per chiave.",
  schema: z.object({ key: z.string() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Dimentica "${i.key}"`,
  async run(ctx, input) {
    const r = await db.agentMemory.deleteMany({ where: { organizationId: ctx.organizationId, key: input.key } });
    return { deleted: r.count };
  },
});

export const addExpense = defineTool({
  name: "add_expense",
  description: "Registra una spesa gestionale (COGS, campioni, marketing, logistica, software, commissioni, foto, consulenze, altro). Dato interno per il margine stimato: non è una scrittura contabile.",
  schema: z.object({ category: z.enum(["COGS", "SAMPLES", "MARKETING", "LOGISTICS", "SOFTWARE", "FEES", "PHOTOGRAPHY", "CONSULTING", "OTHER"]), description: z.string().min(2).max(300), amount: z.string().describe("Importo, es. 1250.00"), currency: z.string().length(3).optional(), date: DATE, vendor: z.string().max(120).optional(), recurring: z.boolean().optional() }),
  risk: "write",
  minRole: "ACCOUNTANT",
  summarize: (i) => `Registra spesa ${i.category} ${i.amount} (${i.description})`,
  async run(ctx, input) {
    const amount = parseAmount(input.amount);
    if (!amount || amount.lte(0)) throw new ToolError("Importo non valido");
    const e = await db.expense.create({ data: { organizationId: ctx.organizationId, category: input.category, description: input.description, amount, currency: (input.currency ?? ctx.currency).toUpperCase(), date: date(input.date)!, vendor: input.vendor ?? null, recurring: input.recurring ?? false, createdById: ctx.userId, createdBy: "agent" } });
    return plain({ id: e.id, amount: e.amount, category: e.category, date: e.date });
  },
});

export const createSupplier = defineTool({
  name: "create_supplier",
  description: "Crea o aggiorna un fornitore (tessuti, stampa, confezione, etichette, packaging) con contatti, lead time e minimo d'ordine.",
  schema: z.object({ name: z.string().min(2).max(120), category: z.string().max(60).optional(), country: z.string().max(60).optional(), contactName: z.string().max(120).optional(), email: z.string().email().optional(), phone: z.string().max(40).optional(), leadTimeDays: z.number().int().min(0).max(365).optional(), minimumOrder: z.string().max(120).optional(), notes: z.string().max(2000).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Fornitore "${i.name}"`,
  async run(ctx, input) {
    const { name, ...rest } = input;
    const s = await db.supplier.upsert({ where: { organizationId_name: { organizationId: ctx.organizationId, name } }, create: { organizationId: ctx.organizationId, name, ...rest }, update: rest });
    return plain({ id: s.id, name: s.name });
  },
});

export const createProductionOrder = defineTool({
  name: "create_production_order",
  description: "Registra un ordine di produzione (riferimento interno, fornitore, descrizione, quantità, costo, date). Traccia la produzione: NON invia nulla al fornitore.",
  schema: z.object({ reference: z.string().min(2).max(40).describe("Es. PO-2026-003"), supplierName: z.string().max(120).optional(), designProjectId: z.string().optional(), description: z.string().min(2).max(500), status: z.enum(["PLANNED", "QUOTED", "ORDERED", "IN_PRODUCTION", "SHIPPED", "RECEIVED", "CANCELLED"]).optional(), quantity: z.number().int().min(1).optional(), unitCost: z.string().optional(), totalCost: z.string().optional(), currency: z.string().length(3).optional(), orderedAt: DATE.optional(), expectedAt: DATE.optional(), notes: z.string().max(2000).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Ordine di produzione ${i.reference}: ${i.description}`,
  async run(ctx, input) {
    const supplier = input.supplierName ? await db.supplier.findUnique({ where: { organizationId_name: { organizationId: ctx.organizationId, name: input.supplierName } } }) : null;
    if (input.supplierName && !supplier) throw new ToolError(`Fornitore "${input.supplierName}" non trovato: crealo prima con create_supplier`);
    if (input.designProjectId) {
      const p = await db.designProject.findFirst({ where: { id: input.designProjectId, organizationId: ctx.organizationId } });
      if (!p) throw new ToolError("Progetto di design non trovato");
    }
    const unit = parseAmount(input.unitCost ?? null);
    const total = parseAmount(input.totalCost ?? null) ?? (unit && input.quantity ? unit.mul(input.quantity) : null);
    const po = await db.productionOrder.create({ data: { organizationId: ctx.organizationId, reference: input.reference, supplierId: supplier?.id ?? null, designProjectId: input.designProjectId ?? null, description: input.description, status: input.status ?? "PLANNED", quantity: input.quantity ?? null, unitCost: unit, totalCost: total, currency: (input.currency ?? ctx.currency).toUpperCase(), orderedAt: date(input.orderedAt), expectedAt: date(input.expectedAt), notes: input.notes ?? null, createdById: ctx.userId } });
    return plain({ id: po.id, reference: po.reference, status: po.status, totalCost: po.totalCost });
  },
});

export const updateProductionOrder = defineTool({
  name: "update_production_order",
  description: "Aggiorna stato, date, costi o note di un ordine di produzione (per riferimento o id).",
  schema: z.object({ id: z.string().optional(), reference: z.string().optional(), status: z.enum(["PLANNED", "QUOTED", "ORDERED", "IN_PRODUCTION", "SHIPPED", "RECEIVED", "CANCELLED"]).optional(), expectedAt: DATE.optional(), receivedAt: DATE.optional(), totalCost: z.string().optional(), notes: z.string().max(2000).optional() }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Aggiorna produzione ${i.reference ?? i.id}${i.status ? ` → ${i.status}` : ""}`,
  async run(ctx, input) {
    const po = await db.productionOrder.findFirst({ where: { organizationId: ctx.organizationId, ...(input.id ? { id: input.id } : { reference: input.reference ?? "" }) } });
    if (!po) throw new ToolError("Ordine di produzione non trovato");
    const u = await db.productionOrder.update({ where: { id: po.id }, data: { ...(input.status ? { status: input.status } : {}), ...(input.expectedAt ? { expectedAt: date(input.expectedAt) } : {}), ...(input.receivedAt ? { receivedAt: date(input.receivedAt), status: input.status ?? "RECEIVED" } : {}), ...(input.totalCost ? { totalCost: parseAmount(input.totalCost) } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}) } });
    return plain({ id: u.id, reference: u.reference, status: u.status, expectedAt: u.expectedAt, receivedAt: u.receivedAt });
  },
});

export const enqueueSync = defineTool({
  name: "enqueue_sync",
  description: "Avvia subito una sincronizzazione (stessa cosa del pulsante 'Sincronizza ora'): jobType di un connettore connesso, oppure reconciliation.run / shipments.detect_problems / agent.monitor senza connettore. Sola lettura verso i sistemi esterni.",
  schema: z.object({ connectionKey: z.string().max(40).optional().describe("shopify, packlink, aruba, meta, ga4, klaviyo…"), jobType: z.string().max(60) }),
  risk: "write",
  minRole: "OPERATIONS",
  summarize: (i) => `Avvia job ${i.jobType}${i.connectionKey ? ` (${i.connectionKey})` : ""}`,
  async run(ctx, input) {
    let connectionId: string | null = null;
    if (input.connectionKey) {
      const def = getConnector(input.connectionKey);
      if (!def.jobs.some((j) => j.type === input.jobType)) throw new ToolError(`Job ${input.jobType} non previsto per ${def.displayName}. Disponibili: ${def.jobs.map((j) => j.type).join(", ")}`);
      const loaded = await loadConnection(ctx.organizationId, input.connectionKey);
      if (!loaded) throw new ToolError("Connessione non configurata");
      if (loaded.connection.status !== "CONNECTED") throw new ToolError(`Connessione in stato ${loaded.connection.status}`);
      connectionId = loaded.connection.id;
    } else if (!["reconciliation.run", "shipments.detect_problems", "agent.monitor", "agent.briefing"].includes(input.jobType)) {
      throw new ToolError("Job non valido senza connettore");
    }
    const { job, deduplicated } = await enqueue({ organizationId: ctx.organizationId, connectionId, type: input.jobType, payload: {} as Prisma.InputJsonValue, dedupeKey: `${input.jobType}:${connectionId ?? ctx.organizationId}`, triggeredBy: ctx.userId ? `agent:${ctx.userId}` : "agent" });
    return { jobId: job.id, deduplicated, note: deduplicated ? "Un job identico era già in coda." : "Job in coda: il worker lo esegue entro pochi secondi; controlla con list_sync_jobs.", url: `/sync/${job.id}` };
  },
});

export const WRITE_TOOLS = [createTask, updateTask, updateAlert, remember, forget, addExpense, createSupplier, createProductionOrder, updateProductionOrder, enqueueSync];
