import { emailEnabled, sendEmail } from "./email";
import { sendTelegram, telegramEnabled } from "./telegram";

/** Fan-out to every notification channel the organization has enabled. Each channel is opt-in in its connector. */
export async function notifyBriefing(organizationId: string, date: string, markdown: string): Promise<string[]> {
  const sent: string[] = [];
  if (await emailEnabled(organizationId, "sendBriefing")) {
    const r = await sendEmail(organizationId, { subject: `Briefing MOAI OS · ${date}`, markdown, reason: "briefing" });
    if (r.ok) sent.push("email");
  }
  if (await telegramEnabled(organizationId, "sendBriefing")) {
    const r = await sendTelegram(organizationId, `MOAI OS · briefing ${date}\n\n${markdown}`, { reason: "briefing" });
    if (r.ok) sent.push("telegram");
  }
  return sent;
}

export async function notifyCriticalAlerts(organizationId: string, alerts: Array<{ title: string; body: string; href?: string }>): Promise<string[]> {
  if (!alerts.length) return [];
  const sent: string[] = [];
  const md = alerts.map((a) => `- **${a.title}**\n  ${a.body}`).join("\n");
  if (await emailEnabled(organizationId, "sendCriticalAlerts")) {
    const r = await sendEmail(organizationId, { subject: `MOAI OS · ${alerts.length} avvis${alerts.length === 1 ? "o critico" : "i critici"}`, markdown: `## Avvisi critici\n${md}`, reason: "monitor.critical" });
    if (r.ok) sent.push("email");
  }
  if (await telegramEnabled(organizationId, "sendCriticalAlerts")) {
    const r = await sendTelegram(organizationId, `MOAI OS · avvisi critici\n\n${alerts.map((a) => `• ${a.title}\n  ${a.body}`).join("\n\n")}`, { reason: "monitor.critical" });
    if (r.ok) sent.push("telegram");
  }
  return sent;
}
