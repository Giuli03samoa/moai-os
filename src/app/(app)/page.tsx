import Link from "next/link";
import { ArrowRight, Bell, CheckCircle2, CheckSquare, Plug, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
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
import { Badge, Card, CardContent, CardHeader, CardTitle, Dot, Notice, SectionTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SP = Record<string, string | undefined>;

const QUICK = ["Cosa devo fare oggi?", "Come va il mese?", "Ordini da spedire", "Costi di produzione 2026"];
const QUICK_PROMPT: Record<string, string> = {
  "Cosa devo fare oggi?": "Cosa devo fare oggi? Dammi le priorità in ordine.",
  "Come va il mese?": "Come va il business questo mese rispetto al precedente?",
  "Ordini da spedire": "Quali ordini pagati non sono ancora stati spediti?",
  "Costi di produzione 2026": "Fammi il punto sui costi di produzione e sui fornitori del 2026.",
};

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
  const connected = connections.filter((c) => c.status === "CONNECTED").length;
  const hour = Number(new Intl.DateTimeFormat("it-IT", { hour: "numeric", hour12: false, timeZone: auth.timezone }).format(new Date()));
  const greeting = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  const longDate = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: auth.timezone }).format(new Date());
  const summary = briefing?.summary ?? (critical ? `${critical} avvisi critici da gestire.` : alerts.length ? `${alerts.length} avvisi aperti, ${tasks.length} attività in corso.` : "Nessuna urgenza. Tutto sotto controllo.");

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative">
        <p className="text-xs font-medium text-graphite first-letter:uppercase">{longDate}</p>
        <h1 className="mt-1.5 text-[34px] font-medium leading-[1.05] tracking-[-0.04em] md:text-[44px]">{greeting}, {auth.name.split(" ")[0]}</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-graphite">{summary}</p>
        {sp.notice ? <div className="mt-4 max-w-2xl"><Notice tone="ok">{sp.notice}</Notice></div> : null}

        <form action={newConversationAction} className="surface group mt-6 flex max-w-3xl items-center gap-2 rounded-full border border-[var(--hairline)] p-1.5 pl-5 transition-shadow focus-within:shadow-float">
          <Sparkles className="h-[18px] w-[18px] shrink-0 text-graphite" strokeWidth={1.75} />
          <input name="prompt" disabled={!configured} placeholder={configured ? "Chiedi qualsiasi cosa su MOAI: vendite, costi, fornitori, grafiche…" : "Assistente non configurato: vedi Impostazioni"} className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-blackout outline-none placeholder:text-space disabled:opacity-60" />
          <Button type="submit" className="h-10 px-5" disabled={!configured}>Chiedi</Button>
        </form>
        {configured ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <form key={q} action={newConversationAction}>
                <input type="hidden" name="prompt" value={QUICK_PROMPT[q]} />
                <button className="rounded-full border border-smoke bg-white/50 px-3 py-1.5 text-xs text-graphite transition-colors hover:border-steel hover:bg-white hover:text-blackout">{q}</button>
              </form>
            ))}
          </div>
        ) : null}
      </section>

      {/* Status strip */}
      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusTile href="/alerts" icon={<Bell className="h-4 w-4" strokeWidth={1.75} />} label="Avvisi aperti" value={alerts.length} tone={critical ? "bad" : alerts.length ? "warn" : "ok"} note={critical ? `${critical} critici` : alerts.length ? "da guardare" : "nessuno"} />
        <StatusTile href="/tasks" icon={<CheckSquare className="h-4 w-4" strokeWidth={1.75} />} label="Attività in corso" value={tasks.length} tone={tasks.some((t) => t.dueAt && t.dueAt < new Date()) ? "warn" : "muted"} note={tasks.some((t) => t.dueAt && t.dueAt < new Date()) ? "alcune scadute" : "in ordine"} />
        <StatusTile href="/assistant/approvals" icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />} label="Da approvare" value={approvals} tone={approvals ? "warn" : "ok"} note={approvals ? "aspettano te" : "niente in sospeso"} />
        <StatusTile href="/integrations" icon={<Plug className="h-4 w-4" strokeWidth={1.75} />} label="Collegamenti attivi" value={connected} tone={connections.some((c) => c.status === "ERROR") ? "bad" : "ok"} note={`su ${connections.length} configurati`} />
      </section>

      {/* Briefing + work */}
      <section className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="theme-ink chevron-pattern relative overflow-hidden rounded-[22px] bg-ink p-6 text-paper md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#6e7180]">Briefing</p>
              <h2 className="mt-1 text-xl font-medium tracking-[-0.03em]">{fmtDate(new Date(), auth.timezone)}</h2>
              <p className="mt-1 text-xs text-[#9da2b3]">{briefing ? `${briefing.generatedBy === "claude" ? "Scritto dall'assistente" : "Generato dalle regole"} · ${fmtRelative(briefing.createdAt)}` : "Lo prepara lo scheduler dopo le 7:00."}</p>
            </div>
            {canAct ? (
              <form action={regenerateBriefingAction}>
                <button className="inline-flex h-8 items-center gap-1.5 rounded-full bg-paper/10 px-3 text-xs text-paper transition-colors hover:bg-paper/20"><RefreshCw className="h-3.5 w-3.5" /> {briefing ? "Rigenera" : "Genera ora"}</button>
              </form>
            ) : null}
          </div>
          <div className="mt-5">
            {briefing ? (
              <Markdown className="[&_*]:text-paper [&_code]:bg-paper/10 [&_td]:border-paper/10 [&_th]:border-paper/10 [&_th]:text-[#9da2b3]">{briefing.content.replace(/^Sintesi:.*\n?/m, "")}</Markdown>
            ) : (
              <p className="text-sm text-[#9da2b3]">Il briefing riassume ieri, il mese in corso, avvisi, attività e approvazioni. Premi “Genera ora” per averlo subito.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Avvisi {alerts.length ? <span className="ml-1 text-sm font-normal text-graphite">{alerts.length}</span> : null}</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href="/alerts">Tutti <ArrowRight /></Link></Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {alerts.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl bg-ok-bg/60 px-3 py-3 text-sm text-ok"><CheckCircle2 className="h-4 w-4 shrink-0" />Nessun avviso aperto.{lastMonitor?.finishedAt ? ` Controllo eseguito ${fmtRelative(lastMonitor.finishedAt)}.` : ""}</div>
              ) : null}
              {alerts.map((a) => {
                const sev = ALERT_SEVERITY_LABEL[a.severity]!;
                return (
                  <div key={a.id} className="group flex items-start justify-between gap-3 rounded-xl border border-smoke/80 bg-white/40 p-3 transition-colors hover:border-steel">
                    <div className="min-w-0">
                      <Link href={a.href ?? "/alerts"} className="flex items-center gap-2 text-sm font-medium hover:underline"><Dot tone={sev.tone} />{a.title}</Link>
                      <p className="mt-1 line-clamp-2 pl-3.5 text-xs text-graphite">{a.body}</p>
                    </div>
                    {canAct ? (
                      <div className="flex shrink-0 gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                        <form action={alertToTaskAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]">→ Attività</Button></form>
                        <form action={setAlertStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="SNOOZED" /><input type="hidden" name="returnTo" value="/" /><Button size="sm" variant="ghost" className="h-7 px-2.5 text-[11px]">Rinvia 3g</Button></form>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Da fare {tasks.length ? <span className="ml-1 text-sm font-normal text-graphite">{tasks.length}</span> : null}</CardTitle>
              <div className="flex items-center gap-2">
                {approvals ? <Link href="/assistant/approvals"><Badge tone="warn">{approvals} da approvare</Badge></Link> : null}
                <Button asChild variant="ghost" size="sm"><Link href="/tasks">Tutte <ArrowRight /></Link></Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col">
              {tasks.length === 0 ? <p className="py-2 text-sm text-graphite">Nessuna attività aperta.</p> : null}
              {tasks.map((t) => {
                const pr = TASK_PRIORITY_LABEL[t.priority]!;
                const overdue = t.dueAt && t.dueAt < new Date();
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 border-b border-smoke/60 py-2.5 text-sm last:border-0">
                    <span className="flex min-w-0 items-center gap-2.5">
                      {canAct ? (
                        <form action={setTaskStatusAction}>
                          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="DONE" /><input type="hidden" name="returnTo" value="/" />
                          <button title="Segna come fatta" className="flex h-[18px] w-[18px] items-center justify-center rounded-md border border-steel text-transparent transition-colors hover:border-ok hover:bg-ok-bg hover:text-ok"><CheckCircle2 className="h-3 w-3" /></button>
                        </form>
                      ) : null}
                      <span className="truncate">{t.title}</span>
                      {t.createdBy !== "user" ? <Badge tone="outline">{t.createdBy === "agent" ? "assistente" : "monitor"}</Badge> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-graphite">
                      <Badge tone={pr.tone}>{pr.label}</Badge>
                      {t.dueAt ? <span className={overdue ? "text-bad" : ""}>{fmtDate(t.dueAt, auth.timezone)}</span> : null}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Numbers */}
      <div>
        <SectionTitle action={<PeriodFilter basePath="/" current={range.key} from={range.from} to={range.to} tz={auth.timezone} />}>Numeri · {fmtDate(range.from, auth.timezone)} → {fmtDate(range.to, auth.timezone)}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((m, i) => <MetricCard key={m.key} m={m} highlight={i === 0} />)}
        </div>
        <p className="mt-3 text-xs text-space">Ogni valore indica origine e ultimo aggiornamento. Pagamenti acquisiti e accrediti liquidati sono lo stesso denaro già contato nelle vendite: non si sommano ai ricavi.</p>
      </div>

      {/* System */}
      <section className="mt-9 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Integrazioni</CardTitle><Button asChild variant="ghost" size="sm"><Link href="/integrations">Gestisci <ArrowRight /></Link></Button></CardHeader>
          <CardContent className="flex flex-col">
            {connections.length === 0 ? <p className="text-sm text-graphite">Nessuna connessione: inizia da Shopify.</p> : null}
            {connections.map((c) => {
              const st = CONNECTION_STATUS_LABEL[c.status] ?? { label: c.status, tone: "muted" as const };
              return (
                <Link key={c.id} href={`/integrations/${c.key}`} className="flex items-center justify-between gap-3 border-b border-smoke/60 py-2.5 text-sm last:border-0 hover:text-blackout">
                  <span className="flex items-center gap-2.5"><Dot tone={st.tone} />{c.displayName}</span>
                  <span className="flex items-center gap-2 text-xs text-graphite"><span>{c.lastSyncAt ? `sync ${fmtRelative(c.lastSyncAt)}` : ""}</span><Badge tone={st.tone}>{st.label}</Badge></span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Sincronizzazioni recenti</CardTitle><Button asChild variant="ghost" size="sm"><Link href="/sync">Tutte <ArrowRight /></Link></Button></CardHeader>
          <CardContent className="flex flex-col">
            {recentJobs.length === 0 ? <p className="text-sm text-graphite">Nessun job eseguito.</p> : null}
            {recentJobs.map((j) => {
              const st = JOB_STATUS_LABEL[j.status] ?? { label: j.status, tone: "muted" as const };
              return (
                <Link key={j.id} href={`/sync/${j.id}`} className="flex items-center justify-between gap-3 border-b border-smoke/60 py-2.5 text-sm last:border-0">
                  <span className="truncate">{JOB_LABELS[j.type] ?? j.type}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-graphite"><span>{fmtRelative(j.finishedAt ?? j.createdAt)}</span><Badge tone={st.tone}>{st.label}</Badge></span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatusTile({ href, icon, label, value, note, tone }: { href: string; icon: React.ReactNode; label: string; value: number; note: string; tone: "ok" | "warn" | "bad" | "muted" }) {
  return (
    <Link href={href} className="surface group flex items-center gap-3.5 rounded-[18px] border border-[var(--hairline)] p-4 transition-transform duration-200 hover:-translate-y-0.5">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", muted: "bg-cloud text-graphite" }[tone])}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-graphite">{label}</span>
        <span className="flex items-baseline gap-2"><span className="text-xl font-medium tracking-[-0.03em] tabular">{value}</span><span className="truncate text-[11px] text-space">{note}</span></span>
      </span>
    </Link>
  );
}
