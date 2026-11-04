"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ExpenseCategory, ProductionStatus } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { parseAmount } from "../money";

function back(msg: string, kind: "notice" | "error" = "notice", tab = ""): never {
  redirect(`/production?${tab ? `tab=${tab}&` : ""}${kind}=${encodeURIComponent(msg)}`);
}
const date = (v: FormDataEntryValue | null) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? new Date(`${String(v)}T12:00:00Z`) : null);
const STATUSES: ProductionStatus[] = ["PLANNED", "QUOTED", "ORDERED", "IN_PRODUCTION", "SHIPPED", "RECEIVED", "CANCELLED"];
const CATEGORIES: ExpenseCategory[] = ["COGS", "SAMPLES", "MARKETING", "LOGISTICS", "SOFTWARE", "FEES", "PHOTOGRAPHY", "CONSULTING", "OTHER"];

export async function upsertSupplierAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (name.length < 2) back("Nome fornitore non valido", "error", "suppliers");
  const lead = Number(formData.get("leadTimeDays"));
  const data = { category: String(formData.get("category") ?? "").trim() || null, country: String(formData.get("country") ?? "").trim() || null, contactName: String(formData.get("contactName") ?? "").trim() || null, email: String(formData.get("email") ?? "").trim() || null, phone: String(formData.get("phone") ?? "").trim() || null, leadTimeDays: Number.isFinite(lead) && lead > 0 ? Math.round(lead) : null, minimumOrder: String(formData.get("minimumOrder") ?? "").trim() || null, notes: String(formData.get("notes") ?? "").trim() || null };
  const s = await db.supplier.upsert({ where: { organizationId_name: { organizationId: auth.organizationId, name } }, create: { organizationId: auth.organizationId, name, ...data }, update: data });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "supplier.upsert", entityType: "Supplier", entityId: s.id });
  revalidatePath("/production");
  back("Fornitore salvato.", "notice", "suppliers");
}

export async function createProductionOrderAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 40);
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);
  if (reference.length < 2 || description.length < 2) back("Riferimento e descrizione obbligatori", "error");
  if (await db.productionOrder.findUnique({ where: { organizationId_reference: { organizationId: auth.organizationId, reference } } })) back("Riferimento già usato", "error");
  const qty = Number(formData.get("quantity"));
  const unit = parseAmount(String(formData.get("unitCost") ?? ""), { decimalSeparator: "," }) ?? parseAmount(String(formData.get("unitCost") ?? ""));
  const total = parseAmount(String(formData.get("totalCost") ?? ""), { decimalSeparator: "," }) ?? parseAmount(String(formData.get("totalCost") ?? "")) ?? (unit && qty > 0 ? unit.mul(qty) : null);
  const status = String(formData.get("status") ?? "PLANNED") as ProductionStatus;
  const po = await db.productionOrder.create({ data: { organizationId: auth.organizationId, reference, description, status: STATUSES.includes(status) ? status : "PLANNED", supplierId: String(formData.get("supplierId") ?? "") || null, designProjectId: String(formData.get("designProjectId") ?? "") || null, quantity: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : null, unitCost: unit, totalCost: total, currency: auth.currency, orderedAt: date(formData.get("orderedAt")), expectedAt: date(formData.get("expectedAt")), notes: String(formData.get("notes") ?? "").trim() || null, createdById: auth.userId } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "production.create", entityType: "ProductionOrder", entityId: po.id });
  revalidatePath("/production");
  back("Ordine di produzione registrato.");
}

export async function setProductionStatusAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as ProductionStatus;
  if (!STATUSES.includes(status)) back("Stato non valido", "error");
  await db.productionOrder.updateMany({ where: { id, organizationId: auth.organizationId }, data: { status, ...(status === "RECEIVED" ? { receivedAt: new Date() } : {}) } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "production.status", entityType: "ProductionOrder", entityId: id, metadata: { status } });
  revalidatePath("/production");
  back("Stato aggiornato.");
}

export async function createExpenseAction(formData: FormData) {
  const auth = await requireAuth("ACCOUNTANT");
  const category = String(formData.get("category") ?? "OTHER") as ExpenseCategory;
  const amount = parseAmount(String(formData.get("amount") ?? ""), { decimalSeparator: "," }) ?? parseAmount(String(formData.get("amount") ?? ""));
  const description = String(formData.get("description") ?? "").trim().slice(0, 300);
  const d = date(formData.get("date"));
  if (!amount || amount.lte(0) || description.length < 2 || !d) back("Dati spesa non validi", "error", "expenses");
  const e = await db.expense.create({ data: { organizationId: auth.organizationId, category: CATEGORIES.includes(category) ? category : "OTHER", description, amount, currency: auth.currency, date: d, vendor: String(formData.get("vendor") ?? "").trim() || null, recurring: formData.get("recurring") === "on", createdById: auth.userId, createdBy: "user" } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "expense.create", entityType: "Expense", entityId: e.id, metadata: { category, amount: amount.toString() } });
  revalidatePath("/production");
  back("Spesa registrata.", "notice", "expenses");
}

export async function deleteExpenseAction(formData: FormData) {
  const auth = await requireAuth("ACCOUNTANT");
  const id = String(formData.get("id") ?? "");
  const e = await db.expense.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!e) back("Spesa non trovata", "error", "expenses");
  await db.expense.delete({ where: { id } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "expense.delete", entityType: "Expense", entityId: id, metadata: { amount: e.amount.toString(), description: e.description } });
  revalidatePath("/production");
  back("Spesa eliminata.", "notice", "expenses");
}
