"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { decideApproval } from "../agent/approvals";
import { enqueue } from "../jobs/queue";
import { generateBriefing } from "../agent/briefing";

export async function newConversationAction(formData: FormData) {
  const auth = await requireAuth("VIEWER");
  const prompt = String(formData.get("prompt") ?? "").trim().slice(0, 4000);
  const c = await db.agentConversation.create({ data: { organizationId: auth.organizationId, userId: auth.userId, title: prompt ? prompt.replace(/\s+/g, " ").slice(0, 70) : "Nuova conversazione" } });
  redirect(`/assistant?c=${c.id}${prompt ? `&q=${encodeURIComponent(prompt)}` : ""}`);
}

export async function archiveConversationAction(formData: FormData) {
  const auth = await requireAuth("VIEWER");
  const id = String(formData.get("id") ?? "");
  await db.agentConversation.updateMany({ where: { id, organizationId: auth.organizationId, userId: auth.userId }, data: { archivedAt: new Date() } });
  revalidatePath("/assistant");
  redirect("/assistant");
}

export async function decideApprovalAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "APPROVE" ? "APPROVE" : "REJECT";
  const returnTo = String(formData.get("returnTo") ?? "/assistant/approvals");
  let msg: string;
  try {
    const r = await decideApproval({ userId: auth.userId, role: auth.role, timezone: auth.timezone, currency: auth.currency, organizationId: auth.organizationId }, id, decision);
    msg = r.status === "APPROVED" ? "Approvata ed eseguita." : r.status === "REJECTED" ? "Rifiutata." : r.status === "FAILED" ? `Approvata ma fallita: ${r.error}` : `Stato: ${r.status}${r.error ? ` (${r.error})` : ""}`;
  } catch (e) {
    msg = (e as Error).message;
  }
  revalidatePath("/assistant");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg)}`);
}

export async function regenerateBriefingAction() {
  const auth = await requireAuth("OPERATIONS");
  await generateBriefing(auth.organizationId, { force: true, notify: false });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "agent.briefing.regenerate" });
  revalidatePath("/");
  redirect("/?notice=" + encodeURIComponent("Briefing rigenerato."));
}

export async function runMonitorNowAction() {
  const auth = await requireAuth("OPERATIONS");
  const { deduplicated } = await enqueue({ organizationId: auth.organizationId, type: "agent.monitor", dedupeKey: `agent.monitor:${auth.organizationId}`, triggeredBy: `user:${auth.userId}` });
  revalidatePath("/alerts");
  redirect("/alerts?notice=" + encodeURIComponent(deduplicated ? "Il monitor è già in esecuzione." : "Monitor avviato: ricarica tra qualche secondo."));
}

export async function deleteMemoryAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const key = String(formData.get("key") ?? "");
  await db.agentMemory.deleteMany({ where: { organizationId: auth.organizationId, key } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "agent.memory.delete", metadata: { key } });
  revalidatePath("/assistant/memory");
  redirect("/assistant/memory");
}

export async function addMemoryAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const key = String(formData.get("key") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const content = String(formData.get("content") ?? "").trim().slice(0, 1500);
  const category = String(formData.get("category") ?? "general");
  if (!key || content.length < 3) redirect("/assistant/memory?error=" + encodeURIComponent("Chiave o contenuto non validi"));
  await db.agentMemory.upsert({ where: { organizationId_key: { organizationId: auth.organizationId, key } }, create: { organizationId: auth.organizationId, key, content, category, source: "user", createdById: auth.userId }, update: { content, category, source: "user" } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "agent.memory.set", metadata: { key } });
  revalidatePath("/assistant/memory");
  redirect("/assistant/memory?notice=" + encodeURIComponent("Memoria salvata."));
}
