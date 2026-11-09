import Link from "next/link";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { createTaskAction, setTaskStatusAction } from "@/server/actions/tasks";
import { fmtDate, fmtRelative } from "@/lib/format";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select, TBody, TD, TH, THead, TR, Table, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string; notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const filter = sp.filter ?? "open";
  const now = new Date();
  const rows = await db.task.findMany({
    where: { organizationId: auth.organizationId, ...(filter === "done" ? { status: { in: ["DONE", "CANCELLED"] } } : filter === "overdue" ? { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } } : filter === "all" ? {} : { status: { in: ["OPEN", "IN_PROGRESS"] } }) },
    orderBy: filter === "done" ? [{ completedAt: "desc" }] : [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const canAct = hasRole(auth.role, "OPERATIONS");
  return (
    <div>
      <PageHeader title="Attività" subtitle="Il lavoro da fare, creato da te, dall'assistente o dagli avvisi. Chiedi all'assistente di trasformare una checklist in task." />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="mb-3 flex flex-wrap gap-1">
        {[["open", "Aperti"], ["overdue", "Scaduti"], ["done", "Completati"], ["all", "Tutti"]].map(([f, l]) => (
          <Link key={f} href={`/tasks?filter=${f}`} className={`rounded-full px-3 py-1 text-xs ${filter === f ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{l}</Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardContent className="pt-5">
            {rows.length === 0 ? <p className="text-sm text-graphite">Nessun task.</p> : (
              <Table>
                <THead><TR><TH>Priorità</TH><TH>Task</TH><TH>Scadenza</TH><TH>Origine</TH><TH>Stato</TH><TH></TH></TR></THead>
                <TBody>
                  {rows.map((t) => {
                    const pr = TASK_PRIORITY_LABEL[t.priority]!;
                    const st = TASK_STATUS_LABEL[t.status]!;
                    const overdue = t.dueAt && t.dueAt < now && (t.status === "OPEN" || t.status === "IN_PROGRESS");
                    return (
                      <TR key={t.id}>
                        <TD><Badge tone={pr.tone}>{pr.label}</Badge></TD>
                        <TD><p className="font-medium">{t.title}</p>{t.description ? <p className="mt-0.5 max-w-lg whitespace-pre-line text-xs text-graphite">{t.description}</p> : null}{t.linkedType ? <p className="text-[11px] text-space">{t.linkedType} {t.linkedId?.slice(0, 10)}</p> : null}</TD>
                        <TD className={`whitespace-nowrap text-xs ${overdue ? "text-bad" : ""}`}>{t.dueAt ? fmtDate(t.dueAt, auth.timezone) : "—"}</TD>
                        <TD className="text-xs text-graphite">{t.createdBy === "agent" ? "assistente" : t.createdBy === "monitor" ? "monitor" : "manuale"} · {fmtRelative(t.createdAt)}</TD>
                        <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                        <TD>{canAct && (t.status === "OPEN" || t.status === "IN_PROGRESS") ? <div className="flex gap-1">{t.status === "OPEN" ? <form action={setTaskStatusAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="IN_PROGRESS" /><input type="hidden" name="returnTo" value={`/tasks?filter=${filter}`} /><Button size="sm" variant="ghost">In corso</Button></form> : null}<form action={setTaskStatusAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="DONE" /><input type="hidden" name="returnTo" value={`/tasks?filter=${filter}`} /><Button size="sm" variant="outline">Fatto</Button></form><form action={setTaskStatusAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="CANCELLED" /><input type="hidden" name="returnTo" value={`/tasks?filter=${filter}`} /><Button size="sm" variant="ghost" className="text-graphite">Annulla</Button></form></div> : null}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {canAct ? (
          <Card>
            <CardHeader><CardTitle>Nuovo task</CardTitle></CardHeader>
            <CardContent>
              <form action={createTaskAction} className="flex flex-col gap-3">
                <Field label="Titolo"><Input name="title" required minLength={3} /></Field>
                <Field label="Descrizione"><Textarea name="description" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Priorità"><Select name="priority" defaultValue="NORMAL">{Object.entries(TASK_PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
                  <Field label="Scadenza"><Input name="dueAt" type="date" /></Field>
                </div>
                <Button type="submit" size="sm">Crea</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
