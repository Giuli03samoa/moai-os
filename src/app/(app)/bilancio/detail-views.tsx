import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { AnnualDetail, CostItem } from "@/server/reports/annual-detail";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge, Card, CardContent, Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Common = { d: AnnualDetail; tz: string; currency: string };
const money = (v: string | number, c: string) => fmtMoney(String(v), c);
const SOURCE_LABEL = { INVOICE: "Fattura emessa", IN_PERSON: "In presenza", SHOP: "Online" } as const;

export function RevenueView({ d, tz, currency }: Common) {
  if (!d.revenue.length) return <Empty title="Nessun ricavo nel periodo" />;
  const groups = (["INVOICE", "IN_PERSON", "SHOP"] as const).map((s) => ({ s, rows: d.revenue.filter((r) => r.source === s) })).filter((g) => g.rows.length);
  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ s, rows }) => {
        const net = rows.reduce((a, r) => a + Number(r.net), 0);
        const gross = rows.reduce((a, r) => a + Number(r.gross), 0);
        return (
          <Section key={s} title={s === "INVOICE" ? "Fatture emesse ad aziende" : s === "IN_PERSON" ? "Vendite in presenza (SumUp)" : "Vendite online (Shopify)"} total={money(net, currency)} note={`${rows.length} ${rows.length === 1 ? "voce" : "voci"} · ${money(gross, currency)} IVA inclusa`} share={Number(d.totals.revenue) ? (net / Number(d.totals.revenue)) * 100 : 0}>
            <table className="w-full min-w-[720px] text-sm tabular">
              <thead><tr className="text-[11px] text-graphite"><Th>Data</Th><Th>Cliente</Th><Th>Cosa</Th><Th>Documento</Th><Th right>Imponibile</Th><Th right>IVA</Th><Th right>Totale</Th><Th>Incassato</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--hairline)] align-top">
                    <Td nowrap>{fmtDate(r.date, tz)}</Td>
                    <Td>{r.party}</Td>
                    <Td className="max-w-[260px] text-graphite">{r.description}</Td>
                    <Td nowrap>{r.document ? (r.href ? <Link href={r.href} className={cn("hover:underline", r.document === "scontrino da fare" && "text-warn")}>{r.document}</Link> : r.document) : "—"}</Td>
                    <Td right>{money(r.net, currency)}</Td>
                    <Td right className="text-graphite">{money(r.vat, currency)}</Td>
                    <Td right>{money(r.gross, currency)}</Td>
                    <Td nowrap>{r.collectedAt ? fmtDate(r.collectedAt, tz) : <Badge tone="warn">da incassare</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        );
      })}
    </div>
  );
}

export function CostsView({ d, tz, currency }: Common) {
  if (!d.costs.length) return <Empty title="Nessun costo nel periodo" />;
  const byCat = new Map<string, CostItem[]>();
  for (const c of d.costs) byCat.set(c.categoryLabel, [...(byCat.get(c.categoryLabel) ?? []), c]);
  const total = Number(d.totals.costs);
  const groups = [...byCat.entries()].map(([label, rows]) => ({ label, rows, net: rows.reduce((a, r) => a + Number(r.net), 0) })).sort((a, b) => b.net - a.net);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <Section key={g.label} title={g.label} total={money(g.net, currency)} note={`${g.rows.length} ${g.rows.length === 1 ? "voce" : "voci"}`} share={total ? (g.net / total) * 100 : 0}>
          <table className="w-full min-w-[720px] text-sm tabular">
            <thead><tr className="text-[11px] text-graphite"><Th>Data</Th><Th>Fornitore</Th><Th>Cosa</Th><Th>Documento</Th><Th right>IVA esclusa</Th><Th>Pagato</Th></tr></thead>
            <tbody>
              {g.rows.map((c) => (
                <tr key={c.id} className="border-t border-[var(--hairline)] align-top">
                  <Td nowrap>{fmtDate(c.date, tz)}</Td>
                  <Td>{c.supplier}</Td>
                  <Td className="max-w-[320px] text-graphite">{c.description}</Td>
                  <Td nowrap>{c.document ? (c.href ? <Link href={c.href} className="hover:underline">{c.document}</Link> : c.document) : "—"}</Td>
                  <Td right className={Number(c.net) < 0 ? "text-ok" : undefined}>{money(c.net, currency)}</Td>
                  <Td nowrap>{c.paidAt ? fmtDate(c.paidAt, tz) : <span className="text-space">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ))}
    </div>
  );
}

export function SuppliersView({ d, tz, currency }: Common) {
  if (!d.suppliers.length) return <Empty title="Nessun fornitore nel periodo" />;
  return (
    <Card>
      <CardContent className="overflow-x-auto pt-5">
        <table className="w-full min-w-[680px] text-sm tabular">
          <thead><tr className="text-[11px] text-graphite"><Th>Fornitore</Th><Th>Per cosa</Th><Th right>Voci</Th><Th>Quota dei costi</Th><Th right>IVA esclusa</Th><Th>Periodo</Th></tr></thead>
          <tbody>
            {d.suppliers.map((s) => (
              <tr key={s.name} className="border-t border-[var(--hairline)] align-top">
                <Td className="font-medium">{s.name}</Td>
                <Td className="max-w-[240px] text-xs text-graphite">{s.categories.join(", ")}</Td>
                <Td right>{s.count}</Td>
                <Td><div className="flex items-center gap-2"><span className="block h-1.5 w-24 overflow-hidden rounded-full bg-cloud"><span className="block h-full rounded-r-[3px] bg-blackout" style={{ width: `${Math.max(0, Math.min(100, s.share))}%` }} /></span><span className="text-xs text-graphite">{s.share.toLocaleString("it-IT")}%</span></div></Td>
                <Td right>{money(s.net, currency)}</Td>
                <Td nowrap className="text-xs text-graphite">{fmtDate(s.first, tz)}{s.first.getTime() !== s.last.getTime() ? ` → ${fmtDate(s.last, tz)}` : ""}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function BankView({ d, tz, currency }: Common) {
  if (!d.bank.length) return <Empty title="Nessun movimento bancario">Importa l&apos;estratto conto da Pagamenti → Importa CSV, oppure dammi i PDF e lo carico io.</Empty>;
  const inflow = d.bank.filter((b) => Number(b.amount) > 0).reduce((a, b) => a + Number(b.amount), 0);
  const outflow = d.bank.filter((b) => Number(b.amount) < 0).reduce((a, b) => a + Number(b.amount), 0);
  const unexplained = d.bank.filter((b) => !b.explainedBy);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-graphite tabular">{d.bank.length} movimenti · entrate {money(inflow, currency)} · uscite {money(-outflow, currency)}{unexplained.length ? <> · <span className="text-warn">{unexplained.length} senza spiegazione</span></> : " · tutti spiegati"}</p>
      <Card>
        <CardContent className="overflow-x-auto pt-5">
          <table className="w-full min-w-[720px] text-sm tabular">
            <thead><tr className="text-[11px] text-graphite"><Th>Data</Th><Th>Controparte</Th><Th>Causale</Th><Th right>Importo</Th><Th>Cos&apos;è</Th></tr></thead>
            <tbody>
              {d.bank.map((b) => (
                <tr key={b.id} className="border-t border-[var(--hairline)] align-top">
                  <Td nowrap>{fmtDate(b.date, tz)}</Td>
                  <Td>{b.counterparty ?? "—"}</Td>
                  <Td className="max-w-[300px] text-xs text-graphite">{b.description}</Td>
                  <Td right className={Number(b.amount) > 0 ? "text-ok" : undefined}>{money(b.amount, currency)}</Td>
                  <Td className="text-xs">{b.explainedBy ?? <Badge tone="warn">da chiarire</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, total, note, share, children }: { title: string; total: string; note: string; share: number; children: React.ReactNode }) {
  return (
    <details open className="group surface overflow-hidden rounded-[18px] border border-[var(--hairline)]">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4 shrink-0 text-graphite transition-transform group-open:rotate-0 -rotate-90" />
        <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium tracking-[-0.02em]">{title}</span><span className="block text-xs text-graphite">{note}</span></span>
        <span className="hidden w-32 sm:block"><span className="block h-1.5 overflow-hidden rounded-full bg-cloud"><span className="block h-full rounded-r-[3px] bg-blackout" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></span><span className="mt-0.5 block text-right text-[11px] text-space">{share.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</span></span>
        <span className="shrink-0 text-[17px] font-medium tracking-[-0.02em] tabular">{total}</span>
      </summary>
      <div className="overflow-x-auto border-t border-[var(--hairline)] px-5 pb-4 pt-1">{children}</div>
    </details>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={cn("py-2 pr-3 font-normal", right ? "text-right" : "text-left")}>{children}</th>;
}
function Td({ children, right, nowrap, className }: { children?: React.ReactNode; right?: boolean; nowrap?: boolean; className?: string }) {
  return <td className={cn("py-2 pr-3", right && "text-right", nowrap && "whitespace-nowrap", className)}>{children}</td>;
}
