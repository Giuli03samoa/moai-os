import Link from "next/link";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { decideApprovalAction } from "@/server/actions/agent";
import { fmtDate } from "@/lib/format";
import { APPROVAL_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, Notice, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string; status?: string }> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const status = sp.status ?? "PENDING";
  const rows = await db.agentApproval.findMany({ where: { organizationId: auth.organizationId, ...(status === "ALL" ? {} : { status: status as "PENDING" }) }, orderBy: { createdAt: "desc" }, take: 100, include: { conversation: { select: { id: true, title: true } } } });
  const canApprove = hasRole(auth.role, "OPERATIONS");
  return (
    <div>
      <PageHeader title="Approvazioni" subtitle="Azioni proposte dall'assistente che richiedono una decisione umana. Approvare esegue l'azione con la tua identità; tutto finisce nell'audit log." actions={<Button asChild variant="ghost" size="sm"><Link href="/assistant">← Assistente</Link></Button>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      <div className="mb-3 flex flex-wrap gap-1">
        {["PENDING", "APPROVED", "REJECTED", "FAILED", "EXPIRED", "ALL"].map((s) => (
          <Link key={s} href={`/assistant/approvals?status=${s}`} className={`rounded-full px-3 py-1 text-xs ${status === s ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{s === "ALL" ? "Tutte" : APPROVAL_STATUS_LABEL[s]?.label ?? s}</Link>
        ))}
      </div>
      <Card>
        <CardContent className="pt-5">
          {rows.length === 0 ? <p className="text-sm text-graphite">Nessuna richiesta.</p> : (
            <Table>
              <THead><TR><TH>Quando</TH><TH>Azione</TH><TH>Cosa</TH><TH>Ruolo</TH><TH>Stato</TH><TH>Conversazione</TH><TH></TH></TR></THead>
              <TBody>
                {rows.map((a) => {
                  const st = APPROVAL_STATUS_LABEL[a.status]!;
                  return (
                    <TR key={a.id}>
                      <TD className="whitespace-nowrap text-xs">{fmtDate(a.createdAt, auth.timezone, true)}</TD>
                      <TD className="font-mono text-xs">{a.toolName}</TD>
                      <TD className="max-w-md text-xs">{a.summary}{a.error ? <span className="block text-bad">{a.error}</span> : null}</TD>
                      <TD className="text-xs">{a.requiredRole}</TD>
                      <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                      <TD className="max-w-[160px] truncate text-xs">{a.conversation ? <Link href={`/assistant?c=${a.conversation.id}`} className="hover:underline">{a.conversation.title}</Link> : "—"}</TD>
                      <TD>{a.status === "PENDING" && canApprove ? <div className="flex gap-1"><form action={decideApprovalAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="APPROVE" /><Button size="sm">Approva</Button></form><form action={decideApprovalAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="REJECT" /><Button size="sm" variant="outline">Rifiuta</Button></form></div> : null}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
