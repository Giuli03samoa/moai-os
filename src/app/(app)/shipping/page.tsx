import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { ordersToShip } from "@/server/connectors/packlink/sync";
import { fmtDate, fmtMoney } from "@/lib/format";
import { SHIPMENT_STATUS_LABEL } from "@/lib/labels";
import { DataTable, parseTableQuery } from "@/components/data-table";
import { SourceTag } from "@/components/source-tag";
import { Badge, Card, CardContent, CardHeader, CardTitle, Notice, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;

export default async function ShippingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const filter = sp.filter;
  const q = parseTableQuery(sp, { sort: "shippedAt" }, ["shippedAt", "status", "carrier", "cost", "deliveredAt"]);
  const where: Prisma.ShipmentWhereInput = {
    organizationId: auth.organizationId, deletedAt: null,
    ...(filter === "problems" ? { problem: true } : filter === "open" ? { status: { in: ["PENDING", "READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "UNKNOWN"] } } : filter === "delivered" ? { status: "DELIVERED" } : {}),
    ...(q.q ? { OR: [{ trackingNumber: { contains: q.q, mode: "insensitive" } }, { packlinkReference: { contains: q.q, mode: "insensitive" } }, { carrier: { contains: q.q, mode: "insensitive" } }, { order: { name: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, toShip, costs, packlink] = await Promise.all([
    db.shipment.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { order: { select: { id: true, name: true } } } }),
    db.shipment.count({ where }),
    ordersToShip(auth.organizationId),
    db.shipment.aggregate({ _sum: { cost: true }, _count: { cost: true }, where: { organizationId: auth.organizationId, deletedAt: null, cost: { not: null }, shippedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    db.integrationConnection.findUnique({ where: { organizationId_key: { organizationId: auth.organizationId, key: "packlink" } } }),
  ]);
  const extra = { filter };
  return (
    <div>
      <PageHeader title="Spedizioni" subtitle="Ordini da preparare, stato delle spedizioni e costi logistici. Le spedizioni le crea l'integrazione Shopify–Packlink PRO: qui vengono solo lette e monitorate."
        actions={<>{hasRole(auth.role, "OPERATIONS") ? <Button asChild size="sm" variant="outline"><Link href="/payments/import?kind=SHIPMENTS">Importa CSV Packlink</Link></Button> : null}<Button asChild variant="outline" size="sm"><a href="/api/export/shipments?period=ytd">Esporta CSV</a></Button></>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Da preparare</p><p className="mt-1 text-xl font-medium tabular">{toShip.length}</p><p className="mt-1 text-xs text-graphite">ordini pagati non evasi (Shopify)</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Costi logistici 30 gg</p><p className="mt-1 text-xl font-medium tabular">{fmtMoney(costs._sum.cost?.toString() ?? 0, auth.currency)}</p><p className="mt-1 text-xs text-graphite">{costs._count.cost} spedizioni con costo noto (API/CSV Packlink o manuale)</p></div></Card>
        <Card><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">Packlink PRO</p><p className="mt-1 text-xl font-medium">{packlink ? <Link href="/integrations/packlink" className="hover:underline">{packlink.status}</Link> : <Link href="/integrations/packlink" className="hover:underline">non configurato</Link>}</p><p className="mt-1 text-xs text-graphite">{packlink?.lastSyncAt ? `ultimo refresh ${fmtDate(packlink.lastSyncAt, auth.timezone, true)}` : "tracking letto da Shopify"}</p></div></Card>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Ordini da spedire ({toShip.length})</CardTitle></CardHeader>
        <CardContent>
          {toShip.length === 0 ? <p className="text-sm text-graphite">Nessun ordine pagato in attesa di evasione.</p> : (
            <Table>
              <THead><TR><TH>Ordine</TH><TH>Data</TH><TH>Attesa</TH><TH className="text-right">Articoli</TH><TH>Pagamento</TH><TH>Evasione</TH><TH>Spedizioni</TH></TR></THead>
              <TBody>
                {toShip.slice(0, 50).map((o) => {
                  const days = Math.floor((Date.now() - o.processedAt.getTime()) / 86_400_000);
                  return (
                    <TR key={o.id}>
                      <TD><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.name}</Link></TD><TD>{fmtDate(o.processedAt, auth.timezone, true)}</TD>
                      <TD><Badge tone={days >= 3 ? "bad" : days >= 1 ? "warn" : "ok"}>{days} g</Badge></TD><TD className="text-right tabular">{o.items.reduce((a, i) => a + i.quantity, 0)}</TD>
                      <TD className="text-xs">{o.financialStatus}</TD><TD className="text-xs">{o.fulfillmentStatus}</TD><TD className="text-xs">{o.shipments.length || "—"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mb-3 flex flex-wrap gap-1">
        {[{ v: undefined, l: "Tutte" }, { v: "open", l: "In corso" }, { v: "problems", l: "Problematiche" }, { v: "delivered", l: "Consegnate" }].map((f) => (
          <Link key={f.l} href={`/shipping${f.v ? `?filter=${f.v}` : ""}`} className={`rounded-full px-3 py-1 text-xs ${filter === f.v ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>{f.l}</Link>
        ))}
      </div>
      <DataTable rows={rows} total={total} query={q} basePath="/shipping" params={extra} rowKey={(r) => r.id} emptyTitle="Nessuna spedizione" searchPlaceholder="Tracking, riferimento Packlink, ordine…"
        columns={[
          { key: "order", label: "Ordine", render: (r) => (r.order ? <Link href={`/orders/${r.order.id}`} className="font-medium hover:underline">{r.order.name}</Link> : <span className="text-graphite">—</span>) },
          { key: "shippedAt", label: "Spedita", sortable: true, render: (r) => fmtDate(r.shippedAt, auth.timezone) },
          { key: "status", label: "Stato", sortable: true, render: (r) => <Link href={`/shipping/${r.id}`}><Badge tone={r.status === "DELIVERED" ? "ok" : r.problem ? "bad" : r.status === "EXCEPTION" ? "bad" : "muted"}>{SHIPMENT_STATUS_LABEL[r.status]}</Badge></Link> },
          { key: "carrier", label: "Corriere", sortable: true, render: (r) => <span className="text-xs">{r.carrier ?? "—"}{r.service ? ` · ${r.service}` : ""}</span> },
          { key: "tracking", label: "Tracking", render: (r) => <span className="font-mono text-xs">{r.trackingUrl ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="hover:underline">{r.trackingNumber}</a> : r.trackingNumber ?? "—"}</span> },
          { key: "packlink", label: "Rif. Packlink", render: (r) => <span className="font-mono text-xs">{r.packlinkReference ?? "—"}</span> },
          { key: "cost", label: "Costo", sortable: true, align: "right", render: (r) => (r.cost ? fmtMoney(r.cost.toString(), r.costCurrency ?? auth.currency) : <span className="text-graphite">—</span>) },
          { key: "problem", label: "Segnalazione", render: (r) => (r.problem ? <span className="text-xs text-bad">{r.problemReason}</span> : "") },
          { key: "source", label: "Origine", render: (r) => <SourceTag source={r.source} updatedAt={r.syncedAt} demo={r.isDemo} /> },
        ]} />
    </div>
  );
}
