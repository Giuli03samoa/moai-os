import { Prisma } from "@prisma/client";
import { db } from "../../db";
import { audit } from "../../audit";
import { decryptJson, verifyHmacBase64 } from "../../crypto";
import { enqueue } from "../../jobs/queue";
import { gid } from "./queries";

/**
 * Shopify webhook intake.
 * 1. Tenant lookup by shop domain → 2. HMAC-SHA256 verification with the app's client secret
 * → 3. deduplication on X-Shopify-Event-Id → 4. enqueue a job that re-reads the resource via API.
 * The payload is treated as a hint, never as the source of truth (it may be stale or re-ordered).
 */
export async function handleShopifyWebhook(rawBody: string, headers: Headers): Promise<{ status: number; body: string }> {
  const topic = headers.get("x-shopify-topic") ?? "";
  const domain = (headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
  const hmac = headers.get("x-shopify-hmac-sha256");
  const eventId = headers.get("x-shopify-event-id") ?? headers.get("x-shopify-webhook-id");
  if (!topic || !domain || !hmac || !eventId) return { status: 400, body: "missing headers" };

  const candidates = await db.integrationConnection.findMany({ where: { key: "shopify", config: { path: ["shopDomain"], equals: domain } } });
  const connection = candidates.find((c) => {
    const s = decryptJson<Record<string, string>>(c.secretsEnc) ?? {};
    return [s.clientSecret, s.webhookSecret].some((secret) => secret && verifyHmacBase64(rawBody, secret, hmac));
  });
  if (!connection) return { status: 401, body: "invalid signature" };

  try {
    await db.webhookEvent.create({ data: { organizationId: connection.organizationId, source: "SHOPIFY", eventId, topic } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: 200, body: "duplicate" };
    throw e;
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, body: "invalid json" };
  }
  const orgId = connection.organizationId;
  const orderIdFromPayload = () => {
    const raw = topic.startsWith("orders/") ? payload.id : payload.order_id;
    return raw !== undefined && raw !== null ? gid("Order", String(raw)) : null;
  };

  switch (true) {
    case topic.startsWith("orders/") || topic.startsWith("refunds/") || topic.startsWith("fulfillments/") || topic.startsWith("fulfillment_events/"): {
      const orderId = orderIdFromPayload();
      if (orderId) {
        await enqueue({ organizationId: orgId, connectionId: connection.id, type: "shopify.orders.sync", payload: { orderId }, dedupeKey: `shopify.order:${orderId}`, triggeredBy: `webhook:${topic}`, maxAttempts: 8 });
      }
      break;
    }
    case topic.startsWith("products/") || topic.startsWith("inventory_levels/"):
      await enqueue({ organizationId: orgId, connectionId: connection.id, type: "shopify.products.sync", payload: {}, dedupeKey: `shopify.products.sync:${connection.id}`, triggeredBy: `webhook:${topic}` });
      break;
    case topic === "customers/redact": {
      // GDPR erasure request: remove PII, keep anonymised order history (legal retention).
      const customer = payload.customer as { id?: number | string } | undefined;
      if (customer?.id) {
        await db.customer.updateMany({
          where: { organizationId: orgId, source: "SHOPIFY", externalId: gid("Customer", String(customer.id)) },
          data: { displayName: null, email: null, piiRedactedAt: new Date() },
        });
      }
      await audit({ organizationId: orgId, action: "gdpr.customers_redact", metadata: { customerId: customer?.id ?? null } });
      break;
    }
    case topic === "customers/data_request":
      await audit({ organizationId: orgId, action: "gdpr.customers_data_request", metadata: { customerId: (payload.customer as { id?: unknown })?.id ?? null, ordersRequested: payload.orders_requested ?? null } });
      break;
    case topic === "shop/redact":
      await audit({ organizationId: orgId, action: "gdpr.shop_redact", metadata: { shopDomain: domain } });
      break;
    case topic === "app/uninstalled":
      await db.integrationConnection.update({ where: { id: connection.id }, data: { status: "DISABLED", blockedReason: "App disinstallata dal negozio" } });
      break;
    default:
      break;
  }
  return { status: 200, body: "ok" };
}
