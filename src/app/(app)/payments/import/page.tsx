import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { FIELDS, PRESETS } from "@/server/imports/csv-mapping";
import { PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ImportForm } from "./import-form";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const auth = await requireAuth("OPERATIONS");
  const { kind } = await searchParams;
  const saved = await db.csvMappingPreset.findMany({ where: { organizationId: auth.organizationId }, orderBy: { name: "asc" } });
  const presets = [
    ...Object.entries(PRESETS).map(([name, m]) => ({ name, kind: m.kind, mapping: m, builtin: true })),
    ...saved.map((p) => ({ name: p.name, kind: p.kind as string, mapping: p.mapping as Record<string, unknown>, builtin: false })),
  ];
  const batches = await db.importBatch.findMany({ where: { organizationId: auth.organizationId }, orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <div>
      <PageHeader title="Importa CSV" subtitle="Transazioni gateway, payout, estratto conto bancario o spedizioni Packlink. Il mapping è configurabile e salvabile come preset; l'anteprima mostra cosa verrà importato prima di scrivere." actions={<Button asChild variant="ghost" size="sm"><Link href="/payments">← Payments</Link></Button>} />
      <ImportForm presets={presets} fields={FIELDS} initialKind={kind === "SHIPMENTS" || kind === "BANK" || kind === "PAYOUTS" ? kind : "PAYMENTS"} tz={auth.timezone} />
      {batches.length ? (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-medium">Ultime importazioni</h2>
          <ul className="flex flex-col gap-1 text-xs text-graphite">
            {batches.map((b) => (
              <li key={b.id}>{b.createdAt.toLocaleString("it-IT", { timeZone: auth.timezone })} · {b.kind} · {b.provider ?? ""} · {b.presetName ?? "mapping manuale"} · {b.rowsImported} nuove, {b.rowsUpdated} aggiornate, {b.rowsSkipped} saltate</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
