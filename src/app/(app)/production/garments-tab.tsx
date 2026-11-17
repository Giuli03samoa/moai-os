import Link from "next/link";
import { ArrowUpRight, Plus, Shirt } from "lucide-react";
import { db } from "@/server/db";
import { createGarmentAction } from "@/server/actions/garments";
import { garmentInclude, summarizeGarment } from "@/server/production/garments";
import { fmtMoney } from "@/lib/format";
import { PRODUCTION_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, Empty, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function GarmentsTab({ orgId, currency, canEdit }: { orgId: string; currency: string; canEdit: boolean }) {
  const [garments, products] = await Promise.all([
    db.garmentSpec.findMany({ where: { organizationId: orgId, archivedAt: null }, include: garmentInclude, orderBy: { name: "asc" } }),
    db.product.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true, title: true, productType: true }, orderBy: { title: "asc" } }),
  ]);
  const withSheet = new Set(garments.map((g) => g.productId).filter(Boolean));
  const without = products.filter((p) => !withSheet.has(p.id));
  const money = (v: string | number | null | undefined) => fmtMoney(String(v ?? 0), currency);

  return (
    <div className="flex flex-col gap-8">
      {garments.length === 0 ? (
        <Empty icon={<Shirt className="h-5 w-5" strokeWidth={1.75} />} title="Nessuna scheda capo">Crea la scheda di un prodotto qui sotto: tessuti, consumo, confezione e costo per capo.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {garments.map((g) => {
            const { cost, price, marginFirst, marginRestock } = summarizeGarment(g);
            const lot = g.productionOrders[0];
            const status = cost.missing || cost.noSewing ? { tone: "bad" as const, label: "dati mancanti" } : cost.estimated ? { tone: "warn" as const, label: "consumi stimati" } : { tone: "ok" as const, label: "costi confermati" };
            return (
              <Card key={g.id} className="group flex flex-col overflow-hidden">
                <Link href={`/production/garments/${g.id}`} className="flex items-start justify-between gap-3 p-5 pb-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-medium tracking-[-0.02em]">{g.name}</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </p>
                    <p className="mt-1 truncate text-xs text-graphite">{[g.modelCode ? `mod. ${g.modelCode}` : null, g.maker?.name, g.composition].filter(Boolean).join(" · ") || "modello, confezionista e composizione da inserire"}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-graphite opacity-0 transition-opacity group-hover:opacity-60" />
                </Link>

                <div className="grid grid-cols-3 gap-3 border-y border-[var(--hairline)] bg-cloud/40 px-5 py-3.5 tabular">
                  <div><p className="text-[11px] text-graphite">Costo per capo</p><p className="text-xl font-medium tracking-[-0.03em]">{money(cost.firstLot)}</p><p className="text-[11px] text-space">primo lotto</p></div>
                  <div><p className="text-[11px] text-graphite">Sui riordini</p><p className="text-xl font-medium tracking-[-0.03em]">{money(cost.restock)}</p><p className="text-[11px] text-space">senza sviluppo</p></div>
                  <div><p className="text-[11px] text-graphite">Margine lordo</p><p className={cn("text-xl font-medium tracking-[-0.03em]", marginFirst && marginFirst.pct < 40 ? "text-warn" : "")}>{marginFirst ? `${marginFirst.pct}%` : "—"}</p><p className="text-[11px] text-space">{price ? `su ${money(price)}${marginRestock ? ` · riordini ${marginRestock.pct}%` : ""}` : "nessun prezzo"}</p></div>
                </div>

                <ul className="flex-1 divide-y divide-[var(--hairline)] px-5 text-sm">
                  {cost.lines.length === 0 ? <li className="py-3 text-xs text-graphite">Nessun tessuto o materiale: aprila e aggiungili.</li> : cost.lines.map((l, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0 truncate"><span>{l.label}</span>{l.role ? <span className="text-xs text-graphite"> · {l.role}</span> : null}</span>
                      <span className="shrink-0 text-xs text-graphite tabular">{l.qty ? `${Number(l.qty).toLocaleString("it-IT")} ${l.unit}${l.estimated ? " ~" : ""}` : <span className="text-bad">consumo?</span>}{l.cost ? <span className="ml-2 text-blackout">{money(l.cost)}</span> : null}</span>
                    </li>
                  ))}
                  {cost.sewing ? <li className="flex items-baseline justify-between gap-3 py-2"><span>Confezione</span><span className="text-xs tabular">{money(cost.sewing)}{cost.developmentPerUnit ? <span className="text-graphite"> + sviluppo {money(cost.developmentPerUnit)}</span> : null}</span></li> : null}
                </ul>

                <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] px-5 py-3 text-xs text-graphite">
                  <span className="truncate">{lot ? <>Ultimo lotto <span className="font-mono">{lot.reference}</span> · {lot.quantity ?? "?"} pz · <Badge tone={PRODUCTION_STATUS_LABEL[lot.status]?.tone ?? "muted"}>{PRODUCTION_STATUS_LABEL[lot.status]?.label ?? lot.status}</Badge></> : "Nessun lotto collegato"}</span>
                  <Link href={`/production/garments/${g.id}`} className="shrink-0 font-medium text-blackout hover:underline">Apri scheda</Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {without.length ? (
        <section>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="text-[15px] font-medium tracking-[-0.02em]">Capi senza scheda</h2>
            <p className="text-xs text-graphite">{without.length} prodotti del negozio</p>
          </div>
          <Card className="divide-y divide-[var(--hairline)]">
            {without.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="text-sm">{p.title}<span className="ml-2 text-xs text-graphite">{p.productType ?? ""}</span></span>
                {canEdit ? <form action={createGarmentAction}><input type="hidden" name="productId" value={p.id} /><Button size="sm" variant="outline"><Plus /> Crea scheda</Button></form> : null}
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {canEdit ? (
        <form action={createGarmentAction} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-graphite">Capo non ancora in negozio (prototipo, nuova capsule):</span>
          <Input name="name" placeholder="Nome del capo" className="h-8 w-56 text-xs" required minLength={2} />
          <Button size="sm" variant="ghost"><Plus /> Crea scheda</Button>
        </form>
      ) : null}
    </div>
  );
}
