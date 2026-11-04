import Link from "next/link";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { addMemoryAction, deleteMemoryAction } from "@/server/actions/agent";
import { fmtDate } from "@/lib/format";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const rows = await db.agentMemory.findMany({ where: { organizationId: auth.organizationId }, orderBy: { updatedAt: "desc" } });
  const canEdit = hasRole(auth.role, "OPERATIONS");
  return (
    <div>
      <PageHeader title="Memoria dell'assistente" subtitle="Fatti durevoli che l'assistente usa come contesto: fornitori, obiettivi, preferenze, decisioni. Niente dati personali dei clienti." actions={<Button asChild variant="ghost" size="sm"><Link href="/assistant">← Assistente</Link></Button>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            {rows.length === 0 ? <p className="text-sm text-graphite">Memoria vuota. L&apos;assistente salva quello che gli chiedi di ricordare; puoi aggiungere fatti anche da qui.</p> : null}
            {rows.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 rounded-lg border border-smoke p-3">
                <div>
                  <p className="font-mono text-xs">{m.key} <Badge tone="muted" className="ml-1">{m.category}</Badge> <Badge tone="outline" className="ml-1">{m.source === "user" ? "inserito da te" : "salvato dall'assistente"}</Badge></p>
                  <p className="mt-1 text-sm">{m.content}</p>
                  <p className="mt-1 text-[11px] text-graphite">aggiornato {fmtDate(m.updatedAt, auth.timezone, true)}</p>
                </div>
                {canEdit ? <form action={deleteMemoryAction}><input type="hidden" name="key" value={m.key} /><Button size="sm" variant="ghost" className="text-bad">Elimina</Button></form> : null}
              </div>
            ))}
          </CardContent>
        </Card>
        {canEdit ? (
          <Card>
            <CardHeader><CardTitle>Aggiungi un fatto</CardTitle><CardDescription>Chiave breve in kebab-case, contenuto in una o due frasi.</CardDescription></CardHeader>
            <CardContent>
              <form action={addMemoryAction} className="flex flex-col gap-3">
                <Field label="Chiave"><Input name="key" placeholder="fornitore-stampa" required /></Field>
                <Field label="Categoria"><Select name="category" defaultValue="business"><option value="business">business</option><option value="preference">preference</option><option value="contact">contact</option><option value="decision">decision</option><option value="general">general</option></Select></Field>
                <Field label="Contenuto"><Textarea name="content" required placeholder="Es. Le stampe serigrafiche le fa Stamperia X a Prato, lead time 3 settimane, minimo 50 pezzi." /></Field>
                <Button type="submit" size="sm">Salva</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
