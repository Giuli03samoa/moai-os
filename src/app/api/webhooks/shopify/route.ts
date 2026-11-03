import { handleShopifyWebhook } from "@/server/connectors/shopify/webhooks";
import { rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`webhook:${ip}`, 600, 60_000).ok) return new Response("rate limited", { status: 429 });
  const raw = await req.text();
  if (raw.length > 2 * 1024 * 1024) return new Response("payload too large", { status: 413 });
  try {
    const r = await handleShopifyWebhook(raw, req.headers);
    return new Response(r.body, { status: r.status });
  } catch (e) {
    console.error("[webhook shopify]", (e as Error).message);
    // 500 makes Shopify retry; the dedupe table guarantees idempotency.
    return new Response("error", { status: 500 });
  }
}
