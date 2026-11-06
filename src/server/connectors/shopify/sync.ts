import { Prisma, type PaymentKind, type PayoutStatus } from "@prisma/client";
import { db } from "../../db";
import type { JobContext } from "../../jobs/types";
import { ConnectorError } from "../types";
import { markSynced, patchCursors, requireConnected } from "../registry";
import { ShopifyClient } from "./client";
import {
  BALANCE_TRANSACTIONS, PAYOUTS, PRODUCTS, customersQuery, legacyId, ordersQuery,
  type BalanceTxResponse, type CustomersResponse, type OrdersResponse, type PayoutsResponse, type ProductsResponse,
} from "./queries";
import { upsertCustomer, upsertOrder, upsertProduct } from "./mappers";

const MAX_PAGES_PER_JOB = 40;
const OVERLAP_MS = 2 * 60_000; // re-read a small window so nothing is lost between pages/jobs

function scopes(conn: { grantedScopes: string[] }) {
  const s = new Set(conn.grantedScopes);
  return {
    orders: s.has("read_orders") || s.has("write_orders"),
    allOrders: s.has("read_all_orders"),
    products: s.has("read_products") || s.has("write_products"),
    customers: s.has("read_customers") || s.has("write_customers"),
    fulfillments: s.has("read_fulfillments") || s.has("write_fulfillments") || s.has("read_merchant_managed_fulfillment_orders") || s.has("read_assigned_fulfillment_orders"),
    // shopifyPaymentsAccount (root field) needs the *_accounts scope; payouts/balance need *_payouts.
    paymentsAccount: s.has("read_shopify_payments_accounts") || s.has("read_shopify_payments"),
    paymentsPayouts: s.has("read_shopify_payments_payouts") || s.has("read_shopify_payments"),
  };
}

export function missingPaymentScopes(conn: { grantedScopes: string[] }) {
  const sc = scopes(conn);
  return [...(!sc.paymentsAccount ? ["read_shopify_payments_accounts"] : []), ...(!sc.paymentsPayouts ? ["read_shopify_payments_payouts"] : [])];
}

function isoMinus(ts: string | Date, ms: number) {
  return new Date(new Date(ts).getTime() - ms).toISOString();
}

export async function syncShopifyOrders(ctx: JobContext) {
  const loaded = await requireConnected(ctx.organizationId, "shopify");
  const sc = scopes(loaded.connection);
  if (!sc.orders) throw new ConnectorError("Scope read_orders non concesso all'app Shopify");
  const client = new ShopifyClient(loaded, ctx.log);
  const storeCustomerPii = sc.customers && loaded.config.storeCustomerPii === true;
  const query = ordersQuery({ customers: sc.customers, customerPii: storeCustomerPii, fulfillments: sc.fulfillments });
  const cursors = (loaded.connection.cursors as Record<string, string>) ?? {};
  const payload = ctx.payload as { full?: boolean; orderId?: string; after?: string | null; since?: string };

  let filter: string | undefined;
  if (payload.orderId) filter = `id:${legacyId(payload.orderId)}`;
  else {
    const since = payload.since ?? (payload.full ? (loaded.config.ordersSince as string | undefined) : cursors.ordersUpdatedAt ?? (loaded.config.ordersSince as string | undefined));
    if (since) filter = `updated_at:>='${new Date(since).toISOString()}'`;
    if (!sc.allOrders) ctx.log("Nota: senza read_all_orders Shopify restituisce solo gli ordini degli ultimi 60 giorni.");
  }

  let after: string | null = payload.after ?? null;
  let pages = 0, created = 0, updated = 0, skipped = 0;
  let lastUpdatedAt: string | null = null;
  try {
    for (;;) {
      const res: OrdersResponse = await client.query<OrdersResponse>(query, { first: 10, after, query: filter });
      pages++;
      for (const node of res.orders.nodes) {
        const r = await upsertOrder(ctx.organizationId, node, { storeCustomerPii });
        if (r.skipped) skipped++;
        else if (r.created) created++;
        else updated++;
        lastUpdatedAt = node.updatedAt;
      }
      if (!payload.orderId && lastUpdatedAt) await patchCursors(loaded.connection.id, { ordersUpdatedAt: isoMinus(lastUpdatedAt, OVERLAP_MS) });
      await ctx.checkpoint({ pages, created, updated, skipped, after: res.orders.pageInfo.endCursor });
      ctx.log(`Pagina ${pages}: ${res.orders.nodes.length} ordini (nuovi ${created}, aggiornati ${updated}, invariati ${skipped})`);
      if (!res.orders.pageInfo.hasNextPage) break;
      after = res.orders.pageInfo.endCursor;
      if (pages >= MAX_PAGES_PER_JOB) {
        ctx.log("Limite pagine per job raggiunto: continuo in un nuovo job");
        await ctx.continueWith({ ...payload, after, since: cursors.ordersUpdatedAt ?? payload.since });
        break;
      }
    }
    await markSynced(loaded.connection.id);
  } catch (e) {
    await markSynced(loaded.connection.id, (e as Error).message);
    throw e;
  }
  return { pages, created, updated, skipped };
}

export async function syncShopifyProducts(ctx: JobContext) {
  const loaded = await requireConnected(ctx.organizationId, "shopify");
  if (!scopes(loaded.connection).products) throw new ConnectorError("Scope read_products non concesso all'app Shopify");
  const client = new ShopifyClient(loaded, ctx.log);
  const cursors = (loaded.connection.cursors as Record<string, string>) ?? {};
  const payload = ctx.payload as { full?: boolean; after?: string | null };
  // Incremental by updated_at, plus one complete pass a day: stock or settings can change without the product date moving.
  const fullDue = !cursors.productsFullAt || Date.now() - Date.parse(cursors.productsFullAt) > 24 * 3_600_000;
  const filter = !payload.full && !fullDue && cursors.productsUpdatedAt ? `updated_at:>='${cursors.productsUpdatedAt}'` : undefined;
  let after: string | null = payload.after ?? null;
  let pages = 0, products = 0, variants = 0;
  let finished = false;
  let lastUpdatedAt: string | null = null;
  for (;;) {
    const res: ProductsResponse = await client.query<ProductsResponse>(PRODUCTS, { first: 8, after, query: filter });
    pages++;
    for (const p of res.products.nodes) {
      await upsertProduct(ctx.organizationId, p);
      products++;
      variants += p.variants.nodes.length;
      lastUpdatedAt = p.updatedAt;
    }
    if (lastUpdatedAt) await patchCursors(loaded.connection.id, { productsUpdatedAt: isoMinus(lastUpdatedAt, OVERLAP_MS) });
    await ctx.checkpoint({ pages, products, variants });
    if (!res.products.pageInfo.hasNextPage) {
      finished = true;
      break;
    }
    after = res.products.pageInfo.endCursor;
    if (pages >= MAX_PAGES_PER_JOB) {
      await ctx.continueWith({ ...payload, after });
      break;
    }
  }
  if (finished && !filter) await patchCursors(loaded.connection.id, { productsFullAt: new Date().toISOString() });
  // Variants synced after an order may now be linkable.
  await db.$executeRaw`
    UPDATE "OrderItem" oi SET "variantId" = pv.id
    FROM "ProductVariant" pv
    WHERE oi."organizationId" = ${ctx.organizationId} AND oi."variantId" IS NULL AND oi.sku IS NOT NULL
      AND pv."organizationId" = oi."organizationId" AND pv.sku = oi.sku AND pv."deletedAt" IS NULL`;
  await markSynced(loaded.connection.id);
  return { pages, products, variants };
}

export async function syncShopifyCustomers(ctx: JobContext) {
  const loaded = await requireConnected(ctx.organizationId, "shopify");
  const sc = scopes(loaded.connection);
  if (!sc.customers) {
    ctx.log("Scope read_customers non concesso: i clienti vengono importati solo come riferimento anonimo dagli ordini.");
    return { skipped: true };
  }
  const client = new ShopifyClient(loaded, ctx.log);
  const storePii = loaded.config.storeCustomerPii === true;
  const cursors = (loaded.connection.cursors as Record<string, string>) ?? {};
  const payload = ctx.payload as { full?: boolean; after?: string | null };
  const filter = !payload.full && cursors.customersUpdatedAt ? `updated_at:>='${cursors.customersUpdatedAt}'` : undefined;
  let after: string | null = payload.after ?? null;
  let pages = 0, customers = 0;
  let lastUpdatedAt: string | null = null;
  for (;;) {
    const res: CustomersResponse = await client.query<CustomersResponse>(customersQuery(storePii), { first: 50, after, query: filter });
    pages++;
    for (const c of res.customers.nodes) {
      await upsertCustomer(ctx.organizationId, c, { storePii });
      customers++;
      lastUpdatedAt = c.updatedAt;
    }
    if (lastUpdatedAt) await patchCursors(loaded.connection.id, { customersUpdatedAt: isoMinus(lastUpdatedAt, OVERLAP_MS) });
    await ctx.checkpoint({ pages, customers });
    if (!res.customers.pageInfo.hasNextPage) break;
    after = res.customers.pageInfo.endCursor;
    if (pages >= MAX_PAGES_PER_JOB) {
      await ctx.continueWith({ ...payload, after });
      break;
    }
  }
  await markSynced(loaded.connection.id);
  return { pages, customers };
}

// ───────────── Shopify Payments (processor ledger) ─────────────

const PAYOUT_STATUS: Record<string, PayoutStatus> = { SCHEDULED: "SCHEDULED", IN_TRANSIT: "IN_TRANSIT", PAID: "PAID", FAILED: "FAILED", CANCELED: "CANCELED" };

/** Balance-transaction types → ledger kinds. Payout/transfer rows are money moving to the bank: tracked as Payout, not as transactions. */
export function mapBalanceType(type: string): PaymentKind | "SKIP" {
  if (/PAYOUT|TRANSFER/.test(type)) return "SKIP";
  switch (type) {
    case "CHARGE": return "SALE";
    case "REFUND": return "REFUND";
    case "DISPUTE":
    case "CHARGEBACK_HOLD":
    case "CHARGEBACK_WITHDRAWAL": return "CHARGEBACK";
    case "DISPUTE_REVERSAL":
    case "CHARGEBACK_HOLD_RELEASE": return "CHARGEBACK_REVERSAL";
    case "CHARGEBACK_FEE":
    case "BILLING_DEBIT": return "FEE";
    case "CHARGEBACK_FEE_REFUND":
    case "BILLING_DEBIT_REVERSAL": return "ADJUSTMENT";
    default: return "ADJUSTMENT";
  }
}

export async function syncShopifyPayments(ctx: JobContext) {
  const loaded = await requireConnected(ctx.organizationId, "shopify");
  const missing = missingPaymentScopes(loaded.connection);
  if (missing.length) {
    throw new ConnectorError(`Scope mancanti per Shopify Payments: ${missing.join(", ")}. Aggiungili alla versione dell'app nel Dev Dashboard, rilasciala, approva i nuovi permessi sul negozio e ripeti "Verifica connessione".`);
  }
  const client = new ShopifyClient(loaded, ctx.log);
  const cursors = (loaded.connection.cursors as Record<string, string>) ?? {};
  const payload = ctx.payload as { full?: boolean };
  const stopBefore = !payload.full && cursors.paymentsSyncedAt ? new Date(cursors.paymentsSyncedAt).getTime() - 7 * 86_400_000 : 0;
  const startedAt = new Date().toISOString();
  const orgId = ctx.organizationId;
  const provider = "shopify_payments";

  // Payouts, newest first.
  let after: string | null = null;
  let payouts = 0;
  for (let page = 0; page < 20; page++) {
    const res: PayoutsResponse = await client.query<PayoutsResponse>(PAYOUTS, { first: 50, after });
    if (!res.shopifyPaymentsAccount) throw new ConnectorError("Shopify Payments non attivo su questo negozio (shopifyPaymentsAccount nullo)");
    let reachedOld = false;
    for (const p of res.shopifyPaymentsAccount.payouts.nodes) {
      const issuedAt = new Date(p.issuedAt);
      if (issuedAt.getTime() < stopBefore) { reachedOld = true; break; }
      const s = p.summary ?? {};
      const fee = ["chargesFee", "refundsFee", "adjustmentsFee", "reservedFundsFee", "retriedPayoutsFee"].reduce((a, k) => a.plus(new Prisma.Decimal(s[k]?.amount ?? 0)), new Prisma.Decimal(0));
      const data = {
        status: PAYOUT_STATUS[p.status] ?? "SCHEDULED",
        issuedAt,
        arrivalDate: issuedAt,
        grossAmount: p.gross ? new Prisma.Decimal(p.gross.amount) : null,
        feeAmount: fee,
        netAmount: new Prisma.Decimal(p.net.amount),
        currency: p.net.currencyCode,
        syncedAt: new Date(),
        deletedAt: null,
      };
      await db.payout.upsert({
        where: { organizationId_provider_externalId: { organizationId: orgId, provider, externalId: p.id } },
        create: { organizationId: orgId, source: "PAYMENT_API", provider, externalId: p.id, ...data },
        update: data,
      });
      payouts++;
    }
    await ctx.checkpoint({ payouts });
    if (reachedOld || !res.shopifyPaymentsAccount.payouts.pageInfo.hasNextPage) break;
    after = res.shopifyPaymentsAccount.payouts.pageInfo.endCursor;
  }

  // Balance transactions (fees, nets, payout association), newest first.
  after = null;
  let transactions = 0, skippedTransfers = 0;
  for (let page = 0; page < 60; page++) {
    const res: BalanceTxResponse = await client.query<BalanceTxResponse>(BALANCE_TRANSACTIONS, { first: 100, after });
    const conn = res.shopifyPaymentsAccount?.balanceTransactions;
    if (!conn) break;
    let reachedOld = false;
    for (const t of conn.nodes) {
      const at = new Date(t.transactionDate);
      if (at.getTime() < stopBefore) { reachedOld = true; break; }
      const kind = mapBalanceType(t.type);
      if (kind === "SKIP") { skippedTransfers++; continue; }
      const payout = t.associatedPayout ? await db.payout.findUnique({ where: { organizationId_provider_externalId: { organizationId: orgId, provider, externalId: t.associatedPayout.id } }, select: { id: true } }) : null;
      const data = {
        kind,
        status: "SUCCESS" as const,
        amount: new Prisma.Decimal(t.amount.amount).abs(),
        fee: new Prisma.Decimal(t.fee.amount).abs(),
        net: new Prisma.Decimal(t.net.amount),
        currency: t.amount.currencyCode,
        processedAt: at,
        gateway: "shopify_payments",
        orderRef: t.associatedOrder?.name ?? null,
        orderTransactionExternalId: t.sourceOrderTransactionId,
        payoutExternalId: t.associatedPayout?.id ?? null,
        payoutId: payout?.id ?? null,
        raw: { type: t.type, sourceType: t.sourceType, sourceId: t.sourceId, adjustmentReason: t.adjustmentReason, test: t.test } as Prisma.InputJsonValue,
        syncedAt: new Date(),
        deletedAt: null,
      };
      await db.paymentTransaction.upsert({
        where: { organizationId_provider_ledger_externalId: { organizationId: orgId, provider, ledger: "PROCESSOR", externalId: t.id } },
        create: { organizationId: orgId, source: "PAYMENT_API", ledger: "PROCESSOR", provider, externalId: t.id, ...data },
        update: data,
      });
      transactions++;
    }
    await ctx.checkpoint({ payouts, transactions, skippedTransfers });
    if (reachedOld || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  await patchCursors(loaded.connection.id, { paymentsSyncedAt: startedAt });
  await markSynced(loaded.connection.id);
  return { payouts, transactions, skippedTransfers };
}
