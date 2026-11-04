"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AlertStatus, TaskPriority, TaskStatus } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";

const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];

export async function createTaskAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const title = String(formData.get("title") ?? "").trim().slice(0, 160);
  if (title.length < 3) redirect("/tasks?error=" + encodeURIComponent("Titolo troppo corto"));
  const priority = String(formData.get("priority") ?? "NORMAL") as TaskPriority;
  const due = String(formData.get("dueAt") ?? "");
  const t = await db.task.create({ data: { organizationId: auth.organizationId, title, description: String(formData.get("description") ?? "").trim().slice(0, 2000) || null, priority: PRIORITIES.includes(priority) ? priority : "NORMAL", dueAt: /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T12:00:00Z`) : null, createdById: auth.userId, createdBy: "user", linkedType: String(formData.get("linkedType") ?? "") || null, linkedId: String(formData.get("linkedId") ?? "") || null } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "task.create", entityType: "Task", entityId: t.id });
  revalidatePath("/tasks");
  redirect(String(formData.get("returnTo") ?? "/tasks"));
}

export async function setTaskStatusAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as TaskStatus;
  if (!STATUSES.includes(status)) redirect("/tasks");
  await db.task.updateMany({ where: { id, organizationId: auth.organizationId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "task.status", entityType: "Task", entityId: id, metadata: { status } });
  revalidatePath("/tasks");
  revalidatePath("/");
  redirect(String(formData.get("returnTo") ?? "/tasks"));
}

export async function setAlertStatusAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AlertStatus;
  if (!["OPEN", "ACKNOWLEDGED", "SNOOZED", "RESOLVED"].includes(status)) redirect("/alerts");
  const days = Math.min(60, Math.max(1, Number(formData.get("days") ?? 3) || 3));
  await db.alert.updateMany({ where: { id, organizationId: auth.organizationId }, data: { status, acknowledgedById: status === "ACKNOWLEDGED" ? auth.userId : undefined, resolvedAt: status === "RESOLVED" ? new Date() : null, snoozedUntil: status === "SNOOZED" ? new Date(Date.now() + days * 86_400_000) : null } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "alert.status", entityType: "Alert", entityId: id, metadata: { status } });
  revalidatePath("/alerts");
  revalidatePath("/");
  redirect(String(formData.get("returnTo") ?? "/alerts"));
}

/** Turns an alert into a task (one click from the cockpit). */
export async function alertToTaskAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const a = await db.alert.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!a) redirect("/alerts");
  const t = await db.task.create({ data: { organizationId: auth.organizationId, title: a.title.slice(0, 160), description: `${a.body}${a.href ? `\n\n${a.href}` : ""}`.slice(0, 2000), priority: a.severity === "CRITICAL" ? "URGENT" : a.severity === "WARNING" ? "HIGH" : "NORMAL", createdById: auth.userId, createdBy: "user", linkedType: "Alert", linkedId: a.id } });
  await db.alert.update({ where: { id: a.id }, data: { status: "ACKNOWLEDGED", acknowledgedById: auth.userId } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "alert.to_task", entityType: "Task", entityId: t.id, metadata: { alertId: a.id } });
  revalidatePath("/tasks");
  revalidatePath("/alerts");
  redirect("/tasks?notice=" + encodeURIComponent("Task creato dall'avviso."));
}
