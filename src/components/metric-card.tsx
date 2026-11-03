import Link from "next/link";
import type { Metric } from "@/server/metrics/dashboard";
import { fmtMoney, fmtNumber, fmtRelative } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/labels";
import { Card } from "@/components/ui/primitives";

export function MetricCard({ m, highlight }: { m: Metric; highlight?: boolean }) {
  const value = m.format === "money" ? fmtMoney(m.value, m.currency) : fmtNumber(m.value);
  const body = (
    <Card className={highlight ? "bg-blackout text-crocus" : ""}>
      <div className="p-5">
        <p className={`text-[11px] font-medium uppercase tracking-wide ${highlight ? "text-space" : "text-graphite"}`}>{m.label}</p>
        <p className="mt-2 text-2xl font-medium tabular" title={m.definition}>{value}</p>
        <p className={`mt-3 text-[11px] ${highlight ? "text-space" : "text-graphite"}`}>
          {m.sources.length ? m.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ") : "nessuna fonte"} · {m.updatedAt ? `agg. ${fmtRelative(m.updatedAt)}` : "mai sincronizzato"}
        </p>
      </div>
    </Card>
  );
  return m.href ? <Link href={m.href} className="block transition-transform hover:-translate-y-px">{body}</Link> : body;
}
