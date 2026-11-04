"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { hashPassword, passwordPolicyError, verifyPassword } from "../auth/password";

function back(msg: string, kind: "error" | "notice" = "notice"): never {
  redirect(`/settings?${kind}=${encodeURIComponent(msg)}`);
}
const ROLES: Role[] = ["OWNER", "ADMIN", "ACCOUNTANT", "OPERATIONS", "VIEWER"];

export async function updateOrgAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const parsed = z
    .object({ name: z.string().min(2).max(120), vatNumber: z.string().max(20), fiscalCode: z.string().max(20), timezone: z.string().max(60), baseCurrency: z.string().length(3) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("Dati organizzazione non validi", "error");
  try {
    new Intl.DateTimeFormat("it-IT", { timeZone: parsed.data.timezone });
  } catch {
    back("Fuso orario non valido", "error");
  }
  await db.organization.update({
    where: { id: auth.organizationId },
    data: { name: parsed.data.name, vatNumber: parsed.data.vatNumber.replace(/^IT/i, "").trim() || null, fiscalCode: parsed.data.fiscalCode.trim().toUpperCase() || null, timezone: parsed.data.timezone, baseCurrency: parsed.data.baseCurrency.toUpperCase() },
  });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "org.update", metadata: { fields: Object.keys(parsed.data) } });
  revalidatePath("/settings");
  back("Organizzazione aggiornata.");
}

export async function createUserAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const parsed = z.object({ name: z.string().min(1).max(120), email: z.string().email(), role: z.enum(["OWNER", "ADMIN", "ACCOUNTANT", "OPERATIONS", "VIEWER"]), password: z.string() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("Dati utente non validi", "error");
  if (parsed.data.role === "OWNER" && auth.role !== "OWNER") back("Solo un OWNER può creare un altro OWNER", "error");
  const err = passwordPolicyError(parsed.data.password);
  if (err) back(err, "error");
  const email = parsed.data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  const user = existing ?? (await db.user.create({ data: { email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) } }));
  await db.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: auth.organizationId } },
    create: { userId: user.id, organizationId: auth.organizationId, role: parsed.data.role },
    update: { role: parsed.data.role },
  });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "user.create", entityType: "User", entityId: user.id, metadata: { role: parsed.data.role, existed: !!existing } });
  revalidatePath("/settings");
  back(`Utente ${email} ${existing ? "aggiunto all'organizzazione" : "creato"}. Comunica la password iniziale su un canale sicuro: al primo accesso dovrà attivare la MFA.`);
}

export async function setUserRoleAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!ROLES.includes(role)) back("Ruolo non valido", "error");
  if (userId === auth.userId) back("Non puoi cambiare il tuo ruolo", "error");
  if (role === "OWNER" && auth.role !== "OWNER") back("Solo un OWNER può assegnare OWNER", "error");
  const target = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: auth.organizationId } } });
  if (!target) back("Utente non trovato", "error");
  if (target.role === "OWNER" && auth.role !== "OWNER") back("Solo un OWNER può modificare un OWNER", "error");
  await db.membership.update({ where: { id: target.id }, data: { role } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "user.role", entityType: "User", entityId: userId, metadata: { from: target.role, to: role } });
  revalidatePath("/settings");
  back("Ruolo aggiornato.");
}

export async function removeUserAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (userId === auth.userId) back("Non puoi rimuovere te stesso", "error");
  const target = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: auth.organizationId } } });
  if (!target) back("Utente non trovato", "error");
  if (target.role === "OWNER" && auth.role !== "OWNER") back("Solo un OWNER può rimuovere un OWNER", "error");
  await db.$transaction([
    db.membership.delete({ where: { id: target.id } }),
    db.session.updateMany({ where: { userId, organizationId: auth.organizationId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "user.remove", entityType: "User", entityId: userId });
  revalidatePath("/settings");
  back("Accesso revocato.");
}

/** Admin resets a colleague's MFA (lost phone). The user re-enrols at next login. */
export async function resetUserMfaAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const member = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: auth.organizationId } } });
  if (!member) back("Utente non trovato", "error");
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, totpSecretEnc: null, recoveryCodes: [] } }),
    db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "user.mfa_reset", entityType: "User", entityId: userId });
  revalidatePath("/settings");
  back("MFA azzerata: l'utente la riconfigurerà al prossimo accesso.");
}

export async function changePasswordAction(formData: FormData) {
  const auth = await requireAuth("VIEWER");
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } });
  if (!(await verifyPassword(current, user.passwordHash))) back("Password attuale errata", "error");
  const err = passwordPolicyError(next);
  if (err) back(err, "error");
  await db.user.update({ where: { id: auth.userId }, data: { passwordHash: await hashPassword(next) } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "user.password_change" });
  back("Password aggiornata.");
}

/** Removes every row flagged isDemo. Real data is never touched. */
export async function deleteDemoDataAction() {
  const auth = await requireAuth("ADMIN");
  const { deleteDemoData } = await import("../demo");
  const counts = await deleteDemoData(auth.organizationId);
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "demo.delete", metadata: counts });
  revalidatePath("/");
  back(`Dati demo eliminati: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
}

/** Creates a read-only MCP token. The plain token is shown once in the redirect notice; only its hash is stored. */
export async function createApiTokenAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const { randomToken, sha256Hex } = await import("../crypto");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || "Token MCP";
  const days = Math.min(365, Math.max(1, Number(formData.get("days") ?? 90) || 90));
  const token = `moai_${randomToken(32)}`;
  const t = await db.apiToken.create({ data: { organizationId: auth.organizationId, userId: auth.userId, name, tokenHash: sha256Hex(token), scopes: ["mcp:read"], expiresAt: new Date(Date.now() + days * 86_400_000) } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "api_token.create", entityType: "ApiToken", entityId: t.id, metadata: { name, days } });
  revalidatePath("/settings");
  redirect(`/settings?token=${encodeURIComponent(token)}&notice=${encodeURIComponent(`Token "${name}" creato: copialo ora, non verrà mostrato di nuovo.`)}`);
}

export async function revokeApiTokenAction(formData: FormData) {
  const auth = await requireAuth("ADMIN");
  const id = String(formData.get("id") ?? "");
  await db.apiToken.updateMany({ where: { id, organizationId: auth.organizationId }, data: { revokedAt: new Date() } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "api_token.revoke", entityType: "ApiToken", entityId: id });
  revalidatePath("/settings");
  back("Token revocato.");
}
