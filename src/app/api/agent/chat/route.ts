import { z } from "zod";
import { readSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { runAgentTurn, type AgentEvent } from "@/server/agent/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const Body = z.object({ conversationId: z.string().min(1), message: z.string().min(1).max(12000) });

/** Streams one assistant turn as Server-Sent Events. Authentication = the normal session cookie (MFA done). */
export async function POST(req: Request) {
  const s = await readSession();
  if (!s || !s.mfaVerified || !s.user.mfaEnabledAt) return new Response("unauthorized", { status: 401 });
  const rl = rateLimit(`agent:${s.userId}`, 30, 10 * 60_000);
  if (!rl.ok) return new Response("Troppe richieste all'assistente: riprova tra qualche minuto.", { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });
  const conv = await db.agentConversation.findFirst({ where: { id: parsed.data.conversationId, organizationId: s.organizationId, userId: s.userId } });
  if (!conv) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      runAgentTurn({
        auth: { userId: s.userId, organizationId: s.organizationId, role: s.role, name: s.user.name, timezone: s.organization.timezone, currency: s.organization.baseCurrency, orgName: s.organization.name },
        conversationId: conv.id,
        userText: parsed.data.message,
        onEvent: send,
        signal: req.signal,
      })
        .catch((e) => send({ type: "error", message: (e as Error).message }))
        .finally(() => {
          clearInterval(keepAlive);
          controller.close();
        });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
