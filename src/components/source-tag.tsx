import { fmtRelative } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/labels";

/** "Shopify · agg. 12 min fa" — every row says where it comes from and how fresh it is. */
export function SourceTag({ source, updatedAt, demo }: { source: string; updatedAt?: Date | string | null; demo?: boolean }) {
  return (
    <span className="whitespace-nowrap text-[11px] text-graphite">
      {demo ? <span className="mr-1 rounded bg-warn-bg px-1 text-warn">DEMO</span> : null}
      {SOURCE_LABEL[source] ?? source}
      {updatedAt ? <> · {fmtRelative(updatedAt)}</> : null}
    </span>
  );
}
