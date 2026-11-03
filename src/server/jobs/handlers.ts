import type { JobHandler } from "./types";
import { syncShopifyCustomers, syncShopifyOrders, syncShopifyPayments, syncShopifyProducts } from "../connectors/shopify/sync";
import { syncArubaInvoices } from "../connectors/aruba/sync";
import { detectShipmentProblems, refreshPacklinkShipments } from "../connectors/packlink/sync";
import { runReconciliation } from "../reconciliation/engine";

/** Job type → handler. Adding a connector means adding entries here; nothing else changes. */
export const handlers: Record<string, JobHandler> = {
  "shopify.orders.sync": syncShopifyOrders,
  "shopify.products.sync": syncShopifyProducts,
  "shopify.customers.sync": syncShopifyCustomers,
  "shopify.payments.sync": syncShopifyPayments,
  "aruba.invoices.sync": syncArubaInvoices,
  "packlink.shipments.refresh": refreshPacklinkShipments,
  "shipments.detect_problems": detectShipmentProblems,
  "reconciliation.run": async (ctx) => {
    const r = await runReconciliation(ctx.organizationId);
    ctx.log(`Pagamenti: ${r.payments.auto} automatici, ${r.payments.suggested} da verificare su ${r.payments.examined}. Payout: ${r.payouts.auto}/${r.payouts.suggested} su ${r.payouts.examined}. Fatture esaminate: ${r.invoicesExamined}`);
    return r as unknown as Record<string, unknown>;
  },
};

export const JOB_LABELS: Record<string, string> = {
  "shopify.orders.sync": "Shopify · ordini",
  "shopify.products.sync": "Shopify · prodotti",
  "shopify.customers.sync": "Shopify · clienti",
  "shopify.payments.sync": "Shopify Payments · payout",
  "aruba.invoices.sync": "Aruba · fatture",
  "packlink.shipments.refresh": "Packlink · spedizioni",
  "shipments.detect_problems": "Spedizioni · controllo anomalie",
  "reconciliation.run": "Riconciliazione",
};
