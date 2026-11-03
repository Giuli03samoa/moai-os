import type { ImportKind, Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { enqueue } from "../jobs/queue";
import { storeDocument } from "../storage";
import {
  mappingSchema, parseBank, parsePayments, parsePayouts, parseShipments, type CsvMapping, type NormalizedBank, type NormalizedPayment, type NormalizedPayout, type NormalizedShipment, type RowError,
} from "./csv-mapping";

export type ImportPreview =
  | { kind: "PAYMENTS"; rows: NormalizedPayment[]; errors: RowError[]; skipped: number; total: number; headers: string[] }
  | { kind: "PAYOUTS"; rows: NormalizedPayout[]; errors: RowError[]; skipped: number; total: number; headers: string[] }
  | { kind: "BANK"; rows: NormalizedBank[]; errors: RowError[]; skipped: number; total: number; headers: string[] }
  | { kind: "SHIPMENTS"; rows: NormalizedShipment[]; errors: RowError[]; skipped: number; total: number; headers: string[] };

export function previewCsv(text: string, rawMapping: unknown): ImportPreview {
  const m = mappingSchema.parse(rawMapping);
  switch (m.kind) {
    case "PAYMENTS": return { kind: "PAYMENTS", ...parsePayments(text, m) };
    case "PAYOUTS": return { kind: "PAYOUTS", ...parsePayouts(text, m) };
    case "BANK": return { kind: "BANK", ...parseBank(text, m) };
    case "SHIPMENTS": return { kind: "SHIPMENTS", ...parseShipments(text, m) };
  }
}

type CommitArgs = { organizationId: string; userId: string; filename: string; content: Buffer; mapping: CsvMapping; presetName?: string; provider?: string; accountLabel?: string };

/** Stores the file, writes rows idempotently (unique external ids), records an ImportBatch and triggers reconciliation. */
export async function commitCsvImport(args: CommitArgs) {
  const text = args.content.toString("utf8");
  const preview = previewCsv(text, args.mapping);
  const provider = (args.provider ?? args.mapping.provider ?? "other").toLowerCase();
  const { document } = await storeDocument({ organizationId: args.organizationId, kind: "CSV_IMPORT", filename: args.filename, mimeType: "text/csv", content: args.content, uploadedById: args.userId });
  const batch = await db.importBatch.create({
    data: { organizationId: args.organizationId, kind: preview.kind as ImportKind, provider, presetName: args.presetName, documentId: document.id, rowsTotal: preview.total, rowsSkipped: preview.skipped + preview.errors.length, errors: preview.errors.slice(0, 200) as unknown as Prisma.InputJsonValue, createdById: args.userId },
  });
  let imported = 0, updated = 0;
  const orgId = args.organizationId;

  if (preview.kind === "PAYMENTS") {
    for (const r of preview.rows) {
      const payout = r.payoutExternalId ? await db.payout.findUnique({ where: { organizationId_provider_externalId: { organizationId: orgId, provider, externalId: r.payoutExternalId } }, select: { id: true } }) : null;
      const data = { kind: r.kind, status: r.status, amount: r.amount, fee: r.fee, net: r.net, currency: r.currency, processedAt: r.processedAt, gateway: r.gateway, orderRef: r.orderRef, payoutExternalId: r.payoutExternalId, payoutId: payout?.id ?? null, parentExternalId: r.parentExternalId, raw: r.raw as Prisma.InputJsonValue, importBatchId: batch.id, syncedAt: new Date(), deletedAt: null };
      const where = { organizationId_provider_ledger_externalId: { organizationId: orgId, provider, ledger: "PROCESSOR" as const, externalId: r.externalId } };
      const existing = await db.paymentTransaction.findUnique({ where, select: { id: true } });
      if (existing) { await db.paymentTransaction.update({ where, data }); updated++; }
      else { await db.paymentTransaction.create({ data: { organizationId: orgId, source: "PAYMENT_CSV", ledger: "PROCESSOR", provider, externalId: r.externalId, ...data } }); imported++; }
    }
  } else if (preview.kind === "PAYOUTS") {
    for (const r of preview.rows) {
      const data = { status: r.status, issuedAt: r.issuedAt, arrivalDate: r.arrivalDate, grossAmount: r.grossAmount, feeAmount: r.feeAmount, netAmount: r.netAmount, currency: r.currency, bankReference: r.bankReference, importBatchId: batch.id, syncedAt: new Date(), deletedAt: null };
      const where = { organizationId_provider_externalId: { organizationId: orgId, provider, externalId: r.externalId } };
      const existing = await db.payout.findUnique({ where, select: { id: true } });
      const payout = existing ? await db.payout.update({ where, data }) : await db.payout.create({ data: { organizationId: orgId, source: "PAYMENT_CSV", provider, externalId: r.externalId, ...data } });
      existing ? updated++ : imported++;
      await db.paymentTransaction.updateMany({ where: { organizationId: orgId, provider, payoutExternalId: r.externalId, payoutId: null }, data: { payoutId: payout.id } });
    }
  } else if (preview.kind === "BANK") {
    const accountLabel = args.accountLabel?.trim() || "Conto principale";
    for (const r of preview.rows) {
      const data = { bookingDate: r.bookingDate, valueDate: r.valueDate, amount: r.amount, currency: r.currency, description: r.description, counterparty: r.counterparty, reference: r.reference, importBatchId: batch.id, syncedAt: new Date(), deletedAt: null };
      const where = { organizationId_accountLabel_externalId: { organizationId: orgId, accountLabel, externalId: r.externalId } };
      const existing = await db.bankTransaction.findUnique({ where, select: { id: true } });
      if (existing) { await db.bankTransaction.update({ where, data }); updated++; }
      else { await db.bankTransaction.create({ data: { organizationId: orgId, source: "BANK_CSV", accountLabel, externalId: r.externalId, ...data } }); imported++; }
    }
  } else {
    for (const r of preview.rows) {
      const order = r.orderRef ? await db.order.findFirst({ where: { organizationId: orgId, deletedAt: null, OR: [{ name: r.orderRef }, { name: `#${r.orderRef.replace(/^#/, "")}` }] }, select: { id: true } }) : null;
      // Prefer enriching the Shopify fulfillment that carries the same tracking number: one shipment, one row.
      const byTracking = r.trackingNumber ? await db.shipment.findFirst({ where: { organizationId: orgId, deletedAt: null, trackingNumber: r.trackingNumber, packlinkReference: null } }) : null;
      const data = { packlinkReference: r.reference, carrier: r.carrier, service: r.service, trackingNumber: r.trackingNumber, status: r.status === "UNKNOWN" && byTracking ? byTracking.status : r.status, rawStatus: r.rawStatus, shippedAt: r.shippedAt, deliveredAt: r.deliveredAt, ...(r.cost ? { cost: r.cost, costCurrency: r.currency, costSource: "PACKLINK_CSV" as const } : {}), importBatchId: batch.id, syncedAt: new Date(), deletedAt: null };
      if (byTracking) { await db.shipment.update({ where: { id: byTracking.id }, data: { ...data, orderId: byTracking.orderId ?? order?.id ?? null } }); updated++; continue; }
      const where = { organizationId_source_externalId: { organizationId: orgId, source: "PACKLINK_CSV" as const, externalId: r.reference } };
      const existing = await db.shipment.findUnique({ where, select: { id: true } });
      if (existing) { await db.shipment.update({ where, data: { ...data, orderId: order?.id ?? undefined } }); updated++; }
      else { await db.shipment.create({ data: { organizationId: orgId, source: "PACKLINK_CSV", externalId: r.reference, orderId: order?.id ?? null, ...data } }); imported++; }
    }
  }

  await db.importBatch.update({ where: { id: batch.id }, data: { rowsImported: imported, rowsUpdated: updated } });
  await audit({ organizationId: orgId, userId: args.userId, action: "import.csv", entityType: "ImportBatch", entityId: batch.id, metadata: { kind: preview.kind, provider, imported, updated, errors: preview.errors.length } });
  if (preview.kind !== "SHIPMENTS") {
    await enqueue({ organizationId: orgId, type: "reconciliation.run", dedupeKey: `reconciliation.run:${orgId}`, triggeredBy: `import:${batch.id}` });
  }
  return { batchId: batch.id, imported, updated, errors: preview.errors, skipped: preview.skipped, total: preview.total };
}
