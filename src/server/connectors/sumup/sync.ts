import { db } from "../../db";
import type { JobContext } from "../../jobs/types";
import { markSynced, patchCursors, requireConnected } from "../registry";
import { SumUpClient, type SumUpTransaction } from "./client";
import { groupPayouts, mapTransaction } from "./map";

const PROVIDER = "sumup";
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function syncStart(config: Record<string, unknown>): Date {
  const raw = String(config.syncFrom ?? "").trim();
  const d = raw ? new Date(`${raw}T00:00:00Z`) : new Date(NaN);
  return Number.isNaN(d.getTime()) ? new Date(Date.now() - 90 * DAY) : d;
}

/**
 * Reads SumUp sales, refunds, fees and payouts into the gateway ledger. READ ONLY: nothing is ever
 * written to SumUp. Face-to-face sales are flagged `inPerson` so they are never matched to online orders.
 */
export async function syncSumUp(ctx: JobContext) {
  const loaded = await requireConnected(ctx.organizationId, PROVIDER);
  const orgId = ctx.organizationId;
  const merchantCode = String(loaded.config.merchantCode ?? "").trim();
  const client = new SumUpClient({ apiKey: loaded.secrets.apiKey!, merchantCode, log: ctx.log });
  const cursors = (loaded.connection.cursors as Record<string, string>) ?? {};
  const full = ctx.payload.full === true;
  const startedAt = new Date();
  const from = syncStart(loaded.config);
  // Overlap the cursor by one hour: changes_since is inclusive and clocks differ.
  const changesSince = !full && cursors.changesSince ? new Date(Date.parse(cursors.changesSince) - 3_600_000) : undefined;

  let transactions = 0, details = 0, skipped = 0;
  for await (const page of client.history({ oldestTime: from, changesSince })) {
    for (const item of page) {
      if (item.timestamp && new Date(item.timestamp) < from) { skipped++; continue; }
      const id = item.id ?? item.transaction_id;
      if (!id) { skipped++; continue; }
      const existing = await db.paymentTransaction.findUnique({ where: { organizationId_provider_ledger_externalId: { organizationId: orgId, provider: PROVIDER, ledger: "PROCESSOR", externalId: id } }, select: { fee: true, payoutId: true, payoutExternalId: true, net: true } });
      // Fee, VAT and product lines live only in the detail: fetch it once per successful sale.
      let detail: SumUpTransaction | null = null;
      const successful = item.status === "SUCCESSFUL" || item.status === "REFUNDED";
      if (successful && (!existing || existing.fee === null) && details < 300) {
        try {
          detail = await client.getTransaction(id);
          details++;
        } catch (e) {
          ctx.log(`Dettaglio non disponibile per ${item.transaction_code ?? id}: ${(e as Error).message}`);
        }
      }
      const m = mapTransaction(item, detail);
      if (!m) { skipped++; continue; }
      const { externalId, raw, fee, net, ...rest } = m;
      const data = { ...rest, ...(fee ? { fee, net } : {}), ...(detail || !existing ? { raw } : {}), syncedAt: new Date(), deletedAt: null };
      await db.paymentTransaction.upsert({
        where: { organizationId_provider_ledger_externalId: { organizationId: orgId, provider: PROVIDER, ledger: "PROCESSOR", externalId } },
        create: { organizationId: orgId, source: "PAYMENT_API", ledger: "PROCESSOR", provider: PROVIDER, externalId, ...rest, fee, net, raw },
        update: data,
      });
      transactions++;
    }
    await ctx.checkpoint({ transactions, details });
  }

  // Payouts: re-read a rolling window (records arrive days after the sale), in 30-day slices.
  const payoutFrom = full || !cursors.payoutsThrough ? from : new Date(Math.max(from.getTime(), Date.parse(cursors.payoutsThrough) - 21 * DAY));
  let payouts = 0, linked = 0;
  for (let a = payoutFrom; a <= startedAt; a = new Date(a.getTime() + 30 * DAY)) {
    const b = new Date(Math.min(a.getTime() + 29 * DAY, startedAt.getTime()));
    const records = await client.listPayouts(ymd(a), ymd(b));
    for (const p of groupPayouts(Array.isArray(records) ? records : [])) {
      const { transactions: txs, externalId, ...data } = p;
      const row = await db.payout.upsert({
        where: { organizationId_provider_externalId: { organizationId: orgId, provider: PROVIDER, externalId } },
        create: { organizationId: orgId, source: "PAYMENT_API", provider: PROVIDER, externalId, ...data },
        update: { ...data, syncedAt: new Date(), deletedAt: null },
      });
      payouts++;
      for (const t of txs) {
        const tx = await db.paymentTransaction.findFirst({ where: { organizationId: orgId, provider: PROVIDER, ledger: "PROCESSOR", orderRef: t.transactionCode, kind: "SALE" }, select: { id: true, amount: true, fee: true } });
        if (!tx) continue;
        await db.paymentTransaction.update({ where: { id: tx.id }, data: { payoutId: row.id, payoutExternalId: externalId, ...(tx.fee === null ? { fee: t.fee, net: tx.amount.minus(t.fee) } : {}) } });
        linked++;
      }
    }
  }

  await patchCursors(loaded.connection.id, { changesSince: startedAt.toISOString(), payoutsThrough: startedAt.toISOString() });
  await markSynced(loaded.connection.id);
  ctx.log(`SumUp: ${transactions} transazioni (${details} con dettaglio), ${payouts} accrediti, ${linked} vendite collegate a un accredito${skipped ? `, ${skipped} saltate` : ""}`);
  return { transactions, details, payouts, linked, skipped };
}
