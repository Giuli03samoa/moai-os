import { CONNECTION_STATUS_LABEL } from "@/lib/labels";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { confirmInvoicePaymentAction, uploadInvoicesAction } from "@/server/actions/invoices";
import { resolvePeriod } from "@/lib/periods";
import { fmtDate, fmtMoney } from "@/lib/format";
import { DOC_TYPE_LABEL, INVOICE_PAYMENT_LABEL } from "@/lib/labels";
import { DataTable, parseTableQuery } from "@/components/data-table";
import { PeriodFilter } from "@/components/period-filter";
import { SourceTag } from "@/components/source-tag";
import { Badge, Card, CardContent, Input, Notice, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const range = resolvePeriod(sp, auth.timezone);
  const direction = sp.direction === "ACTIVE" || sp.direction === "PASSIVE" ? sp.direction : undefined;
  const q = parseTableQuery(sp, { sort: "issueDate" }, ["issueDate", "number", "totalAmount", "senderName", "receiverName", "paymentStatus", "nextDueDate"]);
  const where: Prisma.InvoiceWhereInput = {
    organizationId: auth.organizationId, deletedAt: null, issueDate: { gte: range.from, lte: range.to }, ...(direction ? { direction } : {}),
    ...(sp.due === "overdue" ? { paymentStatus: { in: ["UNPAID", "PARTIAL"] }, paymentToConfirm: false, nextDueDate: { lt: new Date() } } : {}),
    ...(sp.confirm === "1" ? { paymentToConfirm: true } : {}),
    ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { senderName: { contains: q.q, mode: "insensitive" } }, { receiverName: { contains: q.q, mode: "insensitive" } }, { senderVat: { contains: q.q } }, { receiverVat: { contains: q.q } }, { causale: { contains: q.q, mode: "insensitive" } }, { lines: { some: { description: { contains: q.q, mode: "insensitive" } } } }] } : {}),
  };
  const [rows, total, overdue, org, aruba, toConfirm] = await Promise.all([
    db.invoice.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { order: { select: { id: true, name: true } } } }),
    db.invoice.count({ where }),
    db.invoice.count({ where: { organizationId: auth.organizationId, deletedAt: null, paymentStatus: { in: ["UNPAID", "PARTIAL"] }, paymentToConfirm: false, nextDueDate: { lt: new Date() } } }),
    db.organization.findUnique({ where: { id: auth.organizationId }, select: { vatNumber: true } }),
    db.integrationConnection.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key: "aruba" } } }),
    db.invoice.findMany({ where: { organizationId: auth.organizationId, deletedAt: null, paymentToConfirm: true }, orderBy: { issueDate: "asc" }, take: 100, select: { id: true, number: true, issueDate: true, senderName: true, totalAmount: true, currency: true, nextDueDate: true, documentType: true } }),
  ]);
  const canDecide = hasRole(auth.role, "ACCOUNTANT");
  const extra = { period: range.key, from: sp.from, to: sp.to, direction, due: sp.due, confirm: sp.confirm };
  const exportQs = new URLSearchParams(Object.fromEntries(Object.entries({ period: range.key, from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>).toString();
  return (
    <div>
      <PageHeader title="Fatture" subtitle="Archivio ricercabile delle fatture FatturaPA (emesse e ricevute). Copia di lavoro: la conservazione a norma resta su Aruba." actions={<><PeriodFilter basePath="/invoices" current={range.key} from={range.from} to={range.to} tz={auth.timezone} extra={{ direction }} /><Button asChild variant="outline" size="sm"><a href={`/api/export/invoices?${exportQs}`}>Esporta CSV</a></Button></>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      {toConfirm.length ? (
        <Card className="mb-6 overflow-hidden border-warn/30">
          <div className="flex flex-wrap items-start justify-between gap-3 bg-warn-bg/60 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[15px] font-medium tracking-[-0.02em]">{toConfirm.length === 1 ? "1 fattura importata da confermare" : `${toConfirm.length} fatture importate da confermare`}</p>
              <p className="mt-0.5 text-xs text-graphite">Sono arrivate già oltre la scadenza: MOAI OS non sa se le hai pagate. Finché non rispondi non contano come scadute e non mandano avvisi.</p>
            </div>
            {canDecide ? (
              <form action={confirmInvoicePaymentAction} className="flex gap-2">
                {toConfirm.map((i) => <input key={i.id} type="hidden" name="id" value={i.id} />)}
                <input type="hidden" name="decision" value="paid" />
                <Button size="sm">Sono tutte pagate</Button>
              </form>
            ) : null}
          </div>
          <div className="divide-y divide-[var(--hairline)]">
            {toConfirm.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0"><Link href={`/invoices/${i.id}`} className="font-medium hover:underline">{i.senderName}</Link><span className="text-xs text-graphite"> · n. {i.number} del {fmtDate(i.issueDate, auth.timezone)}{i.nextDueDate ? ` · scadenza ${fmtDate(i.nextDueDate, auth.timezone)}` : ""}</span></span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{fmtMoney(i.totalAmount.toString(), i.currency)}</span>
                  {canDecide ? (
                    <>
                      <form action={confirmInvoicePaymentAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="decision" value="paid" /><Button size="sm" variant="outline" className="h-7 text-xs">Pagata</Button></form>
                      <form action={confirmInvoicePaymentAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="decision" value="unpaid" /><Button size="sm" variant="ghost" className="h-7 text-xs">Da pagare</Button></form>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {!org?.vatNumber ? <div className="mb-4"><Notice tone="warn">Inserisci la Partita IVA in <Link href="/settings" className="underline">Settings</Link>: serve per distinguere automaticamente fatture emesse e ricevute nei file caricati a mano.</Notice></div> : null}
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-wrap items-center gap-1">
          {[{ v: undefined, l: "Tutte" }, { v: "ACTIVE", l: "Emesse" }, { v: "PASSIVE", l: "Ricevute" }].map((f) => (
            <Link key={f.l} href={`/invoices?${new URLSearchParams({ period: range.key, ...(sp.from ? { from: sp.from, to: sp.to ?? "" } : {}), ...(f.v ? { direction: f.v } : {}) })}`} className={`rounded-full px-3 py-1 text-xs ${direction === f.v && !sp.due && !sp.confirm ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{f.l}</Link>
          ))}
          {toConfirm.length ? <Link href="/invoices?period=ytd&confirm=1" className={`rounded-full px-3 py-1 text-xs ${sp.confirm === "1" ? "bg-warn text-crocus" : "bg-warn-bg text-warn"}`}>Da confermare: {toConfirm.length}</Link> : null}
          <Link href={`/invoices?period=ytd&due=overdue`} className={`rounded-full px-3 py-1 text-xs ${sp.due === "overdue" ? "bg-bad text-crocus" : "bg-bad-bg text-bad"}`}>Scadute non pagate: {overdue}</Link>
          <span className="ml-2 text-xs text-graphite">Aruba: {aruba ? <Link href="/integrations/aruba" className="underline">{CONNECTION_STATUS_LABEL[aruba.status]?.label ?? aruba.status}</Link> : <Link href="/integrations/aruba" className="underline">non configurata</Link>}</span>
        </div>
        {hasRole(auth.role, "OPERATIONS") ? (
          <Card className="min-w-[320px]">
            <CardContent className="p-3">
              <form action={uploadInvoicesAction} className="flex items-center gap-2">
                <Input type="file" name="files" accept=".xml,.p7m,application/xml,text/xml" multiple required className="h-8 text-xs file:mr-2 file:rounded-full file:border-0 file:bg-blackout file:px-2 file:py-0.5 file:text-[11px] file:text-crocus" />
                <Button type="submit" size="sm">Carica XML/P7M</Button>
              </form>
              <p className="mt-1 text-[11px] text-graphite">Importazione manuale alternativa all&apos;API Aruba. Doppioni riconosciuti e aggiornati, mai duplicati.</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
      <DataTable rows={rows} total={total} query={q} basePath="/invoices" params={extra} rowKey={(r) => r.id} emptyTitle="Nessuna fattura nel periodo" searchPlaceholder="Numero, cedente, P.IVA, descrizione riga…"
        columns={[
          { key: "direction", label: "", render: (r) => <Badge tone={r.direction === "ACTIVE" ? "dark" : "outline"}>{r.direction === "ACTIVE" ? "emessa" : "ricevuta"}</Badge> },
          { key: "number", label: "Numero", sortable: true, render: (r) => <Link href={`/invoices/${r.id}`} className="font-medium hover:underline">{r.number}</Link> },
          { key: "documentType", label: "Tipo", render: (r) => <span className="text-xs">{DOC_TYPE_LABEL[r.documentType] ?? r.documentType}</span> },
          { key: "issueDate", label: "Data", sortable: true, render: (r) => fmtDate(r.issueDate, auth.timezone) },
          { key: "senderName", label: "Cedente", sortable: true, render: (r) => <span className="text-xs">{r.senderName}</span> },
          { key: "receiverName", label: "Cessionario", sortable: true, render: (r) => <span className="text-xs">{r.receiverName}</span> },
          { key: "totalAmount", label: "Totale", sortable: true, align: "right", render: (r) => <span className={`font-medium ${r.documentType === "TD04" ? "text-bad" : ""}`}>{r.documentType === "TD04" ? "−" : ""}{fmtMoney(r.totalAmount.toString(), r.currency)}</span> },
          { key: "paymentStatus", label: "Pagamento", sortable: true, render: (r) => r.paymentToConfirm ? <Badge tone="warn">da confermare</Badge> : <Badge tone={r.paymentStatus === "PAID" ? "ok" : r.paymentStatus === "UNKNOWN" ? "muted" : r.nextDueDate && r.nextDueDate < new Date() ? "bad" : "warn"}>{INVOICE_PAYMENT_LABEL[r.paymentStatus]}</Badge> },
          { key: "nextDueDate", label: "Scadenza", sortable: true, render: (r) => fmtDate(r.nextDueDate, auth.timezone) },
          { key: "sdi", label: "SdI", render: (r) => <span className="text-xs text-graphite">{r.sdiStatus ?? "—"}</span> },
          { key: "order", label: "Ordine", render: (r) => (r.order ? <Link href={`/orders/${r.order.id}`} className="hover:underline">{r.order.name}</Link> : <span className="text-graphite">—</span>) },
          { key: "source", label: "Origine", render: (r) => <SourceTag source={r.source} updatedAt={r.syncedAt} demo={r.isDemo} /> },
        ]} />
    </div>
  );
}
