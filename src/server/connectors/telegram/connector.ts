import type { ConnectorDefinition, VerifyResult } from "../types";

/**
 * Telegram bot used only for OUTBOUND notifications (daily briefing, critical alerts, messages the
 * agent is explicitly approved to send). No inbound processing: the bot never acts on what it receives.
 */
export const telegramConnector: ConnectorDefinition = {
  key: "telegram",
  provider: "TELEGRAM",
  displayName: "Telegram (notifiche)",
  description: "Briefing giornaliero e avvisi critici inviati dal bot MOAI OS alla tua chat.",
  secretFields: [{ name: "botToken", label: "Bot token", type: "password", required: true, help: "Da @BotFather → /newbot. Il bot deve essere avviato dalla chat di destinazione (/start)." }],
  configFields: [
    { name: "chatId", label: "Chat ID di destinazione", type: "text", required: true, help: "Il tuo chat id numerico (scrivi al bot e leggi getUpdates, oppure usa @userinfobot)." },
    { name: "sendBriefing", label: "Invia il briefing del mattino", type: "checkbox" },
    { name: "sendCriticalAlerts", label: "Invia gli avvisi critici appena rilevati", type: "checkbox" },
  ],
  jobs: [],
  notes: [
    "La verifica chiama solo getMe e getChat: non invia messaggi. Il primo invio avviene con il briefing o con un avviso critico, se attivati.",
    "L'assistente può inviare un messaggio Telegram solo tramite approvazione esplicita di una persona.",
    "Nessun messaggio ricevuto dal bot viene letto o eseguito da MOAI OS.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    const token = ctx.secrets.botToken;
    const chatId = String(ctx.config.chatId ?? "").trim();
    if (!token) return { status: "NOT_CONFIGURED", message: "Inserisci il bot token" };
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (me.status === 401 || me.status === 404) return { status: "ERROR", message: "Bot token non valido" };
    if (!me.ok) return { status: "ERROR", message: `Telegram HTTP ${me.status}` };
    const meJson = (await me.json()) as { result?: { username?: string } };
    const capabilities: Record<string, boolean | string> = { bot: meJson.result?.username ?? "ok" };
    if (!chatId) return { status: "BLOCKED", message: `Bot @${capabilities.bot} valido, manca il chat id`, blockedReason: "Chat ID mancante", capabilities };
    const chat = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    if (!chat.ok) return { status: "BLOCKED", message: "Chat non raggiungibile: avvia il bot dalla chat (/start) e ricontrolla il chat id", blockedReason: "Chat non trovata o bot non avviato", capabilities };
    const chatJson = (await chat.json()) as { result?: { type?: string; first_name?: string; title?: string } };
    capabilities.chat = `${chatJson.result?.type ?? ""} ${chatJson.result?.title ?? chatJson.result?.first_name ?? ""}`.trim();
    capabilities.sendBriefing = ctx.config.sendBriefing === true;
    capabilities.sendCriticalAlerts = ctx.config.sendCriticalAlerts === true;
    ctx.log(`Telegram bot @${capabilities.bot}, chat ${capabilities.chat}`);
    return { status: "CONNECTED", message: `Bot @${capabilities.bot} collegato alla chat ${capabilities.chat}`, capabilities };
  },
};
