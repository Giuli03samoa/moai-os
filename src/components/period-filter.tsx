import Link from "next/link";
import { PERIODS, type PeriodKey, toInputDate } from "@/lib/periods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function PeriodFilter({ basePath, current, from, to, tz, extra }: { basePath: string; current: PeriodKey; from: Date; to: Date; tz: string; extra?: Record<string, string | undefined> }) {
  const qs = (period: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(extra ?? {})) if (v) sp.set(k, v);
    sp.set("period", period);
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-full bg-cloud p-1">
        {PERIODS.map((p) => (
          <Link key={p.key} href={qs(p.key)} className={cn("rounded-full px-3 py-1 text-xs transition-colors", current === p.key ? "bg-white text-blackout shadow-sm" : "text-graphite hover:text-blackout")}>
            {p.label}
          </Link>
        ))}
      </div>
      <form action={basePath} className="flex flex-wrap items-center gap-1">
        {Object.entries(extra ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input type="hidden" name="period" value="custom" />
        <Input type="date" name="from" defaultValue={toInputDate(from, tz)} className="h-8 w-[140px] rounded-full text-xs" />
        <span className="text-xs text-graphite">→</span>
        <Input type="date" name="to" defaultValue={toInputDate(to, tz)} className="h-8 w-[140px] rounded-full text-xs" />
        <Button type="submit" variant="outline" size="sm">Applica</Button>
      </form>
    </div>
  );
}
