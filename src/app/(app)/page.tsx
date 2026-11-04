import Link from "next/link";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDashboardMetrics } from "@/server/metrics/dashboard";
import { isAgentConfigured } from "@/server/agent/config";
import { localDate } from "@/server/agent/briefing";
import { newConversationAction, regenerateBriefingAction } from "@/server/actions/agent";
import { alertToTaskAction, setAlertStatusAction, setTaskStatusAction } from "@/server/actions/tasks";
import { resolvePeriod } from "@/lib/periods";
import { fmtDate, fmtRelative } from "@/lib/format";
import { ALERT_SEVERITY_LABEL, CONNECTION_STATUS_LABEL, JOB_STATUS_LABEL, TASK_PRIORITY_LABEL } from "@/lib/labels";
import { JOB_LABELS } from "@/server/jobs/handlers";
import { MetricCard } from "@/components/metric-card";
import { PeriodFilter } from "@/components/period-filter";
import { Markdown } from "@/components/markdown";
import { Badge, Card, CardContent, CardHeader, CardTitle, Notice, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;

export default async function CockpitPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const range = resolvePeriod(sp, auth.timezone);
  const orgId = auth.organizationId;
  const today = localDate(auth.timezone);
  const [metrics, briefing, alerts, tasks, approvals, connections, recentJobs, lastMonitor] = await Promise.all([
    getDashboardMetrics(orgId, range, auth.currency),
    db.briefing.findUnique({ where: { organizationId_date: { organizationId: orgId, date: today } } }),
    db.alert.findMany({ where: { organizationId: orgId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 8 }),
    db.task.findMany({ where: { organizationId: orgId, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ priority: "desc" }, { dueAt: "asc" }], take: 7 }),
    db.agentApproval.count({ where: { organizationId: orgId, status: "PENDING" } }),
    db.integrationConnection.findMany({ where: { organizationId: orgId }, orderBy: { displayName: "asc" } }),
    db.syncJob.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.syncJob.findFirst({ where: { organizationId: orgId, type: "agent.monitor", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
  ]);
  const canAct = hasRole(auth.role, "OPERATIONS");
  const configured = isAgentConfigured();
  const critical = alerts.filter((a) => a.severity === "CRITICAL").length;
  const greeting = (() => {
    const h = Number(new Intl.DateTimeFormat("it-IT", { hour: "numeric", hour12: false, timeZone: auth.timezone }).format(new Date()));
    return h < 12 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
  })();

  return (
    <div>
      <PageHeader title={`${greeting}, ${auth.name.split(" ")[0]}`} subtitle={briefing?.summary ?? (critical ? `${critical} avvisi critici da gestire.` : alerts.length ? `${alerts.length} avvisi aperti, ${tasks.length} task in corso.` : "Nessuna urgenza rilevata.")} actions={<PeriodFilter basePath="/" current={range.key} from={range.from} to={range.to} tz={auth.timezone} />} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}

      <form action={newConversationAction} className="mb-6 flex gap-2">
        <input name="prompt" placeholder={configured ? "Chiedi all'assistente: come va il mese? cosa devo fare oggi? proponi una grafica per…" : "Assistente non configurato: imposta ANTHROPIC_API_KEY (vedi Impostazioni)"} disabled={!configured} className="h-11 flex-1 rounded-full border border-steel bg-white px-5 text-sm placeholder:text-space focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-graphite disabled:opacity-60" />
        <Button type="submit" size="lg" className="h-11" disabled={!configured}>Chiedi</Button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="bg-blackout text-crocus">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Briefing del {fmtDate(new Date(), auth.timezone)}</CardTitle>
              <p className="mt-1 text-xs text-space">{briefing ? `${briefing.generatedBy === "claude" ? "Scritto dall'assistente" : "Generato dalle regole"} · ${fmtRelative(briefing.createdAt)}` : "Non ancora generato: lo scheduler lo prepara dopo le 7:00."}</p>
            </div>
            {canAct ? <form action={regenerateBriefingAction}><Button type="submit" size="sm" variant="secondary">{briefing ? "Rigenera" : "Genera ora"}</Button></form> : null}
          </CardHeader>
          <CardContent>
            {briefing ? <Markdown className="[&_*]:text-crocus [&_th]:text-space [&_td]:border-white/10 [&_th]:border-white/10 [&_code]:bg-white/10">{briefing.content.replace(/^Sintesi:.*\n?/m, "")}</Markdown> : <p className="text-sm text-space">Il briefing riassume ieri, il mese in corso, avvisi, task e approvazioni. Premi “Genera ora” per averlo subito.</p>}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Avvisi {alerts.length ? <span className="ml-1 text-sm text-graphite">({alerts.length})</span> : null}</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href="/alerts">Tutti</Link></Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {alerts.length === 0 ? <p className="text-sm text-graphite">Nessun avviso aperto.{lastMonitor?.finishedAt ? ` Monitor eseguito ${fmtRelative(lastMonitor.finishedAt)}.` : " Il monitor gira ogni 15 minuti con il worker."}</p> : null}
              {alerts.map((a) => {
                const sev = ALERT_SEVERITY_LABEL[a.severity]!;
                return (
                  <div key={a.id} className="flex items-start justify-between gap-2 rounded-lg border border-smoke p-2.5">
                    <div className="min-w-0">
                      <Link href={a.href ?? "/alerts"} className="block text-sm font-medium hover:underline"><Badge tone={sev.tone} className="mr-1.5">{sev.label}</Badge>{a.title}</Link>
                      <p className="mt-0.5 line-clamp-2 text-xs text-graphite">{a.body}</p>
                    </div>
                    {canAct ? (
                      <div className="flex shrink-0 flex-col gap-1">
                        <form action={alertToTaskAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="outline" className="h-6 px-2 text-[11px]">→ Task</Button></form>
                        <form action={setAlertStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="SNOOZED" /><input type="hidden" name="returnTo" value="/" /><Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]">Rinvia 3g</Button></form>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Da fare {tasks.length ? <span className="ml-1 text-sm text-graphite">({tasks.length})</span> : null}</CardTitle>
              <div className="flex items-center gap-2">{approvals ? <Link href="/assistant/approvals"><Badge tone="warn">{approvals} approvazioni in attesa</Badge></Link> : null}<Button asChild variant="ghost" size="sm"><Link href="/tasks">Tutti</Link></Button></div>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {tasks.length === 0 ? <p className="text-sm text-graphite">Nessun task aperto.</p> : null}
              {tasks.map((t) => {
                const pr = TASK_PRIORITY_LABEL[t.priority]!;
                const overdue = t.dueAt && t.dueAt < new Date();
                return (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2"><Badge tone={pr.tone}>{pr.label}</Badge><span className="truncate">{t.title}</span>{t.createdBy !== "user" ? <Badge tone="outline">{t.createdBy === "agent" ? "assistente" : "monitor"}</Badge> : null}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-graphite">{t.dueAt ? <span className={overdue ? "text-bad" : ""}>{fmtDate(t.dueAt, auth.timezone)}</span> : null}{canAct ? <form action={setTaskStatusAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="DONE" /><input type="hidden" name="returnTo" value="/" /><Button size="sm" variant="outline" className="h-6 px-2 text-[11px]">Fatto</Button></form> : null}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-[11px] font-medium uppercase tracking-wide text-graphite">Numeri · {fmtDate(range.from, auth.timezone)} → {fmtDate(range.to, auth.timezone)}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m, i) => <MetricCard key={m.key} m={m} highlight={i === 0} />)}
      </div>
      <p className="mt-3 text-xs text-graphite">Ogni valore indica origine e ultimo aggiornamento. Pagamenti acquisiti e accrediti liquidati sono viste dello stesso denaro già conteggiato nelle vendite: non vanno sommati ai ricavi.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Integrazioni</CardTitle><Button asChild variant="ghost" size="sm"><Link href="/integrations">Gestisci</Link></Button></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {connections.length === 0 ? <p className="text-sm text-graphite">Nessuna connessione: inizia da Shopify.</p> : null}
            {connections.map((c) => {
              const st = CONNECTION_STATUS_LABEL[c.status] ?? { label: c.status, tone: "muted" as const };
              return <Link key={c.id} href={`/integrations/${c.key}`} className="flex items-center justify-between text-sm"><span>{c.displayName}</span><span className="flex items-center gap-2 text-xs text-graphite"><span>{c.lastSyncAt ? `sync ${fmtRelative(c.lastSyncAt)}` : ""}</span><Badge tone={st.tone}>{st.label}</Badge></span></Link>;
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Sincronizzazioni recenti</CardTitle><Button asChild variant="ghost" size="sm"><Link href="/sync">Tutte</Link></Button></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentJobs.length === 0 ? <p className="text-sm text-graphite">Nessun job eseguito.</p> : null}
            {recentJobs.map((j) => {
              const st = JOB_STATUS_LABEL[j.status] ?? { label: j.status, tone: "muted" as const };
              return <Link key={j.id} href={`/sync/${j.id}`} className="flex items-center justify-between text-sm"><span>{JOB_LABELS[j.type] ?? j.type}</span><span className="flex items-center gap-2 text-xs text-graphite"><span>{fmtRelative(j.finishedAt ?? j.createdAt)}</span><Badge tone={st.tone}>{st.label}</Badge></span></Link>;
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
