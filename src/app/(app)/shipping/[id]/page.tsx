import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { updateShipmentAction } from "@/server/actions/shipping";
import { fmtDate } from "@/lib/format";
import { SHIPMENT_STATUS_LABEL } from "@/lib/labels";
import { SourceTag } from "@/components/source-tag";
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function ShipmentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const s = await db.shipment.findFirst({ where: { id, organizationId: auth.organizationId }, include: { order: true } });
  if (!s) notFound();
  const audit = await db.auditLog.findMany({ where: { organizationId: auth.organizationId, entityType: "Shipment", entityId: id }, orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { name: true } } } });
  const canEdit = hasRole(auth.role, "OPERATIONS");
  return (
    <div>
      <PageHeader title={`Spedizione ${s.trackingNumber ?? s.packlinkReference ?? s.externalId.slice(0, 12)}`} subtitle={<span className="flex items-center gap-2">{s.order ? <Link href={`/orders/${s.order.id}`} className="hover:underline">Ordine {s.order.name}</Link> : "Senza ordine"} · <SourceTag source={s.source} updatedAt={s.syncedAt} demo={s.isDemo} /></span>} actions={<Button asChild variant="ghost" size="sm"><Link href="/shipping">← Spedizioni</Link></Button>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Dati spedizione</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[["Stato", SHIPMENT_STATUS_LABEL[s.status]], ["Stato grezzo", s.rawStatus ?? "—"], ["Corriere", s.carrier ?? "—"], ["Servizio", s.service ?? "—"], ["Tracking", s.trackingNumber ?? "—"], ["Rif. Packlink", s.packlinkReference ?? "—"], ["Fulfillment Shopify", s.shopifyFulfillmentId ?? "—"], ["Spedita", fmtDate(s.shippedAt, auth.timezone, true)], ["Consegnata", fmtDate(s.deliveredAt, auth.timezone, true)], ["Ultimo evento", fmtDate(s.lastEventAt, auth.timezone, true)], ["Costo", s.cost ? `${s.cost.toFixed(2)} ${s.costCurrency ?? ""} (${s.costSource ?? ""})` : "—"], ["Problema", s.problem ? s.problemReason ?? "sì" : "no"]].map(([l, v]) => (
                <div key={l}><dt className="text-[11px] uppercase tracking-wide text-graphite">{l}</dt><dd className="font-mono text-xs">{v}</dd></div>
              ))}
            </dl>
            {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm underline">Apri tracking del corriere</a> : null}
          </CardContent>
        </Card>
        {canEdit ? (
          <Card>
            <CardHeader><CardTitle>Aggiornamento manuale (tracciato)</CardTitle></CardHeader>
            <CardContent>
              <form action={updateShipmentAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={s.id} />
                <Field label="Stato"><Select name="status" defaultValue={s.status}>{Object.entries(SHIPMENT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Corriere"><Input name="carrier" defaultValue={s.carrier ?? ""} /></Field>
                <Field label="Tracking"><Input name="trackingNumber" defaultValue={s.trackingNumber ?? ""} /></Field>
                <Field label="URL tracking"><Input name="trackingUrl" defaultValue={s.trackingUrl ?? ""} /></Field>
                <Field label="Riferimento Packlink"><Input name="packlinkReference" defaultValue={s.packlinkReference ?? ""} /></Field>
                <Field label="Costo (€)"><Input name="cost" defaultValue={s.cost?.toFixed(2).replace(".", ",") ?? ""} placeholder="7,90" /></Field>
                <Field label="Segnalazione" className="sm:col-span-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="problem" defaultChecked={s.problem} /> Spedizione problematica</label><Input name="problemReason" defaultValue={s.problemReason ?? ""} placeholder="Motivo" /></Field>
                <div className="sm:col-span-2"><Button type="submit">Salva</Button></div>
              </form>
              <p className="mt-2 text-xs text-graphite">Ogni modifica manuale resta visibile nell&apos;audit log. La prossima sincronizzazione Packlink/Shopify può sovrascrivere stato e tracking con i dati ufficiali.</p>
            </CardContent>
          </Card>
        ) : null}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Storico modifiche</CardTitle></CardHeader>
          <CardContent>
            {audit.length === 0 ? <p className="text-sm text-graphite">Nessuna modifica manuale registrata.</p> : (
              <ul className="flex flex-col gap-1 text-xs">
                {audit.map((a) => <li key={a.id}><span className="text-graphite">{fmtDate(a.createdAt, auth.timezone, true)}</span> · {a.user?.name ?? "sistema"} · {a.action} · <span className="font-mono">{JSON.stringify(a.metadata).slice(0, 200)}</span></li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
