import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { fmtMoney } from "@/lib/format";
import { DataTable, parseTableQuery } from "@/components/data-table";
import { SourceTag } from "@/components/source-tag";
import { Badge, PageHeader } from "@/components/ui/primitives";

type SP = Record<string, string | undefined>;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
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
    <div>
      <PageHeader title="Prodotti" subtitle="Prodotti e varianti con giacenza per variante (snapshot Shopify). «Non tracciata» vuol dire che Shopify non controlla le scorte. I movimenti sono le differenze rilevate tra due sincronizzazioni." />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={lowStock ? "warn" : "ok"}>{lowStock} varianti tracciate con giacenza ≤ 3</Badge>
        {movements.length ? <span className="text-xs text-graphite">Ultimi movimenti: {movements.map((m) => `${m.variant.sku ?? m.variant.product.title} ${m.quantityDelta > 0 ? "+" : ""}${m.quantityDelta}`).join(" · ")}</span> : null}
      </div>
      <DataTable rows={rows} total={total} query={q} basePath="/products" rowKey={(r) => r.id} emptyTitle="Nessun prodotto: esegui la sincronizzazione prodotti da Integrations → Shopify" searchPlaceholder="SKU, nome, tipologia…"
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
    </div>
  );
}
