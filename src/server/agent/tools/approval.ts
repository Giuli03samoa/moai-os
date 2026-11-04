import { z } from "zod/v4";
import { db } from "../../db";
import { audit } from "../../audit";
import { decideReconciliation } from "../../reconciliation/engine";
import { refreshInvoicePaymentStatus } from "../../invoices/archive";
import { sendTelegram } from "../../notify/telegram";
import { defineTool, plain, ToolError } from "./types";

/**
 * Approval-gated tools: the agent can only PROPOSE these. The registry records an AgentApproval and
 * `run` executes later, with the approver's identity, from the Approvals page.
 */

export const decideReconciliationTool = defineTool({
  name: "decide_reconciliation",
  description: "Propone di confermare o scartare una riconciliazione SUGGESTED. La decisione viene eseguita solo dopo approvazione di un ACCOUNTANT/ADMIN: spiega sempre il motivo.",
  schema: z.object({ id: z.string(), decision: z.enum(["CONFIRM", "REJECT"]), reason: z.string().min(5).max(500) }),
  risk: "approval",
  minRole: "ACCOUNTANT",
  summarize: (i) => `${i.decision === "CONFIRM" ? "Conferma" : "Scarta"} la riconciliazione ${i.id}: ${i.reason}`,
  async run(ctx, input) {
    if (!ctx.userId) throw new ToolError("Serve un utente approvatore");
    await decideReconciliation(ctx.organizationId, input.id, input.decision, ctx.userId);
    return { id: input.id, decision: input.decision };
  },
});

export const markInstallmentPaid = defineTool({
  name: "mark_installment_paid",
  description: "Propone di segnare pagata (o non pagata) una rata di una fattura. Eseguito solo dopo approvazione (ACCOUNTANT).",
  schema: z.object({ invoiceId: z.string(), position: z.number().int().min(1), paid: z.boolean(), reason: z.string().max(300).optional() }),
  risk: "approval",
  minRole: "ACCOUNTANT",
  summarize: (i) => `Segna ${i.paid ? "pagata" : "non pagata"} la rata ${i.position} della fattura ${i.invoiceId}${i.reason ? ` (${i.reason})` : ""}`,
  async run(ctx, input) {
    const inst = await db.invoiceInstallment.findFirst({ where: { organizationId: ctx.organizationId, invoiceId: input.invoiceId, position: input.position } });
    if (!inst) throw new ToolError("Rata non trovata");
    await db.invoiceInstallment.update({ where: { id: inst.id }, data: { paidAt: input.paid ? new Date() : null } });
    await refreshInvoicePaymentStatus(inst.invoiceId);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: input.paid ? "invoice.installment_paid" : "invoice.installment_unpaid", entityType: "InvoiceInstallment", entityId: inst.id, metadata: { via: "agent-approval" } });
    return { invoiceId: input.invoiceId, position: input.position, paid: input.paid };
  },
});

export const updateShipmentTool = defineTool({
  name: "update_shipment",
  description: "Propone una modifica manuale tracciata a una spedizione (stato, tracking, corriere, anomalia). Eseguita solo dopo approvazione (OPERATIONS). Non crea spedizioni.",
  schema: z.object({ id: z.string(), status: z.enum(["PENDING", "READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION", "RETURNED", "CANCELLED"]).optional(), trackingNumber: z.string().max(80).optional(), carrier: z.string().max(60).optional(), problem: z.boolean().optional(), problemReason: z.string().max(300).optional(), reason: z.string().max(300).optional() }),
  risk: "approval",
  minRole: "OPERATIONS",
  summarize: (i) => `Aggiorna spedizione ${i.id}${i.status ? ` → ${i.status}` : ""}${i.trackingNumber ? ` tracking ${i.trackingNumber}` : ""}${i.problem === false ? " (risolta)" : ""}`,
  async run(ctx, input) {
    const s = await db.shipment.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
    if (!s) throw new ToolError("Spedizione non trovata");
    if (input.trackingNumber && input.trackingNumber !== s.trackingNumber) {
      const dup = await db.shipment.findFirst({ where: { organizationId: ctx.organizationId, trackingNumber: input.trackingNumber, id: { not: s.id }, deletedAt: null } });
      if (dup) throw new ToolError("Esiste già una spedizione con questo tracking");
    }
    const u = await db.shipment.update({ where: { id: s.id }, data: { ...(input.status ? { status: input.status, deliveredAt: input.status === "DELIVERED" ? s.deliveredAt ?? new Date() : s.deliveredAt } : {}), ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}), ...(input.carrier ? { carrier: input.carrier } : {}), ...(input.problem !== undefined ? { problem: input.problem, problemReason: input.problem ? input.problemReason ?? s.problemReason : null } : {}), lastEventAt: new Date() } });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "shipment.manual_update", entityType: "Shipment", entityId: s.id, metadata: { via: "agent-approval", before: { status: s.status, trackingNumber: s.trackingNumber }, after: { status: u.status, trackingNumber: u.trackingNumber } } });
    return plain({ id: u.id, status: u.status, trackingNumber: u.trackingNumber, problem: u.problem });
  },
});

export const sendTelegramMessage = defineTool({
  name: "send_telegram_message",
  description: "Propone l'invio di un messaggio Telegram alla chat configurata (es. un promemoria o un riepilogo). Inviato solo dopo approvazione.",
  schema: z.object({ text: z.string().min(1).max(3500) }),
  risk: "approval",
  minRole: "OPERATIONS",
  summarize: (i) => `Invia su Telegram: "${i.text.slice(0, 120)}${i.text.length > 120 ? "…" : ""}"`,
  async run(ctx, input) {
    const r = await sendTelegram(ctx.organizationId, input.text, { userId: ctx.userId, reason: "agent-approval" });
    if (!r.ok) throw new ToolError(r.error ?? "Invio fallito");
    return { sent: true };
  },
});

export const APPROVAL_TOOLS = [decideReconciliationTool, markInstallmentPaid, updateShipmentTool, sendTelegramMessage];
