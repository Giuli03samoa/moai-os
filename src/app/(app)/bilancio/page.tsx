import Link from "next/link";
import { Info } from "lucide-react";
import { requireAuth } from "@/server/auth/session";
import { annualReport } from "@/server/reports/annual";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Notice, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MONTHS = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

export default async function BilancioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const thisYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: auth.timezone, year: "numeric" }).format(new Date()));
  const year = /^\d{4}$/.test(sp.anno ?? "") && Number(sp.anno) >= 2024 && Number(sp.anno) <= thisYear ? Number(sp.anno) : thisYear;
  const r = await annualReport(auth.organizationId, year);
  const money = (v: string | number) => fmtMoney(String(v), r.currency);
  const result = Number(r.result);
  const maxMonth = Math.max(1, ...r.months.map((m) => Math.max(Number(m.revenue), Number(m.costs))));
  const lastMonth = year === thisYear ? Number(new Intl.DateTimeFormat("en-US", { timeZone: auth.timezone, month: "numeric" }).format(new Date())) : 12;

  return (
    <div>
      <PageHeader
        eyebrow="Conti dell'anno"
        title={`Bilancio ${year}`}
        subtitle="Quanto hai incassato, quanto hai speso e cosa resta, da fatture, SumUp, Shopify e spese registrate. È una vista gestionale per orientarti: il bilancio ufficiale lo fa il commercialista."
        actions={
          <div className="flex items-center gap-1 rounded-full bg-cloud p-1">
            {Array.from({ length: thisYear - 2024 + 1 }, (_, i) => 2024 + i).reverse().slice(0, 3).map((y) => (
              <Link key={y} href={`/bilancio?anno=${y}`} className={cn("rounded-full px-3 py-1 text-xs", y === year ? "bg-blackout text-crocus" : "text-graphite hover:text-blackout")}>{y}</Link>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card><div className="p-5"><p className="text-xs text-graphite">Ricavi</p><p className="mt-1 text-[28px] font-medium tracking-[-0.03em] tabular">{money(r.revenue.total)}</p><p className="mt-0.5 text-[11px] text-space">IVA esclusa</p></div></Card>
        <Card><div className="p-5"><p className="text-xs text-graphite">Costi</p><p className="mt-1 text-[28px] font-medium tracking-[-0.03em] tabular">{money(r.costs.total)}</p><p className="mt-0.5 text-[11px] text-space">IVA esclusa</p></div></Card>
        <div className={cn("theme-ink chevron-pattern rounded-[18px] bg-ink p-5 text-paper")}>
          <p className="text-xs text-[#9da2b3]">{result >= 0 ? "Utile gestionale" : "Perdita gestionale"}</p>
          <p className="mt-1 text-[28px] font-medium tracking-[-0.03em] tabular">{money(r.result)}</p>
          <p className="mt-0.5 text-[11px] text-[#6e7180]">ricavi meno costi, prima delle tasse e senza contare il magazzino</p>
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Ricavi</CardTitle><CardDescription>Vendite dell&apos;anno, IVA esclusa.</CardDescription></CardHeader>
          <CardContent>
            <Rows rows={[
              ["Vendite online (Shopify)", money(r.revenue.online), r.revenue.onlineOrders === 1 ? "1 ordine" : `${r.revenue.onlineOrders} ordini`],
              ["Vendite in presenza (SumUp)", money(r.revenue.inPerson), r.revenue.inPersonSales === 1 ? "1 incasso" : `${r.revenue.inPersonSales} incassi`],
              ["Fatture emesse ad aziende", money(r.revenue.invoiced), r.revenue.invoicedCount === 1 ? "1 fattura" : `${r.revenue.invoicedCount} fatture`],
            ]} total={["Totale ricavi", money(r.revenue.total)]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Costi</CardTitle><CardDescription>Dalle fatture dei fornitori e dai pagamenti, IVA esclusa.</CardDescription></CardHeader>
          <CardContent>
            <Rows rows={[
              ...r.costs.byCategory.map((c) => [c.label, money(c.amount), c.count === 1 ? "1 voce" : `${c.count} voci`] as [string, string, string]),
              ...(Number(r.costs.gatewayFees) ? [["Commissioni sugli incassi (SumUp, Shopify)", money(r.costs.gatewayFees), ""] as [string, string, string]] : []),
              ...(Number(r.costs.shipping) ? [["Spedizioni", money(r.costs.shipping), ""] as [string, string, string]] : []),
            ]} total={["Totale costi", money(r.costs.total)]} />
            <p className="mt-3 text-xs text-graphite"><Link href="/production?tab=expenses&period=ytd" className="underline">Vedi tutte le spese</Link></p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Mese per mese</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-blackout" />Costi</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-space" />Ricavi</span>
            <span>IVA esclusa · cassa IVA inclusa</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm tabular">
              <thead><tr className="text-[11px] text-graphite"><th className="py-2 pr-3 text-left font-normal">Mese</th><th className="py-2 text-left font-normal">Costi e ricavi</th><th className="py-2 pl-3 text-right font-normal">Ricavi</th><th className="py-2 pl-3 text-right font-normal">Costi</th><th className="py-2 pl-3 text-right font-normal">Entrate cassa</th><th className="py-2 pl-3 text-right font-normal">Uscite cassa</th></tr></thead>
              <tbody>
                {r.months.slice(0, lastMonth).map((m) => {
                  const rev = Number(m.revenue), cost = Number(m.costs);
                  const empty = !rev && !cost && !Number(m.cashIn) && !Number(m.cashOut);
                  return (
                    <tr key={m.month} className={cn("border-t border-[var(--hairline)]", empty && "text-space")} title={`${MONTHS[m.month]}: ricavi ${money(m.revenue)}, costi ${money(m.costs)}`}>
                      <td className="py-2 pr-3">{MONTHS[m.month]}</td>
                      <td className="w-[38%] py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="block h-1.5 rounded-r-[3px] bg-blackout" style={{ width: `${(cost / maxMonth) * 100}%` }} />
                          <span className="block h-1.5 rounded-r-[3px] bg-space" style={{ width: `${(rev / maxMonth) * 100}%` }} />
                        </div>
                      </td>
                      <td className="py-2 pl-3 text-right">{rev ? money(m.revenue) : "—"}</td>
                      <td className="py-2 pl-3 text-right">{cost ? money(m.costs) : "—"}</td>
                      <td className="py-2 pl-3 text-right text-graphite">{Number(m.cashIn) ? money(m.cashIn) : "—"}</td>
                      <td className="py-2 pl-3 text-right text-graphite">{Number(m.cashOut) ? money(m.cashOut) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cassa</CardTitle><CardDescription>Soldi entrati e usciti davvero, IVA inclusa{r.cash.bankUntil ? `. Dalla banca fino al ${fmtDate(r.cash.bankUntil, auth.timezone)}` : ""}.</CardDescription></CardHeader>
          <CardContent>
            <Rows rows={[["Entrate", money(r.cash.in), r.cash.inNote], ["Uscite", `−${money(r.cash.out)}`, r.cash.outNote]]} total={["Differenza", money(r.cash.balance)]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>IVA (stima)</CardTitle><CardDescription>La liquidazione vera la fa il commercialista.</CardDescription></CardHeader>
          <CardContent>
            <Rows rows={[["IVA sugli acquisti", money(r.vat.onPurchases), "dalle fatture dei fornitori"], ["IVA sulle vendite", `−${money(r.vat.onSales)}`, "da Shopify e SumUp"]]} total={[Number(r.vat.balance) >= 0 ? "IVA a credito" : "IVA a debito", money(Math.abs(Number(r.vat.balance)))]} />
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="flex items-center gap-2"><Info className="h-4 w-4 text-graphite" strokeWidth={1.75} />Cosa manca per un quadro completo</CardTitle></CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm text-graphite">{r.missing.map((m) => <li key={m} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-graphite" />{m}</li>)}</ul>
          {!r.sources.bankRows ? <div className="mt-4"><Button asChild size="sm" variant="outline"><Link href="/payments/import">Importa l&apos;estratto conto</Link></Button></div> : null}
          <p className="mt-4 text-[11px] text-space">Fonti: {r.sources.invoices} fatture ricevute, {r.sources.expenses} spese registrate, {r.sources.bankRows} movimenti bancari{r.sources.lastBankDate ? ` (ultimo del ${fmtDate(r.sources.lastBankDate, auth.timezone)})` : ""}.</p>
        </CardContent>
      </Card>
      {result < 0 ? <Notice tone="muted">Il primo anno di un marchio è quasi sempre in perdita: la produzione si paga prima di vendere. Guarda quanto della spesa è merce ancora da vendere.</Notice> : null}
    </div>
  );
}

function Rows({ rows, total }: { rows: Array<[string, string, string]>; total: [string, string] }) {
  return (
    <div className="text-sm tabular">
      {rows.map(([l, v, n]) => (
        <div key={l} className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] py-2">
          <span className="min-w-0">{l}{n ? <span className="block text-[11px] text-space">{n}</span> : null}</span>
          <span className="shrink-0">{v}</span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 pt-2.5 font-medium"><span>{total[0]}</span><span>{total[1]}</span></div>
    </div>
  );
}
