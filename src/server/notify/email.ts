import nodemailer from "nodemailer";
import { db } from "../db";
import { audit } from "../audit";
import { loadConnection } from "../connectors/registry";
import { emailLayout, markdownToHtml } from "./markdown-html";
import { toPlainText } from "./telegram";

/** Outbound email through the SMTP connector. Nothing is sent unless the connector is CONNECTED and the option is on. */
export type SmtpSettings = { host: string; port: number; secure: boolean; user: string; pass: string; from: string; to: string };

export function smtpSettings(secrets: Record<string, string>, config: Record<string, unknown>): SmtpSettings | null {
  const host = String(config.smtpHost ?? "").trim();
  const user = String(config.smtpUser ?? "").trim();
  const to = String(config.to ?? "").trim();
  const port = Number(config.smtpPort ?? 465) || 465;
  if (!host || !user || !to || !secrets.smtpPassword) return null;
  return { host, port, secure: config.secure === undefined ? port === 465 : config.secure === true, user, pass: secrets.smtpPassword, from: String(config.from ?? "").trim() || user, to };
}

export function transporterFor(s: SmtpSettings) {
  return nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15_000 });
}

export async function emailEnabled(organizationId: string, option: "sendBriefing" | "sendCriticalAlerts" | "any"): Promise<boolean> {
  const loaded = await loadConnection(organizationId, "email");
  if (!loaded || loaded.connection.status !== "CONNECTED" || !smtpSettings(loaded.secrets, loaded.config)) return false;
  return option === "any" ? true : loaded.config[option] === true;
}

export async function sendEmail(organizationId: string, args: { subject: string; markdown: string; reason: string; userId?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadConnection(organizationId, "email");
  if (!loaded || loaded.connection.status !== "CONNECTED") return { ok: false, error: "Email non connessa" };
  const s = smtpSettings(loaded.secrets, loaded.config);
  if (!s) return { ok: false, error: "Impostazioni SMTP incomplete" };
  try {
    await transporterFor(s).sendMail({ from: s.from, to: s.to, subject: args.subject, text: toPlainText(args.markdown), html: emailLayout(args.subject, markdownToHtml(args.markdown)) });
    await db.integrationConnection.update({ where: { id: loaded.connection.id }, data: { lastSyncAt: new Date(), lastError: null } });
    await audit({ organizationId, userId: args.userId ?? null, action: "notify.email", metadata: { reason: args.reason, subject: args.subject, to: s.to } });
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await db.integrationConnection.update({ where: { id: loaded.connection.id }, data: { lastError: error } });
    return { ok: false, error };
  }
}
