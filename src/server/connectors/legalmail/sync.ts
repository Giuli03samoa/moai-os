import { db } from "../../db";
import { redact } from "../../crypto";
import { ingestInvoiceFile } from "../../invoices/archive";
import { decodeInvoiceFile, InvoiceParseError, parseFatturaPA } from "../../invoices/fatturapa";
import { markSynced, patchCursors, requireConnected } from "../registry";
import { ConnectorError } from "../types";
import type { JobContext } from "../../jobs/types";
import { extractInvoiceFiles } from "./extract";
import { imapSettings, startDateFor, withImapMailbox, type MailSource } from "./mailbox";

const BATCH = 100;
const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

type Cursor = { uidValidity?: string; lastUid?: number };

export type Totals = { messages: number; invoicesCreated: number; invoicesKnown: number; notOurs: number; unreadable: number; tooLarge: number };

/** One slice: up to BATCH messages, ascending by UID, advancing the cursor after each message. */
export async function processMailbox(ctx: JobContext, box: MailSource, args: { connectionId: string; since: Date; cursor: Cursor; full: boolean }): Promise<{ totals: Totals; remaining: number; lastUid: number }> {
  const sameBox = args.cursor.uidValidity === box.uidValidity;
  let lastUid = !args.full && sameBox ? args.cursor.lastUid ?? 0 : Number(ctx.payload.afterUid ?? 0);
  const uids = await box.listUids({ since: args.since, afterUid: lastUid });
  const slice = uids.slice(0, BATCH);
  const totals: Totals = { messages: 0, invoicesCreated: 0, invoicesKnown: 0, notOurs: 0, unreadable: 0, tooLarge: 0 };
  for (const uid of slice) {
    if ((await box.size(uid)) > MAX_MESSAGE_BYTES) {
      totals.tooLarge++;
    } else {
      // A download failure propagates: the job retries and the cursor has not moved past this message.
      const raw = await box.download(uid);
      let files: Awaited<ReturnType<typeof extractInvoiceFiles>> = [];
      try {
        files = await extractInvoiceFiles(raw);
      } catch {
        totals.unreadable++;
      }
      for (const f of files) {
        // A file that cannot be read as an invoice is skipped for good: it must never block the mailbox.
        try {
          parseFatturaPA(decodeInvoiceFile(f.filename, f.content).xml);
        } catch {
          totals.unreadable++;
          ctx.log(`File non leggibile come fattura: ${f.filename}`);
          continue;
        }
        try {
          const r = await ingestInvoiceFile({ organizationId: ctx.organizationId, filename: f.filename, content: f.content, source: "PEC_EMAIL" });
          for (const inv of r.invoices) {
            if (inv.created) totals.invoicesCreated++;
            else totals.invoicesKnown++;
          }
        } catch (e) {
          // The only parse error left is "not addressed to this VAT number"; anything else (database, disk) retries.
          if (!(e instanceof InvoiceParseError)) throw e;
          totals.notOurs++;
        }
      }
    }
    totals.messages++;
    lastUid = uid;
    await patchCursors(args.connectionId, { uidValidity: box.uidValidity, lastUid });
  }
  return { totals, remaining: uids.length - slice.length, lastUid };
}

export type SourceOpener = <T>(s: NonNullable<ReturnType<typeof imapSettings>>, fn: (box: MailSource) => Promise<T>) => Promise<T>;

export function makeSyncHandler(open: SourceOpener = withImapMailbox) {
  return async function syncLegalmailInvoices(ctx: JobContext) {
    const { connection, secrets, config } = await requireConnected(ctx.organizationId, "legalmail");
    const s = imapSettings(secrets, config);
    if (!s) throw new ConnectorError("Legalmail: credenziali mancanti");
    const since = startDateFor(config);
    const full = ctx.payload.full === true && ctx.payload.afterUid === undefined;
    const resuming = ctx.payload.afterUid !== undefined;
    try {
      const out = await open(s, (box) => processMailbox(ctx, box, { connectionId: connection.id, since, cursor: resuming ? {} : ((connection.cursors as Cursor) ?? {}), full }));
      const previous = (ctx.payload.totals as Partial<Totals> | undefined) ?? {};
      const totals = Object.fromEntries(Object.entries(out.totals).map(([k, v]) => [k, v + (previous[k as keyof Totals] ?? 0)])) as Totals;
      ctx.log(`Legalmail: ${totals.messages} messaggi controllati, ${totals.invoicesCreated} fatture nuove, ${totals.invoicesKnown} già presenti, ${totals.notOurs} non intestate a questa P.IVA, ${totals.unreadable} non leggibili, ${totals.tooLarge} troppo grandi`);
      if (out.remaining > 0) await ctx.continueWith({ afterUid: out.lastUid, totals });
      else await markSynced(connection.id);
      return { ...totals, remaining: out.remaining };
    } catch (e) {
      await db.integrationConnection.update({ where: { id: connection.id }, data: { lastError: redact((e as Error).message).slice(0, 500) } });
      throw e;
    }
  };
}

export const syncLegalmailInvoices = makeSyncHandler();
