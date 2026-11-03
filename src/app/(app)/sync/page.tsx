import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { JOB_LABELS } from "@/server/jobs/handlers";
import { retryJobAction, runJobAction, scheduleNowAction } from "@/server/actions/integrations";
import { fmtDate, fmtRelative } from "@/lib/format";
import { JOB_STATUS_LABEL } from "@/lib/labels";
import { DataTable, parseTableQuery } from "@/components/data-table";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;

export default async function SyncPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const status = sp.status;
  const q = parseTableQuery(sp, { sort: "createdAt" }, ["createdAt", "type", "status", "attempts", "finishedAt"]);
  const where: Prisma.SyncJobWhereInput = { organizationId: auth.organizationId, ...(status ? { status: status as Prisma.EnumJobStatusFilter } : {}), ...(q.q ? { OR: [{ type: { contains: q.q, mode: "insensitive" } }, { lastError: { contains: q.q, mode: "insensitive" } }, { triggeredBy: { contains: q.q, mode: "insensitive" } }] } : {}) };
  const [rows, total, counts, health, lastWebhook] = await Promise.all([
    db.syncJob.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { connection: { select: { displayName: true } } } }),
    db.syncJob.count({ where }),
    db.syncJob.groupBy({ by: ["status"], where: { organizationId: auth.organizationId }, _count: { _all: true } }),
    db.syncJob.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    db.webhookEvent.findFirst({ where: { organizationId: auth.organizationId }, orderBy: { receivedAt: "desc" } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const canRun = hasRole(auth.role, "OPERATIONS");
  const workerAlive = health?.finishedAt && Date.now() - health.finishedAt.getTime() < 2 * Number(process.env.WORKER_SCHEDULE_MINUTES ?? 15) * 60_000;
  return (
    <div>
      <PageHeader title="Sync" subtitle="Coda persistente dei job: ogni sincronizzazione, errore e tentativo è visibile e recuperabile. I job falliti riprovano con backoff; quelli morti richiedono intervento."
        actions={canRun ? <><form action={scheduleNowAction}><Button type="submit" variant="outline" size="sm">Pianifica ora</Button></form><form action={runJobAction}><input type="hidden" name="type" value="reconciliation.run" /><input type="hidden" name="returnTo" value="/sync" /><Button type="submit" variant="outline" size="sm">Riconcilia</Button></form><form action={runJobAction}><input type="hidden" name="type" value="shipments.detect_problems" /><input type="hidden" name="returnTo" value="/sync" /><Button type="submit" variant="outline" size="sm">Controlla spedizioni</Button></form></> : null} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Worker</p><p className="mt-1 text-lg font-medium">{workerAlive ? <span className="text-ok">attivo</span> : count("QUEUED") + count("FAILED") > 0 ? <span className="text-bad">non risponde</span> : <span className="text-graphite">inattivo</span>}</p><p className="text-xs text-graphite">ultimo job ok {health?.finishedAt ? fmtRelative(health.finishedAt) : "mai"}</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">In coda / in corso</p><p className="mt-1 text-lg font-medium tabular">{count("QUEUED") + count("FAILED")} / {count("RUNNING")}</p><p className="text-xs text-graphite">{count("FAILED")} in attesa di nuovo tentativo</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Falliti definitivamente</p><p className={`mt-1 text-lg font-medium tabular ${count("DEAD") ? "text-bad" : ""}`}>{count("DEAD")}</p><p className="text-xs text-graphite">richiedono intervento</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Ultimo webhook</p><p className="mt-1 text-lg font-medium">{lastWebhook ? fmtRelative(lastWebhook.receivedAt) : "—"}</p><p className="text-xs text-graphite">{lastWebhook?.topic ?? "nessun webhook ricevuto"}</p></div></Card>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {[undefined, "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].map((s) => (
          <Link key={s ?? "all"} href={`/sync${s ? `?status=${s}` : ""}`} className={`rounded-full px-3 py-1 text-xs ${status === s ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{s ? JOB_STATUS_LABEL[s]?.label : "Tutti"}</Link>
        ))}
      </div>
      <DataTable rows={rows} total={total} query={q} basePath="/sync" params={{ status }} rowKey={(r) => r.id} emptyTitle="Nessun job" searchPlaceholder="Tipo, errore, origine…"
        columns={[
          { key: "type", label: "Job", sortable: true, render: (r) => <Link href={`/sync/${r.id}`} className="font-medium hover:underline">{JOB_LABELS[r.type] ?? r.type}</Link> },
          { key: "connection", label: "Connessione", render: (r) => <span className="text-xs">{r.connection?.displayName ?? "—"}</span> },
          { key: "status", label: "Stato", sortable: true, render: (r) => { const s = JOB_STATUS_LABEL[r.status]!; return <Badge tone={s.tone}>{s.label}</Badge>; } },
          { key: "attempts", label: "Tentativi", sortable: true, align: "right", render: (r) => `${r.attempts}/${r.maxAttempts}` },
          { key: "triggeredBy", label: "Origine", render: (r) => <span className="text-xs text-graphite">{r.triggeredBy}</span> },
          { key: "createdAt", label: "Creato", sortable: true, render: (r) => fmtDate(r.createdAt, auth.timezone, true) },
          { key: "finishedAt", label: "Terminato", sortable: true, render: (r) => (r.finishedAt ? fmtRelative(r.finishedAt) : r.status === "FAILED" ? `riprova ${fmtRelative(r.runAt).replace(" fa", "")}` : "—") },
          { key: "result", label: "Esito", render: (r) => <span className={`block max-w-xs truncate text-xs ${r.lastError ? "text-bad" : "text-graphite"}`} title={r.lastError ?? JSON.stringify(r.result)}>{r.lastError ?? (r.result ? JSON.stringify(r.result).slice(0, 100) : "")}</span> },
          { key: "actions", label: "", render: (r) => (canRun && (r.status === "DEAD" || r.status === "FAILED") ? <form action={retryJobAction}><input type="hidden" name="id" value={r.id} /><Button size="sm" variant="outline">Riprova</Button></form> : null) },
        ]} />
    </div>
  );
}
