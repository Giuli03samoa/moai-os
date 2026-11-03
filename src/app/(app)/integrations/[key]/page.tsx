import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { getConnector, listConnectors, loadConnection } from "@/server/connectors/registry";
import { runJobAction, saveIntegrationAction, verifyIntegrationAction } from "@/server/actions/integrations";
import { JOB_LABELS } from "@/server/jobs/handlers";
import { fmtDate, fmtRelative } from "@/lib/format";
import { CONNECTION_STATUS_LABEL, JOB_STATUS_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select, TBody, TD, TH, THead, TR, Table } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function IntegrationDetail({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const { key } = await params;
  const sp = await searchParams;
  if (!listConnectors().some((c) => c.key === key)) notFound();
  const def = getConnector(key);
  const loaded = await loadConnection(auth.organizationId, key);
  const c = loaded?.connection;
  const config = loaded?.config ?? {};
  const presentSecrets = new Set(Object.keys(loaded?.secrets ?? {}).filter((k) => !k.startsWith("_")));
  const canEdit = hasRole(auth.role, "ADMIN");
  const canRun = hasRole(auth.role, "OPERATIONS");
  const jobs = c ? await db.syncJob.findMany({ where: { organizationId: auth.organizationId, connectionId: c.id }, orderBy: { createdAt: "desc" }, take: 15 }) : [];
  const st = CONNECTION_STATUS_LABEL[c?.status ?? "NOT_CONFIGURED"]!;
  const caps = (c?.capabilities as Record<string, boolean | string>) ?? {};
  const cursors = (c?.cursors as Record<string, string>) ?? {};
  const webhookUrl = `${process.env.APP_URL ?? ""}/api/webhooks/shopify`;

  return (
    <div>
      <PageHeader title={def.displayName} subtitle={def.description} actions={<><Badge tone={st.tone} className="text-xs">{st.label}</Badge><Button asChild variant="ghost" size="sm"><Link href="/integrations">← Integrazioni</Link></Button></>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      {c?.blockedReason ? <div className="mb-4"><Notice tone="warn"><strong>Bloccato:</strong> {c.blockedReason}</Notice></div> : null}
      {c?.lastError && c.status === "ERROR" ? <div className="mb-4"><Notice tone="bad">{c.lastError}</Notice></div> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Configurazione</CardTitle></CardHeader>
          <CardContent>
            {def.secretFields.length === 0 && def.configFields.length === 0 ? <p className="text-sm text-graphite">Nessuna configurazione: questo connettore usa altre connessioni o solo CSV.</p> : null}
            <form action={saveIntegrationAction} className="flex flex-col gap-4">
              <input type="hidden" name="key" value={key} />
              {def.configFields.map((f) => (
                <Field key={f.name} label={f.label} help={f.help}>
                  {f.type === "select" ? (
                    <Select name={`config.${f.name}`} defaultValue={String(config[f.name] ?? f.options?.[0]?.value ?? "")} disabled={!canEdit}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                  ) : f.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`config.${f.name}`} defaultChecked={config[f.name] === true} disabled={!canEdit} /> attivo</label>
                  ) : (
                    <Input name={`config.${f.name}`} type={f.type === "date" ? "date" : "text"} defaultValue={String(config[f.name] ?? "")} placeholder={f.placeholder} required={f.required} disabled={!canEdit} />
                  )}
                </Field>
              ))}
              {def.secretFields.map((f) => (
                <Field key={f.name} label={f.label} help={f.help}>
                  <Input name={`secret.${f.name}`} type={f.type === "password" ? "password" : "text"} autoComplete="off" placeholder={presentSecrets.has(f.name) ? "•••••••• (impostato: lascia vuoto per non cambiare)" : f.placeholder ?? ""} disabled={!canEdit} />
                </Field>
              ))}
              {canEdit && (def.secretFields.length || def.configFields.length) ? <div className="flex gap-2"><Button type="submit">Salva e verifica</Button></div> : null}
            </form>
            {canRun ? (
              <form action={verifyIntegrationAction} className="mt-3"><input type="hidden" name="key" value={key} /><Button type="submit" variant="outline" size="sm">Verifica connessione</Button></form>
            ) : null}
            <p className="mt-3 text-xs text-graphite">Le credenziali sono cifrate (AES-256-GCM) e non vengono mai mostrate né inviate al browser.</p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Stato e capacità verificate</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <dt className="text-graphite">Ultima verifica</dt><dd>{c?.lastVerifiedAt ? fmtDate(c.lastVerifiedAt, auth.timezone, true) : "—"}</dd>
                <dt className="text-graphite">Ultima sincronizzazione</dt><dd>{c?.lastSyncAt ? fmtDate(c.lastSyncAt, auth.timezone, true) : "—"}</dd>
                <dt className="text-graphite">Ambiente</dt><dd>{c?.environment ?? "—"}</dd>
                {c?.grantedScopes.length ? <><dt className="text-graphite">Scope concessi</dt><dd className="font-mono break-words">{c.grantedScopes.join(" ")}</dd></> : null}
                {Object.entries(caps).map(([k, v]) => <Fragment key={`cap-${k}`}><dt className="text-graphite">{k}</dt><dd className="break-words">{typeof v === "boolean" ? (v ? "✓" : "✗") : String(v)}</dd></Fragment>)}
                {Object.entries(cursors).map(([k, v]) => <Fragment key={`cur-${k}`}><dt className="text-graphite">cursore {k}</dt><dd className="font-mono">{String(v)}</dd></Fragment>)}
              </dl>
              {Object.keys(caps).length === 0 ? <p className="text-graphite">Nessuna verifica eseguita: le capacità vengono rilevate alla verifica delle credenziali.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Requisiti e limiti</CardTitle></CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-4 text-xs text-graphite">{def.notes.map((n, i) => <li key={i}>{n.replace("{APP_URL}/api/webhooks/shopify", webhookUrl)}</li>)}</ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {def.jobs.length ? (
        <Card className="mt-6">
          <CardHeader><CardTitle>Sincronizzazioni</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {def.jobs.map((j, i) => (
                <form key={`${j.type}-${i}`} action={runJobAction}>
                  <input type="hidden" name="key" value={key} /><input type="hidden" name="type" value={j.type} /><input type="hidden" name="payload" value={JSON.stringify(j.manualPayload ?? {})} /><input type="hidden" name="returnTo" value={`/integrations/${key}`} />
                  <Button type="submit" variant={j.scheduled ? "secondary" : "outline"} size="sm" disabled={!canRun || c?.status !== "CONNECTED"} title={j.description}>{j.label}</Button>
                </form>
              ))}
              <span className="self-center text-xs text-graphite">{c?.status === "CONNECTED" ? `I job pianificati girano ogni ${process.env.WORKER_SCHEDULE_MINUTES ?? 15} minuti.` : "Disponibili quando la connessione è CONNESSA."}</span>
            </div>
            {jobs.length ? (
              <Table>
                <THead><TR><TH>Job</TH><TH>Stato</TH><TH>Avviato da</TH><TH>Creato</TH><TH>Durata</TH><TH>Esito</TH></TR></THead>
                <TBody>
                  {jobs.map((j) => {
                    const s = JOB_STATUS_LABEL[j.status]!;
                    const dur = j.startedAt && j.finishedAt ? `${Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000)}s` : "—";
                    return (
                      <TR key={j.id}>
                        <TD><Link href={`/sync/${j.id}`} className="hover:underline">{JOB_LABELS[j.type] ?? j.type}</Link></TD><TD><Badge tone={s.tone}>{s.label}</Badge></TD><TD className="text-xs">{j.triggeredBy}</TD><TD className="text-xs">{fmtRelative(j.createdAt)}</TD><TD className="text-xs">{dur}</TD>
                        <TD className="max-w-md truncate text-xs text-graphite" title={j.lastError ?? JSON.stringify(j.result)}>{j.lastError ?? (j.result ? JSON.stringify(j.result).slice(0, 120) : "")}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
