import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { createManualShipmentAction } from "@/server/actions/shipping";
import { fmtDate, fmtMoney } from "@/lib/format";
import { FINANCIAL_STATUS_LABEL, FULFILLMENT_STATUS_LABEL, PAYMENT_KIND_LABEL, RECONCILIATION_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/labels";
import { SourceTag } from "@/components/source-tag";
import { Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, Notice, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const order = await db.order.findFirst({
    where: { id, organizationId: auth.organizationId },
    include: {
      items: { include: { variant: { select: { id: true, sku: true } } } },
      customer: true,
      payments: { orderBy: [{ ledger: "asc" }, { processedAt: "asc" }] },
      shipments: { orderBy: { shippedAt: "desc" } },
      invoices: true,
      reconciliations: { include: { paymentTransaction: { select: { provider: true, externalId: true, amount: true, currency: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) notFound();
  const processorTx = await db.paymentTransaction.findMany({ where: { organizationId: auth.organizationId, ledger: "PROCESSOR", OR: [{ orderId: order.id }, { reconciliations: { some: { orderId: order.id, status: { in: ["AUTO_MATCHED", "CONFIRMED"] } } } }] }, include: { payout: { select: { id: true, externalId: true, status: true, arrivalDate: true } } } });
  const money = (v: { toString(): string }, cur = order.currency) => fmtMoney(v.toString(), cur);

  return (
    <div>
      <PageHeader
        title={`Ordine ${order.name}`}
        subtitle={<span className="flex items-center gap-2">{fmtDate(order.processedAt, auth.timezone, true)} · <SourceTag source={order.source} updatedAt={order.syncedAt} demo={order.isDemo} /> · <span className="font-mono text-xs">{order.externalId}</span></span>}
        actions={<Button asChild variant="ghost" size="sm"><Link href="/orders">← Ordini</Link></Button>}
      />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Totale", money(order.totalPrice)], ["Subtotale", money(order.subtotalPrice)], ["Spedizione", money(order.totalShipping)], ["IVA", money(order.totalTax)],
          ["Sconti", money(order.totalDiscounts)], ["Rimborsato", money(order.totalRefunded)],
          ["Pagamento", FINANCIAL_STATUS_LABEL[order.financialStatus] ?? order.financialStatus], ["Evasione", FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus] ?? order.fulfillmentStatus],
        ].map(([l, v]) => (
          <Card key={l}><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">{l}</p><p className="mt-1 text-lg font-medium tabular">{v}</p></div></Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Articoli</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>SKU</TH><TH>Articolo</TH><TH className="text-right">Qtà</TH><TH className="text-right">Prezzo</TH><TH className="text-right">Sconto</TH></TR></THead>
              <TBody>
                {order.items.map((i) => (
                  <TR key={i.id}><TD className="font-mono text-xs">{i.sku ?? "—"}</TD><TD>{i.title}</TD><TD className="text-right tabular">{i.quantity}</TD><TD className="text-right tabular">{money(i.unitPrice)}</TD><TD className="text-right tabular">{i.totalDiscount.isZero() ? "—" : money(i.totalDiscount)}</TD></TR>
                ))}
              </TBody>
            </Table>
            <div className="mt-3 text-xs text-graphite">
              Cliente: {order.customer ? order.customer.displayName ?? order.customer.email ?? <span className="font-mono">{order.customer.externalId}</span> : "—"}
              {order.customer && !order.customer.displayName ? " (dati personali non importati: permessi/impostazione)" : ""}
              {order.tags.length ? <> · Tag: {order.tags.join(", ")}</> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pagamenti</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-graphite">Ledger ordine (cosa ha registrato il negozio)</p>
              <Table>
                <THead><TR><TH>Data</TH><TH>Tipo</TH><TH>Gateway</TH><TH>Stato</TH><TH className="text-right">Importo</TH></TR></THead>
                <TBody>
                  {order.payments.filter((p) => p.ledger === "ORDER").map((p) => (
                    <TR key={p.id}><TD>{fmtDate(p.processedAt, auth.timezone, true)}</TD><TD>{PAYMENT_KIND_LABEL[p.kind] ?? p.kind}</TD><TD>{p.provider}</TD><TD><Badge tone={p.status === "SUCCESS" ? "ok" : p.status === "PENDING" ? "warn" : "bad"}>{p.status}</Badge></TD><TD className="text-right tabular">{money(p.amount, p.currency)}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-graphite">Ledger gateway (commissioni, netto, payout) — collegato tramite riconciliazione</p>
              {processorTx.length === 0 ? <p className="text-sm text-graphite">Nessuna transazione gateway collegata. Importa i dati del gateway (API o CSV) e avvia la riconciliazione.</p> : (
                <Table>
                  <THead><TR><TH>Data</TH><TH>Gateway</TH><TH>Tipo</TH><TH className="text-right">Lordo</TH><TH className="text-right">Commissione</TH><TH className="text-right">Netto</TH><TH>Payout</TH></TR></THead>
                  <TBody>
                    {processorTx.map((p) => (
                      <TR key={p.id}><TD>{fmtDate(p.processedAt, auth.timezone)}</TD><TD>{p.provider}</TD><TD>{PAYMENT_KIND_LABEL[p.kind] ?? p.kind}</TD><TD className="text-right tabular">{money(p.amount, p.currency)}</TD><TD className="text-right tabular">{p.fee ? money(p.fee, p.currency) : "—"}</TD><TD className="text-right tabular">{p.net ? money(p.net, p.currency) : "—"}</TD>
                        <TD className="text-xs">{p.payout ? <>{p.payout.status} {p.payout.arrivalDate ? fmtDate(p.payout.arrivalDate, auth.timezone) : ""}</> : p.payoutExternalId ?? "—"}</TD></TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Spedizioni</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {order.shipments.length === 0 ? <p className="text-sm text-graphite">Nessuna spedizione registrata.</p> : (
              <Table>
                <THead><TR><TH>Stato</TH><TH>Corriere</TH><TH>Tracking</TH><TH>Rif. Packlink</TH><TH className="text-right">Costo</TH><TH>Origine</TH></TR></THead>
                <TBody>
                  {order.shipments.map((s) => (
                    <TR key={s.id}>
                      <TD><Link href={`/shipping/${s.id}`}><Badge tone={s.status === "DELIVERED" ? "ok" : s.problem ? "bad" : "muted"}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge></Link></TD>
                      <TD>{s.carrier ?? "—"}</TD>
                      <TD className="font-mono text-xs">{s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="hover:underline">{s.trackingNumber}</a> : s.trackingNumber ?? "—"}</TD>
                      <TD className="font-mono text-xs">{s.packlinkReference ?? "—"}</TD>
                      <TD className="text-right tabular">{s.cost ? money(s.cost, s.costCurrency ?? order.currency) : "—"}</TD>
                      <TD><SourceTag source={s.source} updatedAt={s.syncedAt} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {hasRole(auth.role, "OPERATIONS") ? (
              <details className="rounded-lg border border-smoke p-3">
                <summary className="cursor-pointer text-sm font-medium">Registra spedizione manuale</summary>
                <form action={createManualShipmentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="orderId" value={order.id} />
                  <Field label="Corriere"><Input name="carrier" /></Field>
                  <Field label="Tracking"><Input name="trackingNumber" /></Field>
                  <Field label="Riferimento Packlink"><Input name="packlinkReference" /></Field>
                  <Field label="Costo (€)"><Input name="cost" placeholder="7,90" /></Field>
                  <div className="sm:col-span-2"><Button type="submit" size="sm">Registra</Button><span className="ml-3 text-xs text-graphite">Non crea nulla su Packlink: registra solo ciò che è già stato spedito.</span></div>
                </form>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fatture e riconciliazioni</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {order.invoices.length === 0 ? <p className="text-sm text-graphite">Nessuna fattura collegata.</p> : order.invoices.map((i) => (
              <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between text-sm hover:underline">
                <span>{i.documentType} {i.number} · {fmtDate(i.issueDate, auth.timezone)}</span><span className="tabular">{money(i.totalAmount, i.currency)}</span>
              </Link>
            ))}
            {order.reconciliations.length ? (
              <Table>
                <THead><TR><TH>Tipo</TH><TH>Stato</TH><TH>Regola</TH><TH>Spiegazione</TH></TR></THead>
                <TBody>
                  {order.reconciliations.map((r) => {
                    const st = RECONCILIATION_STATUS_LABEL[r.status]!;
                    return <TR key={r.id}><TD className="text-xs">{r.type}</TD><TD><Badge tone={st.tone}>{st.label}</Badge></TD><TD className="font-mono text-[11px]">{r.rule}</TD><TD className="text-xs">{r.explanation}</TD></TR>;
                  })}
                </TBody>
              </Table>
            ) : <p className="text-sm text-graphite">Nessuna riconciliazione per questo ordine.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
