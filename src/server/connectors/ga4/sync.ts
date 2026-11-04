import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import { markSynced, requireConnected } from "../registry";
import type { JobContext } from "../../jobs/types";
import { Ga4Client, ga4Date, parseServiceAccount, reportToRows } from "./client";

const METRICS = ["sessions", "totalUsers", "newUsers", "screenPageViews", "keyEvents", "ecommercePurchases", "purchaseRevenue"];

export async function syncGa4Report(ctx: JobContext) {
  const orgId = ctx.organizationId;
  const { connection, secrets, config } = await requireConnected(orgId, "ga4");
  const client = new Ga4Client(parseServiceAccount(secrets.serviceAccountJson!), String(config.propertyId ?? "").replace(/\D/g, ""));
  try {
    const report = await client.runReport({ startDate: "14daysAgo", endDate: "today", metrics: METRICS });
    const rows = reportToRows(report);
    for (const r of rows) {
      const date = ga4Date(r.date ?? "");
      if (!date) continue;
      const metrics: Record<string, number> = {};
      for (const m of METRICS) if (r[m] !== undefined && r[m] !== "") metrics[m] = Number(r[m]);
      await db.marketingSnapshot.upsert({
        where: { organizationId_channel_date: { organizationId: orgId, channel: "web", date } },
        create: { organizationId: orgId, source: "GA4_API", channel: "web", date, metrics: metrics as Prisma.InputJsonValue },
        update: { metrics: metrics as Prisma.InputJsonValue, syncedAt: new Date() },
      });
    }
    ctx.log(`GA4: ${rows.length} giorni aggiornati`);
    await markSynced(connection.id);
    return { days: rows.length };
  } catch (e) {
    await markSynced(connection.id, (e as Error).message);
    throw e;
  }
}
