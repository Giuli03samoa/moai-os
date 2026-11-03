/**
 * DEMO DATA — fictitious, clearly labelled (isDemo=true, source=DEMO, "DEMO" badge in the UI).
 * Refuses to run unless DEMO_MODE=true. Removable from Settings → "Elimina tutti i dati demo".
 * Purpose: show every screen working end to end (orders, two payment ledgers, payouts, bank,
 * invoices, shipments, reconciliation) before real credentials are available.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "../src/server/db";
import { ingestInvoiceFile } from "../src/server/invoices/archive";
import { runReconciliation } from "../src/server/reconciliation/engine";

const D = (v: string | number) => new Prisma.Decimal(v);
const DEMO_VAT = "01234567890";

// Deterministic pseudo-random so the demo looks the same on every machine.
let seed = 20261017;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;

const CATALOG = [
  { title: "ESSENTIALS Tee", type: "ESSENTIALS", price: "49.00", sku: "ESS-TEE", colors: ["BLK", "CRO"] },
  { title: "ESSENTIALS Tee W", type: "ESSENTIALS", price: "49.00", sku: "ESS-TEE-W", colors: ["BLK", "CRO"] },
  { title: "MOTION Tee", type: "MOTION", price: "72.95", sku: "MOT-TEE", colors: ["BLK"] },
  { title: "MOTION Short", type: "MOTION", price: "79.00", sku: "MOT-SHO", colors: ["BLK", "GRA"] },
  { title: "ESSENTIALS Hoodie", type: "ESSENTIALS", price: "119.00", sku: "ESS-HOD", colors: ["BLK"] },
];
const SIZES = ["S", "M", "L", "XL"];

async function main() {
  if (process.env.DEMO_MODE !== "true") throw new Error("Rifiutato: DEMO_MODE non è true. I dati demo si creano solo in ambiente demo.");
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("Nessuna organizzazione: completa prima /setup nell'app.");
  if (await db.order.count({ where: { organizationId: org.id, isDemo: true } })) throw new Error("Dati demo già presenti: eliminali da Settings prima di rigenerarli.");
  if (!org.vatNumber) {
    await db.organization.update({ where: { id: org.id }, data: { vatNumber: DEMO_VAT } });
    console.log(`P.IVA demo ${DEMO_VAT} impostata sull'organizzazione (modificabile in Settings).`);
  } else if (org.vatNumber.replace(/^IT/i, "") !== DEMO_VAT) {
    console.log(`Attenzione: la P.IVA reale (${org.vatNumber}) differisce da quella delle fatture demo (${DEMO_VAT}): le fatture demo verranno classificate con directionHint.`);
  }
  const orgId = org.id;
  const now = Date.now();
  const DAY = 86_400_000;

  // Products & variants
  const variants: Array<{ id: string; sku: string; price: Prisma.Decimal; title: string }> = [];
  for (const c of CATALOG) {
    const product = await db.product.create({ data: { organizationId: orgId, source: "DEMO", externalId: `demo:product:${c.sku}`, title: c.title, handle: c.title.toLowerCase().replace(/\s+/g, "-"), status: "ACTIVE", vendor: "MOAI Athletics", productType: c.type, isDemo: true } });
    for (const color of c.colors) for (const size of SIZES) {
      const sku = `${c.sku}-${color}-${size}`;
      const v = await db.productVariant.create({ data: { organizationId: orgId, productId: product.id, source: "DEMO", externalId: `demo:variant:${sku}`, sku, title: `${color} / ${size}`, price: D(c.price), currency: "EUR", inventoryQuantity: Math.floor(rnd() * 40), isDemo: true } });
      variants.push({ id: v.id, sku, price: D(c.price), title: `${c.title} ${color} ${size}` });
    }
  }

  // Orders over the last 60 days with ORDER-ledger transactions and shipments
  const gateways = ["shopify_payments", "shopify_payments", "shopify_payments", "paypal", "satispay"];
  const orders: Array<{ id: string; name: string; total: Prisma.Decimal; processedAt: Date; gateway: string; txGid: string }> = [];
  for (let i = 0; i < 48; i++) {
    const n = 1001 + i;
    const processedAt = new Date(now - Math.floor(rnd() * 60) * DAY - Math.floor(rnd() * 20) * 3_600_000);
    const items = Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => ({ v: pick(variants), qty: 1 + (rnd() < 0.2 ? 1 : 0) }));
    const subtotal = items.reduce((a, it) => a.plus(it.v.price.times(it.qty)), D(0));
    const shipping = subtotal.gte(100) ? D(0) : D("6.90");
    const total = subtotal.plus(shipping);
    const tax = total.times(22).div(122).toDecimalPlaces(2);
    const gateway = pick(gateways);
    const refunded = rnd() < 0.08 ? items[0]!.v.price : D(0);
    const cancelled = rnd() < 0.03;
    const daysAgo = (now - processedAt.getTime()) / DAY;
    const fulfillment = cancelled ? "UNFULFILLED" : daysAgo < 1.5 ? "UNFULFILLED" : "FULFILLED";
    const customerId = `demo:customer:${1 + Math.floor(rnd() * 30)}`;
    const customer = await db.customer.upsert({ where: { organizationId_source_externalId: { organizationId: orgId, source: "DEMO", externalId: customerId } }, create: { organizationId: orgId, source: "DEMO", externalId: customerId, isDemo: true, ordersCount: 1 }, update: { ordersCount: { increment: 1 } } });
    const txGid = `demo:tx:${n}`;
    const order = await db.order.create({
      data: {
        organizationId: orgId, source: "DEMO", externalId: `demo:order:${n}`, name: `#${n}`, customerId: customer.id, currency: "EUR", presentmentCurrency: "EUR",
        subtotalPrice: subtotal, totalShipping: shipping, totalTax: tax, totalPrice: total, totalRefunded: refunded,
        financialStatus: cancelled ? "VOIDED" : refunded.gt(0) ? "PARTIALLY_REFUNDED" : "PAID", fulfillmentStatus: fulfillment, paymentGateways: [gateway], tags: ["demo", i % 7 === 0 ? "drop01" : "web"],
        processedAt, cancelledAt: cancelled ? processedAt : null, sourceUpdatedAt: processedAt, isDemo: true,
        items: { create: items.map((it, k) => ({ organizationId: orgId, externalId: `demo:line:${n}:${k}`, variantId: it.v.id, sku: it.v.sku, title: it.v.title, quantity: it.qty, unitPrice: it.v.price, currency: "EUR" })) },
        payments: {
          create: [
            { organizationId: orgId, source: "DEMO", ledger: "ORDER", provider: gateway, externalId: txGid, kind: "SALE", status: cancelled ? "VOIDED" : "SUCCESS", amount: total, currency: "EUR", processedAt, gateway, orderRef: `#${n}`, isDemo: true },
            ...(refunded.gt(0) ? [{ organizationId: orgId, source: "DEMO" as const, ledger: "ORDER" as const, provider: gateway, externalId: `${txGid}:refund`, kind: "REFUND" as const, status: "SUCCESS" as const, amount: refunded, currency: "EUR", processedAt: new Date(processedAt.getTime() + 3 * DAY), gateway, orderRef: `#${n}`, parentExternalId: txGid, isDemo: true }] : []),
          ],
        },
      },
    });
    if (fulfillment === "FULFILLED") {
      const shippedAt = new Date(processedAt.getTime() + DAY);
      const delivered = daysAgo > 5 && rnd() < 0.9;
      const exception = !delivered && daysAgo > 9;
      await db.shipment.create({
        data: {
          organizationId: orgId, source: "DEMO", externalId: `demo:fulfillment:${n}`, orderId: order.id, shopifyFulfillmentId: `demo:f:${n}`, packlinkReference: `IT2026DEMO${n}`, carrier: pick(["BRT", "GLS", "UPS", "Poste Italiane"]), service: "Standard",
          trackingNumber: `DEMO${n}${Math.floor(rnd() * 9000 + 1000)}`, status: delivered ? "DELIVERED" : exception ? "EXCEPTION" : "IN_TRANSIT", rawStatus: delivered ? "DELIVERED" : exception ? "INCIDENT" : "IN_TRANSIT",
          shippedAt, deliveredAt: delivered ? new Date(shippedAt.getTime() + 2 * DAY) : null, lastEventAt: delivered ? new Date(shippedAt.getTime() + 2 * DAY) : shippedAt, cost: D(pick(["5.90", "6.40", "7.90", "9.20"])), costCurrency: "EUR", costSource: "PACKLINK_CSV",
          problem: exception, problemReason: exception ? "Giacenza presso il corriere" : null, isDemo: true,
        },
      });
    }
    if (!cancelled) orders.push({ id: order.id, name: `#${n}`, total, processedAt, gateway, txGid });
  }

  // Processor ledger: Shopify Payments (exact link via orderTransactionExternalId) and PayPal (order ref), fees deducted.
  const spNets: Array<{ net: Prisma.Decimal; at: Date }> = [];
  for (const o of orders) {
    if (o.gateway === "shopify_payments") {
      const fee = o.total.times("0.019").plus("0.25").toDecimalPlaces(2);
      const net = o.total.minus(fee);
      await db.paymentTransaction.create({ data: { organizationId: orgId, source: "DEMO", ledger: "PROCESSOR", provider: "shopify_payments", externalId: `demo:bt:${o.name}`, kind: "SALE", status: "SUCCESS", amount: o.total, fee, net, currency: "EUR", processedAt: o.processedAt, gateway: "shopify_payments", orderRef: o.name, orderTransactionExternalId: o.txGid, isDemo: true } });
      spNets.push({ net, at: o.processedAt });
    } else if (o.gateway === "paypal") {
      const fee = o.total.times("0.034").plus("0.35").toDecimalPlaces(2);
      // Two of the PayPal rows deliberately lack the order reference so the UI shows a "da verificare" case.
      const missingRef = rnd() < 0.3;
      await db.paymentTransaction.create({ data: { organizationId: orgId, source: "DEMO", ledger: "PROCESSOR", provider: "paypal", externalId: `demo:pp:${o.name}`, kind: "SALE", status: "SUCCESS", amount: o.total, fee, net: o.total.minus(fee), currency: "EUR", processedAt: new Date(o.processedAt.getTime() + 60_000), gateway: "paypal", orderRef: missingRef ? null : o.name, isDemo: true } });
    }
    // satispay: no processor data → only ORDER ledger (shows "nessuna transazione gateway")
  }

  // Weekly Shopify Payments payouts + bank credits (one payout without bank credit, one credit without reference)
  const byWeek = new Map<number, Prisma.Decimal>();
  for (const s of spNets) {
    const w = Math.floor((now - s.at.getTime()) / (7 * DAY));
    byWeek.set(w, (byWeek.get(w) ?? D(0)).plus(s.net));
  }
  let k = 0;
  for (const [w, net] of [...byWeek.entries()].sort(([a], [b]) => b - a)) {
    const issuedAt = new Date(now - w * 7 * DAY);
    const arrival = new Date(issuedAt.getTime() + 2 * DAY);
    const status = w === 0 ? "IN_TRANSIT" : "PAID";
    const payout = await db.payout.create({ data: { organizationId: orgId, source: "DEMO", provider: "shopify_payments", externalId: `demo:payout:${w}`, status, issuedAt, arrivalDate: arrival, netAmount: net, currency: "EUR", isDemo: true } });
    await db.paymentTransaction.updateMany({ where: { organizationId: orgId, provider: "shopify_payments", ledger: "PROCESSOR", processedAt: { gte: new Date(issuedAt.getTime() - 7 * DAY), lt: issuedAt } }, data: { payoutId: payout.id, payoutExternalId: payout.externalId } });
    if (status === "PAID" && k !== 2) {
      await db.bankTransaction.create({ data: { organizationId: orgId, source: "DEMO", accountLabel: "Conto principale (demo)", externalId: `demo:bank:${w}`, bookingDate: arrival, valueDate: arrival, amount: net, currency: "EUR", description: k % 2 === 0 ? `BONIFICO SHOPIFY PAYMENTS RIF demo:payout:${w}` : "ACCREDITO SHOPIFY", isDemo: true } });
    }
    k++;
  }
  await db.bankTransaction.createMany({
    data: [
      { organizationId: orgId, source: "DEMO", accountLabel: "Conto principale (demo)", externalId: "demo:bank:rent", bookingDate: new Date(now - 10 * DAY), amount: D("-850.00"), currency: "EUR", description: "ADDEBITO CANONE MAGAZZINO", isDemo: true },
      { organizationId: orgId, source: "DEMO", accountLabel: "Conto principale (demo)", externalId: "demo:bank:supplier", bookingDate: new Date(now - 4 * DAY), amount: D("-610.00"), currency: "EUR", description: "BONIFICO TESSUTI NORD FATT 778", isDemo: true },
    ],
  });

  // Invoices: one active per the first two orders (XML generated from the fixture), one passive supplier invoice
  const fx = (n: string) => readFileSync(path.join(__dirname, "../tests/fixtures", n), "utf8");
  const vat = (org.vatNumber ?? DEMO_VAT).replace(/^IT/i, "");
  for (const [i, o] of orders.slice(0, 3).entries()) {
    const taxable = o.total.times(100).div(122).toDecimalPlaces(2);
    const xml = fx("fatturapa-active.xml")
      .replaceAll("01234567890", vat)
      .replace("2026/0042", `2026/${String(100 + i).padStart(4, "0")}`)
      .replaceAll("#1042", o.name)
      .replace("<Data>2026-09-15</Data>", `<Data>${new Date(o.processedAt.getTime() + DAY).toISOString().slice(0, 10)}</Data>`)
      .replace("<ImportoTotaleDocumento>89.00", `<ImportoTotaleDocumento>${o.total.toFixed(2)}`)
      .replace("<ImportoPagamento>89.00", `<ImportoPagamento>${o.total.toFixed(2)}`)
      .replace("<PrezzoUnitario>72.95", `<PrezzoUnitario>${taxable.toFixed(2)}`)
      .replace("<PrezzoTotale>72.95", `<PrezzoTotale>${taxable.toFixed(2)}`)
      .replace("<ImponibileImporto>72.95", `<ImponibileImporto>${taxable.toFixed(2)}`)
      .replace("<Imposta>16.05", `<Imposta>${o.total.minus(taxable).toFixed(2)}`);
    await ingestInvoiceFile({ organizationId: orgId, filename: `IT${vat}_demo${100 + i}.xml`, content: Buffer.from(xml), source: "DEMO", directionHint: "ACTIVE", isDemo: true });
  }
  await ingestInvoiceFile({ organizationId: orgId, filename: "IT09876543210_778.xml", content: Buffer.from(fx("fatturapa-passive.xml").replaceAll("01234567890", vat)), source: "DEMO", directionHint: "PASSIVE", isDemo: true });

  const rec = await runReconciliation(orgId);
  console.log(`Demo creato per ${org.name}: ${orders.length} ordini, ${variants.length} varianti, ${spNets.length} transazioni Shopify Payments, ${byWeek.size} payout.`);
  console.log(`Riconciliazione: pagamenti ${rec.payments.auto} auto / ${rec.payments.suggested} da verificare; payout ${rec.payouts.auto} auto / ${rec.payouts.suggested} da verificare.`);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => db.$disconnect());
