import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "../db";
import { randomToken, sha256Hex } from "../crypto";

export const SESSION_COOKIE = "moai_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h absolute
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h idle

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

export async function createSession(userId: string, organizationId: string) {
  const token = randomToken(32);
  const h = await headers();
  await db.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId,
      organizationId,
      mfaVerified: false,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: await clientIp(),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure whenever the app is served over HTTPS. A local production build on http://localhost keeps working.
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function readSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true, organization: true },
  });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.deletedAt || s.organization.deletedAt) return null;
  if (Date.now() - s.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) return null;
  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: s.userId, organizationId: s.organizationId } },
  });
  if (!membership) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  }
  return { ...s, role: membership.role };
}

export async function markSessionMfaVerified(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.updateMany({ where: { tokenHash: sha256Hex(token) }, data: { revokedAt: new Date() } });
  jar.delete(SESSION_COOKIE);
}

export type AuthContext = {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string;
  orgName: string;
  timezone: string;
  currency: string;
};

const RANK: Record<Role, number> = { VIEWER: 0, OPERATIONS: 1, ACCOUNTANT: 2, ADMIN: 3, OWNER: 4 };

/**
 * Every page/action behind the login calls this. It enforces: valid session, MFA completed,
 * and a minimum role. The organizationId returned is the ONLY tenant id business queries may use.
 */
export async function requireAuth(minRole: Role = "VIEWER"): Promise<AuthContext> {
  const s = await readSession();
  if (!s) redirect("/login");
  if (!s.user.mfaEnabledAt) redirect("/mfa/setup");
  if (!s.mfaVerified) redirect("/mfa/verify");
  if (RANK[s.role] < RANK[minRole]) throw new Error("Permesso negato: ruolo insufficiente");
  return {
    userId: s.userId,
    organizationId: s.organizationId,
    role: s.role,
    email: s.user.email,
    name: s.user.name,
    orgName: s.organization.name,
    timezone: s.organization.timezone,
    currency: s.organization.baseCurrency,
  };
}

export function hasRole(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}
