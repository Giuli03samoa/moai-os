import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { JOB_LABELS } from "@/server/jobs/handlers";
import { cancelJobAction, retryJobAction } from "@/server/actions/integrations";
import { fmtDate } from "@/lib/format";
import { JOB_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, CardHeader, CardTitle, Notice, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const job = await db.syncJob.findFirst({ where: { id, organizationId: auth.organizationId }, include: { connection: { select: { key: true, displayName: true } } } });
  if (!job) notFound();
  const s = JOB_STATUS_LABEL[job.status]!;
  const canRun = hasRole(auth.role, "OPERATIONS");
  return (
    <div>
      <PageHeader title={JOB_LABELS[job.type] ?? job.type} subtitle={<span className="flex items-center gap-2"><Badge tone={s.tone}>{s.label}</Badge> {job.connection ? <Link href={`/integrations/${job.connection.key}`} className="hover:underline">{job.connection.displayName}</Link> : null} · <span className="font-mono text-xs">{job.id}</span></span>}
        actions={<>{canRun && (job.status === "DEAD" || job.status === "FAILED") ? <form action={retryJobAction}><input type="hidden" name="id" value={job.id} /><Button size="sm">Riprova adesso</Button></form> : null}{canRun && (job.status === "QUEUED" || job.status === "FAILED") ? <form action={cancelJobAction}><input type="hidden" name="id" value={job.id} /><Button size="sm" variant="outline">Annulla</Button></form> : null}<Button asChild variant="ghost" size="sm"><Link href="/sync">← Sync</Link></Button></>} />
      {job.lastError ? <div className="mb-4"><Notice tone={job.status === "DEAD" ? "bad" : "warn"}><strong>Ultimo errore:</strong> {job.lastError}</Notice></div> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_1.4fr]">
        <Card>
          <CardHeader><CardTitle>Dettagli</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {[["Tipo", job.type], ["Avviato da", job.triggeredBy], ["Tentativi", `${job.attempts} / ${job.maxAttempts}`], ["Creato", fmtDate(job.createdAt, auth.timezone, true)], ["Pianificato per", fmtDate(job.runAt, auth.timezone, true)], ["Iniziato", fmtDate(job.startedAt, auth.timezone, true)], ["Terminato", fmtDate(job.finishedAt, auth.timezone, true)], ["Worker", job.lockedBy ?? "—"], ["Chiave dedupe", job.dedupeKey ?? "—"]].map(([l, v]) => (
                <Fragment key={l}><dt className="text-graphite">{l}</dt><dd className="font-mono break-all">{v}</dd></Fragment>
              ))}
            </dl>
            <p className="mt-3 text-[11px] uppercase tracking-wide text-graphite">Payload</p>
            <pre className="mt-1 overflow-auto rounded-lg bg-cloud p-2 text-[11px]">{JSON.stringify(job.payload, null, 2)}</pre>
            <p className="mt-3 text-[11px] uppercase tracking-wide text-graphite">Risultato / checkpoint</p>
            <pre className="mt-1 overflow-auto rounded-lg bg-cloud p-2 text-[11px]">{JSON.stringify(job.result ?? {}, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Log ({job.log.length} righe)</CardTitle></CardHeader>
          <CardContent>
            {job.log.length === 0 ? <p className="text-sm text-graphite">Nessuna riga di log.</p> : <pre className="max-h-[600px] overflow-auto rounded-lg bg-blackout p-3 text-[11px] leading-relaxed text-crocus">{job.log.join("\n")}</pre>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
