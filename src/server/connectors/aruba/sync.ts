import { db } from "../../db";
import type { JobContext } from "../../jobs/types";
import { ingestInvoiceFile } from "../../invoices/archive";
import { InvoiceParseError } from "../../invoices/fatturapa";
import { markSynced, patchCursors, requireConnected } from "../registry";
import { ArubaClient, OUT_STATUS, arubaDate, type ArubaEnv, type ArubaInvoiceItem } from "./client";

const MAX_PAGES_PER_JOB = 20;
const OVERLAP_DAYS = 7;

function statusOf(item: ArubaInvoiceItem) {
  const first = item.invoices?.[0];
  const code = first?.status !== undefined && first.status !== null && /^\d+$/.test(String(first.status)) ? Number(first.status) : null;
  const description = first?.statusDescription ?? (code !== null ? OUT_STATUS[code] ?? null : typeof first?.status === "string" ? first.status : null);
  return { code, description };
}

export async function syncArubaInvoices(ctx: JobContext) {
  const loaded = await requireConnected(ctx.organizationId, "aruba");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const client = new ArubaClient({ env: (loaded.config.environment as ArubaEnv) ?? "production", username: loaded.secrets.username!, password: loaded.secrets.password!, log: ctx.log });
  const payload = ctx.payload as { full?: boolean; direction?: "out" | "in"; page?: number; startDate?: string; startedAt?: string };
  const cursors = (loaded.connection.cursors as Record<string, string>) ?? {};
  const vat = org.vatNumber?.replace(/^IT/i, "") ?? undefined;
  const startedAt = payload.startedAt ?? new Date().toISOString();

  const defaultSince = new Date(Date.UTC(new Date().getUTCFullYear() - 1, 0, 1));
  const startDate =
    payload.startDate ??
    (payload.full
      ? arubaDate(loaded.config.since ? new Date(String(loaded.config.since)) : defaultSince)
      : cursors.arubaSyncedAt
        ? arubaDate(new Date(new Date(cursors.arubaSyncedAt).getTime() - OVERLAP_DAYS * 86_400_000))
        : arubaDate(loaded.config.since ? new Date(String(loaded.config.since)) : defaultSince));

  const directions: Array<"out" | "in"> = payload.direction ? [payload.direction] : ["out", "in"];
  const stats = { listed: 0, downloaded: 0, created: 0, updated: 0, statusOnly: 0, failed: 0 };
  let pagesThisJob = 0;

  try {
    for (const dir of directions) {
      let page = payload.direction === dir ? payload.page ?? 1 : 1;
      for (;;) {
        const res = await client.findInvoices(dir, { page, size: 100, startDate, endDate: arubaDate(new Date()), country: vat ? org.countryCode : undefined, vatcode: vat });
        pagesThisJob++;
        stats.listed += res.content.length;
        for (const item of res.content) {
          try {
            const r = await processItem(ctx, client, dir, item);
            stats[r]++;
            if (r !== "statusOnly") stats.downloaded++;
          } catch (e) {
            stats.failed++;
            const msg = e instanceof InvoiceParseError ? `non leggibile: ${e.message}` : (e as Error).message;
            ctx.log(`Fattura ${item.filename} (${dir}) ${msg}`);
            if (!(e instanceof InvoiceParseError) && stats.failed > 20) throw e;
          }
        }
        ctx.log(`${dir}: pagina ${page}/${res.totalPages || 1} — ${res.content.length} documenti`);
        await ctx.checkpoint({ ...stats, direction: dir, page });
        if (res.last || res.content.length === 0 || page >= (res.totalPages || 1)) break;
        page++;
        if (pagesThisJob >= MAX_PAGES_PER_JOB) {
          await ctx.continueWith({ ...payload, direction: dir, page, startDate, startedAt });
          return { ...stats, continued: true };
        }
      }
      if (payload.direction === dir && directions.length === 1 && !payload.full && dir === "out") {
        // A continuation that finished "out" must still run "in" with the same window.
        await ctx.continueWith({ ...payload, direction: "in", page: 1, startDate, startedAt });
        return { ...stats, continued: true };
      }
    }
    await patchCursors(loaded.connection.id, { arubaSyncedAt: startedAt });
    await markSynced(loaded.connection.id);
  } catch (e) {
    await markSynced(loaded.connection.id, (e as Error).message);
    throw e;
  }
  return stats;
}

async function processItem(ctx: JobContext, client: ArubaClient, dir: "out" | "in", item: ArubaInvoiceItem): Promise<"created" | "updated" | "statusOnly"> {
  const arubaId = String(item.id);
  const { code, description } = statusOf(item);
  const existing = await db.invoice.findMany({ where: { organizationId: ctx.organizationId, arubaId }, select: { id: true, documentId: true, sdiStatusCode: true } });
  if (existing.length && existing.every((e) => e.documentId)) {
    // Already archived: refresh SdI status only (statuses move: Inviata → Consegnata → Accettata).
    if (existing.some((e) => e.sdiStatusCode !== code)) {
      await db.invoice.updateMany({ where: { organizationId: ctx.organizationId, arubaId }, data: { sdiStatusCode: code, sdiStatus: description, syncedAt: new Date() } });
    }
    return "statusOnly";
  }
  const full = item.file ? item : await client.getByFilename(dir, item.filename, true);
  if (!full.file) throw new InvoiceParseError("Aruba non ha restituito il contenuto del file");
  const content = Buffer.from(full.file, "base64");
  const result = await ingestInvoiceFile({
    organizationId: ctx.organizationId,
    filename: item.filename,
    content,
    source: "ARUBA_API",
    directionHint: dir === "out" ? "ACTIVE" : "PASSIVE",
    aruba: { id: arubaId, sdiId: item.idSdi != null ? String(item.idSdi) : null, statusCode: code, statusDescription: description },
  });
  for (const w of result.warnings) ctx.log(`${item.filename}: ${w}`);
  return result.invoices.some((i) => i.created) ? "created" : "updated";
}
