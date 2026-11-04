import type { Prisma } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";
import { getDashboardMetrics } from "../metrics/dashboard";
import { resolvePeriod } from "../../lib/periods";
import { isAgentConfigured } from "./config";
import { completeOnce } from "./engine";
import { BRIEFING_SYSTEM } from "./prompt";
import { notifyBriefing } from "../notify";

/**
 * Daily briefing. Facts are gathered from the database; the text is written by Claude when the
 * API key is configured, otherwise by deterministic rules. Stored once per local day.
 */
export function localDate(tz: string, d = new Date()): string {
  const z = new TZDate(d, tz);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
}

export async function buildBriefingData(organizationId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const tz = org.timezone;
  const today = localDate(tz);
  const y = new TZDate(Date.now() - 86_400_000, tz);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  const rYesterday = resolvePeriod({ period: "custom", from: yesterday, to: yesterday }, tz);
  const rMtd = resolvePeriod({ period: "mtd" }, tz);
  const rLastMonth = resolvePeriod({ period: "last_month" }, tz);
  const pick = (ms: Awaited<ReturnType<typeof getDashboardMetrics>>) => Object.fromEntries(ms.filter((m) => ["gross", "net", "orders", "toShip", "unreconciled", "invoicesReceived"].includes(m.key)).map((m) => [m.key, { label: m.label, value: m.value, currency: m.currency, sources: m.sources, updatedAt: m.updatedAt }]));
  const [mY, mMtd, mLast, alerts, tasks, approvals, connections, deadJobs, marketing, memories] = await Promise.all([
    getDashboardMetrics(organizationId, rYesterday, org.baseCurrency),
    getDashboardMetrics(organizationId, rMtd, org.baseCurrency),
    getDashboardMetrics(organizationId, rLastMonth, org.baseCurrency),
    db.alert.findMany({ where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 12, select: { severity: true, title: true, body: true, href: true, status: true } }),
    db.task.findMany({ where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ dueAt: { lte: new Date(Date.now() + 86_400_000) } }, { priority: { in: ["HIGH", "URGENT"] } }] }, orderBy: [{ dueAt: "asc" }], take: 10, select: { title: true, priority: true, dueAt: true, status: true } }),
    db.agentApproval.findMany({ where: { organizationId, status: "PENDING" }, select: { summary: true, requiredRole: true, createdAt: true }, take: 10 }),
    db.integrationConnection.findMany({ where: { organizationId }, select: { displayName: true, status: true, lastSyncAt: true, blockedReason: true } }),
    db.syncJob.count({ where: { organizationId, status: "DEAD" } }),
    db.marketingSnapshot.findMany({ where: { organizationId, date: { gte: localDate(tz, new Date(Date.now() - 7 * 86_400_000)) } }, orderBy: { date: "desc" }, take: 40, select: { channel: true, date: true, metrics: true } }),
    db.agentMemory.findMany({ where: { organizationId, category: { in: ["business", "decision"] } }, take: 8, orderBy: { updatedAt: "desc" }, select: { key: true, content: true } }),
  ]);
  const latestByChannel: Record<string, unknown> = {};
  for (const m of marketing) if (!latestByChannel[m.channel]) latestByChannel[m.channel] = { date: m.date, ...(m.metrics as object) };
  return {
    org: { name: org.name, timezone: tz, currency: org.baseCurrency, demoMode: process.env.DEMO_MODE === "true" },
    date: today,
    yesterday: { date: yesterday, metrics: pick(mY) },
    monthToDate: { from: rMtd.from, metrics: pick(mMtd) },
    lastMonth: { metrics: pick(mLast) },
    alerts,
    tasksDueOrHigh: tasks,
    pendingApprovals: approvals,
    integrations: connections,
    deadJobs,
    marketingLatest: latestByChannel,
    businessContext: memories,
  };
}

export function renderRuleBriefing(d: Awaited<ReturnType<typeof buildBriefingData>>): { content: string; summary: string } {
  const m = (o: Record<string, { value: string; currency?: string }>, k: string) => o[k] ? `${Number(o[k]!.value).toLocaleString("it-IT", { minimumFractionDigits: o[k]!.currency ? 2 : 0 })}${o[k]!.currency ? ` ${o[k]!.currency}` : ""}` : "—";
    const y = d.yesterday.metrics as Record<string, { value: string; currency?: string }>;
  const mtd = d.monthToDate.metrics as Record<string, { value: string; currency?: string }>;
  const last = d.lastMonth.metrics as Record<string, { value: string; currency?: string }>;
  const critical = d.alerts.filter((a) => a.severity === "CRITICAL");
  const summary = critical.length ? `${critical.length} avvisi critici da gestire; ieri ${m(y, "orders")} ordini per ${m(y, "net")}.` : `Ieri ${m(y, "orders")} ordini per ${m(y, "net")}; ${d.alerts.length} avvisi aperti, ${d.tasksDueOrHigh.length} task prioritari.`;
  const lines = [
    `Sintesi: ${summary}`,
    "",
    "## Numeri",
    "| | Ieri | Mese in corso | Mese scorso |",
    "|---|---|---|---|",
    `| Vendite nette | ${m(y, "net")} | ${m(mtd, "net")} | ${m(last, "net")} |`,
    `| Ordini | ${m(y, "orders")} | ${m(mtd, "orders")} | ${m(last, "orders")} |`,
    `| Da spedire | ${m(mtd, "toShip")} | | |`,
    `| Non riconciliate | ${m(mtd, "unreconciled")} | | |`,
    "",
    "## Da fare oggi",
    ...(d.alerts.length || d.tasksDueOrHigh.length || d.pendingApprovals.length
      ? [
          ...d.alerts.slice(0, 6).map((a) => `- **${a.severity}** ${a.title}`),
          ...d.tasksDueOrHigh.map((t) => `- Task ${t.priority}: ${t.title}${t.dueAt ? ` (scade ${t.dueAt.toISOString().slice(0, 10)})` : ""}`),
          ...d.pendingApprovals.map((a) => `- Approvazione in attesa (${a.requiredRole}): ${a.summary}`),
        ]
      : ["- Nessuna urgenza rilevata."]),
    "",
    "## Da tenere d'occhio",
    ...d.integrations.filter((c) => c.status !== "CONNECTED").map((c) => `- ${c.displayName}: ${c.status}${c.blockedReason ? ` (${c.blockedReason})` : ""}`),
    ...(d.deadJobs ? [`- ${d.deadJobs} sincronizzazioni fallite definitivamente`] : []),
    ...Object.entries(d.marketingLatest).map(([ch, v]) => `- ${ch}: ${JSON.stringify(v)}`),
    ...(d.org.demoMode ? ["- Ambiente DEMO: parte dei dati è fittizia."] : []),
  ];
  return { content: lines.join("\n"), summary };
}

export async function generateBriefing(organizationId: string, opts: { force?: boolean; notify?: boolean } = {}): Promise<{ id: string; date: string; generatedBy: string; created: boolean }> {
  const data = await buildBriefingData(organizationId);
  const existing = await db.briefing.findUnique({ where: { organizationId_date: { organizationId, date: data.date } } });
  if (existing && !opts.force) return { id: existing.id, date: existing.date, generatedBy: existing.generatedBy, created: false };
  let content: string, summary: string, generatedBy = "rules", runId: string | null = null;
  const rules = renderRuleBriefing(data);
  if (isAgentConfigured()) {
    try {
      const r = await completeOnce({ organizationId, kind: "BRIEFING", system: BRIEFING_SYSTEM, user: JSON.stringify(data), maxTokens: 2500, effort: "low" });
      content = r.text.trim() || rules.content;
      runId = r.runId;
      generatedBy = "claude";
      const m = /^Sintesi:\s*(.+)$/m.exec(content);
      summary = m?.[1]?.trim() ?? rules.summary;
    } catch {
      content = rules.content;
      summary = rules.summary;
    }
  } else {
    content = rules.content;
    summary = rules.summary;
  }
  const b = await db.briefing.upsert({
    where: { organizationId_date: { organizationId, date: data.date } },
    create: { organizationId, date: data.date, content, summary, data: data as unknown as Prisma.InputJsonValue, generatedBy, runId },
    update: { content, summary, data: data as unknown as Prisma.InputJsonValue, generatedBy, runId },
  });
  if ((opts.notify ?? true) && !existing) await notifyBriefing(organizationId, data.date, content);
  return { id: b.id, date: b.date, generatedBy, created: true };
}
