import Link from "next/link";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { runMonitorNowAction } from "@/server/actions/agent";
import { alertToTaskAction, setAlertStatusAction } from "@/server/actions/tasks";
import { fmtDate, fmtRelative } from "@/lib/format";
import { ALERT_SEVERITY_LABEL, ALERT_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, Notice, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ status?: string; notice?: string }> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const status = sp.status ?? "OPEN";
  const [rows, lastRun] = await Promise.all([
    db.alert.findMany({ where: { organizationId: auth.organizationId, ...(status === "ALL" ? {} : status === "OPEN" ? { status: { in: ["OPEN", "ACKNOWLEDGED"] } } : { status: status as "RESOLVED" }) }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 200 }),
    db.syncJob.findFirst({ where: { organizationId: auth.organizationId, type: "agent.monitor" }, orderBy: { createdAt: "desc" } }),
  ]);
  const canAct = hasRole(auth.role, "OPERATIONS");
  return (
    <div>
      <PageHeader title="Avvisi" subtitle={`Il monitor controlla ogni 15 minuti ordini in ritardo, spedizioni ferme, pagamenti non riconciliati, fatture in scadenza, integrazioni, scorte, produzione e budget dell'assistente. Ultima esecuzione: ${lastRun?.finishedAt ? fmtRelative(lastRun.finishedAt) : lastRun ? lastRun.status : "mai"}.`} actions={canAct ? <form action={runMonitorNowAction}><Button type="submit" size="sm" variant="outline">Controlla ora</Button></form> : null} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      <div className="mb-3 flex flex-wrap gap-1">
        {[["OPEN", "Aperti"], ["SNOOZED", "Posticipati"], ["RESOLVED", "Risolti"], ["ALL", "Tutti"]].map(([s, l]) => (
          <Link key={s} href={`/alerts?status=${s}`} className={`rounded-full px-3 py-1 text-xs ${status === s ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{l}</Link>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {rows.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-graphite">Nessun avviso in questo stato.</CardContent></Card> : null}
        {rows.map((a) => {
          const sev = ALERT_SEVERITY_LABEL[a.severity]!;
          return (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={sev.tone}>{sev.label}</Badge><Badge tone="outline">{ALERT_STATUS_LABEL[a.status]}</Badge><span className="font-mono text-[11px] text-graphite">{a.kind}</span></div>
                  <p className="mt-1.5 font-medium">{a.href ? <Link href={a.href} className="hover:underline">{a.title} →</Link> : a.title}</p>
                  <p className="mt-0.5 text-sm text-graphite">{a.body}</p>
                  <p className="mt-1 text-[11px] text-graphite">rilevato {fmtDate(a.firstSeenAt, auth.timezone, true)} · ultimo controllo {fmtRelative(a.lastSeenAt)}{a.snoozedUntil ? ` · rinviato fino al ${fmtDate(a.snoozedUntil, auth.timezone)}` : ""}{a.resolvedAt ? ` · risolto ${fmtRelative(a.resolvedAt)}` : ""}</p>
                </div>
                {canAct && a.status !== "RESOLVED" ? (
                  <div className="flex flex-wrap gap-1">
                    <form action={alertToTaskAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="outline">Crea task</Button></form>
                    {a.status !== "ACKNOWLEDGED" ? <form action={setAlertStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="ACKNOWLEDGED" /><Button size="sm" variant="ghost">Preso in carico</Button></form> : null}
                    <form action={setAlertStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="SNOOZED" /><input type="hidden" name="days" value="7" /><Button size="sm" variant="ghost">Rinvia 7g</Button></form>
                    <form action={setAlertStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="RESOLVED" /><Button size="sm" variant="ghost">Risolto</Button></form>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
