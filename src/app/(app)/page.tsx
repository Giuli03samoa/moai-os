import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDashboardMetrics } from "@/server/metrics/dashboard";
import { resolvePeriod } from "@/lib/periods";
import { fmtDate, fmtMoney, fmtRelative } from "@/lib/format";
import { CONNECTION_STATUS_LABEL, FINANCIAL_STATUS_LABEL, FULFILLMENT_STATUS_LABEL, JOB_STATUS_LABEL } from "@/lib/labels";
import { JOB_LABELS } from "@/server/jobs/handlers";
import { MetricCard } from "@/components/metric-card";
import { PeriodFilter } from "@/components/period-filter";
import { SourceTag } from "@/components/source-tag";
import { Badge, Card, CardContent, CardHeader, CardTitle, Notice, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const range = resolvePeriod(sp, auth.timezone);
  const orgId = auth.organizationId;
  const [metrics, connections, deadJobs, recentOrders, recentJobs, problemShipments] = await Promise.all([
    getDashboardMetrics(orgId, range, auth.currency),
    db.integrationConnection.findMany({ where: { organizationId: orgId }, orderBy: { displayName: "asc" } }),
    db.syncJob.count({ where: { organizationId: orgId, status: "DEAD" } }),
    db.order.findMany({ where: { organizationId: orgId, deletedAt: null }, orderBy: { processedAt: "desc" }, take: 8 }),
    db.syncJob.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.shipment.count({ where: { organizationId: orgId, deletedAt: null, problem: true } }),
  ]);
  const blocked = connections.filter((c) => c.status === "BLOCKED" || c.status === "ERROR");
  const attention = [
    deadJobs ? { text: `${deadJobs} sincronizzazioni fallite richiedono intervento`, href: "/sync?status=DEAD" } : null,
    ...blocked.map((c) => ({ text: `${c.displayName}: ${c.blockedReason ?? c.lastError ?? CONNECTION_STATUS_LABEL[c.status]?.label}`, href: `/integrations/${c.key}` })),
    problemShipments ? { text: `${problemShipments} spedizioni problematiche`, href: "/shipping?filter=problems" } : null,
    connections.length === 0 ? { text: "Nessuna integrazione configurata: inizia da Shopify", href: "/integrations/shopify" } : null,
  ].filter((x): x is { text: string; href: string } => !!x);

  return (
    <div>
      <PageHeader title="Overview" subtitle={`${fmtDate(range.from, auth.timezone)} → ${fmtDate(range.to, auth.timezone)} · fuso ${auth.timezone}`} actions={<PeriodFilter basePath="/" current={range.key} from={range.from} to={range.to} tz={auth.timezone} />} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {attention.length ? (
        <div className="mb-6 flex flex-col gap-2">
          {attention.map((a) => (
            <Link key={a.href + a.text} href={a.href} className="block">
              <Notice tone="warn">{a.text} →</Notice>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m, i) => (
          <MetricCard key={m.key} m={m} highlight={i === 0} />
        ))}
      </div>
      <p className="mt-3 text-xs text-graphite">Ogni valore indica origine e ultimo aggiornamento. I pagamenti acquisiti e gli accrediti liquidati sono viste dello stesso denaro già conteggiato nelle vendite: non vanno sommati ai ricavi.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Ultimi ordini</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link href="/orders">Tutti</Link></Button>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-graphite">Nessun ordine importato. Configura Shopify in Integrations.</p>
            ) : (
              <Table>
                <THead><TR><TH>Ordine</TH><TH>Data</TH><TH>Pagamento</TH><TH>Evasione</TH><TH className="text-right">Totale</TH><TH>Origine</TH></TR></THead>
                <TBody>
                  {recentOrders.map((o) => (
                    <TR key={o.id}>
                      <TD><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.name}</Link></TD>
                      <TD>{fmtDate(o.processedAt, auth.timezone, true)}</TD>
                      <TD><Badge tone={o.financialStatus === "PAID" ? "ok" : o.financialStatus.includes("REFUND") ? "warn" : "muted"}>{FINANCIAL_STATUS_LABEL[o.financialStatus] ?? o.financialStatus}</Badge></TD>
                      <TD><Badge tone={o.fulfillmentStatus === "FULFILLED" ? "ok" : "muted"}>{FULFILLMENT_STATUS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}</Badge></TD>
                      <TD className="text-right tabular">{fmtMoney(o.totalPrice.toString(), o.currency)}</TD>
                      <TD><SourceTag source={o.source} updatedAt={o.syncedAt} demo={o.isDemo} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Integrazioni</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href="/integrations">Gestisci</Link></Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {connections.length === 0 ? <p className="text-sm text-graphite">Nessuna connessione.</p> : null}
              {connections.map((c) => {
                const st = CONNECTION_STATUS_LABEL[c.status] ?? { label: c.status, tone: "muted" as const };
                return (
                  <Link key={c.id} href={`/integrations/${c.key}`} className="flex items-center justify-between text-sm">
                    <span>{c.displayName}</span>
                    <span className="flex items-center gap-2 text-xs text-graphite"><span>{c.lastSyncAt ? `sync ${fmtRelative(c.lastSyncAt)}` : ""}</span><Badge tone={st.tone}>{st.label}</Badge></span>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Sincronizzazioni recenti</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href="/sync">Tutte</Link></Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {recentJobs.length === 0 ? <p className="text-sm text-graphite">Nessun job eseguito.</p> : null}
              {recentJobs.map((j) => {
                const st = JOB_STATUS_LABEL[j.status] ?? { label: j.status, tone: "muted" as const };
                return (
                  <Link key={j.id} href={`/sync/${j.id}`} className="flex items-center justify-between text-sm">
                    <span>{JOB_LABELS[j.type] ?? j.type}</span>
                    <span className="flex items-center gap-2 text-xs text-graphite"><span>{fmtRelative(j.finishedAt ?? j.createdAt)}</span><Badge tone={st.tone}>{st.label}</Badge></span>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
