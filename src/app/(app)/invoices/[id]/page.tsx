import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { setInstallmentPaidAction } from "@/server/actions/invoices";
import { fmtDate, fmtMoney } from "@/lib/format";
import { DOC_TYPE_LABEL, INVOICE_PAYMENT_LABEL, RECONCILIATION_STATUS_LABEL } from "@/lib/labels";
import { SourceTag } from "@/components/source-tag";
import { Badge, Card, CardContent, CardHeader, CardTitle, Notice, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const inv = await db.invoice.findFirst({ where: { id, organizationId: auth.organizationId }, include: { lines: { orderBy: { lineNumber: "asc" } }, installments: { orderBy: { position: "asc" } }, order: true, document: true, reconciliations: { include: { order: true }, orderBy: { createdAt: "desc" } } } });
  if (!inv) notFound();
  const money = (v: { toString(): string }) => fmtMoney(v.toString(), inv.currency);
  const canPay = hasRole(auth.role, "ACCOUNTANT");
  return (
    <div>
      <PageHeader title={`${DOC_TYPE_LABEL[inv.documentType] ?? inv.documentType} ${inv.number}`} subtitle={<span className="flex flex-wrap items-center gap-2">{fmtDate(inv.issueDate, auth.timezone)} · <Badge tone={inv.direction === "ACTIVE" ? "dark" : "outline"}>{inv.direction === "ACTIVE" ? "emessa" : "ricevuta"}</Badge> · <SourceTag source={inv.source} updatedAt={inv.syncedAt} demo={inv.isDemo} />{inv.sdiId ? <span className="font-mono text-xs">SdI {inv.sdiId}</span> : null}</span>}
        actions={<>{inv.document ? <Button asChild variant="outline" size="sm"><a href={`/api/documents/${inv.document.id}`}>Scarica {inv.document.kind === "INVOICE_P7M" ? "P7M" : "XML"}</a></Button> : null}<Button asChild variant="ghost" size="sm"><Link href="/invoices">← Fatture</Link></Button></>} />
      {inv.parseWarnings.length ? <div className="mb-4 flex flex-col gap-2">{inv.parseWarnings.map((w, i) => <Notice key={i} tone="warn">{w}</Notice>)}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["Totale documento", money(inv.totalAmount)], ["Imponibile", money(inv.taxableAmount)], ["Imposta", money(inv.taxAmount)], ["Pagamento", INVOICE_PAYMENT_LABEL[inv.paymentStatus]], ["Stato SdI", inv.sdiStatus ?? "—"], ["Prossima scadenza", fmtDate(inv.nextDueDate, auth.timezone)], ["Formato/file", inv.filename ?? "—"], ["Ordine collegato", inv.order ? inv.order.name : "—"]].map(([l, v]) => (
          <Card key={l}><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">{l}</p><p className="mt-1 truncate text-lg font-medium tabular" title={String(v)}>{v}</p></div></Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Soggetti</CardTitle></CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <div><p className="text-[11px] uppercase tracking-wide text-graphite">Cedente / prestatore</p><p className="font-medium">{inv.senderName}</p><p className="text-xs text-graphite">{inv.senderCountry}{inv.senderVat} {inv.senderFiscalCode ? `· CF ${inv.senderFiscalCode}` : ""}</p></div>
            <div><p className="text-[11px] uppercase tracking-wide text-graphite">Cessionario / committente</p><p className="font-medium">{inv.receiverName}</p><p className="text-xs text-graphite">{inv.receiverCountry}{inv.receiverVat} {inv.receiverFiscalCode ? `· CF ${inv.receiverFiscalCode}` : ""}</p></div>
            {inv.causale ? <div className="sm:col-span-2"><p className="text-[11px] uppercase tracking-wide text-graphite">Causale</p><p className="text-xs">{inv.causale}</p></div> : null}
            {inv.orderReference ? <div><p className="text-[11px] uppercase tracking-wide text-graphite">Riferimento ordine (DatiOrdineAcquisto)</p><p className="font-mono text-xs">{inv.orderReference}</p></div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Scadenze e pagamenti</CardTitle></CardHeader>
          <CardContent>
            {inv.installments.length === 0 ? <p className="text-sm text-graphite">Nessun DatiPagamento nel documento.</p> : (
              <Table>
                <THead><TR><TH>#</TH><TH>Modalità</TH><TH>Scadenza</TH><TH className="text-right">Importo</TH><TH>Stato</TH>{canPay ? <TH></TH> : null}</TR></THead>
                <TBody>
                  {inv.installments.map((i) => (
                    <TR key={i.id}>
                      <TD>{i.position + 1}</TD><TD className="text-xs">{i.method ?? "—"}</TD><TD>{fmtDate(i.dueDate, auth.timezone)}</TD><TD className="text-right tabular">{money(i.amount)}</TD>
                      <TD>{i.paidAt ? <Badge tone="ok">pagata {fmtDate(i.paidAt, auth.timezone)}</Badge> : i.dueDate && i.dueDate < new Date() ? <Badge tone="bad">scaduta</Badge> : <Badge tone="warn">da pagare</Badge>}</TD>
                      {canPay ? <TD><form action={setInstallmentPaidAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="paid" value={i.paidAt ? "false" : "true"} /><Button size="sm" variant="outline">{i.paidAt ? "Segna non pagata" : "Segna pagata"}</Button></form></TD> : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <p className="mt-2 text-xs text-graphite">Lo stato di pagamento è una decisione umana tracciata nell&apos;audit log. Nessun pagamento viene mai eseguito da MOAI OS.</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Righe</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>#</TH><TH>Descrizione</TH><TH className="text-right">Qtà</TH><TH className="text-right">Prezzo unit.</TH><TH className="text-right">Totale</TH><TH className="text-right">IVA %</TH><TH>Natura</TH></TR></THead>
              <TBody>
                {inv.lines.map((l) => (
                  <TR key={l.id}><TD>{l.lineNumber}</TD><TD className="text-xs">{l.description}</TD><TD className="text-right tabular">{l.quantity?.toString() ?? "—"}</TD><TD className="text-right tabular">{l.unitPrice.toFixed(2)}</TD><TD className="text-right tabular">{money(l.totalPrice)}</TD><TD className="text-right tabular">{l.vatRate.toFixed(0)}</TD><TD className="text-xs">{l.natura ?? ""}</TD></TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        {inv.reconciliations.length ? (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Collegamenti a ordini</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <THead><TR><TH>Ordine</TH><TH>Stato</TH><TH>Regola</TH><TH>Spiegazione</TH></TR></THead>
                <TBody>{inv.reconciliations.map((r) => { const st = RECONCILIATION_STATUS_LABEL[r.status]!; return <TR key={r.id}><TD>{r.order ? <Link href={`/orders/${r.order.id}`} className="hover:underline">{r.order.name}</Link> : "—"}</TD><TD><Badge tone={st.tone}>{st.label}</Badge></TD><TD className="font-mono text-[11px]">{r.rule}</TD><TD className="text-xs">{r.explanation}</TD></TR>; })}</TBody>
              </Table>
              <p className="mt-2 text-xs text-graphite">Le proposte si confermano in Payments → Riconciliazione.</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
