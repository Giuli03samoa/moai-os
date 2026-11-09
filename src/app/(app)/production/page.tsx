import Link from "next/link";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { createExpenseAction, createProductionOrderAction, deleteExpenseAction, setProductionStatusAction, upsertSupplierAction } from "@/server/actions/production";
import { resolvePeriod } from "@/lib/periods";
import { fmtDate, fmtMoney } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL, PRODUCTION_STATUS_LABEL } from "@/lib/labels";
import { PeriodFilter } from "@/components/period-filter";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select, TBody, TD, TH, THead, TR, Table, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const tab = sp.tab ?? "orders";
  const range = resolvePeriod(sp, auth.timezone);
  const orgId = auth.organizationId;
  const [orders, suppliers, projects, expenses, byCat] = await Promise.all([
    db.productionOrder.findMany({ where: { organizationId: orgId }, orderBy: [{ status: "asc" }, { expectedAt: "asc" }], include: { supplier: { select: { name: true } }, designProject: { select: { id: true, name: true } } } }),
    db.supplier.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, include: { _count: { select: { productionOrders: true } } } }),
    db.designProject.findMany({ where: { organizationId: orgId, archivedAt: null }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" } }),
    db.expense.findMany({ where: { organizationId: orgId, date: { gte: range.from, lte: range.to } }, orderBy: { date: "desc" }, take: 200 }),
    db.expense.groupBy({ by: ["category"], where: { organizationId: orgId, date: { gte: range.from, lte: range.to } }, _sum: { amount: true } }),
  ]);
  const canEdit = hasRole(auth.role, "OPERATIONS");
  const canMoney = hasRole(auth.role, "ACCOUNTANT");
  const openCost = orders.filter((o) => ["ORDERED", "IN_PRODUCTION", "SHIPPED"].includes(o.status)).reduce((a, o) => a + Number(o.totalCost ?? 0), 0);
  const expTotal = byCat.reduce((a, c) => a + Number(c._sum.amount ?? 0), 0);
  return (
    <div>
      <PageHeader title="Produzione e costi" subtitle="Fornitori, ordini di produzione e spese gestionali: la base per il margine stimato. MOAI OS registra e monitora; gli ordini ai fornitori li fai tu." actions={tab === "expenses" ? <PeriodFilter basePath="/production" current={range.key} from={range.from} to={range.to} tz={auth.timezone} extra={{ tab }} /> : null} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Produzione in corso</p><p className="mt-1 text-lg font-medium tabular">{fmtMoney(openCost, auth.currency)}</p><p className="text-xs text-graphite">{orders.filter((o) => ["ORDERED", "IN_PRODUCTION", "SHIPPED"].includes(o.status)).length} ordini ordinati/in produzione/spediti</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Spese nel periodo</p><p className="mt-1 text-lg font-medium tabular">{fmtMoney(expTotal, auth.currency)}</p><p className="text-xs text-graphite">{byCat.map((c) => `${EXPENSE_CATEGORY_LABEL[c.category]} ${fmtMoney(Number(c._sum.amount ?? 0), auth.currency)}`).join(" · ") || "nessuna"}</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Fornitori</p><p className="mt-1 text-lg font-medium tabular">{suppliers.length}</p><p className="text-xs text-graphite">lead time medio {suppliers.length ? Math.round(suppliers.reduce((a, s) => a + (s.leadTimeDays ?? 0), 0) / suppliers.length) : 0} giorni</p></div></Card>
      </div>
      <div className="mb-4 flex gap-1">
        {[["orders", "Ordini di produzione"], ["suppliers", "Fornitori"], ["expenses", "Spese"]].map(([t, l]) => <Link key={t} href={`/production?tab=${t}`} className={`rounded-full px-3 py-1 text-xs ${tab === t ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{l}</Link>)}
      </div>

      {tab === "orders" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card><CardContent className="pt-5">
            {orders.length === 0 ? <p className="text-sm text-graphite">Nessun ordine di produzione.</p> : (
              <Table>
                <THead><TR><TH>Rif.</TH><TH>Descrizione</TH><TH>Fornitore</TH><TH className="text-right">Q.tà</TH><TH className="text-right">Costo</TH><TH>Atteso</TH><TH>Stato</TH><TH></TH></TR></THead>
                <TBody>{orders.map((o) => { const st = PRODUCTION_STATUS_LABEL[o.status]!; const late = o.expectedAt && o.expectedAt < new Date() && !["RECEIVED", "CANCELLED"].includes(o.status); return (
                  <TR key={o.id}>
                    <TD className="whitespace-nowrap font-mono text-xs">{o.reference}</TD>
                    <TD><p>{o.description}</p>{o.designProject ? <Link href={`/design/${o.designProject.id}`} className="text-[11px] text-graphite hover:underline">{o.designProject.name}</Link> : null}</TD>
                    <TD className="text-xs">{o.supplier?.name ?? "—"}</TD>
                    <TD className="text-right tabular">{o.quantity ?? "—"}</TD>
                    <TD className="text-right tabular">{o.totalCost ? fmtMoney(o.totalCost.toString(), o.currency) : "—"}</TD>
                    <TD className={`text-xs ${late ? "text-bad" : ""}`}>{fmtDate(o.expectedAt, auth.timezone)}{o.receivedAt ? <span className="block text-ok">ricevuto {fmtDate(o.receivedAt, auth.timezone)}</span> : null}</TD>
                    <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                    <TD>{canEdit && !["RECEIVED", "CANCELLED"].includes(o.status) ? <form action={setProductionStatusAction} className="flex gap-1"><input type="hidden" name="id" value={o.id} /><Select name="status" defaultValue={o.status} className="h-7 w-36 text-xs">{Object.entries(PRODUCTION_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select><Button size="sm" variant="outline" className="h-7">OK</Button></form> : null}</TD>
                  </TR>); })}</TBody>
              </Table>
            )}
          </CardContent></Card>
          {canEdit ? <Card><CardHeader><CardTitle>Nuovo ordine di produzione</CardTitle><CardDescription>Registra cosa hai ordinato a chi, per quando e a che costo.</CardDescription></CardHeader><CardContent>
            <form action={createProductionOrderAction} className="flex flex-col gap-3">
              <Field label="Riferimento"><Input name="reference" required placeholder="PO-2026-001" /></Field>
              <Field label="Descrizione"><Input name="description" required placeholder="MOTION Tee nera, 120 pz" /></Field>
              <Field label="Fornitore"><Select name="supplierId" defaultValue=""><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Progetto design"><Select name="designProjectId" defaultValue=""><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <div className="grid grid-cols-3 gap-2"><Field label="Q.tà"><Input name="quantity" type="number" min={1} /></Field><Field label="Costo unit."><Input name="unitCost" placeholder="12,50" /></Field><Field label="Totale"><Input name="totalCost" placeholder="auto" /></Field></div>
              <div className="grid grid-cols-2 gap-2"><Field label="Ordinato il"><Input name="orderedAt" type="date" /></Field><Field label="Atteso il"><Input name="expectedAt" type="date" /></Field></div>
              <Field label="Stato"><Select name="status" defaultValue="PLANNED">{Object.entries(PRODUCTION_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
              <Field label="Note"><Textarea name="notes" className="min-h-[60px]" /></Field>
              <Button type="submit" size="sm">Registra</Button>
            </form></CardContent></Card> : null}
        </div>
      ) : null}

      {tab === "suppliers" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card><CardContent className="pt-5">
            {suppliers.length === 0 ? <p className="text-sm text-graphite">Nessun fornitore.</p> : (
              <Table>
                <THead><TR><TH>Nome</TH><TH>Categoria</TH><TH>Paese</TH><TH>Contatto</TH><TH className="text-right">Lead time</TH><TH>MOQ</TH><TH className="text-right">Ordini</TH></TR></THead>
                <TBody>{suppliers.map((s) => <TR key={s.id}><TD className="font-medium">{s.name}{s.notes ? <p className="text-xs text-graphite">{s.notes}</p> : null}</TD><TD className="text-xs">{s.category ?? "—"}</TD><TD className="text-xs">{s.country ?? "—"}</TD><TD className="text-xs">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "—"}</TD><TD className="text-right tabular">{s.leadTimeDays ? `${s.leadTimeDays} g` : "—"}</TD><TD className="text-xs">{s.minimumOrder ?? "—"}</TD><TD className="text-right tabular">{s._count.productionOrders}</TD></TR>)}</TBody>
              </Table>
            )}
          </CardContent></Card>
          {canEdit ? <Card><CardHeader><CardTitle>Fornitore</CardTitle><CardDescription>Stesso nome = aggiornamento.</CardDescription></CardHeader><CardContent>
            <form action={upsertSupplierAction} className="flex flex-col gap-3">
              <Field label="Nome"><Input name="name" required /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Categoria"><Input name="category" placeholder="stampa, tessuti, confezione" /></Field><Field label="Paese"><Input name="country" placeholder="IT" /></Field></div>
              <Field label="Referente"><Input name="contactName" /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Email"><Input name="email" type="email" /></Field><Field label="Telefono"><Input name="phone" /></Field></div>
              <div className="grid grid-cols-2 gap-2"><Field label="Lead time (giorni)"><Input name="leadTimeDays" type="number" min={0} /></Field><Field label="Minimo d'ordine"><Input name="minimumOrder" placeholder="50 pz / colore" /></Field></div>
              <Field label="Note"><Textarea name="notes" className="min-h-[60px]" /></Field>
              <Button type="submit" size="sm">Salva</Button>
            </form></CardContent></Card> : null}
        </div>
      ) : null}

      {tab === "expenses" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card><CardContent className="pt-5">
            {expenses.length === 0 ? <p className="text-sm text-graphite">Nessuna spesa nel periodo.</p> : (
              <Table>
                <THead><TR><TH>Data</TH><TH>Categoria</TH><TH>Descrizione</TH><TH>Fornitore</TH><TH className="text-right">Importo</TH><TH></TH></TR></THead>
                <TBody>{expenses.map((e) => <TR key={e.id}><TD className="text-xs">{fmtDate(e.date, auth.timezone)}</TD><TD><Badge tone="muted">{EXPENSE_CATEGORY_LABEL[e.category]}</Badge></TD><TD>{e.description}{e.recurring ? <Badge tone="outline" className="ml-1">ricorrente</Badge> : null}{e.createdBy === "agent" ? <Badge tone="outline" className="ml-1">assistente</Badge> : null}</TD><TD className="text-xs">{e.vendor ?? "—"}</TD><TD className="text-right tabular">{fmtMoney(e.amount.toString(), e.currency)}</TD><TD>{canMoney ? <form action={deleteExpenseAction}><input type="hidden" name="id" value={e.id} /><Button size="sm" variant="ghost" className="text-bad">Elimina</Button></form> : null}</TD></TR>)}</TBody>
              </Table>
            )}
          </CardContent></Card>
          {canMoney ? <Card><CardHeader><CardTitle>Nuova spesa</CardTitle><CardDescription>Dato gestionale per il margine stimato, non una scrittura contabile.</CardDescription></CardHeader><CardContent>
            <form action={createExpenseAction} className="flex flex-col gap-3">
              <Field label="Categoria"><Select name="category" defaultValue="COGS">{Object.entries(EXPENSE_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Descrizione"><Input name="description" required /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Importo"><Input name="amount" required placeholder="1.250,00" /></Field><Field label="Data"><Input name="date" type="date" required /></Field></div>
              <Field label="Fornitore"><Input name="vendor" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" /> ricorrente</label>
              <Button type="submit" size="sm">Registra</Button>
            </form></CardContent></Card> : null}
        </div>
      ) : null}
    </div>
  );
}
