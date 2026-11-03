"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { getConnector, loadConnection, saveConnectionSettings, verifyConnection } from "../connectors/registry";
import { enqueue, retryJob } from "../jobs/queue";
import { scheduleDueJobs } from "../jobs/scheduler";

function back(path: string, msg: string, kind: "error" | "notice" = "notice"): never {
  redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
}

export async function saveIntegrationAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const key = String(formData.get("key") ?? "");
  const def = getConnector(key);
  const secrets: Record<string, string> = {};
  for (const f of def.secretFields) secrets[f.name] = String(formData.get(`secret.${f.name}`) ?? "");
  const config: Record<string, unknown> = {};
  for (const f of def.configFields) {
    const v = formData.get(`config.${f.name}`);
    config[f.name] = f.type === "checkbox" ? v === "on" : v === null ? undefined : String(v).trim();
  }
  await saveConnectionSettings({ organizationId: auth.organizationId, key, userId: auth.userId, secrets, config });
  const result = await verifyConnection(auth.organizationId, key, auth.userId);
  revalidatePath(`/integrations/${key}`);
  back(`/integrations/${key}`, `Salvato. Verifica: ${result.message}`, result.status === "CONNECTED" ? "notice" : "error");
}

export async function verifyIntegrationAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const key = String(formData.get("key") ?? "");
  getConnector(key);
  const result = await verifyConnection(auth.organizationId, key, auth.userId);
  revalidatePath(`/integrations/${key}`);
  back(`/integrations/${key}`, result.message, result.status === "CONNECTED" ? "notice" : "error");
}

export async function runJobAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const type = String(formData.get("type") ?? "");
  const key = String(formData.get("key") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/sync");
  let payload: Prisma.InputJsonValue = {};
  try {
    payload = JSON.parse(String(formData.get("payload") || "{}")) as Prisma.InputJsonValue;
  } catch {
    back(returnTo, "Payload non valido", "error");
  }
  let connectionId: string | null = null;
  if (key) {
    const def = getConnector(key);
    if (!def.jobs.some((j) => j.type === type)) back(returnTo, "Job non previsto per questo connettore", "error");
    const loaded = await loadConnection(auth.organizationId, key);
    if (!loaded) back(returnTo, "Connessione non configurata", "error");
    connectionId = loaded.connection.id;
  } else if (!["reconciliation.run", "shipments.detect_problems"].includes(type)) {
    back(returnTo, "Job non valido", "error");
  }
  const { job, deduplicated } = await enqueue({ organizationId: auth.organizationId, connectionId, type, payload, dedupeKey: `${type}:${connectionId ?? auth.organizationId}`, triggeredBy: `user:${auth.userId}` });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "job.enqueue", entityType: "SyncJob", entityId: job.id, metadata: { type, deduplicated } });
  revalidatePath("/sync");
  back(returnTo, deduplicated ? "Un job identico è già in coda o in esecuzione." : "Job avviato: segui l'avanzamento in Sync.");
}

export async function retryJobAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  await retryJob(auth.organizationId, id, auth.userId);
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "job.retry", entityType: "SyncJob", entityId: id });
  revalidatePath("/sync");
  redirect(`/sync/${id}`);
}

export async function cancelJobAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  await db.syncJob.updateMany({ where: { id, organizationId: auth.organizationId, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "job.cancel", entityType: "SyncJob", entityId: id });
  revalidatePath("/sync");
  redirect(`/sync/${id}`);
}

export async function scheduleNowAction() {
  const auth = await requireAuth("OPERATIONS");
  const n = await scheduleDueJobs();
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "job.schedule_now", metadata: { enqueued: n } });
  revalidatePath("/sync");
  back("/sync", `Pianificazione eseguita: ${n} job aggiunti.`);
}
