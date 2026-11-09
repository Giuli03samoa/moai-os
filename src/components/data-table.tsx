import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, TBody, TD, TH, THead, TR, Table, Empty } from "@/components/ui/primitives";

/**
 * Server-rendered table with URL-driven search, sorting and pagination.
 * Keeps the dashboard fast and bookmarkable without client state.
 */
export type Column<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
};

export type TableQuery = { q?: string; sort?: string; dir?: "asc" | "desc"; page?: string };

export function parseTableQuery(sp: Record<string, string | string[] | undefined>, defaults: { sort: string; dir?: "asc" | "desc" }, allowedSort: string[]) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const sort = allowedSort.includes(first(sp.sort) ?? "") ? (first(sp.sort) as string) : defaults.sort;
  const dir = first(sp.dir) === "asc" ? "asc" : first(sp.dir) === "desc" ? "desc" : defaults.dir ?? "desc";
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1);
  return { q, sort, dir: dir as "asc" | "desc", page, take: 50, skip: (page - 1) * 50 };
}

export function DataTable<T>({ rows, columns, total, query, basePath, params, emptyTitle, rowKey, searchPlaceholder }: {
  rows: T[];
  columns: Column<T>[];
  total: number;
  query: { q: string; sort: string; dir: "asc" | "desc"; page: number; take: number };
  basePath: string;
  params?: Record<string, string | undefined>;
  emptyTitle: string;
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
}) {
  const href = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, q: query.q || undefined, sort: query.sort, dir: query.dir, page: String(query.page), ...patch })) if (v) sp.set(k, v);
    return `${basePath}?${sp.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(total / query.take));
  return (
    <div className="flex flex-col gap-3">
      <form action={basePath} className="flex flex-wrap items-center gap-2">
        {Object.entries(params ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input type="hidden" name="sort" value={query.sort} />
        <input type="hidden" name="dir" value={query.dir} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-space" strokeWidth={1.75} />
          <Input name="q" defaultValue={query.q} placeholder={searchPlaceholder ?? "Cerca…"} className="rounded-full pl-9" />
        </div>
        <Button type="submit" variant="secondary" size="sm">Cerca</Button>
        {query.q ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={href({ q: undefined, page: "1" })}>Azzera</Link>
          </Button>
        ) : null}
        <span className="ml-auto rounded-full bg-cloud px-2.5 py-1 text-xs text-graphite tabular">{total} risultati</span>
      </form>
      {rows.length === 0 ? (
        <Empty title={emptyTitle} />
      ) : (
        <div className="surface overflow-hidden rounded-[18px] border border-[var(--hairline)]">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {columns.map((c) => (
                  <TH key={c.key} className={c.align === "right" ? "text-right" : ""}>
                    {c.sortable ? (
                      <Link href={href({ sort: c.key, dir: query.sort === c.key && query.dir === "desc" ? "asc" : "desc", page: "1" })} className="inline-flex items-center gap-1 hover:text-blackout">
                        {c.label}
                        {query.sort === c.key ? (query.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={rowKey(r)}>
                  {columns.map((c) => (
                    <TD key={c.key} className={c.align === "right" ? "text-right tabular" : ""}>
                      {c.render(r)}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm text-graphite">
          <span>Pagina {query.page} di {pages}</span>
          {query.page > 1 ? <Button asChild variant="outline" size="sm"><Link href={href({ page: String(query.page - 1) })}>Precedente</Link></Button> : null}
          {query.page < pages ? <Button asChild variant="outline" size="sm"><Link href={href({ page: String(query.page + 1) })}>Successiva</Link></Button> : null}
        </div>
      ) : null}
    </div>
  );
}
