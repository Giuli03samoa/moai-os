import { Prisma, type PaymentKind, type PaymentStatus, type ShipmentStatus } from "@prisma/client";
import { db } from "../../db";
import type { CustomerNode, OrderNode, ProductNode } from "./queries";

const D = (v: string | number | null | undefined) => new Prisma.Decimal(v ?? 0);

export function normalizeGateway(g: string | null | undefined): string {
  const s = (g ?? "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return s || "unknown";
}

const TX_KIND: Record<string, PaymentKind | null> = {
  SALE: "SALE",
  CAPTURE: "CAPTURE",
  AUTHORIZATION: "AUTHORIZATION",
  VOID: "VOID",
  REFUND: "REFUND",
  CHANGE: "ADJUSTMENT",
  SUGGESTED_REFUND: null, // not a real money movement
};
const TX_STATUS: Record<string, PaymentStatus> = {
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  PENDING: "PENDING",
  ERROR: "ERROR",
  AWAITING_RESPONSE: "PENDING",
  UNKNOWN: "PENDING",
};

export function mapFulfillmentStatus(displayStatus: string | null, status: string): ShipmentStatus {
  switch (displayStatus) {
    case "DELIVERED":
    case "PICKED_UP":
      return "DELIVERED";
    case "IN_TRANSIT":
    case "CONFIRMED":
    case "SUBMITTED":
      return "IN_TRANSIT";
    case "OUT_FOR_DELIVERY":
    case "READY_FOR_PICKUP":
      return "OUT_FOR_DELIVERY";
    case "ATTEMPTED_DELIVERY":
    case "FAILURE":
    case "NOT_DELIVERED":
      return "EXCEPTION";
    case "CANCELED":
    case "LABEL_VOIDED":
      return "CANCELLED";
    case "LABEL_PRINTED":
    case "LABEL_PURCHASED":
      return "READY";
    case "FULFILLED":
    case "MARKED_AS_FULFILLED":
      return "IN_TRANSIT";
    default:
      if (status === "CANCELLED") return "CANCELLED";
      if (status === "ERROR" || status === "FAILURE") return "EXCEPTION";
      if (status === "SUCCESS") return "IN_TRANSIT";
      return "UNKNOWN";
  }
}

export async function upsertCustomer(organizationId: string, c: CustomerNode, opts: { storePii: boolean; isDemo?: boolean }) {
  const base = {
    ordersCount: Number(c.numberOfOrders ?? 0),
    amountSpent: D(c.amountSpent?.amount),
    currency: c.amountSpent?.currencyCode ?? null,
    sourceCreatedAt: new Date(c.createdAt),
    sourceUpdatedAt: new Date(c.updatedAt),
    syncedAt: new Date(),
    deletedAt: null,
    ...(opts.storePii ? { displayName: c.displayName ?? null, email: c.email?.toLowerCase() ?? null } : {}),
  };
  const existing = await db.customer.findUnique({ where: { organizationId_source_externalId: { organizationId, source: "SHOPIFY", externalId: c.id } } });
  if (existing?.piiRedactedAt) {
    // GDPR erasure already executed: never re-populate PII from a later sync.
    return db.customer.update({ where: { id: existing.id }, data: { ...base, displayName: null, email: null } });
  }
  return db.customer.upsert({
    where: { organizationId_source_externalId: { organizationId, source: "SHOPIFY", externalId: c.id } },
    create: { organizationId, source: "SHOPIFY", externalId: c.id, isDemo: opts.isDemo ?? false, ...base },
    update: base,
  });
}

export async function upsertOrder(organizationId: string, o: OrderNode, opts: { storeCustomerPii: boolean; isDemo?: boolean }) {
  const customerId = o.customer ? (await upsertCustomer(organizationId, o.customer, { storePii: opts.storeCustomerPii, isDemo: opts.isDemo })).id : null;
  const where = { organizationId_source_externalId: { organizationId, source: "SHOPIFY" as const, externalId: o.id } };
  const existing = await db.order.findUnique({ where, select: { id: true, sourceUpdatedAt: true } });
  // Idempotency: an update older than what we already have is a stale webhook/overlap → skip rewriting lines.
  const incomingUpdatedAt = new Date(o.updatedAt);
  if (existing && existing.sourceUpdatedAt.getTime() > incomingUpdatedAt.getTime()) return { id: existing.id, created: false, skipped: true };

  const data = {
    name: o.name,
    customerId,
    currency: o.currencyCode,
    presentmentCurrency: o.presentmentCurrencyCode,
    subtotalPrice: D(o.subtotalPriceSet.shopMoney.amount),
    totalDiscounts: D(o.totalDiscountsSet.shopMoney.amount),
    totalShipping: D(o.totalShippingPriceSet.shopMoney.amount),
    totalTax: D(o.totalTaxSet.shopMoney.amount),
    totalPrice: D(o.totalPriceSet.shopMoney.amount),
    totalRefunded: D(o.totalRefundedSet.shopMoney.amount),
    financialStatus: o.displayFinancialStatus ?? "UNKNOWN",
    fulfillmentStatus: o.displayFulfillmentStatus ?? "UNKNOWN",
    paymentGateways: o.paymentGatewayNames ?? [],
    tags: o.tags ?? [],
    test: o.test,
    processedAt: new Date(o.processedAt ?? o.createdAt),
    cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
    closedAt: o.closedAt ? new Date(o.closedAt) : null,
    sourceUpdatedAt: incomingUpdatedAt,
    syncedAt: new Date(),
    deletedAt: null,
  };

  const variantIds = o.lineItems.nodes.map((l) => l.variant?.id).filter((x): x is string => !!x);
  const variants = variantIds.length ? await db.productVariant.findMany({ where: { organizationId, source: "SHOPIFY", externalId: { in: variantIds } }, select: { id: true, externalId: true } }) : [];
  const variantByGid = new Map(variants.map((v) => [v.externalId, v.id]));

  const orderId = await db.$transaction(async (tx) => {
    const order = existing
      ? await tx.order.update({ where: { id: existing.id }, data })
      : await tx.order.create({ data: { ...data, organizationId, source: "SHOPIFY", externalId: o.id, isDemo: opts.isDemo ?? false } });

    const keepItemIds: string[] = [];
    for (const l of o.lineItems.nodes) {
      const item = await tx.orderItem.upsert({
        where: { organizationId_externalId: { organizationId, externalId: l.id } },
        create: {
          organizationId, orderId: order.id, externalId: l.id, variantId: l.variant?.id ? variantByGid.get(l.variant.id) ?? null : null,
          sku: l.sku, title: l.title, quantity: l.quantity, unitPrice: D(l.originalUnitPriceSet.shopMoney.amount), totalDiscount: D(l.totalDiscountSet.shopMoney.amount), currency: o.currencyCode,
        },
        update: { variantId: l.variant?.id ? variantByGid.get(l.variant.id) ?? null : null, sku: l.sku, title: l.title, quantity: l.quantity, unitPrice: D(l.originalUnitPriceSet.shopMoney.amount), totalDiscount: D(l.totalDiscountSet.shopMoney.amount) },
      });
      keepItemIds.push(item.id);
    }
    await tx.orderItem.deleteMany({ where: { orderId: order.id, id: { notIn: keepItemIds } } });

    // ORDER ledger: what the store recorded. Processor ledgers (fees, payouts) come from the gateway.
    for (const t of o.transactions) {
      const kind = TX_KIND[t.kind];
      if (kind === null || kind === undefined) continue;
      const provider = normalizeGateway(t.gateway ?? o.paymentGatewayNames[0]);
      const fee = t.fees?.length ? t.fees.reduce((a, f) => a.plus(D(f.amount.amount)), D(0)) : null;
      const amount = D(t.amountSet.shopMoney.amount).abs();
      const payload = {
        kind,
        status: TX_STATUS[t.status] ?? "PENDING",
        amount,
        fee,
        net: fee ? amount.minus(fee) : null,
        currency: t.amountSet.shopMoney.currencyCode,
        processedAt: new Date(t.processedAt ?? o.processedAt),
        gateway: t.gateway,
        orderId: order.id,
        orderRef: o.name,
        parentExternalId: t.parentTransaction?.id ?? null,
        syncedAt: new Date(),
        deletedAt: null,
      };
      await tx.paymentTransaction.upsert({
        where: { organizationId_provider_ledger_externalId: { organizationId, provider, ledger: "ORDER", externalId: t.id } },
        create: { organizationId, source: "SHOPIFY", ledger: "ORDER", provider, externalId: t.id, isDemo: opts.isDemo ?? false, ...payload },
        update: payload,
      });
    }

    for (const f of o.fulfillments ?? []) {
      const tracking = f.trackingInfo?.[0];
      const status = mapFulfillmentStatus(f.displayStatus, f.status);
      const payload = {
        orderId: order.id,
        shopifyFulfillmentId: f.id,
        carrier: tracking?.company ?? null,
        trackingNumber: tracking?.number ?? null,
        trackingUrl: tracking?.url ?? null,
        status,
        rawStatus: f.displayStatus ?? f.status,
        shippedAt: f.inTransitAt ? new Date(f.inTransitAt) : new Date(f.createdAt),
        deliveredAt: f.deliveredAt ? new Date(f.deliveredAt) : null,
        lastEventAt: new Date(f.updatedAt),
        problem: status === "EXCEPTION",
        problemReason: status === "EXCEPTION" ? `Stato Shopify: ${f.displayStatus ?? f.status}` : null,
        syncedAt: new Date(),
        deletedAt: null,
      };
      await tx.shipment.upsert({
        where: { organizationId_source_externalId: { organizationId, source: "SHOPIFY", externalId: f.id } },
        create: { organizationId, source: "SHOPIFY", externalId: f.id, isDemo: opts.isDemo ?? false, ...payload },
        update: payload,
      });
    }
    return order.id;
  });
  return { id: orderId, created: !existing, skipped: false };
}

export async function upsertProduct(organizationId: string, p: ProductNode, opts: { isDemo?: boolean } = {}) {
  const product = await db.product.upsert({
    where: { organizationId_source_externalId: { organizationId, source: "SHOPIFY", externalId: p.id } },
    create: { organizationId, source: "SHOPIFY", externalId: p.id, title: p.title, handle: p.handle, status: p.status, vendor: p.vendor, productType: p.productType, sourceUpdatedAt: new Date(p.updatedAt), isDemo: opts.isDemo ?? false },
    update: { title: p.title, handle: p.handle, status: p.status, vendor: p.vendor, productType: p.productType, sourceUpdatedAt: new Date(p.updatedAt), syncedAt: new Date(), deletedAt: null },
  });
  const keep: string[] = [];
  for (const v of p.variants.nodes) {
    const existing = await db.productVariant.findUnique({ where: { organizationId_source_externalId: { organizationId, source: "SHOPIFY", externalId: v.id } } });
    const variant = await db.productVariant.upsert({
      where: { organizationId_source_externalId: { organizationId, source: "SHOPIFY", externalId: v.id } },
      create: { organizationId, productId: product.id, source: "SHOPIFY", externalId: v.id, sku: v.sku, title: v.title, price: D(v.price), currency: "", inventoryQuantity: v.inventoryQuantity, inventoryTracked: v.inventoryItem?.tracked ?? null, sourceUpdatedAt: new Date(v.updatedAt), isDemo: opts.isDemo ?? false },
      update: { productId: product.id, sku: v.sku, title: v.title, price: D(v.price), inventoryQuantity: v.inventoryQuantity, inventoryTracked: v.inventoryItem?.tracked ?? null, sourceUpdatedAt: new Date(v.updatedAt), syncedAt: new Date(), deletedAt: null },
    });
    keep.push(variant.id);
    // Inventory is tracked as snapshots: a change between two syncs becomes a movement.
    if (existing && existing.inventoryQuantity !== null && v.inventoryQuantity !== null && existing.inventoryQuantity !== v.inventoryQuantity) {
      await db.inventoryMovement.upsert({
        where: { organizationId_source_externalId: { organizationId, source: "SHOPIFY", externalId: `${v.id}:${v.updatedAt}` } },
        create: { organizationId, variantId: variant.id, source: "SHOPIFY", externalId: `${v.id}:${v.updatedAt}`, quantityDelta: v.inventoryQuantity - existing.inventoryQuantity, quantityAfter: v.inventoryQuantity, reason: "SYNC_SNAPSHOT", occurredAt: new Date(v.updatedAt) },
        update: {},
      });
    }
  }
  await db.productVariant.updateMany({ where: { productId: product.id, id: { notIn: keep }, deletedAt: null }, data: { deletedAt: new Date() } });
  return product;
}
