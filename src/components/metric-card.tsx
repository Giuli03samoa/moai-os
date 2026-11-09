import Link from "next/link";
import { ArrowUpRight, Banknote, CircleDollarSign, FileDown, FileUp, Landmark, Percent, Receipt, RotateCcw, Scale, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import type { Metric } from "@/server/metrics/dashboard";
import { fmtMoney, fmtNumber, fmtRelative } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ICON: Record<string, LucideIcon> = {
  gross: CircleDollarSign,
  net: Banknote,
  orders: ShoppingBag,
  captured: Receipt,
  fees: Percent,
  payouts: Landmark,
  invoicesIssued: FileUp,
  invoicesReceived: FileDown,
  toShip: Truck,
  refunded: RotateCcw,
  unreconciled: Scale,
};

export function MetricCard({ m, highlight }: { m: Metric; highlight?: boolean }) {
  const value = m.format === "money" ? fmtMoney(m.value, m.currency) : fmtNumber(m.value);
  const Icon = ICON[m.key] ?? CircleDollarSign;
  const zero = Number(m.value) === 0;
  const body = (
    <div
      className={cn(
        "group relative h-full overflow-hidden rounded-[18px] border p-5 transition-[transform,box-shadow,border-color] duration-200",
        highlight ? "theme-ink chevron-pattern border-transparent bg-ink text-paper dark:border-[#3a3a3e] dark:bg-[#2b2b2e]" : "surface border-[var(--hairline)] hover:border-smoke",
        m.href && "hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", highlight ? "bg-paper/10 text-paper" : "bg-cloud text-graphite")}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        {m.href ? <ArrowUpRight className={cn("h-4 w-4 opacity-0 transition-opacity group-hover:opacity-60", highlight && "text-paper")} /> : null}
      </div>
      <p className={cn("mt-4 text-xs", highlight ? "text-[#9da2b3]" : "text-graphite")}>{m.label}</p>
      <p className={cn("mt-1 text-[26px] font-medium leading-tight tracking-[-0.03em] tabular", zero && !highlight && "text-graphite")} title={m.definition}>{value}</p>
      <p className={cn("mt-3 truncate text-[11px]", highlight ? "text-[#6e7180]" : "text-space")}>
        {m.sources.length ? m.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ") : "nessuna fonte"} · {m.updatedAt ? `agg. ${fmtRelative(m.updatedAt)}` : "mai sincronizzato"}
      </p>
    </div>
  );
  return m.href ? <Link href={m.href} className="block h-full">{body}</Link> : body;
}
