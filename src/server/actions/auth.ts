"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { rateLimit } from "../rate-limit";
import { decrypt, encrypt } from "../crypto";
import { hashPassword, passwordPolicyError, verifyPassword } from "../auth/password";
import { generateRecoveryCodes, hashRecoveryCodes, matchRecoveryCode, newTotpSecret, verifyTotp } from "../auth/totp";
import { clientIp, createSession, destroySession, markSessionMfaVerified, readSession } from "../auth/session";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function loginAction(formData: FormData) {
  const parsed = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(500) }).safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) fail("/login", "Inserisci email e password.");
  const email = parsed.data.email.toLowerCase().trim();
  const ip = (await clientIp()) ?? "unknown";
  if (!rateLimit(`login:${ip}`, 20, 15 * 60_000).ok || !rateLimit(`login:${email}`, 10, 15 * 60_000).ok) fail("/login", "Troppi tentativi. Riprova tra qualche minuto.");

  const user = await db.user.findUnique({ where: { email }, include: { memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } } } });
  const generic = "Credenziali non valide.";
  if (!user || user.deletedAt) {
    await audit({ action: "auth.login_failed", ip, metadata: { email, reason: "unknown_user" } });
    fail("/login", generic);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ userId: user.id, action: "auth.login_locked", ip });
    fail("/login", `Account temporaneamente bloccato. Riprova dopo le ${user.lockedUntil.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}.`);
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db.user.update({ where: { id: user.id }, data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    await audit({ userId: user.id, action: "auth.login_failed", ip, metadata: { failed } });
    fail("/login", generic);
  }
  const membership = user.memberships.find((m) => !m.organization.deletedAt);
  if (!membership) fail("/login", "Nessuna organizzazione associata a questo utente.");
  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id, membership.organizationId);
  await audit({ organizationId: membership.organizationId, userId: user.id, action: "auth.login", ip });
  redirect(user.mfaEnabledAt ? "/mfa/verify" : "/mfa/setup");
}

export async function logoutAction() {
  const s = await readSession();
  await destroySession();
  if (s) await audit({ organizationId: s.organizationId, userId: s.userId, action: "auth.logout" });
  redirect("/login");
}

/** First run only: creates the organization and its OWNER. Disabled as soon as a user exists. */
export async function setupAction(formData: FormData) {
  if ((await db.user.count()) > 0) fail("/login", "Il sistema è già inizializzato.");
  const parsed = z
    .object({ orgName: z.string().min(2).max(120), vatNumber: z.string().max(20).optional(), name: z.string().min(1).max(120), email: z.string().email(), password: z.string() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/setup", "Compila tutti i campi.");
  const pwErr = passwordPolicyError(parsed.data.password);
  if (pwErr) fail("/setup", pwErr);
  const slug = parsed.data.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
  const org = await db.organization.create({ data: { name: parsed.data.orgName, slug, vatNumber: parsed.data.vatNumber?.replace(/^IT/i, "").trim() || null } });
  const user = await db.user.create({ data: { email: parsed.data.email.toLowerCase(), name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) } });
  await db.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
  await createSession(user.id, org.id);
  await audit({ organizationId: org.id, userId: user.id, action: "auth.setup", ip: await clientIp() });
  redirect("/mfa/setup");
}

/** Returns (creating if needed) the pending TOTP secret for the current user. */
export async function getPendingTotpSecret(): Promise<{ secret: string; email: string } | null> {
  const s = await readSession();
  if (!s || s.user.mfaEnabledAt) return null;
  if (s.user.totpSecretEnc) return { secret: decrypt(s.user.totpSecretEnc), email: s.user.email };
  const secret = newTotpSecret();
  await db.user.update({ where: { id: s.userId }, data: { totpSecretEnc: encrypt(secret) } });
  return { secret, email: s.user.email };
}

export type MfaConfirmState = { error?: string; recoveryCodes?: string[] };

export async function mfaConfirmAction(_prev: MfaConfirmState, formData: FormData): Promise<MfaConfirmState> {
  const s = await readSession();
  if (!s) redirect("/login");
  if (s.user.mfaEnabledAt) redirect("/mfa/verify");
  if (!s.user.totpSecretEnc) return { error: "Secret non inizializzato: ricarica la pagina." };
  const code = String(formData.get("code") ?? "");
  if (!verifyTotp(decrypt(s.user.totpSecretEnc), code)) {
    await audit({ organizationId: s.organizationId, userId: s.userId, action: "auth.mfa_setup_failed" });
    return { error: "Codice non valido. Controlla l'orologio del telefono e riprova." };
  }
  const codes = generateRecoveryCodes();
  await db.user.update({ where: { id: s.userId }, data: { mfaEnabledAt: new Date(), recoveryCodes: await hashRecoveryCodes(codes) } });
  await markSessionMfaVerified(s.id);
  await audit({ organizationId: s.organizationId, userId: s.userId, action: "auth.mfa_enabled" });
  return { recoveryCodes: codes };
}

export async function mfaVerifyAction(formData: FormData) {
  const s = await readSession();
  if (!s) redirect("/login");
  if (!s.user.mfaEnabledAt || !s.user.totpSecretEnc) redirect("/mfa/setup");
  if (!rateLimit(`mfa:${s.userId}`, 10, 10 * 60_000).ok) fail("/mfa/verify", "Troppi tentativi. Attendi qualche minuto.");
  const code = String(formData.get("code") ?? "").trim();
  if (verifyTotp(decrypt(s.user.totpSecretEnc), code)) {
    await markSessionMfaVerified(s.id);
    await audit({ organizationId: s.organizationId, userId: s.userId, action: "auth.mfa_verified" });
    redirect("/");
  }
  const idx = await matchRecoveryCode(code, s.user.recoveryCodes);
  if (idx >= 0) {
    const remaining = s.user.recoveryCodes.filter((_, i) => i !== idx);
    await db.user.update({ where: { id: s.userId }, data: { recoveryCodes: remaining } });
    await markSessionMfaVerified(s.id);
    await audit({ organizationId: s.organizationId, userId: s.userId, action: "auth.mfa_recovery_used", metadata: { remaining: remaining.length } });
    redirect("/?notice=" + encodeURIComponent(`Codice di recupero usato: ne restano ${remaining.length}.`));
  }
  await audit({ organizationId: s.organizationId, userId: s.userId, action: "auth.mfa_failed" });
  fail("/mfa/verify", "Codice non valido.");
}
