import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArrowUpRight, Package, Search } from "lucide-react";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { createGarmentAction } from "@/server/actions/garments";
import { garmentInclude, summarizeGarment } from "@/server/production/garments";
import { GENDER_LABEL, genderOf, variantGrid, type Gender } from "@/server/products/catalog";
import { fmtMoney } from "@/lib/format";
import { PRODUCTION_STATUS_LABEL } from "@/lib/labels";
import { DataTable, parseTableQuery } from "@/components/data-table";
import { SourceTag } from "@/components/source-tag";
import { Badge, Card, Empty, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SP = Record<string, string | undefined>;
const VIEWS = [{ key: "list", label: "Listino" }, { key: "variants", label: "Tutte le varianti" }] as const;
const LINES = [{ key: "all", label: "Tutti" }, { key: "MEN", label: "Uomo" }, { key: "WOMEN", label: "Donna" }] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const view = sp.view === "variants" ? "variants" : "list";
  const tabs = (
    <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-full bg-cloud p-1">
      {VIEWS.map((v) => <Link key={v.key} href={`/products?view=${v.key}`} className={cn("rounded-full px-3 py-1 text-xs", view === v.key ? "bg-blackout text-crocus" : "text-graphite hover:text-blackout")}>{v.label}</Link>)}
    </div>
  );
  return (
    <div>
      <PageHeader eyebrow="Catalogo" title="Prodotti" subtitle={view === "list" ? "Un capo per scheda: prezzo, colori e taglie con i pezzi in magazzino, e quanto ti costa produrlo. Prezzi e scorte arrivano da Shopify; costi e margine dalle schede di Produzione." : "Ogni riga è una variante (un colore in una taglia), come su Shopify. Utile per cercare uno SKU."} />
      {tabs}
      {view === "list" ? <PriceList sp={sp} auth={auth} /> : <Variants sp={sp} auth={auth} />}
    </div>
  );
}

type Auth = Awaited<ReturnType<typeof requireAuth>>;

async function PriceList({ sp, auth }: { sp: SP; auth: Auth }) {
  const orgId = auth.organizationId;
  const line = LINES.some((l) => l.key === sp.line) ? sp.line! : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const [products, garments] = await Promise.all([
    db.product.findMany({ where: { organizationId: orgId, deletedAt: null }, include: { variants: { where: { deletedAt: null }, orderBy: { title: "asc" } } }, orderBy: { title: "asc" } }),
    db.garmentSpec.findMany({ where: { organizationId: orgId, archivedAt: null, productId: { not: null } }, include: garmentInclude }),
  ]);
  const byProduct = new Map(garments.map((g) => [g.productId!, g]));
  const canEdit = hasRole(auth.role, "OPERATIONS");
  const money = (v: number | string | null | undefined) => fmtMoney(String(v ?? 0), auth.currency);

  const items = products
    .map((p) => ({ p, gender: genderOf(p.title), grid: variantGrid(p.variants), spec: byProduct.get(p.id) }))
    .filter((x) => (line === "all" || x.gender === line) && (!q || x.p.title.toLowerCase().includes(q) || (x.p.productType ?? "").toLowerCase().includes(q)));
  const all = products.map((p) => variantGrid(p.variants));
  const stock = all.reduce((a, g) => a + (g.stock ?? 0), 0);
  const low = all.reduce((a, g) => a + g.low + g.out, 0);
  const withSpec = products.filter((p) => byProduct.has(p.id)).length;

  const qs = (patch: Record<string, string>) => `/products?${new URLSearchParams({ view: "list", ...(line !== "all" ? { line } : {}), ...(sp.q ? { q: sp.q } : {}), ...patch })}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Capi in negozio", String(products.length), `${products.filter((p) => genderOf(p.title) === "MEN").length} uomo · ${products.filter((p) => genderOf(p.title) === "WOMEN").length} donna`],
          ["Varianti", String(products.reduce((a, p) => a + p.variants.length, 0)), "colori × taglie"],
          ["Pezzi in magazzino", stock.toLocaleString("it-IT"), "solo varianti con scorte tracciate"],
          ["Con scheda di produzione", `${withSpec} su ${products.length}`, low ? `${low} varianti in esaurimento` : "nessuna variante in esaurimento"],
        ].map(([l, v, n]) => <Card key={l}><div className="p-4"><p className="text-xs text-graphite">{l}</p><p className="mt-1 text-xl font-medium tracking-[-0.03em] tabular">{v}</p><p className="mt-0.5 truncate text-[11px] text-space">{n}</p></div></Card>)}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-fit gap-1 rounded-full bg-cloud p-1">
          {LINES.map((l) => <Link key={l.key} href={qs({ line: l.key })} className={cn("rounded-full px-3 py-1 text-xs", line === l.key ? "bg-blackout text-crocus" : "text-graphite hover:text-blackout")}>{l.label}</Link>)}
        </div>
        <form action="/products" className="flex h-8 items-center gap-2 rounded-full border border-smoke bg-white/70 px-3 text-xs">
          <input type="hidden" name="view" value="list" />{line !== "all" ? <input type="hidden" name="line" value={line} /> : null}
          <Search className="h-3.5 w-3.5 text-space" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Cerca un capo…" className="w-40 bg-transparent outline-none placeholder:text-space" />
        </form>
      </div>

      {items.length === 0 ? <Empty icon={<Package className="h-5 w-5" strokeWidth={1.75} />} title="Nessun capo">{products.length ? "Nessun capo corrisponde al filtro." : "Esegui la sincronizzazione prodotti da Integrazioni → Shopify."}</Empty> : null}

      {(["MEN", "WOMEN"] as Gender[]).map((gender) => {
        const group = items.filter((x) => x.gender === gender);
        if (!group.length) return null;
        return (
          <section key={gender}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-[15px] font-medium tracking-[-0.02em]">{GENDER_LABEL[gender]}</h2>
              <p className="text-xs text-graphite">{group.length === 1 ? "1 capo" : `${group.length} capi`}</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {group.map(({ p, grid, spec }) => {
                const summary = spec ? summarizeGarment(spec) : null;
                const incomplete = summary && (summary.cost.missing || summary.cost.noSewing || summary.cost.noFabric);
                const lot = spec?.productionOrders[0];
                return (
                  <Card key={p.id} className="flex flex-col overflow-hidden">
                    <div className="flex items-start justify-between gap-3 p-5 pb-4">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2"><span className="text-[17px] font-medium tracking-[-0.02em]">{p.title}</span>{p.status && p.status !== "ACTIVE" ? <Badge tone="muted">{p.status === "DRAFT" ? "bozza" : p.status.toLowerCase()}</Badge> : null}</p>
                        <p className="mt-0.5 text-xs text-graphite">{[p.productType, grid.colors.filter((c) => c !== "Unico").join(", ")].filter(Boolean).join(" · ")}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xl font-medium tracking-[-0.03em] tabular">{grid.prices.min === grid.prices.max ? money(grid.prices.min) : `${money(grid.prices.min)}–${money(grid.prices.max)}`}</p>
                        <p className="text-[11px] text-space">IVA inclusa</p>
                      </div>
                    </div>

                    <div className="px-5">
                      <table className="w-full text-center text-xs tabular">
                        <thead><tr className="text-[11px] text-graphite"><th className="py-1.5 pr-2 text-left font-normal">Taglia</th>{grid.sizes.map((s) => <th key={s} className="px-1 py-1.5 font-medium">{s}</th>)}</tr></thead>
                        <tbody>
                          {grid.colors.map((c) => (
                            <tr key={c} className="border-t border-[var(--hairline)]">
                              <td className="py-1.5 pr-2 text-left text-graphite">{c}</td>
                              {grid.sizes.map((s) => {
                                const cell = grid.cells[c]?.[s];
                                if (!cell) return <td key={s} className="px-1 py-1.5 text-steel">·</td>;
                                if (!cell.tracked) return <td key={s} className="px-1 py-1.5 text-space" title={`${cell.sku ?? ""} · scorte non tracciate da Shopify`}>n.t.</td>;
                                return <td key={s} className={cn("px-1 py-1.5", cell.qty! <= 0 ? "text-bad" : cell.qty! <= 3 ? "font-medium text-warn" : "")} title={cell.sku ?? undefined}>{cell.qty}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1.5 text-[11px] text-space">{grid.stock !== null ? `${grid.stock} pezzi in magazzino` : "Scorte non tracciate da Shopify"}{grid.untracked && grid.stock !== null ? ` · ${grid.untracked} varianti non tracciate` : ""}{grid.out ? ` · ${grid.out} esaurite` : ""}</p>
                    </div>

                    <div className="mt-4 flex flex-1 items-end border-t border-[var(--hairline)] bg-cloud/40 px-5 py-3.5">
                      {spec && summary ? (
                        <Link href={`/production/garments/${spec.id}`} className="group flex w-full items-center justify-between gap-3">
                          <span className="flex gap-6 tabular">
                            <span><span className="block text-[11px] text-graphite">Costo per capo</span><span className="text-[15px] font-medium">{money(summary.cost.firstLot)}</span></span>
                            <span><span className="block text-[11px] text-graphite">Margine</span><span className={cn("text-[15px] font-medium", summary.marginFirst && summary.marginFirst.pct < 40 ? "text-warn" : "")}>{summary.marginFirst ? `${summary.marginFirst.pct}%` : "—"}</span></span>
                            <span className="hidden sm:block"><span className="block text-[11px] text-graphite">Ultimo lotto</span><span className="text-xs">{lot ? <>{lot.quantity ?? "?"} pz · {PRODUCTION_STATUS_LABEL[lot.status]?.label ?? lot.status}</> : "—"}</span></span>
                          </span>
                          <span className="flex items-center gap-2">{incomplete ? <Badge tone="bad">costo incompleto</Badge> : summary.cost.estimated ? <Badge tone="warn">stimato</Badge> : null}<ArrowUpRight className="h-4 w-4 text-graphite transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
                        </Link>
                      ) : (
                        <div className="flex w-full items-center justify-between gap-3">
                          <span className="text-xs text-graphite">Nessuna scheda di produzione: costo e margine non noti.</span>
                          {canEdit ? <form action={createGarmentAction}><input type="hidden" name="productId" value={p.id} /><Button size="sm" variant="outline">Crea scheda</Button></form> : null}
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-space">Costo e margine sono stime gestionali IVA esclusa, calcolate sul prezzo più comune del capo. «n.t.» = Shopify non conta le scorte di quella variante.</p>
    </div>
  );
}

async function Variants({ sp, auth }: { sp: SP; auth: Auth }) {
  const q = parseTableQuery(sp, { sort: "sku", dir: "asc" }, ["sku", "title", "price", "inventoryQuantity"]);
  const where: Prisma.ProductVariantWhereInput = {
    organizationId: auth.organizationId, deletedAt: null,
    ...(q.q ? { OR: [{ sku: { contains: q.q, mode: "insensitive" } }, { title: { contains: q.q, mode: "insensitive" } }, { product: { title: { contains: q.q, mode: "insensitive" } } }, { product: { productType: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, movements, lowStock] = await Promise.all([
    db.productVariant.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { product: true } }),
    db.productVariant.count({ where }),
    db.inventoryMovement.findMany({ where: { organizationId: auth.organizationId }, orderBy: { occurredAt: "desc" }, take: 8, include: { variant: { select: { sku: true, title: true, product: { select: { title: true } } } } } }),
    db.productVariant.count({ where: { organizationId: auth.organizationId, deletedAt: null, inventoryTracked: true, inventoryQuantity: { lte: 3 }, product: { status: "ACTIVE" } } }),
  ]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={lowStock ? "warn" : "ok"}>{lowStock} varianti tracciate con giacenza ≤ 3</Badge>
        {movements.length ? <span className="text-xs text-graphite">Ultimi movimenti: {movements.map((m) => `${m.variant.sku ?? m.variant.product.title} ${m.quantityDelta > 0 ? "+" : ""}${m.quantityDelta}`).join(" · ")}</span> : null}
      </div>
      <DataTable rows={rows} total={total} query={q} basePath="/products" params={{ view: "variants" }} rowKey={(r) => r.id} emptyTitle="Nessun prodotto: esegui la sincronizzazione prodotti da Integrazioni → Shopify" searchPlaceholder="SKU, nome, tipologia…"
        columns={[
          { key: "sku", label: "SKU", sortable: true, render: (r) => <span className="font-mono text-xs">{r.sku ?? "—"}</span> },
          { key: "product", label: "Prodotto", render: (r) => <span className="font-medium">{r.product.title}</span> },
          { key: "title", label: "Variante", sortable: true, render: (r) => <span className="text-xs">{r.title}</span> },
          { key: "type", label: "Tipologia", render: (r) => <span className="text-xs text-graphite">{r.product.productType || "—"}</span> },
          { key: "status", label: "Stato", render: (r) => <Badge tone={r.product.status === "ACTIVE" ? "ok" : "muted"}>{r.product.status ?? "—"}</Badge> },
          { key: "price", label: "Prezzo", sortable: true, align: "right", render: (r) => fmtMoney(r.price.toString(), r.currency || auth.currency) },
          { key: "inventoryQuantity", label: "Giacenza", sortable: true, align: "right", render: (r) => (r.inventoryQuantity === null || r.inventoryTracked === false ? <span className="text-graphite" title="Shopify non traccia le scorte di questa variante: la quantità non indica un esaurimento">non tracciata</span> : <span className={r.inventoryQuantity <= 3 ? "font-medium text-warn" : ""}>{r.inventoryQuantity}</span>) },
          { key: "source", label: "Origine", render: (r) => <SourceTag source={r.source} updatedAt={r.syncedAt} demo={r.isDemo} /> },
        ]} />
    </>
  );
}
