import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDailySales, getGatewayBreakdown, getTopProducts } from "@/server/metrics/dashboard";
import { resolvePeriod } from "@/lib/periods";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { PeriodFilter } from "@/components/period-filter";
import { Card, CardContent, CardHeader, CardTitle, PageHeader, TBody, TD, TH, THead, TR, Table, Empty } from "@/components/ui/primitives";

type SP = Record<string, string | undefined>;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const range = resolvePeriod(sp, auth.timezone);
  const orgId = auth.organizationId;
  const [daily, top, gateways, refunds, fees, shippingCosts, lastSync] = await Promise.all([
    getDailySales(orgId, range, auth.timezone),
    getTopProducts(orgId, range, 15),
    getGatewayBreakdown(orgId, range),
    db.order.aggregate({ _sum: { totalRefunded: true }, _count: { _all: true }, where: { organizationId: orgId, deletedAt: null, test: false, totalRefunded: { gt: 0 }, processedAt: { gte: range.from, lte: range.to } } }),
    db.paymentTransaction.aggregate({ _sum: { fee: true }, where: { organizationId: orgId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", processedAt: { gte: range.from, lte: range.to } } }),
    db.shipment.aggregate({ _sum: { cost: true }, _count: { cost: true }, where: { organizationId: orgId, deletedAt: null, cost: { not: null }, shippedAt: { gte: range.from, lte: range.to } } }),
    db.order.aggregate({ _max: { syncedAt: true }, where: { organizationId: orgId } }),
  ]);
  const totals = daily.reduce((a, d) => ({ gross: a.gross + Number(d.gross), net: a.net + Number(d.net), orders: a.orders + d.orders }), { gross: 0, net: 0, orders: 0 });
  const aov = totals.orders ? totals.net / totals.orders : 0;
  const feeTotal = Number(fees._sum.fee ?? 0);
  const shipTotal = Number(shippingCosts._sum.cost ?? 0);
  const feePct = totals.gross ? (feeTotal / totals.gross) * 100 : 0;

  return (
    <div>
      <PageHeader title="Analytics" subtitle={`Fonte ordini: Shopify (agg. ${lastSync._max.syncedAt ? fmtDate(lastSync._max.syncedAt, auth.timezone, true) : "mai"}). Commissioni e costi logistici dai rispettivi ledger, dove importati.`} actions={<PeriodFilter basePath="/analytics" current={range.key} from={range.from} to={range.to} tz={auth.timezone} />} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Vendite nette", fmtMoney(totals.net, auth.currency), `lorde ${fmtMoney(totals.gross, auth.currency)}`],
          ["Ordini · valore medio", `${fmtNumber(totals.orders)} · ${fmtMoney(aov, auth.currency)}`, "netto / ordini"],
          ["Rimborsi", fmtMoney(refunds._sum.totalRefunded?.toString() ?? 0, auth.currency), `${refunds._count._all} ordini con rimborso`],
          ["Commissioni gateway", `${fmtMoney(feeTotal, auth.currency)} (${feePct.toFixed(2)}%)`, feeTotal ? "% sulle vendite lorde" : "nessun ledger gateway importato"],
          ["Costi logistici noti", fmtMoney(shipTotal, auth.currency), `${shippingCosts._count.cost} spedizioni con costo`],
        ].map(([l, v, d]) => (
          <Card key={l}><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">{l}</p><p className="mt-1 text-xl font-medium tabular">{v}</p><p className="mt-1 text-xs text-graphite">{d}</p></div></Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Andamento giornaliero</CardTitle></CardHeader>
          <CardContent>
            {daily.length === 0 ? <Empty title="Nessun ordine nel periodo" /> : (
              <Table>
                <THead><TR><TH>Giorno</TH><TH className="text-right">Ordini</TH><TH className="text-right">Lordo</TH><TH className="text-right">Netto</TH><TH className="w-1/3">Quota</TH></TR></THead>
                <TBody>
                  {daily.map((d) => {
                    const pct = totals.net ? (Number(d.net) / totals.net) * 100 : 0;
                    return (
                      <TR key={d.date}>
                        <TD className="font-mono text-xs">{d.date}</TD><TD className="text-right tabular">{d.orders}</TD><TD className="text-right tabular">{fmtMoney(d.gross, auth.currency)}</TD><TD className="text-right tabular font-medium">{fmtMoney(d.net, auth.currency)}</TD>
                        <TD><div className="h-2 w-full rounded-full bg-cloud"><div className="h-2 rounded-full bg-blackout" style={{ width: `${Math.min(100, pct * (100 / Math.max(1, Math.max(...daily.map((x) => (totals.net ? (Number(x.net) / totals.net) * 100 : 0)))))).toFixed(1)}%` }} /></div></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Articoli più venduti</CardTitle></CardHeader>
            <CardContent>
              {top.length === 0 ? <Empty title="Nessuna riga ordine" /> : (
                <Table>
                  <THead><TR><TH>SKU</TH><TH>Articolo</TH><TH className="text-right">Pezzi</TH></TR></THead>
                  <TBody>{top.map((t, i) => <TR key={`${t.sku}-${i}`}><TD className="font-mono text-xs">{t.sku ?? "—"}</TD><TD className="text-xs">{t.title}</TD><TD className="text-right tabular font-medium">{t.quantity}</TD></TR>)}</TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Gateway di pagamento (ledger ordini)</CardTitle></CardHeader>
            <CardContent>
              {gateways.length === 0 ? <Empty title="Nessuna transazione" /> : (
                <Table>
                  <THead><TR><TH>Gateway</TH><TH className="text-right">Transazioni</TH><TH className="text-right">Acquisito</TH></TR></THead>
                  <TBody>{gateways.map((g) => <TR key={g.provider}><TD>{g.provider}</TD><TD className="text-right tabular">{g.count}</TD><TD className="text-right tabular font-medium">{fmtMoney(g.amount, auth.currency)}</TD></TR>)}</TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
