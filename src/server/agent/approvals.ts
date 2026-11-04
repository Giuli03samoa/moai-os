import type { Prisma, Role } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { redact } from "../crypto";
import { runApprovedTool } from "./tools/registry";
import { roleAtLeast } from "./tools/types";

export type Approver = { userId: string; role: Role; timezone: string; currency: string; organizationId: string };

/**
 * Human decision on a tool call the agent proposed. APPROVE executes the tool now with the approver's
 * identity and records the result; REJECT just closes it. Both are audited and echoed back into the
 * conversation so the assistant knows the outcome on its next turn.
 */
export async function decideApproval(approver: Approver, approvalId: string, decision: "APPROVE" | "REJECT"): Promise<{ status: string; result?: unknown; error?: string }> {
  const a = await db.agentApproval.findFirst({ where: { id: approvalId, organizationId: approver.organizationId } });
  if (!a) throw new Error("Approvazione non trovata");
  if (a.status !== "PENDING") return { status: a.status, error: "Già decisa" };
  if (a.expiresAt < new Date()) {
    await db.agentApproval.update({ where: { id: a.id }, data: { status: "EXPIRED" } });
    return { status: "EXPIRED", error: "Richiesta scaduta" };
  }
  if (!roleAtLeast(approver.role, a.requiredRole)) throw new Error(`Per decidere serve il ruolo ${a.requiredRole}`);

  if (decision === "REJECT") {
    await db.agentApproval.update({ where: { id: a.id }, data: { status: "REJECTED", decidedById: approver.userId, decidedAt: new Date() } });
    await audit({ organizationId: approver.organizationId, userId: approver.userId, action: "agent.approval.reject", entityType: "AgentApproval", entityId: a.id, metadata: { tool: a.toolName, summary: a.summary } });
    await echoToConversation(a.conversationId, a.organizationId, `[Esito approvazione] RIFIUTATA da ${approver.userId}: ${a.summary}`);
    return { status: "REJECTED" };
  }

  const lines: string[] = [];
  try {
    const result = await runApprovedTool({ organizationId: approver.organizationId, userId: approver.userId, role: approver.role, timezone: approver.timezone, currency: approver.currency, conversationId: a.conversationId, runId: a.runId, channel: "web", log: (l) => lines.push(l) }, a.toolName, a.input);
    await db.agentApproval.update({ where: { id: a.id }, data: { status: "APPROVED", decidedById: approver.userId, decidedAt: new Date(), result: (result ?? null) as Prisma.InputJsonValue } });
    await audit({ organizationId: approver.organizationId, userId: approver.userId, action: "agent.approval.approve", entityType: "AgentApproval", entityId: a.id, metadata: { tool: a.toolName, summary: a.summary, log: lines.slice(0, 10) } });
    await echoToConversation(a.conversationId, a.organizationId, `[Esito approvazione] APPROVATA ed eseguita: ${a.summary}. Risultato: ${JSON.stringify(result ?? {}).slice(0, 500)}`);
    return { status: "APPROVED", result };
  } catch (e) {
    const error = redact((e as Error).message ?? "errore").slice(0, 1000);
    await db.agentApproval.update({ where: { id: a.id }, data: { status: "FAILED", decidedById: approver.userId, decidedAt: new Date(), error } });
    await audit({ organizationId: approver.organizationId, userId: approver.userId, action: "agent.approval.failed", entityType: "AgentApproval", entityId: a.id, metadata: { tool: a.toolName, error } });
    await echoToConversation(a.conversationId, a.organizationId, `[Esito approvazione] APPROVATA ma l'esecuzione è fallita: ${a.summary}. Errore: ${error}`);
    return { status: "FAILED", error };
  }
}

/** Appends a user-role note (append-only history) so the model sees what happened to its proposal. */
async function echoToConversation(conversationId: string | null, organizationId: string, text: string) {
  if (!conversationId) return;
  await db.agentMessage.create({ data: { organizationId, conversationId, role: "user", content: [{ type: "text", text }], text } });
  await db.agentConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
}

export async function expirePendingApprovals() {
  return db.agentApproval.updateMany({ where: { status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
}
