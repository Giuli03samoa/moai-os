import type { ConnectorDefinition, VerifyResult } from "../types";
import { smtpSettings, transporterFor } from "../../notify/email";

/** SMTP email, outbound only: morning briefing, critical alerts, messages the agent is approved to send. */
export const emailConnector: ConnectorDefinition = {
  key: "email",
  provider: "EMAIL",
  displayName: "Email (SMTP)",
  description: "Briefing del mattino e avvisi critici nella tua casella di posta, tramite SMTP (Gmail, iCloud, Aruba, Fastmail…).",
  secretFields: [{ name: "smtpPassword", label: "Password SMTP", type: "password", required: true, help: "Gmail: Account Google → Sicurezza → Password per le app (serve la verifica in due passaggi). Mai la password normale dell'account." }],
  configFields: [
    { name: "smtpHost", label: "Server SMTP", type: "text", required: true, placeholder: "smtp.gmail.com" },
    { name: "smtpPort", label: "Porta", type: "text", placeholder: "465", help: "465 (SSL) o 587 (STARTTLS)" },
    { name: "smtpUser", label: "Utente SMTP (indirizzo)", type: "text", required: true, placeholder: "tu@gmail.com" },
    { name: "from", label: "Mittente", type: "text", placeholder: "MOAI OS <tu@gmail.com>", help: "Vuoto = l'utente SMTP" },
    { name: "to", label: "Destinatario", type: "text", required: true, placeholder: "tu@gmail.com", help: "Più indirizzi separati da virgola" },
    { name: "sendBriefing", label: "Invia il briefing del mattino", type: "checkbox" },
    { name: "sendCriticalAlerts", label: "Invia gli avvisi critici appena rilevati", type: "checkbox" },
  ],
  jobs: [],
  notes: [
    "La verifica apre la connessione SMTP e autentica, senza inviare nulla. Il primo messaggio parte con il briefing (dalle 7:00) o con un avviso critico, se attivati.",
    "L'assistente può inviare un'email solo tramite approvazione esplicita di una persona, sempre e solo al destinatario configurato qui.",
    "Nessuna lettura della casella: MOAI OS non legge le email.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    const s = smtpSettings(ctx.secrets, ctx.config);
    if (!s) return { status: "NOT_CONFIGURED", message: "Compila server, utente, password e destinatario" };
    try {
      await transporterFor(s).verify();
    } catch (e) {
      const m = (e as Error).message;
      return { status: "ERROR", message: /auth|535|534|credentials/i.test(m) ? `Autenticazione SMTP rifiutata: ${m.slice(0, 160)}` : `Connessione SMTP fallita: ${m.slice(0, 160)}` };
    }
    ctx.log(`SMTP ${s.host}:${s.port} ok per ${s.user}`);
    return { status: "CONNECTED", message: `SMTP ${s.host} pronto, destinatario ${s.to}`, capabilities: { smtp: `${s.host}:${s.port}${s.secure ? " SSL" : " STARTTLS"}`, to: s.to, sendBriefing: ctx.config.sendBriefing === true, sendCriticalAlerts: ctx.config.sendCriticalAlerts === true } };
  },
};
