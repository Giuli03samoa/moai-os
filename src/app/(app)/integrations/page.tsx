import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { listConnectors } from "@/server/connectors/registry";
import { fmtRelative } from "@/lib/format";
import { CONNECTION_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";

export default async function IntegrationsPage() {
  const auth = await requireAuth();
  const connections = await db.integrationConnection.findMany({ where: { organizationId: auth.organizationId } });
  const byKey = new Map(connections.map((c) => [c.key, c]));
  const groups = [
    { title: "Ecommerce", keys: ["shopify"] },
    { title: "Fatturazione", keys: ["legalmail", "aruba"] },
    { title: "Logistica", keys: ["packlink"] },
    { title: "Pagamenti", keys: listConnectors().filter((c) => c.provider === "PAYMENT_GATEWAY").map((c) => c.key) },
    { title: "Marketing", keys: ["meta", "ga4", "klaviyo"] },
    { title: "Notifiche", keys: ["email", "telegram"] },
  ];
  return (
    <div>
      <PageHeader title="Integrazioni" subtitle="Ogni connettore è un modulo indipendente con credenziali cifrate, verifica, job e note sui requisiti. Le credenziali non lasciano mai il server." />
      <div className="flex flex-col gap-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-graphite">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.keys.map((key) => {
                const def = listConnectors().find((c) => c.key === key)!;
                const c = byKey.get(key);
                const st = CONNECTION_STATUS_LABEL[c?.status ?? "NOT_CONFIGURED"]!;
                return (
                  <Link key={key} href={`/integrations/${key}`} className="block transition-transform hover:-translate-y-px">
                    <Card className="h-full">
                      <div className="flex h-full flex-col p-5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium">{def.displayName}</p>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-graphite">{def.description}</p>
                        <p className="mt-auto pt-3 text-[11px] text-graphite">
                          {c?.blockedReason ? <span className="text-warn">{c.blockedReason}</span> : c?.lastError ? <span className="text-bad">{c.lastError.slice(0, 80)}</span> : c?.lastSyncAt ? `Ultima sync ${fmtRelative(c.lastSyncAt)}` : c?.lastVerifiedAt ? `Verificato ${fmtRelative(c.lastVerifiedAt)}` : "Non configurato"}
                        </p>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
