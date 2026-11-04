import { db } from "../db";
import { getConnector } from "../connectors/registry";
import { enqueue } from "./queue";
import { TZDate } from "@date-fns/tz";

/**
 * Periodic scheduling. Idempotent thanks to dedupeKey: if the previous run is still
 * queued/running nothing is added. Reconciliation and shipment checks run per organization.
 */
export async function scheduleDueJobs(): Promise<number> {
  let n = 0;
  const connections = await db.integrationConnection.findMany({ where: { status: "CONNECTED" }, include: { organization: { select: { deletedAt: true } } } });
  for (const c of connections) {
    if (c.organization.deletedAt) continue;
    let def;
    try {
      def = getConnector(c.key);
    } catch {
      continue;
    }
    for (const job of def.jobs.filter((j) => j.scheduled)) {
      const r = await enqueue({ organizationId: c.organizationId, connectionId: c.id, type: job.type, payload: {}, dedupeKey: `${job.type}:${c.id}`, triggeredBy: "schedule" });
      if (!r.deduplicated) n++;
    }
  }
  const orgs = await db.organization.findMany({ where: { deletedAt: null }, select: { id: true, timezone: true } });
  for (const o of orgs) {
    for (const type of ["reconciliation.run", "shipments.detect_problems", "agent.monitor"]) {
      const r = await enqueue({ organizationId: o.id, type, payload: {}, dedupeKey: `${type}:${o.id}`, triggeredBy: "schedule" });
      if (!r.deduplicated) n++;
    }
    // Daily briefing: once per local day, from 07:00 in the organization timezone.
    const local = new TZDate(Date.now(), o.timezone);
    const date = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    if (local.getHours() >= 7) {
      const existing = await db.briefing.findUnique({ where: { organizationId_date: { organizationId: o.id, date } } });
      if (!existing) {
        const r = await enqueue({ organizationId: o.id, type: "agent.briefing", payload: {}, dedupeKey: `agent.briefing:${o.id}:${date}`, triggeredBy: "schedule", maxAttempts: 3 });
        if (!r.deduplicated) n++;
      }
    }
  }
  return n;
}
