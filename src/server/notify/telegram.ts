import { db } from "../db";
import { audit } from "../audit";
import { loadConnection } from "../connectors/registry";

/**
 * Outbound Telegram notifications (bot → the chat chosen in the Telegram connector).
 * Nothing is sent unless the connector is CONNECTED and the relevant option is enabled in its
 * configuration; every message is audited. Inbound messages are not processed (no webhook).
 */
export async function telegramEnabled(organizationId: string, option: "sendBriefing" | "sendCriticalAlerts" | "any"): Promise<boolean> {
  const loaded = await loadConnection(organizationId, "telegram");
  if (!loaded || loaded.connection.status !== "CONNECTED" || !loaded.secrets.botToken || !loaded.config.chatId) return false;
  if (option === "any") return true;
  return loaded.config[option] === true;
}

export async function sendTelegram(organizationId: string, text: string, opts: { userId?: string | null; reason: string }): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadConnection(organizationId, "telegram");
  if (!loaded || loaded.connection.status !== "CONNECTED") return { ok: false, error: "Telegram non connesso" };
  const token = loaded.secrets.botToken;
  const chatId = String(loaded.config.chatId ?? "");
  if (!token || !chatId) return { ok: false, error: "Bot token o chat id mancanti" };
  const chunks = splitMessage(toPlainText(text));
  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      await db.integrationConnection.update({ where: { id: loaded.connection.id }, data: { lastError: `sendMessage HTTP ${res.status}: ${body}` } });
      return { ok: false, error: `Telegram HTTP ${res.status}` };
    }
  }
  await db.integrationConnection.update({ where: { id: loaded.connection.id }, data: { lastSyncAt: new Date(), lastError: null } });
  await audit({ organizationId, userId: opts.userId ?? null, action: "notify.telegram", metadata: { reason: opts.reason, chars: text.length, chunks: chunks.length } });
  return { ok: true };
}

/** Telegram's MarkdownV2 is unforgiving; we send plain text and strip the most common markdown. */
export function toPlainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function splitMessage(text: string, max = 4000): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf("\n", max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}
