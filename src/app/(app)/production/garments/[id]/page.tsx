import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { addComponentAction, archiveGarmentAction, linkProductionOrderAction, updateComponentAction, updateGarmentAction } from "@/server/actions/garments";
import { MATERIAL_KIND_LABEL, garmentInclude, summarizeGarment } from "@/server/production/garments";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PRODUCTION_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dec = (v: { toFixed(n: number): string } | null | undefined, digits = 2) => (v ? v.toFixed(digits).replace(".", ",") : "");

export default async function GarmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const g = await db.garmentSpec.findFirst({ where: { id, organizationId: auth.organizationId, archivedAt: null }, include: garmentInclude });
  if (!g) notFound();
  const [materials, suppliers, products, freeOrders] = await Promise.all([
    db.material.findMany({ where: { organizationId: auth.organizationId, archivedAt: null }, include: { supplier: { select: { name: true } } }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.supplier.findMany({ where: { organizationId: auth.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.product.findMany({ where: { organizationId: auth.organizationId, deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    db.productionOrder.findMany({ where: { organizationId: auth.organizationId, garmentSpecId: null }, select: { id: true, reference: true, description: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const canEdit = hasRole(auth.role, "OPERATIONS");
  const { cost, price, marginFirst, marginRestock } = summarizeGarment(g);
  const money = (v: string | number | null | undefined) => fmtMoney(String(v ?? 0), auth.currency);
  const comps = new Map(g.components.map((c) => [c.id, c]));

  return (
    <div>
      <PageHeader
        eyebrow={<Link href="/production" className="hover:underline">Produzione · Capi</Link>}
        title={g.name}
        subtitle={[g.modelCode ? `Modello ${g.modelCode}` : null, g.maker ? `confezionato da ${g.maker.name}` : null, g.composition].filter(Boolean).join(" · ") || "Completa i dati del capo qui sotto."}
        actions={<Button asChild variant="ghost" size="sm"><Link href="/production">← Tutti i capi</Link></Button>}
      />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["Costo per capo", money(cost.firstLot), g.lotSize ? `primo lotto da ${g.lotSize} pz` : "primo lotto"],
          ["Sui riordini", money(cost.restock), "senza lo sviluppo taglie"],
          ["Prezzo in negozio", price ? money(price) : "—", marginFirst ? `${money(marginFirst.net)} senza IVA` : "collega un prodotto"],
          ["Margine lordo", marginFirst ? `${marginFirst.pct}%` : "—", marginFirst ? `${money(marginFirst.amount)} a capo${marginRestock ? ` · riordini ${marginRestock.pct}%` : ""}` : ""],
        ].map(([l, v, n]) => (
          <Card key={l}><div className="p-4"><p className="text-xs text-graphite">{l}</p><p className="mt-1 text-2xl font-medium tracking-[-0.03em] tabular">{v}</p><p className="mt-0.5 text-[11px] text-space">{n}</p></div></Card>
        ))}
      </div>
      {cost.missing || cost.noSewing ? <div className="mb-6"><Notice tone="warn">Il costo è incompleto: {[cost.noSewing ? "manca il costo di confezione" : null, cost.missing ? `${cost.missing === 1 ? "un materiale" : `${cost.missing} materiali`} senza consumo o prezzo` : null].filter(Boolean).join(" e ")}. I totali qui sopra sono più bassi del vero.</Notice></div> : cost.estimated ? <div className="mb-6"><Notice tone="muted">Alcuni consumi sono stimati (segnati con ~): chiedi i metri per capo al confezionista e spunta «confermato».</Notice></div> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Distinta del capo</CardTitle><CardDescription>Cosa serve per fare un pezzo e quanto costa. Prezzi IVA esclusa.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {cost.lines.map((l) => {
                const c = comps.get(l.id!)!;
                return (
                  <div key={l.id} className="rounded-2xl border border-[var(--hairline)] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="min-w-0 text-sm"><span className="font-medium">{l.label}</span><span className="text-xs text-graphite"> · {MATERIAL_KIND_LABEL[c.material.kind]}{c.material.supplier ? ` · ${c.material.supplier.name}` : ""}</span></p>
                      <p className="text-sm tabular">{l.cost ? money(l.cost) : <span className="text-bad">da completare</span>}<span className="ml-2 text-xs text-graphite">{l.unitPrice ? `${money(l.unitPrice)}/${l.unit}` : "prezzo?"}</span></p>
                    </div>
                    {c.material.composition ? <p className="mt-0.5 text-[11px] text-graphite">{c.material.composition}</p> : null}
                    {canEdit ? (
                      <form action={updateComponentAction} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <Input name="role" defaultValue={c.role ?? ""} placeholder="uso (es. polsini)" aria-label="Uso nel capo" className="h-8 w-40 text-xs" />
                        <span className="flex items-center gap-1"><Input name="qtyPerUnit" defaultValue={dec(c.qtyPerUnit, 3).replace(/,?0+$/, "")} placeholder="consumo" aria-label="Consumo per capo" className="h-8 w-20 text-right text-xs" /><span className="text-xs text-graphite">{c.material.unit} a capo</span></span>
                        <label className="flex items-center gap-1.5 text-xs text-graphite"><input type="checkbox" name="estimated" defaultChecked={c.estimated} /> stimato</label>
                        <Button size="sm" variant="outline" className="h-8">Salva</Button>
                        <Button size="sm" variant="ghost" className="h-8 text-bad" name="remove" value="1" title="Togli dal capo"><Trash2 /></Button>
                      </form>
                    ) : <p className="mt-1 text-xs text-graphite">{l.role ?? ""} {l.qty ? `${l.qty} ${l.unit} a capo${l.estimated ? " (stimato)" : ""}` : "consumo da definire"}</p>}
                  </div>
                );
              })}
              {canEdit ? (
                <form action={addComponentAction} className="mt-1 flex flex-wrap items-end gap-2 rounded-2xl border border-dashed border-steel/70 p-3">
                  <input type="hidden" name="garmentId" value={g.id} />
                  <Field label="Aggiungi tessuto o materiale" className="min-w-[200px] flex-1"><Select name="materialId" required defaultValue=""><option value="" disabled>Scegli…</option>{materials.map((m) => <option key={m.id} value={m.id}>{[m.name, m.variant].filter(Boolean).join(" — ")}{m.supplier ? ` (${m.supplier.name})` : ""}</option>)}</Select></Field>
                  <Field label="Uso"><Input name="role" placeholder="tessuto principale" className="w-36" /></Field>
                  <Field label="Consumo a capo"><Input name="qtyPerUnit" placeholder="1,2" className="w-24" /></Field>
                  <label className="flex h-9 items-center gap-1.5 text-xs text-graphite"><input type="checkbox" name="estimated" defaultChecked /> stimato</label>
                  <Button size="sm" className="h-9">Aggiungi</Button>
                </form>
              ) : null}
              {canEdit ? <p className="text-[11px] text-space">Manca un tessuto nell&apos;elenco? Aggiungilo in <Link href="/production?tab=materials" className="underline">Tessuti e materiali</Link>.</p> : null}

              <div className="mt-3 border-t border-[var(--hairline)] pt-3 text-sm tabular">
                {[
                  ["Materiali", money(cost.materials)],
                  ["Confezione", cost.sewing ? money(cost.sewing) : "—"],
                  ["Sviluppo taglie (diviso sul primo lotto)", cost.developmentPerUnit ? money(cost.developmentPerUnit) : "—"],
                  [g.extraCostNote ? `Altro: ${g.extraCostNote}` : "Altro", cost.extra ? money(cost.extra) : "—"],
                ].map(([l, v]) => <p key={l} className="flex justify-between py-0.5 text-graphite"><span>{l}</span><span>{v}</span></p>)}
                <p className="mt-1 flex justify-between border-t border-[var(--hairline)] pt-2 font-medium"><span>Costo per capo, primo lotto</span><span>{money(cost.firstLot)}</span></p>
                <p className="flex justify-between text-graphite"><span>Sui riordini</span><span>{money(cost.restock)}</span></p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Lotti di produzione</CardTitle><CardDescription>Gli ordini di produzione di questo capo.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {g.productionOrders.length === 0 ? <p className="text-sm text-graphite">Nessun lotto collegato.</p> : g.productionOrders.map((o) => {
                const st = PRODUCTION_STATUS_LABEL[o.status];
                return (
                  <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-1 py-1.5 text-sm">
                    <span><span className="font-mono text-xs">{o.reference}</span> · {o.quantity ?? "?"} pz · {o.totalCost ? money(o.totalCost.toString()) : "—"} · {fmtDate(o.orderedAt, auth.timezone)}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={st?.tone ?? "muted"}>{st?.label ?? o.status}</Badge>
                      {canEdit ? <form action={linkProductionOrderAction}><input type="hidden" name="garmentId" value={g.id} /><input type="hidden" name="productionOrderId" value={o.id} /><input type="hidden" name="unlink" value="1" /><Button size="sm" variant="ghost" className="h-7 text-xs">Scollega</Button></form> : null}
                    </span>
                  </div>
                );
              })}
              {canEdit && freeOrders.length ? (
                <form action={linkProductionOrderAction} className="mt-1 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="garmentId" value={g.id} />
                  <Select name="productionOrderId" required defaultValue="" className="h-8 w-auto max-w-full text-xs"><option value="" disabled>Collega un ordine…</option>{freeOrders.map((o) => <option key={o.id} value={o.id}>{o.reference} — {o.description.slice(0, 60)}</option>)}</Select>
                  <Button size="sm" variant="outline" className="h-8">Collega</Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Dati del capo</CardTitle></CardHeader>
            <CardContent>
              {canEdit ? (
                <form action={updateGarmentAction} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={g.id} />
                  <Field label="Nome"><Input name="name" defaultValue={g.name} required /></Field>
                  <Field label="Prodotto in negozio"><Select name="productId" defaultValue={g.productId ?? ""}><option value="">— nessuno —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Codice modello"><Input name="modelCode" defaultValue={g.modelCode ?? ""} placeholder="FP007" /></Field>
                    <Field label="Confezionista"><Select name="makerId" defaultValue={g.makerId ?? ""}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                  </div>
                  <Field label="Composizione in etichetta"><Input name="composition" defaultValue={g.composition ?? ""} placeholder="75% cotone, 25% elastan" /></Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Confezione"><Input name="sewingCost" defaultValue={dec(g.sewingCost)} placeholder="19,00" /></Field>
                    <Field label="Sviluppo"><Input name="developmentCost" defaultValue={dec(g.developmentCost)} placeholder="104,50" /></Field>
                    <Field label="Primo lotto"><Input name="lotSize" type="number" min={1} defaultValue={g.lotSize ?? ""} placeholder="pz" /></Field>
                  </div>
                  <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
                    <Field label="Altro a capo"><Input name="extraCost" defaultValue={dec(g.extraCost)} placeholder="0,00" /></Field>
                    <Field label="Cosa"><Input name="extraCostNote" defaultValue={g.extraCostNote ?? ""} placeholder="stampa, packaging…" /></Field>
                  </div>
                  <Field label="Note"><Textarea name="notes" defaultValue={g.notes ?? ""} className="min-h-[90px]" /></Field>
                  <Button type="submit" size="sm">Salva</Button>
                </form>
              ) : (
                <dl className="grid gap-2 text-sm">{[["Confezione", cost.sewing ? money(cost.sewing) : "—"], ["Sviluppo", g.developmentCost ? money(g.developmentCost.toString()) : "—"], ["Primo lotto", g.lotSize ? `${g.lotSize} pz` : "—"], ["Note", g.notes ?? "—"]].map(([k, v]) => <div key={k}><dt className="text-xs text-graphite">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>)}</dl>
              )}
            </CardContent>
          </Card>
          {canEdit ? (
            <form action={archiveGarmentAction} className={cn("text-right")}>
              <input type="hidden" name="id" value={g.id} />
              <Button size="sm" variant="ghost" className="text-graphite">Archivia scheda</Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
