import { Prisma } from "@prisma/client";
import { db } from "../../db";
import type { JobContext } from "../../jobs/types";
import { parseAmount } from "../../money";
import { ConnectorError, sleep } from "../types";
import { markSynced, requireConnected } from "../registry";
import { PacklinkClient, mapPacklinkState, type PacklinkEnv } from "./client";

const DAY = 86_400_000;

/** Re-reads open shipments that carry a Packlink reference. Never creates shipments. */
export async function refreshPacklinkShipments(ctx: JobContext) {
  const loaded = await requireConnected(ctx.organizationId, "packlink");
  const client = new PacklinkClient({ apiKey: loaded.secrets.apiKey!, env: (loaded.config.environment as PacklinkEnv) ?? "production", log: ctx.log });
  const shipments = await db.shipment.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null, packlinkReference: { not: null }, status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED"] } },
    orderBy: { lastEventAt: "asc" },
    take: 200,
  });
  let updated = 0, failed = 0;
  let capabilityRecorded = false;
  for (const s of shipments) {
    try {
      const p = await client.getShipment(s.packlinkReference!);
      const status = mapPacklinkState(p.state ?? p.status);
      const tracking = p.trackings?.[0] ?? p.tracking_codes?.[0] ?? null;
      const price = typeof p.price === "object" && p.price ? p.price.total_price ?? p.price.base_price : p.price;
      const cost = parseAmount(price as string | number | undefined);
      let lastEventAt: Date | null = null;
      let trackingCapability: string | boolean = false;
      try {
        const events = await client.getTracking(s.packlinkReference!);
        const ts = events.map((e) => (e.timestamp ? new Date(e.timestamp).getTime() : NaN)).filter((t) => !Number.isNaN(t));
        if (ts.length) lastEventAt = new Date(Math.max(...ts));
        trackingCapability = `${events.length} eventi`;
      } catch (e) {
        trackingCapability = `non disponibile: ${(e as Error).message}`; /* tracking not exposed for this account: keep what we have */
      }
      if (!capabilityRecorded) {
        // The verify step cannot test the lookup without a reference: the first real shipment proves it.
        const caps = (loaded.connection.capabilities as Record<string, unknown>) ?? {};
        await db.integrationConnection.update({
          where: { id: loaded.connection.id },
          data: { capabilities: { ...caps, shipmentLookup: true, shipmentFields: Object.keys(p).slice(0, 25).join(","), tracking: trackingCapability, lookupVerifiedWith: s.packlinkReference } as Prisma.InputJsonValue },
        });
        capabilityRecorded = true;
        ctx.log(`Lettura spedizione verificata con ${s.packlinkReference}: campi ${Object.keys(p).length}, tracking ${trackingCapability}`);
      }
      await db.shipment.update({
        where: { id: s.id },
        data: {
          status,
          rawStatus: p.state ?? p.status ?? s.rawStatus,
          carrier: p.carrier ?? s.carrier,
          service: p.service ?? s.service,
          trackingNumber: tracking ?? s.trackingNumber,
          trackingUrl: p.tracking_url ?? s.trackingUrl,
          deliveredAt: status === "DELIVERED" ? s.deliveredAt ?? lastEventAt ?? new Date() : s.deliveredAt,
          lastEventAt: lastEventAt ?? s.lastEventAt,
          ...(cost ? { cost, costCurrency: (typeof p.price === "object" && p.price?.currency) || p.currency || s.costCurrency || "EUR", costSource: "PACKLINK_API" as const } : {}),
          syncedAt: new Date(),
        },
      });
      updated++;
    } catch (e) {
      failed++;
      ctx.log(`Spedizione ${s.packlinkReference}: ${(e as Error).message}`);
      if (e instanceof ConnectorError && (e.httpStatus === 401 || e.httpStatus === 403)) throw e;
    }
    await sleep(250);
  }
  await markSynced(loaded.connection.id);
  return { examined: shipments.length, updated, failed };
}

/** Flags shipments that need attention. Works on data from any source (Shopify, Packlink, CSV). */
export async function detectShipmentProblems(ctx: JobContext) {
  const orgId = ctx.organizationId;
  const stale = new Date(Date.now() - 7 * DAY);
  const inTransitStale = await db.shipment.updateMany({
    where: { organizationId: orgId, deletedAt: null, problem: false, status: { in: ["IN_TRANSIT", "OUT_FOR_DELIVERY", "READY"] }, OR: [{ lastEventAt: { lt: stale } }, { lastEventAt: null, shippedAt: { lt: stale } }] },
    data: { problem: true, problemReason: "Nessun aggiornamento di tracking da oltre 7 giorni" },
  });
  const exceptions = await db.shipment.updateMany({
    where: { organizationId: orgId, deletedAt: null, problem: false, status: { in: ["EXCEPTION", "RETURNED"] } },
    data: { problem: true, problemReason: "Eccezione o reso segnalato dal corriere" },
  });
  const cleared = await db.shipment.updateMany({
    where: { organizationId: orgId, deletedAt: null, problem: true, status: { in: ["DELIVERED", "CANCELLED"] } },
    data: { problem: false, problemReason: null },
  });
  return { flaggedStale: inTransitStale.count, flaggedExceptions: exceptions.count, cleared: cleared.count };
}

/** Orders paid but not shipped: the "da preparare" list. */
export async function ordersToShip(organizationId: string) {
  return db.order.findMany({
    where: {
      organizationId,
      deletedAt: null,
      test: false,
      cancelledAt: null,
      financialStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID", "AUTHORIZED"] },
      fulfillmentStatus: { in: ["UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "OPEN", "SCHEDULED", "ON_HOLD", "PENDING_FULFILLMENT"] },
    },
    orderBy: { processedAt: "asc" },
    include: { items: { select: { quantity: true } }, shipments: { select: { id: true } } },
    take: 500,
  });
}

export const shipmentCostTotal = (rows: Array<{ cost: Prisma.Decimal | null }>) => rows.reduce((a, r) => a.plus(r.cost ?? 0), new Prisma.Decimal(0));
