import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { fmtDate, fmtRelative } from "@/lib/format";
import { CHANNEL_LABEL, CONNECTION_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const CONNECTOR_BY_CHANNEL: Record<string, string> = { instagram: "meta", facebook: "meta", meta_ads: "meta", web: "ga4", email: "klaviyo" };

export default async function MarketingPage() {
  const auth = await requireAuth();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [snapshots, posts, connections] = await Promise.all([
    db.marketingSnapshot.findMany({ where: { organizationId: auth.organizationId, date: { gte: since } }, orderBy: { date: "desc" } }),
    db.socialPost.findMany({ where: { organizationId: auth.organizationId }, orderBy: { publishedAt: "desc" }, take: 20 }),
    db.integrationConnection.findMany({ where: { organizationId: auth.organizationId, key: { in: ["meta", "ga4", "klaviyo"] } } }),
  ]);
  const channels = ["instagram", "facebook", "meta_ads", "web", "email"];
  const byChannel = new Map(channels.map((c) => [c, snapshots.filter((s) => s.channel === c)]));
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const sum = (rows: typeof snapshots, key: string) => rows.reduce((a, r) => a + (num((r.metrics as Record<string, unknown>)[key]) ?? 0), 0);
  return (
    <div>
      <PageHeader title="Marketing" subtitle="Instagram, Facebook, Meta Ads, sito (GA4) ed email (Klaviyo) in sola lettura. Correlazioni, non attribuzione: i ricavi veri restano quelli degli ordini." actions={<Button asChild variant="outline" size="sm"><Link href="/integrations">Collega canali</Link></Button>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {channels.map((ch) => {
          const rows = byChannel.get(ch) ?? [];
          const latest = rows[0];
          const m = (latest?.metrics ?? {}) as Record<string, unknown>;
          const conn = connections.find((c) => c.key === CONNECTOR_BY_CHANNEL[ch]);
          const st = CONNECTION_STATUS_LABEL[conn?.status ?? "NOT_CONFIGURED"]!;
          const headline = ch === "instagram" || ch === "facebook" ? { label: "Follower", value: num(m.followers) } : ch === "meta_ads" ? { label: "Spesa 7 giorni", value: sum(rows.slice(0, 7), "spend") } : ch === "web" ? { label: "Sessioni 7 giorni", value: sum(rows.slice(0, 7), "sessions") } : { label: "Campagne inviate 30g", value: num(m.campaignsSent30d) };
          return (
            <Card key={ch}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2"><p className="text-[11px] font-medium uppercase tracking-wide text-graphite">{CHANNEL_LABEL[ch]}</p><Badge tone={st.tone}>{st.label}</Badge></div>
                <p className="mt-2 text-2xl font-medium tabular">{headline.value === null || Number.isNaN(headline.value) ? "—" : headline.value.toLocaleString("it-IT", { maximumFractionDigits: 2 })}</p>
                <p className="text-[11px] text-graphite">{headline.label}{latest ? ` · ${latest.date} · agg. ${fmtRelative(latest.syncedAt)}` : " · nessun dato"}</p>
                {ch === "instagram" && m.reach !== undefined ? <p className="mt-1 text-[11px] text-graphite">reach ultimo giorno {String(m.reach)}</p> : null}
                {ch === "web" && latest ? <p className="mt-1 text-[11px] text-graphite">utenti 7g {sum(rows.slice(0, 7), "totalUsers")} · acquisti {sum(rows.slice(0, 7), "ecommercePurchases")}</p> : null}
                {!conn || conn.status === "NOT_CONFIGURED" ? <Link href={`/integrations/${CONNECTOR_BY_CHANNEL[ch]}`} className="mt-2 block text-xs underline-offset-4 hover:underline">Collega →</Link> : null}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Serie giornaliere (30 giorni)</CardTitle><CardDescription>Solo i valori restituiti dalle API, per giorno.</CardDescription></CardHeader>
          <CardContent>
            {snapshots.length === 0 ? <p className="text-sm text-graphite">Nessun dato: collega Meta, GA4 o Klaviyo e avvia la sincronizzazione.</p> : (
              <Table>
                <THead><TR><TH>Giorno</TH><TH>Canale</TH><TH>Metriche</TH></TR></THead>
                <TBody>{snapshots.slice(0, 60).map((s) => <TR key={s.id}><TD className="text-xs">{s.date}</TD><TD className="text-xs">{CHANNEL_LABEL[s.channel] ?? s.channel}</TD><TD className="font-mono text-[11px] text-graphite">{Object.entries(s.metrics as Record<string, unknown>).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${String(v)}`).join("  ")}</TD></TR>)}</TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Post recenti</CardTitle><CardDescription>Like e commenti dall'API Instagram.</CardDescription></CardHeader>
          <CardContent>
            {posts.length === 0 ? <p className="text-sm text-graphite">Nessun post sincronizzato.</p> : (
              <Table>
                <THead><TR><TH>Data</TH><TH>Post</TH><TH className="text-right">Like</TH><TH className="text-right">Commenti</TH></TR></THead>
                <TBody>{posts.map((p) => { const m = p.metrics as Record<string, unknown>; return <TR key={p.id}><TD className="text-xs">{fmtDate(p.publishedAt, auth.timezone)}</TD><TD className="max-w-md truncate text-xs">{p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer" className="hover:underline">{p.caption?.slice(0, 90) || p.mediaType || p.externalId}</a> : p.caption?.slice(0, 90)}</TD><TD className="text-right tabular">{String(m.likes ?? "—")}</TD><TD className="text-right tabular">{String(m.comments ?? "—")}</TD></TR>; })}</TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
