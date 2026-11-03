import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { Range } from "../metrics/dashboard";

/** CSV for Excel (Italian locale): UTF-8 with BOM, semicolon separated, CRLF. Formulas are neutralised. */
export function toCsv(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; label: string }>): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : v instanceof Prisma.Decimal ? v.toFixed(2).replace(".", ",") : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV injection guard
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(";"), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export type ExportEntity = "orders" | "payments" | "payouts" | "invoices" | "shipments" | "reconciliations" | "bank";

export async function exportEntity(orgId: string, entity: ExportEntity, range: Range): Promise<{ filename: string; csv: string }> {
  const inRange = { gte: range.from, lte: range.to };
  const stamp = new Date().toISOString().slice(0, 10);
  switch (entity) {
    case "orders": {
      const rows = await db.order.findMany({ where: { organizationId: orgId, deletedAt: null, processedAt: inRange }, orderBy: { processedAt: "desc" }, take: 50_000 });
      return { filename: `moai-ordini-${stamp}.csv`, csv: toCsv(rows, [
        { key: "name", label: "Ordine" }, { key: "processedAt", label: "Data" }, { key: "financialStatus", label: "Stato pagamento" }, { key: "fulfillmentStatus", label: "Stato evasione" },
        { key: "subtotalPrice", label: "Subtotale" }, { key: "totalDiscounts", label: "Sconti" }, { key: "totalShipping", label: "Spedizione" }, { key: "totalTax", label: "IVA" }, { key: "totalPrice", label: "Totale" }, { key: "totalRefunded", label: "Rimborsato" },
        { key: "currency", label: "Valuta" }, { key: "paymentGateways", label: "Gateway" }, { key: "source", label: "Origine" }, { key: "syncedAt", label: "Ultimo aggiornamento" }, { key: "externalId", label: "ID esterno" },
      ]) };
    }
    case "payments": {
      const rows = await db.paymentTransaction.findMany({ where: { organizationId: orgId, deletedAt: null, processedAt: inRange }, orderBy: { processedAt: "desc" }, include: { order: { select: { name: true } } }, take: 50_000 });
      return { filename: `moai-pagamenti-${stamp}.csv`, csv: toCsv(rows.map((r) => ({ ...r, orderName: r.order?.name ?? r.orderRef })), [
        { key: "processedAt", label: "Data" }, { key: "ledger", label: "Ledger" }, { key: "provider", label: "Gateway" }, { key: "kind", label: "Tipo" }, { key: "status", label: "Stato" },
        { key: "amount", label: "Importo" }, { key: "fee", label: "Commissione" }, { key: "net", label: "Netto" }, { key: "currency", label: "Valuta" }, { key: "orderName", label: "Ordine" }, { key: "payoutExternalId", label: "Payout" }, { key: "source", label: "Origine" }, { key: "externalId", label: "ID esterno" },
      ]) };
    }
    case "payouts": {
      const rows = await db.payout.findMany({ where: { organizationId: orgId, deletedAt: null, issuedAt: inRange }, orderBy: { issuedAt: "desc" }, take: 50_000 });
      return { filename: `moai-payout-${stamp}.csv`, csv: toCsv(rows, [
        { key: "issuedAt", label: "Emesso" }, { key: "arrivalDate", label: "Accredito previsto" }, { key: "provider", label: "Gateway" }, { key: "status", label: "Stato" }, { key: "grossAmount", label: "Lordo" }, { key: "feeAmount", label: "Commissioni" }, { key: "netAmount", label: "Netto" }, { key: "currency", label: "Valuta" }, { key: "bankReference", label: "Riferimento banca" }, { key: "source", label: "Origine" }, { key: "externalId", label: "ID esterno" },
      ]) };
    }
    case "invoices": {
      const rows = await db.invoice.findMany({ where: { organizationId: orgId, deletedAt: null, issueDate: inRange }, orderBy: { issueDate: "desc" }, include: { order: { select: { name: true } } }, take: 50_000 });
      return { filename: `moai-fatture-${stamp}.csv`, csv: toCsv(rows.map((r) => ({ ...r, orderName: r.order?.name ?? "" })), [
        { key: "direction", label: "Direzione" }, { key: "documentType", label: "Tipo doc" }, { key: "number", label: "Numero" }, { key: "issueDate", label: "Data" }, { key: "senderName", label: "Cedente" }, { key: "senderVat", label: "P.IVA cedente" }, { key: "receiverName", label: "Cessionario" }, { key: "receiverVat", label: "P.IVA cessionario" },
        { key: "taxableAmount", label: "Imponibile" }, { key: "taxAmount", label: "Imposta" }, { key: "totalAmount", label: "Totale" }, { key: "currency", label: "Valuta" }, { key: "paymentStatus", label: "Pagamento" }, { key: "nextDueDate", label: "Prossima scadenza" }, { key: "sdiStatus", label: "Stato SdI" }, { key: "orderName", label: "Ordine" }, { key: "source", label: "Origine" }, { key: "filename", label: "File" },
      ]) };
    }
    case "shipments": {
      const rows = await db.shipment.findMany({ where: { organizationId: orgId, deletedAt: null, OR: [{ shippedAt: inRange }, { shippedAt: null, syncedAt: inRange }] }, orderBy: { shippedAt: "desc" }, include: { order: { select: { name: true } } }, take: 50_000 });
      return { filename: `moai-spedizioni-${stamp}.csv`, csv: toCsv(rows.map((r) => ({ ...r, orderName: r.order?.name ?? "" })), [
        { key: "orderName", label: "Ordine" }, { key: "shippedAt", label: "Spedito" }, { key: "status", label: "Stato" }, { key: "carrier", label: "Corriere" }, { key: "service", label: "Servizio" }, { key: "trackingNumber", label: "Tracking" }, { key: "packlinkReference", label: "Rif. Packlink" }, { key: "cost", label: "Costo" }, { key: "costCurrency", label: "Valuta" }, { key: "deliveredAt", label: "Consegnato" }, { key: "problem", label: "Problema" }, { key: "problemReason", label: "Motivo" }, { key: "source", label: "Origine" },
      ]) };
    }
    case "bank": {
      const rows = await db.bankTransaction.findMany({ where: { organizationId: orgId, deletedAt: null, bookingDate: inRange }, orderBy: { bookingDate: "desc" }, take: 50_000 });
      return { filename: `moai-banca-${stamp}.csv`, csv: toCsv(rows, [
        { key: "accountLabel", label: "Conto" }, { key: "bookingDate", label: "Data contabile" }, { key: "valueDate", label: "Data valuta" }, { key: "amount", label: "Importo" }, { key: "currency", label: "Valuta" }, { key: "description", label: "Descrizione" }, { key: "counterparty", label: "Controparte" }, { key: "reference", label: "Riferimento" },
      ]) };
    }
    case "reconciliations": {
      const rows = await db.reconciliation.findMany({ where: { organizationId: orgId, createdAt: inRange }, orderBy: { createdAt: "desc" }, include: { order: { select: { name: true } }, paymentTransaction: { select: { provider: true, externalId: true, amount: true } }, payout: { select: { externalId: true, netAmount: true } }, bankTransaction: { select: { description: true, amount: true } }, invoice: { select: { number: true } } }, take: 50_000 });
      return { filename: `moai-riconciliazioni-${stamp}.csv`, csv: toCsv(rows.map((r) => ({
        ...r, orderName: r.order?.name, tx: r.paymentTransaction ? `${r.paymentTransaction.provider} ${r.paymentTransaction.externalId}` : "", txAmount: r.paymentTransaction?.amount, payout: r.payout?.externalId, payoutNet: r.payout?.netAmount, bank: r.bankTransaction?.description, bankAmount: r.bankTransaction?.amount, invoice: r.invoice?.number,
      })), [
        { key: "createdAt", label: "Creata" }, { key: "type", label: "Tipo" }, { key: "status", label: "Stato" }, { key: "confidence", label: "Confidenza" }, { key: "rule", label: "Regola" }, { key: "explanation", label: "Spiegazione" }, { key: "amountDifference", label: "Differenza" },
        { key: "tx", label: "Transazione" }, { key: "txAmount", label: "Importo tx" }, { key: "orderName", label: "Ordine" }, { key: "payout", label: "Payout" }, { key: "payoutNet", label: "Netto payout" }, { key: "bank", label: "Movimento banca" }, { key: "bankAmount", label: "Importo banca" }, { key: "invoice", label: "Fattura" }, { key: "decidedAt", label: "Decisa il" },
      ]) };
    }
  }
}
