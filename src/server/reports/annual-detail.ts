import { Prisma, type ExpenseCategory } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";
import { CREDIT_NOTE_TYPES } from "../invoices/fatturapa";
import { posVatAmount, saleDescription, vatSplit } from "../receipts/receipts";
import { COST_LABEL } from "./annual";

/** Every revenue and cost line of a year, with where it comes from: the detail behind the yearly summary. */

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);

export type RevenueItem = { id: string; date: Date; source: "INVOICE" | "IN_PERSON" | "SHOP"; party: string; description: string; net: string; vat: string; gross: string; collectedAt: Date | null; document: string | null; href: string | null };
export type CostItem = { id: string; date: Date; category: ExpenseCategory | "GATEWAY"; categoryLabel: string; supplier: string; description: string; net: string; document: string | null; href: string | null; paidAt: Date | null; origin: "INVOICE" | "BANK" | "MANUAL" | "GATEWAY" };
export type SupplierRow = { name: string; net: string; count: number; share: number; first: Date; last: Date; categories: string[] };
export type BankItem = { id: string; date: Date; amount: string; counterparty: string | null; description: string; explainedBy: string | null };
export type AnnualDetail = { revenue: RevenueItem[]; costs: CostItem[]; suppliers: SupplierRow[]; bank: BankItem[]; totals: { revenue: string; costs: string } };

/** "STUDIOTRENTATRE SRL" and "Studio 33" are not merged; "JERSEY LOMELLINA S.p.A." and "Jersey Lomellina" are. */
const ALIASES: Record<string, string> = { STUDIOTRENTATRE: "STUDIO 33", "STUDIO TRENTATRE": "STUDIO 33", "F LLI COLOSIO": "FRATELLI COLOSIO", "TINEXTA INFOCERT": "INFOCERT" };
export function supplierGroup(name: string) {
  const k = name.toUpperCase().replace(/\b(S\.?R\.?L\.?S?|S\.?P\.?A\.?|S\.?A\.?|UNIPERSONALE|SOCIETA'?|SSD A RL|DISTRIBUZIONE TESSILE|SERVIZI)\b/g, "").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return ALIASES[k] ?? k;
}

const GENERIC = new Set(["STUDIO", "NOTARILE", "SOCIETA", "RESPONSABILITA", "LIMITATA", "DISTRIBUZIONE", "SERVIZI", "ITALIA", "GROUP"]);
const tokens = (n: string) => new Set(n.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GENERIC.has(w)));

/** The supplier whose distinctive words appear in a bank counterparty ("STUDIO NOTARILE BENEDETTA MAZZEO" → Benedetta Mazzeo). */
export function bestSupplier<T extends { name: string }>(counterparty: string, suppliers: T[]): T | undefined {
  const cp = tokens(counterparty);
  let best: T | undefined, score = 0;
  for (const s of suppliers) {
    const hit = [...tokens(s.name)].filter((w) => cp.has(w)).length;
    if (hit > score) { best = s; score = hit; }
  }
  return best;
}

/** Among the spellings of one supplier, the one a person would write: fewest capitals, then most used. */
function displayName(names: Map<string, number>) {
  const caps = (n: string) => n.replace(/[^A-Z]/g, "").length / Math.max(1, n.replace(/[^A-Za-z]/g, "").length);
  return [...names.entries()].sort((a, b) => caps(a[0]) - caps(b[0]) || b[1] - a[1])[0]![0];
}

export async function annualDetail(organizationId: string, year: number): Promise<AnnualDetail> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const tz = org.timezone;
  const inYear = { gte: new Date(new TZDate(year, 0, 1, tz).getTime()), lt: new Date(new TZDate(year + 1, 0, 1, tz).getTime()) };

  const [active, sales, refunds, orders, expenses, fees, bank, paidInstallments] = await Promise.all([
    db.invoice.findMany({ where: { organizationId, deletedAt: null, direction: "ACTIVE", orderId: null, issueDate: inYear }, include: { installments: true, lines: { select: { description: true }, take: 3 } }, orderBy: { issueDate: "asc" } }),
    db.paymentTransaction.findMany({ where: { organizationId, deletedAt: null, ledger: "PROCESSOR", inPerson: true, status: "SUCCESS", kind: { in: ["SALE", "CAPTURE"] }, processedAt: inYear }, orderBy: { processedAt: "asc" } }),
    db.paymentTransaction.findMany({ where: { organizationId, deletedAt: null, ledger: "PROCESSOR", inPerson: true, status: "SUCCESS", kind: { in: ["REFUND", "CHARGEBACK"] }, processedAt: inYear }, orderBy: { processedAt: "asc" } }),
    db.order.findMany({ where: { organizationId, deletedAt: null, test: false, cancelledAt: null, isDemo: false, processedAt: inYear }, orderBy: { processedAt: "asc" }, select: { id: true, name: true, processedAt: true, totalPrice: true, totalTax: true, totalRefunded: true, financialStatus: true } }),
    db.expense.findMany({ where: { organizationId, date: inYear }, orderBy: { date: "asc" } }),
    db.paymentTransaction.findMany({ where: { organizationId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", fee: { not: null }, processedAt: inYear }, orderBy: { processedAt: "asc" }, select: { id: true, provider: true, processedAt: true, fee: true, amount: true } }),
    db.bankTransaction.findMany({ where: { organizationId, deletedAt: null, bookingDate: inYear }, orderBy: { bookingDate: "asc" } }),
    db.invoiceInstallment.findMany({ where: { organizationId, paidAt: inYear, invoice: { deletedAt: null } }, select: { paidAt: true, amount: true, invoice: { select: { number: true, direction: true, senderName: true, receiverName: true } } } }),
  ]);

  // ── Revenue ──
  const revenue: RevenueItem[] = [];
  for (const i of active) {
    const credit = CREDIT_NOTE_TYPES.includes(i.documentType);
    const s = credit ? -1 : 1;
    const paid = i.installments.length && i.installments.every((r) => r.paidAt) ? i.installments.map((r) => r.paidAt!).sort((a, b) => b.getTime() - a.getTime())[0]! : null;
    revenue.push({ id: i.id, date: i.issueDate, source: "INVOICE", party: i.receiverName, description: i.lines.map((l) => l.description).join("; ").slice(0, 160) || (credit ? "Nota di credito" : "Fattura"), net: D(i.taxableAmount).times(s).toFixed(2), vat: D(i.taxAmount).times(s).toFixed(2), gross: D(i.totalAmount).times(s).toFixed(2), collectedAt: paid, document: `${credit ? "Nota di credito" : "Fattura"} ${i.number}`, href: `/invoices/${i.id}` });
  }
  for (const t of sales) {
    const split = vatSplit(t.amount, posVatAmount(t.raw));
    revenue.push({ id: t.id, date: t.processedAt, source: "IN_PERSON", party: "Cliente al banco", description: saleDescription(t.raw) ?? "Incasso SumUp", net: split.net, vat: split.vat, gross: split.gross, collectedAt: t.processedAt, document: t.fiscalDocAt ? (t.fiscalDocKind === "INVOICE" ? "Fattura" : "Scontrino") + (t.fiscalDocRef ? ` ${t.fiscalDocRef}` : "") : "scontrino da fare", href: "/receipts?view=all" });
  }
  for (const t of refunds) {
    const split = vatSplit(t.amount);
    revenue.push({ id: t.id, date: t.processedAt, source: "IN_PERSON", party: "Cliente al banco", description: "Rimborso SumUp", net: `-${split.net}`, vat: `-${split.vat}`, gross: `-${split.gross}`, collectedAt: t.processedAt, document: null, href: "/payments?provider=sumup" });
  }
  for (const o of orders) {
    const gross = D(o.totalPrice).minus(D(o.totalRefunded));
    revenue.push({ id: o.id, date: o.processedAt, source: "SHOP", party: "Cliente online", description: `Ordine ${o.name}`, net: gross.minus(D(o.totalTax)).toFixed(2), vat: D(o.totalTax).toFixed(2), gross: gross.toFixed(2), collectedAt: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.financialStatus ?? "") ? o.processedAt : null, document: o.name, href: `/orders/${o.id}` });
  }
  revenue.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ── Costs ──
  const invIds = [...new Set(expenses.map((e) => e.invoiceId).filter((x): x is string => !!x))];
  const invoices = new Map((await db.invoice.findMany({ where: { id: { in: invIds } }, select: { id: true, number: true, documentType: true, installments: { select: { paidAt: true } } } })).map((i) => [i.id, i]));
  const costs: CostItem[] = expenses.map((e) => {
    const inv = e.invoiceId ? invoices.get(e.invoiceId) : undefined;
    const paid = inv && inv.installments.length && inv.installments.every((r) => r.paidAt) ? inv.installments.map((r) => r.paidAt!).sort((a, b) => b.getTime() - a.getTime())[0]! : null;
    const fromBank = !inv && /da estratto conto/.test(e.description);
    return { id: e.id, date: e.date, category: e.category, categoryLabel: COST_LABEL[e.category], supplier: e.vendor ?? "—", description: e.description.replace(/^[^—]+—\s*/, ""), net: D(e.amount).toFixed(2), document: inv ? `${CREDIT_NOTE_TYPES.includes(inv.documentType) ? "Nota di credito" : "Fattura"} ${inv.number}` : fromBank ? "Estratto conto" : null, href: inv ? `/invoices/${inv.id}` : null, paidAt: inv ? paid : fromBank ? e.date : null, origin: inv ? "INVOICE" : fromBank ? "BANK" : "MANUAL" };
  });
  for (const f of fees) costs.push({ id: f.id, date: f.processedAt, category: "GATEWAY", categoryLabel: "Commissioni sugli incassi", supplier: f.provider === "sumup" ? "SumUp" : f.provider, description: `Commissione su incasso di ${D(f.amount).toFixed(2)} €`, net: D(f.fee).toFixed(2), document: null, href: "/payments", paidAt: f.processedAt, origin: "GATEWAY" });
  costs.sort((a, b) => a.date.getTime() - b.date.getTime());
  const costTotal = costs.reduce((a, c) => a.plus(c.net), D(0));

  // ── Suppliers ──
  const groups = new Map<string, { names: Map<string, number>; net: Prisma.Decimal; count: number; first: Date; last: Date; categories: Set<string> }>();
  for (const c of costs) {
    const k = supplierGroup(c.supplier) || c.supplier;
    const g = groups.get(k) ?? { names: new Map(), net: D(0), count: 0, first: c.date, last: c.date, categories: new Set() };
    g.names.set(c.supplier, (g.names.get(c.supplier) ?? 0) + 1);
    g.net = g.net.plus(c.net); g.count++; g.categories.add(c.categoryLabel);
    if (c.date < g.first) g.first = c.date;
    if (c.date > g.last) g.last = c.date;
    groups.set(k, g);
  }
  const suppliers: SupplierRow[] = [...groups.values()].map((g) => ({ name: displayName(g.names), net: g.net.toFixed(2), count: g.count, share: costTotal.isZero() ? 0 : Number(g.net.div(costTotal).times(100).toFixed(1)), first: g.first, last: g.last, categories: [...g.categories] })).sort((a, b) => Number(b.net) - Number(a.net));

  // ── Bank: what explains each movement ──
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const paidKey = new Map<string, string>();
  for (const p of paidInstallments) paidKey.set(`${day(p.paidAt!)}|${D(p.amount).toFixed(2)}`, `${p.invoice.direction === "ACTIVE" ? "Incasso fattura" : "Fattura"} ${p.invoice.number} · ${p.invoice.direction === "ACTIVE" ? p.invoice.receiverName : p.invoice.senderName}`);
  const supplierInvoices = [...new Map(paidInstallments.filter((p) => p.invoice.direction === "PASSIVE").map((p) => [supplierGroup(p.invoice.senderName), { name: p.invoice.senderName }])).values()];
  const bankExpense = new Map(expenses.filter((e) => /da estratto conto/.test(e.description)).map((e) => [`${day(e.date)}|${D(e.amount).toFixed(2)}`, e]));
  const bankItems: BankItem[] = bank.map((b) => {
    const k = `${day(b.bookingDate)}|${D(b.amount).abs().toFixed(2)}`;
    const e = bankExpense.get(k);
    // Payments split in instalments or rounded (530 for 530,70) still belong to a known supplier invoice.
    const supplierPaid = !paidKey.get(k) && b.counterparty && Number(b.amount) < 0 ? bestSupplier(b.counterparty, supplierInvoices) : undefined;
    const explained = paidKey.get(k) ?? (e ? `${COST_LABEL[e.category]} · ${e.vendor ?? ""}`.trim() : /^COMPETENZE|^IMP\.BOLLO|SPESE E COMM|COMM\.BON|COMM\. BON|COMM\.SDD|NEXI/.test(b.description) ? "Spese del conto" : supplierPaid ? `Pagamento a ${supplierPaid.name} (fatture registrate)` : null);
    return { id: b.id, date: b.bookingDate, amount: D(b.amount).toFixed(2), counterparty: b.counterparty, description: b.description, explainedBy: explained };
  });

  return { revenue, costs, suppliers, bank: bankItems, totals: { revenue: revenue.reduce((a, r) => a.plus(r.net), D(0)).toFixed(2), costs: costTotal.toFixed(2) } };
}

/** CSV for the accountant: one line per revenue or cost item, Italian number format. */
export function detailCsv(d: AnnualDetail) {
  const n = (v: string) => v.replace(".", ",");
  const q = (s: string | null | undefined) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const date = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
  const lines = ["Tipo;Data;Categoria;Controparte;Descrizione;Imponibile;IVA;Totale;Documento;Pagato/incassato il"];
  for (const r of d.revenue) lines.push(["Ricavo", date(r.date), r.source === "INVOICE" ? "Fatture emesse" : r.source === "IN_PERSON" ? "Vendite in presenza" : "Vendite online", q(r.party), q(r.description), n(r.net), n(r.vat), n(r.gross), q(r.document), date(r.collectedAt)].join(";"));
  for (const c of d.costs) lines.push(["Costo", date(c.date), q(c.categoryLabel), q(c.supplier), q(c.description), n(c.net), "", "", q(c.document), date(c.paidAt)].join(";"));
  return "﻿" + lines.join("\n") + "\n";
}
