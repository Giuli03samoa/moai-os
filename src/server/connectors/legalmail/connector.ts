import type { ConnectorDefinition, VerifyResult } from "../types";
import { describeImapError, imapSettings, startDateFor, withImapMailbox } from "./mailbox";

export const legalmailConnector: ConnectorDefinition = {
  key: "legalmail",
  provider: "EMAIL",
  displayName: "Legalmail (PEC)",
  description: "Copia in archivio le fatture elettroniche ricevute sulla PEC. Sola lettura: la casella non viene mai modificata.",
  secretFields: [
    { name: "username", label: "UserID Legalmail", type: "text", required: true, help: "Il codice fornito da InfoCert (es. M7B123), non l'indirizzo PEC" },
    { name: "password", label: "Password della casella", type: "password", required: true },
  ],
  configFields: [
    { name: "since", label: "Importa fatture dal", type: "date", help: "Prima data da controllare (default: 1° gennaio dell'anno scorso)" },
    { name: "imapHost", label: "Server IMAP", type: "text", placeholder: "mbox.cert.legalmail.it" },
    { name: "imapPort", label: "Porta", type: "text", placeholder: "993" },
    { name: "mailbox", label: "Cartella", type: "text", placeholder: "INBOX" },
  ],
  jobs: [
    { type: "legalmail.invoices.sync", label: "Importa fatture", description: "Controlla i messaggi nuovi e copia le fatture XML/P7M in archivio", scheduled: true },
    { type: "legalmail.invoices.sync", label: "Ricontrolla tutta la casella", description: "Riparte dalla data iniziale; le fatture già presenti non vengono duplicate", scheduled: false, manualPayload: { full: true } },
  ],
  notes: [
    "Sola lettura: la cartella è aperta in modalità EXAMINE, quindi i messaggi non vengono segnati come letti, spostati, cancellati o inviati.",
    "Di ogni messaggio MOAI OS conserva soltanto le fatture FatturaPA intestate alla tua P.IVA. Testi, altri allegati e ricevute PEC non vengono salvati.",
    "Vede solo le fatture consegnate su questa casella. Non è la conservazione a norma e non sostituisce Fatture e Corrispettivi.",
    "La firma dei file .p7m viene letta ma non verificata.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    const s = imapSettings(ctx.secrets, ctx.config);
    if (!s) return { status: "NOT_CONFIGURED", message: "Inserisci userID e password" };
    try {
      return await withImapMailbox(s, async (box) => {
        const since = startDateFor(ctx.config);
        const fromSdi = await box.countFrom("fatturapa", since).catch(() => null);
        ctx.log(`IMAP ${s.host}: cartella ${s.mailbox} aperta in sola lettura, ${box.messageCount} messaggi`);
        return { status: "CONNECTED" as const, message: `Casella aperta in sola lettura: ${box.messageCount} messaggi${fromSdi === null ? "" : `, ${fromSdi} dal Sistema di Interscambio dal ${since.toISOString().slice(0, 10)}`}`, capabilities: { readOnly: true, server: `${s.host}:${s.port}`, folder: s.mailbox, messages: String(box.messageCount), sdiMessages: fromSdi === null ? "non determinato" : String(fromSdi), writes: "nessuna, per progetto" } };
      });
    } catch (e) {
      const err = describeImapError(e);
      return { status: "ERROR", message: err.message };
    }
  },
};
