import { ImapFlow } from "imapflow";
import { ConnectorError } from "../types";

/**
 * Read-only access to a mailbox. The folder is opened with EXAMINE (`readOnly: true`), so the server
 * cannot change flags or contents: messages stay unread, in place, untouched. No code here moves,
 * deletes, flags or sends anything; a PEC has legal value and MOAI OS only copies invoices out of it.
 */
export type MailMeta = { uid: number; size: number };

export interface MailSource {
  uidValidity: string;
  messageCount: number;
  /** UIDs received on or after `since` and greater than `afterUid`, ascending. */
  listUids(args: { since: Date; afterUid: number }): Promise<number[]>;
  size(uid: number): Promise<number>;
  download(uid: number): Promise<Buffer>;
  countFrom(fragment: string, since: Date): Promise<number>;
}

export type ImapSettings = { host: string; port: number; username: string; password: string; mailbox: string };

export function imapSettings(secrets: Record<string, string>, config: Record<string, unknown>): ImapSettings | null {
  if (!secrets.username || !secrets.password) return null;
  return {
    host: String(config.imapHost ?? "").trim() || "mbox.cert.legalmail.it",
    port: Number(config.imapPort) || 993,
    username: secrets.username,
    password: secrets.password,
    mailbox: String(config.mailbox ?? "").trim() || "INBOX",
  };
}

export function startDateFor(config: Record<string, unknown>, now = new Date()): Date {
  const since = String(config.since ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) return new Date(`${since}T00:00:00Z`);
  return new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
}

export function describeImapError(e: unknown): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (err.authenticationFailed) return new ConnectorError("Legalmail: accesso rifiutato. Controlla userID (es. M7B123, non l'indirizzo PEC) e password, e che l'accesso da programmi di posta sia consentito.");
  if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ECONNRESET") return new ConnectorError(`Legalmail: server non raggiungibile (${err.code})`, { retryable: true, retryAfterMs: 60_000 });
  return new ConnectorError(`Legalmail: ${err.responseText ?? err.message ?? "errore IMAP"}`.slice(0, 300), { retryable: true, retryAfterMs: 60_000 });
}

type FlowLike = Pick<ImapFlow, "connect" | "mailboxOpen" | "search" | "fetchOne" | "download" | "logout" | "mailbox">;

export async function withImapMailbox<T>(s: ImapSettings, fn: (source: MailSource) => Promise<T>, make: (s: ImapSettings) => FlowLike = createFlow): Promise<T> {
  const client = make(s);
  try {
    await client.connect();
    await client.mailboxOpen(s.mailbox, { readOnly: true });
  } catch (e) {
    await client.logout().catch(() => {});
    throw describeImapError(e);
  }
  const box = client.mailbox;
  if (!box) throw new ConnectorError("Legalmail: casella non aperta");
  if (!box.readOnly) {
    await client.logout().catch(() => {});
    throw new ConnectorError("Legalmail: il server non ha aperto la casella in sola lettura: operazione interrotta.");
  }
  const source: MailSource = {
    uidValidity: String(box.uidValidity),
    messageCount: box.exists,
    async listUids({ since, afterUid }) {
      const uids = await client.search({ since }, { uid: true });
      return (uids || []).filter((u) => u > afterUid).sort((a, b) => a - b);
    },
    async size(uid) {
      const m = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
      return m ? m.size ?? 0 : 0;
    },
    async download(uid) {
      const { content } = await client.download(String(uid), undefined, { uid: true });
      if (!content) throw new ConnectorError(`Legalmail: messaggio ${uid} non scaricabile`, { retryable: true, retryAfterMs: 60_000 });
      const chunks: Buffer[] = [];
      for await (const c of content) chunks.push(Buffer.from(c as Buffer));
      return Buffer.concat(chunks);
    },
    async countFrom(fragment, since) {
      const uids = await client.search({ from: fragment, since }, { uid: true });
      return (uids || []).length;
    },
  };
  try {
    return await fn(source);
  } finally {
    await client.logout().catch(() => {});
  }
}

function createFlow(s: ImapSettings): FlowLike {
  return new ImapFlow({ host: s.host, port: s.port, secure: true, auth: { user: s.username, pass: s.password }, logger: false, disableAutoIdle: true, connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 120_000 });
}
