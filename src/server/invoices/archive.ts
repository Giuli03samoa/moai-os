import type { DataSource, InvoiceDirection, Prisma } from "@prisma/client";
import { db } from "../db";
import { storeDocument } from "../storage";
import { decodeInvoiceFile, InvoiceParseError, parseFatturaPA, type ParsedFile, type ParsedInvoice } from "./fatturapa";
import { proposeInvoiceOrderMatch } from "../reconciliation/engine";

/**
 * Searchable internal archive of FatturaPA documents.
 * NOT a substitute for "conservazione digitale a norma" (DMEF 17/06/2014): the legally
 * binding copy stays with Aruba's conservation service. We keep the original bytes,
 * a parsed read model and links to orders/payments.
 */

export type IngestResult = {
  documentId: string;
  duplicateFile: boolean;
  invoices: Array<{ id: string; number: string; direction: InvoiceDirection; created: boolean }>;
  warnings: string[];
};

export function normalizeVat(v: string | null | undefined) {
  return (v ?? "").toUpperCase().replace(/^IT/, "").replace(/\s/g, "") || null;
}

export function classifyDirection(org: { vatNumber: string | null; fiscalCode: string | null }, parsed: ParsedFile): InvoiceDirection | null {
  const orgVat = normalizeVat(org.vatNumber);
  const orgCf = (org.fiscalCode ?? "").toUpperCase() || null;
  const isSender = (orgVat && normalizeVat(parsed.sender.vat) === orgVat) || (orgCf && parsed.sender.fiscalCode?.toUpperCase() === orgCf);
  const isReceiver = (orgVat && normalizeVat(parsed.receiver.vat) === orgVat) || (orgCf && parsed.receiver.fiscalCode?.toUpperCase() === orgCf);
  if (isSender && !isReceiver) return "ACTIVE";
  if (isReceiver && !isSender) return "PASSIVE";
  return null;
}

export function invoiceDedupeKey(direction: InvoiceDirection, parsed: ParsedFile, inv: ParsedInvoice) {
  const senderId = normalizeVat(parsed.sender.vat) ?? parsed.sender.fiscalCode ?? parsed.sender.name;
  return [direction, senderId, inv.documentType, inv.number.toUpperCase(), inv.issueDate.toISOString().slice(0, 10)].join(":");
}

export async function ingestInvoiceFile(args: {
  organizationId: string;
  filename: string;
  content: Buffer;
  source: DataSource; // XML_UPLOAD | ARUBA_API | DEMO
  directionHint?: InvoiceDirection; // Aruba tells us in/out explicitly
  aruba?: { id?: string | null; sdiId?: string | null; statusCode?: number | null; statusDescription?: string | null };
  userId?: string | null;
  isDemo?: boolean;
}): Promise<IngestResult> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: args.organizationId } });
  const { xml, signed } = decodeInvoiceFile(args.filename, args.content);
  const parsed = parseFatturaPA(xml);

  const direction = args.directionHint ?? classifyDirection(org, parsed);
  if (!direction) {
    throw new InvoiceParseError(
      "Impossibile stabilire se la fattura è emessa o ricevuta: la P.IVA/CF dell'organizzazione non corrisponde né al cedente né al cessionario. Verifica la P.IVA in Impostazioni.",
    );
  }

  const { document, duplicate } = await storeDocument({
    organizationId: args.organizationId,
    kind: signed ? "INVOICE_P7M" : "INVOICE_XML",
    filename: args.filename,
    mimeType: signed ? "application/pkcs7-mime" : "application/xml",
    content: args.content,
    uploadedById: args.userId,
  });

  const result: IngestResult = { documentId: document.id, duplicateFile: duplicate, invoices: [], warnings: [] };
  if (signed) result.warnings.push("File firmato (.p7m): contenuto estratto, firma digitale NON verificata da MOAI OS.");

  for (const inv of parsed.invoices) {
    const dedupeKey = invoiceDedupeKey(direction, parsed, inv);
    const firstDue = inv.installments.map((i) => i.dueDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const data = {
      direction,
      documentType: inv.documentType,
      number: inv.number,
      issueDate: inv.issueDate,
      currency: inv.currency,
      totalAmount: inv.totalAmount,
      taxableAmount: inv.taxableAmount,
      taxAmount: inv.taxAmount,
      senderName: parsed.sender.name,
      senderVat: parsed.sender.vat,
      senderFiscalCode: parsed.sender.fiscalCode,
      senderCountry: parsed.sender.country,
      receiverName: parsed.receiver.name,
      receiverVat: parsed.receiver.vat,
      receiverFiscalCode: parsed.receiver.fiscalCode,
      receiverCountry: parsed.receiver.country,
      causale: inv.causale?.slice(0, 2000) ?? null,
      orderReference: inv.orderReference,
      filename: args.filename,
      bodyIndex: inv.bodyIndex,
      documentId: document.id,
      parseWarnings: inv.warnings,
      ...(args.aruba?.id ? { arubaId: args.aruba.id } : {}),
      ...(args.aruba?.sdiId ? { sdiId: args.aruba.sdiId } : {}),
      ...(args.aruba?.statusCode != null ? { sdiStatusCode: args.aruba.statusCode, sdiStatus: args.aruba.statusDescription ?? null } : {}),
    } satisfies Partial<Prisma.InvoiceUncheckedCreateInput>;

    const existing = await db.invoice.findUnique({
      where: { organizationId_dedupeKey: { organizationId: args.organizationId, dedupeKey } },
      include: { installments: true },
    });

    const saved = await db.$transaction(async (tx) => {
      const invoice = existing
        ? await tx.invoice.update({ where: { id: existing.id }, data: { ...data, deletedAt: null, syncedAt: new Date() } })
        : await tx.invoice.create({
            data: { ...data, organizationId: args.organizationId, source: args.source, dedupeKey, isDemo: args.isDemo ?? false },
          });
      await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
      if (inv.lines.length) {
        await tx.invoiceLine.createMany({
          data: inv.lines.map((l, i) => ({ ...l, lineNumber: Number.isFinite(l.lineNumber) ? l.lineNumber : i + 1, invoiceId: invoice.id, organizationId: args.organizationId })),
          skipDuplicates: true,
        });
      }
      // Keep manual "paidAt" decisions when re-importing the same document.
      const paidByPos = new Map(existing?.installments.map((i) => [i.position, i.paidAt]) ?? []);
      await tx.invoiceInstallment.deleteMany({ where: { invoiceId: invoice.id } });
      if (inv.installments.length) {
        await tx.invoiceInstallment.createMany({
          data: inv.installments.map((i) => ({ ...i, invoiceId: invoice.id, organizationId: args.organizationId, paidAt: paidByPos.get(i.position) ?? null })),
        });
      }
      return invoice;
    });
    await refreshInvoicePaymentStatus(saved.id);
    if (!firstDue && inv.installments.length === 0) result.warnings.push(`Fattura ${inv.number}: nessuna scadenza indicata (DatiPagamento assente).`);
    result.warnings.push(...inv.warnings.map((w) => `Fattura ${inv.number}: ${w}`));
    result.invoices.push({ id: saved.id, number: saved.number, direction, created: !existing });

    if (direction === "ACTIVE") await proposeInvoiceOrderMatch(args.organizationId, saved.id);
  }
  return result;
}

/** Derives payment status and next due date from installments. Never marks "paid" by itself. */
export async function refreshInvoicePaymentStatus(invoiceId: string) {
  const inst = await db.invoiceInstallment.findMany({ where: { invoiceId }, orderBy: { position: "asc" } });
  if (!inst.length) {
    await db.invoice.update({ where: { id: invoiceId }, data: { paymentStatus: "UNKNOWN", nextDueDate: null } });
    return;
  }
  const paid = inst.filter((i) => i.paidAt).length;
  const open = inst.filter((i) => !i.paidAt && i.dueDate).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      paymentStatus: paid === 0 ? "UNPAID" : paid === inst.length ? "PAID" : "PARTIAL",
      nextDueDate: open[0]?.dueDate ?? null,
    },
  });
}
