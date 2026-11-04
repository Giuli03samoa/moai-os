import { db } from "@/server/db";
import { agentModel, isAgentConfigured } from "@/server/agent/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness/readiness for the load balancer. Reports queue health without exposing data. */
export async function GET() {
  try {
    const [queued, dead, lastSucceeded] = await Promise.all([
      db.syncJob.count({ where: { status: { in: ["QUEUED", "FAILED"] } } }),
      db.syncJob.count({ where: { status: "DEAD" } }),
      db.syncJob.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    ]);
    return Response.json({ ok: true, db: "up", queue: { pending: queued, dead, lastSucceededAt: lastSucceeded?.finishedAt ?? null }, agent: { configured: isAgentConfigured(), model: agentModel() } });
  } catch (e) {
    return Response.json({ ok: false, db: "down", error: (e as Error).message }, { status: 503 });
  }
}
