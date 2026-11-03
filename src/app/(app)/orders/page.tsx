import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { resolvePeriod } from "@/lib/periods";
import { fmtDate, fmtMoney } from "@/lib/format";
import { FINANCIAL_STATUS_LABEL, FULFILLMENT_STATUS_LABEL } from "@/lib/labels";
import { DataTable, parseTableQuery } from "@/components/data-table";
import { PeriodFilter } from "@/components/period-filter";
import { SourceTag } from "@/components/source-tag";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;
const SORT: Record<string, keyof Prisma.OrderOrderByWithRelationInput> = { processedAt: "processedAt", name: "name", totalPrice: "totalPrice", financialStatus: "financialStatus", fulfillmentStatus: "fulfillmentStatus" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const range = resolvePeriod(sp, auth.timezone);
  const q = parseTableQuery(sp, { sort: "processedAt" }, Object.keys(SORT));
  const status = sp.status;
  const where: Prisma.OrderWhereInput = {
    organizationId: auth.organizationId,
    deletedAt: null,
    processedAt: { gte: range.from, lte: range.to },
    ...(status === "REFUNDED" ? { totalRefunded: { gt: 0 } } : status === "UNFULFILLED" ? { fulfillmentStatus: { in: ["UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "OPEN"] } } : status ? { financialStatus: status } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { tags: { has: q.q } }, { items: { some: { sku: { contains: q.q, mode: "insensitive" } } } }, { customer: { email: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.order.findMany({ where, orderBy: { [SORT[q.sort]!]: q.dir }, skip: q.skip, take: q.take, include: { _count: { select: { items: true } }, shipments: { select: { status: true } } } }),
    db.order.count({ where }),
  ]);
  const extra = { period: range.key, from: sp.from, to: sp.to, status };
  const exportQs = new URLSearchParams(Object.fromEntries(Object.entries({ period: range.key, from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>).toString();
  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Ordini Shopify con stato pagamento ed evasione. Fonte: Shopify GraphQL Admin API."
        actions={
          <>
            <PeriodFilter basePath="/orders" current={range.key} from={range.from} to={range.to} tz={auth.timezone} extra={{ status }} />
            <Button asChild variant="outline" size="sm"><a href={`/api/export/orders?${exportQs}`}>Esporta CSV</a></Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-1">
        {[
          { v: undefined, l: "Tutti" }, { v: "PAID", l: "Pagati" }, { v: "PENDING", l: "In attesa" }, { v: "UNFULFILLED", l: "Da evadere" }, { v: "REFUNDED", l: "Con rimborsi" }, { v: "VOIDED", l: "Annullati" },
        ].map((f) => (
          <Link key={f.l} href={`/orders?${new URLSearchParams({ period: range.key, ...(sp.from ? { from: sp.from, to: sp.to ?? "" } : {}), ...(f.v ? { status: f.v } : {}) })}`} className={`rounded-full px-3 py-1 text-xs ${status === f.v ? "bg-blackout text-crocus" : "bg-cloud text-graphite hover:text-blackout"}`}>
            {f.l}
          </Link>
        ))}
      </div>
      <DataTable
        rows={rows}
        total={total}
        query={q}
        basePath="/orders"
        params={extra}
        rowKey={(o) => o.id}
        emptyTitle="Nessun ordine nel periodo"
        searchPlaceholder="Numero ordine, SKU, tag, email…"
        columns={[
          { key: "name", label: "Ordine", sortable: true, render: (o) => <Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.name}{o.test ? <Badge tone="outline" className="ml-2">test</Badge> : null}</Link> },
          { key: "processedAt", label: "Data", sortable: true, render: (o) => fmtDate(o.processedAt, auth.timezone, true) },
          { key: "financialStatus", label: "Pagamento", sortable: true, render: (o) => <Badge tone={o.financialStatus === "PAID" ? "ok" : o.financialStatus.includes("REFUND") ? "warn" : o.financialStatus === "VOIDED" ? "bad" : "muted"}>{FINANCIAL_STATUS_LABEL[o.financialStatus] ?? o.financialStatus}</Badge> },
          { key: "fulfillmentStatus", label: "Evasione", sortable: true, render: (o) => <Badge tone={o.fulfillmentStatus === "FULFILLED" ? "ok" : "muted"}>{FULFILLMENT_STATUS_LABEL[o.fulfillmentStatus] ?? o.fulfillmentStatus}</Badge> },
          { key: "items", label: "Articoli", align: "right", render: (o) => o._count.items },
          { key: "gateway", label: "Gateway", render: (o) => <span className="text-xs text-graphite">{o.paymentGateways.join(", ") || "—"}</span> },
          { key: "totalPrice", label: "Totale", sortable: true, align: "right", render: (o) => <span className="font-medium">{fmtMoney(o.totalPrice.toString(), o.currency)}</span> },
          { key: "totalRefunded", label: "Rimborsato", align: "right", render: (o) => (o.totalRefunded.isZero() ? <span className="text-graphite">—</span> : fmtMoney(o.totalRefunded.toString(), o.currency)) },
          { key: "source", label: "Origine", render: (o) => <SourceTag source={o.source} updatedAt={o.syncedAt} demo={o.isDemo} /> },
        ]}
      />
    </div>
  );
}
