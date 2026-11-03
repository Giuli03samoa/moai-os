"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import type { ShipmentStatus } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { parseAmount } from "../money";

const STATUSES: ShipmentStatus[] = ["PENDING", "READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION", "RETURNED", "CANCELLED", "UNKNOWN"];

/** Tracked manual update: who changed what is in the audit log; the row keeps its original source. */
export async function updateShipmentAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const s = await db.shipment.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!s) redirect("/shipping");
  const status = String(formData.get("status") ?? s.status) as ShipmentStatus;
  const cost = parseAmount(String(formData.get("cost") ?? ""), { decimalSeparator: "," }) ?? parseAmount(String(formData.get("cost") ?? ""));
  const data = {
    status: STATUSES.includes(status) ? status : s.status,
    trackingNumber: String(formData.get("trackingNumber") ?? "").trim() || null,
    trackingUrl: String(formData.get("trackingUrl") ?? "").trim() || null,
    carrier: String(formData.get("carrier") ?? "").trim() || null,
    packlinkReference: String(formData.get("packlinkReference") ?? "").trim() || null,
    ...(cost ? { cost, costCurrency: auth.currency, costSource: "MANUAL" as const } : {}),
    problem: formData.get("problem") === "on",
    problemReason: String(formData.get("problemReason") ?? "").trim() || null,
    deliveredAt: status === "DELIVERED" ? s.deliveredAt ?? new Date() : s.deliveredAt,
    lastEventAt: new Date(),
  };
  if (data.trackingNumber && data.trackingNumber !== s.trackingNumber) {
    const dup = await db.shipment.findFirst({ where: { organizationId: auth.organizationId, trackingNumber: data.trackingNumber, id: { not: id }, deletedAt: null } });
    if (dup) redirect(`/shipping/${id}?error=${encodeURIComponent("Esiste già una spedizione con questo tracking: non creo duplicati.")}`);
  }
  await db.shipment.update({ where: { id }, data });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "shipment.manual_update", entityType: "Shipment", entityId: id, metadata: { before: { status: s.status, trackingNumber: s.trackingNumber, packlinkReference: s.packlinkReference, cost: s.cost?.toString() ?? null }, after: { ...data, cost: data.cost?.toString() } } });
  revalidatePath("/shipping");
  redirect(`/shipping/${id}?notice=${encodeURIComponent("Spedizione aggiornata (modifica manuale tracciata).")}`);
}

/** Registers a shipment that exists in the real world but not in Shopify/Packlink data. */
export async function createManualShipmentAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const orderId = String(formData.get("orderId") ?? "");
  const order = await db.order.findFirst({ where: { id: orderId, organizationId: auth.organizationId } });
  if (!order) redirect("/orders");
  const trackingNumber = String(formData.get("trackingNumber") ?? "").trim() || null;
  const packlinkReference = String(formData.get("packlinkReference") ?? "").trim() || null;
  if (trackingNumber || packlinkReference) {
    const dup = await db.shipment.findFirst({ where: { organizationId: auth.organizationId, deletedAt: null, OR: [...(trackingNumber ? [{ trackingNumber }] : []), ...(packlinkReference ? [{ packlinkReference }] : [])] } });
    if (dup) redirect(`/orders/${orderId}?error=${encodeURIComponent("Spedizione già registrata con questo tracking/riferimento.")}`);
  }
  const cost = parseAmount(String(formData.get("cost") ?? ""), { decimalSeparator: "," });
  const s = await db.shipment.create({
    data: {
      organizationId: auth.organizationId, source: "MANUAL", externalId: `manual:${randomUUID()}`, orderId, carrier: String(formData.get("carrier") ?? "").trim() || null, trackingNumber, packlinkReference,
      status: "IN_TRANSIT", rawStatus: "manuale", shippedAt: new Date(), lastEventAt: new Date(), ...(cost ? { cost, costCurrency: auth.currency, costSource: "MANUAL" as const } : {}),
    },
  });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "shipment.manual_create", entityType: "Shipment", entityId: s.id, metadata: { orderId, trackingNumber, packlinkReference } });
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}?notice=${encodeURIComponent("Spedizione manuale registrata.")}`);
}
