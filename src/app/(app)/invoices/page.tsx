import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { uploadInvoicesAction } from "@/server/actions/invoices";
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
    ...(sp.due === "overdue" ? { paymentStatus: { in: ["UNPAID", "PARTIAL"] }, nextDueDate: { lt: new Date() } } : {}),
    ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { senderName: { contains: q.q, mode: "insensitive" } }, { receiverName: { contains: q.q, mode: "insensitive" } }, { senderVat: { contains: q.q } }, { receiverVat: { contains: q.q } }, { causale: { contains: q.q, mode: "insensitive" } }, { lines: { some: { description: { contains: q.q, mode: "insensitive" } } } }] } : {}),
  };
  const [rows, total, overdue, org, aruba] = await Promise.all([
    db.invoice.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { order: { select: { id: true, name: true } } } }),
    db.invoice.count({ where }),
    db.invoice.count({ where: { organizationId: auth.organizationId, deletedAt: null, paymentStatus: { in: ["UNPAID", "PARTIAL"] }, nextDueDate: { lt: new Date() } } }),
    db.organization.findUnique({ where: { id: auth.organizationId }, select: { vatNumber: true } }),
    db.integrationConnection.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key: "aruba" } } }),
  ]);
  const extra = { period: range.key, from: sp.from, to: sp.to, direction, due: sp.due };
  const exportQs = new URLSearchParams(Object.fromEntries(Object.entries({ period: range.key, from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>).toString();
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Archivio ricercabile delle fatture FatturaPA (emesse e ricevute). Copia di lavoro: la conservazione a norma resta su Aruba." actions={<><PeriodFilter basePath="/invoices" current={range.key} from={range.from} to={range.to} tz={auth.timezone} extra={{ direction }} /><Button asChild variant="outline" size="sm"><a href={`/api/export/invoices?${exportQs}`}>Esporta CSV</a></Button></>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      {!org?.vatNumber ? <div className="mb-4"><Notice tone="warn">Inserisci la Partita IVA in <Link href="/settings" className="underline">Settings</Link>: serve per distinguere automaticamente fatture emesse e ricevute nei file caricati a mano.</Notice></div> : null}
      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-wrap items-center gap-1">
          {[{ v: undefined, l: "Tutte" }, { v: "ACTIVE", l: "Emesse" }, { v: "PASSIVE", l: "Ricevute" }].map((f) => (
            <Link key={f.l} href={`/invoices?${new URLSearchParams({ period: range.key, ...(sp.from ? { from: sp.from, to: sp.to ?? "" } : {}), ...(f.v ? { direction: f.v } : {}) })}`} className={`rounded-full px-3 py-1 text-xs ${direction === f.v && !sp.due ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{f.l}</Link>
          ))}
          <Link href={`/invoices?period=ytd&due=overdue`} className={`rounded-full px-3 py-1 text-xs ${sp.due === "overdue" ? "bg-bad text-crocus" : "bg-bad-bg text-bad"}`}>Scadute non pagate: {overdue}</Link>
          <span className="ml-2 text-xs text-graphite">Aruba API: {aruba ? <Link href="/integrations/aruba" className="underline">{aruba.status}</Link> : <Link href="/integrations/aruba" className="underline">non configurata</Link>}</span>
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
          { key: "paymentStatus", label: "Pagamento", sortable: true, render: (r) => <Badge tone={r.paymentStatus === "PAID" ? "ok" : r.paymentStatus === "UNKNOWN" ? "muted" : r.nextDueDate && r.nextDueDate < new Date() ? "bad" : "warn"}>{INVOICE_PAYMENT_LABEL[r.paymentStatus]}</Badge> },
          { key: "nextDueDate", label: "Scadenza", sortable: true, render: (r) => fmtDate(r.nextDueDate, auth.timezone) },
          { key: "sdi", label: "SdI", render: (r) => <span className="text-xs text-graphite">{r.sdiStatus ?? "—"}</span> },
          { key: "order", label: "Ordine", render: (r) => (r.order ? <Link href={`/orders/${r.order.id}`} className="hover:underline">{r.order.name}</Link> : <span className="text-graphite">—</span>) },
          { key: "source", label: "Origine", render: (r) => <SourceTag source={r.source} updatedAt={r.syncedAt} demo={r.isDemo} /> },
        ]} />
    </div>
  );
}
