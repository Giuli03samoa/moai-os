import { Prisma, type ExpenseCategory } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";
import { CREDIT_NOTE_TYPES } from "../invoices/fatturapa";
import { posVatAmount, vatSplit } from "../receipts/receipts";

/**
 * Management view of one calendar year: what came in, what went out, what is left.
 * It is NOT the statutory balance sheet (bilancio d'esercizio): no accruals, no stock valuation, no depreciation.
 * Revenue and costs are VAT excluded; the cash view is VAT included.
 */

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);

export const COST_LABEL: Record<ExpenseCategory, string> = {
  COGS: "Produzione (tessuti, confezione, accessori)",
  SAMPLES: "Campioni e sviluppo taglie",
  MARKETING: "Marketing ed eventi",
  LOGISTICS: "Logistica",
  SOFTWARE: "Software e servizi online",
  FEES: "Commissioni e canoni POS",
  PHOTOGRAPHY: "Foto e video",
  CONSULTING: "Notaio, marchio e consulenze",
  OTHER: "Rimborsi spese e altro",
};

export type MonthRow = { month: number; revenue: string; costs: string; cashIn: string; cashOut: string };

export type AnnualReport = {
  year: number;
  currency: string;
  revenue: { online: string; onlineOrders: number; inPerson: string; inPersonSales: number; invoiced: string; invoicedCount: number; total: string };
  costs: { byCategory: Array<{ category: ExpenseCategory; label: string; amount: string; count: number }>; gatewayFees: string; shipping: string; total: string };
  result: string; // revenue − costs, VAT excluded
  cash: { in: string; out: string; balance: string; inNote: string; outNote: string; bankUntil: Date | null };
  vat: { onSales: string; onPurchases: string; balance: string }; // balance > 0 = VAT credit (estimate)
  months: MonthRow[];
  missing: string[];
  sources: { invoices: number; expenses: number; bankRows: number; lastBankDate: Date | null };
};

export async function annualReport(organizationId: string, year: number): Promise<AnnualReport> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const tz = org.timezone;
  const from = new TZDate(year, 0, 1, tz);
  const to = new TZDate(year + 1, 0, 1, tz);
  const inYear = { gte: new Date(from.getTime()), lt: new Date(to.getTime()) };
  const monthOf = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(d)) - 1;

  const [orders, inPerson, inPersonRefunds, expenses, fees, shipping, payouts, passive, bankRows, lastBank, active, bank] = await Promise.all([
    db.order.findMany({ where: { organizationId, deletedAt: null, test: false, cancelledAt: null, isDemo: false, processedAt: inYear }, select: { processedAt: true, totalPrice: true, totalTax: true, totalRefunded: true } }),
    db.paymentTransaction.findMany({ where: { organizationId, deletedAt: null, ledger: "PROCESSOR", inPerson: true, status: "SUCCESS", kind: { in: ["SALE", "CAPTURE"] }, processedAt: inYear }, select: { processedAt: true, amount: true, raw: true } }),
    db.paymentTransaction.findMany({ where: { organizationId, deletedAt: null, ledger: "PROCESSOR", inPerson: true, status: "SUCCESS", kind: { in: ["REFUND", "CHARGEBACK"] }, processedAt: inYear }, select: { processedAt: true, amount: true } }),
    db.expense.findMany({ where: { organizationId, date: inYear }, select: { date: true, amount: true, category: true } }),
    db.paymentTransaction.findMany({ where: { organizationId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", fee: { not: null }, processedAt: inYear }, select: { processedAt: true, fee: true } }),
    db.shipment.findMany({ where: { organizationId, deletedAt: null, cost: { not: null }, shippedAt: inYear }, select: { shippedAt: true, cost: true } }),
    db.payout.findMany({ where: { organizationId, deletedAt: null, status: "PAID", issuedAt: inYear }, select: { issuedAt: true, netAmount: true } }),
    db.invoice.findMany({ where: { organizationId, deletedAt: null, direction: "PASSIVE", issueDate: inYear }, select: { documentType: true, totalAmount: true, taxAmount: true, installments: { select: { amount: true, paidAt: true } } } }),
    db.bankTransaction.count({ where: { organizationId, deletedAt: null, bookingDate: inYear } }),
    db.bankTransaction.findFirst({ where: { organizationId, deletedAt: null }, orderBy: { bookingDate: "desc" }, select: { bookingDate: true } }),
    // Invoices issued to business customers (not tied to a shop order, which is already counted): B2B revenue.
    db.invoice.findMany({ where: { organizationId, deletedAt: null, direction: "ACTIVE", orderId: null, issueDate: inYear }, select: { issueDate: true, documentType: true, taxableAmount: true, taxAmount: true, totalAmount: true, installments: { select: { amount: true, paidAt: true } } } }),
    db.bankTransaction.findMany({ where: { organizationId, deletedAt: null, bookingDate: inYear }, select: { bookingDate: true, amount: true } }),
  ]);

  const months = Array.from({ length: 12 }, () => ({ revenue: D(0), costs: D(0), cashIn: D(0), cashOut: D(0) }));

  // Revenue, VAT excluded.
  let online = D(0), vatSales = D(0);
  for (const o of orders) {
    const gross = D(o.totalPrice).minus(D(o.totalRefunded));
    const tax = D(o.totalTax);
    const net = gross.minus(tax);
    online = online.plus(net);
    vatSales = vatSales.plus(tax);
    months[monthOf(o.processedAt)]!.revenue = months[monthOf(o.processedAt)]!.revenue.plus(net);
  }
  let inPersonNet = D(0);
  for (const s of inPerson) {
    const split = vatSplit(s.amount, posVatAmount(s.raw));
    inPersonNet = inPersonNet.plus(split.net);
    vatSales = vatSales.plus(split.vat);
    months[monthOf(s.processedAt)]!.revenue = months[monthOf(s.processedAt)]!.revenue.plus(split.net);
  }
  let invoiced = D(0);
  for (const i of active) {
    const credit = CREDIT_NOTE_TYPES.includes(i.documentType);
    const net = credit ? D(i.taxableAmount).neg() : D(i.taxableAmount);
    invoiced = invoiced.plus(net);
    vatSales = credit ? vatSales.minus(i.taxAmount) : vatSales.plus(i.taxAmount);
    months[monthOf(i.issueDate)]!.revenue = months[monthOf(i.issueDate)]!.revenue.plus(net);
  }
  for (const r of inPersonRefunds) {
    const split = vatSplit(r.amount);
    inPersonNet = inPersonNet.minus(split.net);
    vatSales = vatSales.minus(split.vat);
    months[monthOf(r.processedAt)]!.revenue = months[monthOf(r.processedAt)]!.revenue.minus(split.net);
  }

  // Costs, VAT excluded.
  const byCat = new Map<ExpenseCategory, { amount: Prisma.Decimal; count: number }>();
  for (const e of expenses) {
    const c = byCat.get(e.category) ?? { amount: D(0), count: 0 };
    c.amount = c.amount.plus(e.amount);
    c.count++;
    byCat.set(e.category, c);
    months[monthOf(e.date)]!.costs = months[monthOf(e.date)]!.costs.plus(e.amount);
  }
  let feeTotal = D(0);
  for (const f of fees) {
    feeTotal = feeTotal.plus(D(f.fee));
    months[monthOf(f.processedAt)]!.costs = months[monthOf(f.processedAt)]!.costs.plus(D(f.fee));
  }
  let shipTotal = D(0);
  for (const s of shipping) {
    shipTotal = shipTotal.plus(D(s.cost));
    if (s.shippedAt) months[monthOf(s.shippedAt)]!.costs = months[monthOf(s.shippedAt)]!.costs.plus(D(s.cost));
  }
  const expensesTotal = [...byCat.values()].reduce((a, c) => a.plus(c.amount), D(0));
  const costsTotal = expensesTotal.plus(feeTotal).plus(shipTotal);
  const revenueTotal = online.plus(inPersonNet).plus(invoiced);

  // Cash, VAT included. The bank statement is the truth up to its last movement; after it (or without it) the
  // estimate uses payouts credited, customer invoices collected and supplier invoices paid.
  const bankUntil = bank.length ? bank.reduce((a, b) => (b.bookingDate > a ? b.bookingDate : a), bank[0]!.bookingDate) : null;
  const afterBank = (d: Date) => !bankUntil || d > bankUntil;
  let cashIn = D(0), cashOut = D(0), vatPurchases = D(0);
  for (const b of bank) {
    const m = months[monthOf(b.bookingDate)]!;
    if (D(b.amount).gte(0)) { cashIn = cashIn.plus(b.amount); m.cashIn = m.cashIn.plus(b.amount); }
    else { cashOut = cashOut.minus(b.amount); m.cashOut = m.cashOut.minus(b.amount); }
  }
  for (const p of payouts) {
    if (!afterBank(p.issuedAt)) continue;
    cashIn = cashIn.plus(p.netAmount);
    months[monthOf(p.issuedAt)]!.cashIn = months[monthOf(p.issuedAt)]!.cashIn.plus(p.netAmount);
  }
  for (const i of active) {
    for (const r of i.installments) {
      if (!r.paidAt || r.paidAt < inYear.gte || r.paidAt >= inYear.lt || !afterBank(r.paidAt)) continue;
      cashIn = cashIn.plus(r.amount);
      months[monthOf(r.paidAt)]!.cashIn = months[monthOf(r.paidAt)]!.cashIn.plus(r.amount);
    }
  }
  for (const i of passive) {
    const credit = CREDIT_NOTE_TYPES.includes(i.documentType);
    vatPurchases = credit ? vatPurchases.minus(i.taxAmount) : vatPurchases.plus(i.taxAmount);
    for (const r of i.installments) {
      if (!r.paidAt || r.paidAt < inYear.gte || r.paidAt >= inYear.lt || !afterBank(r.paidAt)) continue;
      const amt = credit ? D(r.amount).neg() : D(r.amount);
      cashOut = cashOut.plus(amt);
      months[monthOf(r.paidAt)]!.cashOut = months[monthOf(r.paidAt)]!.cashOut.plus(amt);
    }
  }

  const missing: string[] = [];
  if (bankUntil && bankUntil < new Date(Math.min(Date.now(), inYear.lt.getTime())) && Date.now() - bankUntil.getTime() > 20 * 86_400_000) missing.push(`Estratto conto dopo il ${new Intl.DateTimeFormat("it-IT", { timeZone: tz }).format(bankUntil)}: da lì in poi la cassa è stimata dalle fatture pagate e dagli accrediti.`);
  if (!bankRows) missing.push("Estratto conto della banca: senza, mancano le uscite senza fattura elettronica (tasse F24, banca, abbonamenti esteri come Shopify o pubblicità) e i versamenti dei soci.");
  if (!orders.length) missing.push("Nessun ordine online nell'anno: Shopify non ha registrato vendite (o lo storico ordini non è disponibile oltre 60 giorni).");
  missing.push("Merce ancora in magazzino: i capi prodotti e non venduti sono un costo anticipato. Nel bilancio vero il commercialista li conta come rimanenze, quindi il risultato reale è migliore di quello qui sotto.");

  return {
    year,
    currency: org.baseCurrency,
    revenue: { online: online.toFixed(2), onlineOrders: orders.length, inPerson: inPersonNet.toFixed(2), inPersonSales: inPerson.length, invoiced: invoiced.toFixed(2), invoicedCount: active.length, total: revenueTotal.toFixed(2) },
    costs: {
      byCategory: [...byCat.entries()].map(([category, c]) => ({ category, label: COST_LABEL[category], amount: c.amount.toFixed(2), count: c.count })).sort((a, b) => Number(b.amount) - Number(a.amount)),
      gatewayFees: feeTotal.toFixed(2),
      shipping: shipTotal.toFixed(2),
      total: costsTotal.toFixed(2),
    },
    result: revenueTotal.minus(costsTotal).toFixed(2),
    cash: { in: cashIn.toFixed(2), out: cashOut.toFixed(2), balance: cashIn.minus(cashOut).toFixed(2), inNote: bankUntil ? "movimenti della banca, poi incassi registrati" : "accrediti di SumUp e Shopify e fatture incassate", outNote: bankUntil ? "movimenti della banca, poi fatture pagate" : "fatture dei fornitori pagate, IVA inclusa", bankUntil },
    vat: { onSales: vatSales.toFixed(2), onPurchases: vatPurchases.toFixed(2), balance: vatPurchases.minus(vatSales).toFixed(2) },
    months: months.map((m, i) => ({ month: i, revenue: m.revenue.toFixed(2), costs: m.costs.toFixed(2), cashIn: m.cashIn.toFixed(2), cashOut: m.cashOut.toFixed(2) })),
    missing,
    sources: { invoices: passive.length, expenses: expenses.length, bankRows, lastBankDate: lastBank?.bookingDate ?? null },
  };
}
