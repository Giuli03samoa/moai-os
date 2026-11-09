import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { addSketchAction, deleteAssetAction, renderMockupAction, updateDesignProjectAction, uploadReferenceAction } from "@/server/actions/design";
import { newConversationAction } from "@/server/actions/agent";
import { GARMENTS, PLACEMENTS } from "@/server/design/brand";
import { fmtDate, fmtRelative } from "@/lib/format";
import { ASSET_KIND_LABEL, DESIGN_LINE_LABEL, DESIGN_STAGE_LABEL } from "@/lib/labels";
import { Markdown } from "@/components/markdown";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type Check = { ok?: boolean; issues?: Array<{ level: string; message: string }>; colors?: Array<{ hex: string; name: string | null }> };

export default async function DesignProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.designProject.findFirst({ where: { id, organizationId: auth.organizationId }, include: { assets: { orderBy: { createdAt: "desc" } }, productionOrders: { include: { supplier: { select: { name: true } } } } } });
  if (!p) notFound();
  const canEdit = hasRole(auth.role, "OPERATIONS");
  const st = DESIGN_STAGE_LABEL[p.stage]!;
  const sketches = p.assets.filter((a) => a.kind === "SKETCH");
  const toDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const prompt = `Apri il progetto di design "${p.name}" (id ${p.id}) con get_design_project, carica le skill design-direction, brand-guide e sketch-svg, e proponi il passo successivo: ${p.stage === "IDEA" || p.stage === "CONCEPT" ? "2–3 direzioni grafiche con uno sketch per la migliore" : p.stage === "BRIEF" ? "rivedi e completa il brief per lo stampatore" : "controlla cosa manca per la fase successiva"}.`;
  return (
    <div>
      <PageHeader title={p.name} subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge><Badge tone="dark">{DESIGN_LINE_LABEL[p.line]}</Badge>{p.garments.length ? <span className="text-graphite">{p.garments.join(", ")}</span> : null}{p.targetDate ? <span className="text-graphite">· target {fmtDate(p.targetDate, auth.timezone)}</span> : null}</span>} actions={<><form action={newConversationAction}><input type="hidden" name="prompt" value={prompt} /><Button type="submit" size="sm">Chiedi all&apos;assistente</Button></form><Button asChild variant="outline" size="sm"><Link href={`/design/${p.id}/techpack`}>Tech pack</Link></Button><Button asChild variant="ghost" size="sm"><Link href="/design">← Studio</Link></Button></>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-graphite">Asset ({p.assets.length})</h2>
            {p.assets.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-graphite">Nessun asset. Chiedi all&apos;assistente uno sketch, incolla un SVG o carica un riferimento.</CardContent></Card> : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {p.assets.map((a) => {
                const check = (a.brandCheck ?? {}) as Check;
                const warnings = check.issues?.filter((i) => i.level === "warning") ?? [];
                const isImage = !!a.svg || /^image\//.test(a.mimeType ?? "");
                return (
                  <Card key={a.id} className="overflow-hidden">
                    <a href={`/api/design/assets/${a.id}`} target="_blank" rel="noreferrer" className="flex h-56 items-center justify-center bg-cloud">
                      {isImage ? <img src={`/api/design/assets/${a.id}`} alt={a.title} className="max-h-56 w-full object-contain" /> : <span className="text-xs text-graphite">{a.mimeType ?? "file"} · apri</span>}
                    </a>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{a.title}</p><Badge tone={a.kind === "MOCKUP" ? "dark" : a.kind === "SKETCH" ? "ok" : "muted"}>{ASSET_KIND_LABEL[a.kind]}</Badge></div>
                      <p className="mt-1 text-[11px] text-graphite">{a.createdBy === "agent" ? "assistente" : "manuale"} · {fmtRelative(a.createdAt)}{check.colors?.length ? ` · ${check.colors.map((c) => c.name ?? c.hex).join(", ")}` : ""}</p>
                      {warnings.length ? <p className="mt-1 text-[11px] text-warn">{warnings.map((w) => w.message).join(" · ")}</p> : a.kind === "SKETCH" ? <p className="mt-1 text-[11px] text-ok">Brand check superato</p> : null}
                      {canEdit ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {a.kind === "SKETCH" ? (
                            <form action={renderMockupAction} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="sketchId" value={a.id} />
                              <Select name="garment" defaultValue="tee" className="h-7 w-20 text-xs"><option value="tee">tee</option><option value="hoodie">hoodie</option><option value="tote">tote</option></Select>
                              <Select name="color" defaultValue="blackout" className="h-7 w-24 text-xs"><option value="blackout">Black Out</option><option value="crocus">Crocus</option></Select>
                              <Select name="placement" defaultValue="chest-left" className="h-7 w-28 text-xs">{PLACEMENTS.map((pl) => <option key={pl} value={pl}>{pl}</option>)}</Select>
                              <Button size="sm" variant="outline" className="h-7 text-xs">Mockup</Button>
                            </form>
                          ) : null}
                          <form action={deleteAssetAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="ghost" className="h-7 text-xs text-bad">Elimina</Button></form>
                        </div>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          {p.brief ? (
            <Card>
              <CardHeader><CardTitle>Brief</CardTitle><CardDescription>Per stampatore o designer. Esportabile dal tech pack.</CardDescription></CardHeader>
              <CardContent><Markdown>{p.brief}</Markdown></CardContent>
            </Card>
          ) : null}

          {p.productionOrders.length ? (
            <Card>
              <CardHeader><CardTitle>Produzione collegata</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">{p.productionOrders.map((po) => <Link key={po.id} href="/production" className="flex justify-between hover:underline"><span>{po.reference} · {po.description}</span><span className="text-xs text-graphite">{po.supplier?.name ?? ""} · {po.status}</span></Link>)}</CardContent>
            </Card>
          ) : null}

          {canEdit ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Incolla uno sketch SVG</CardTitle><CardDescription>Brand check automatico: palette, Geist, niente gradienti o script. Token: {"{{ICON_CREAM}} {{ICON_BLACK}} {{LOGO_CREAM}} {{LOGO_BLACK}} {{PATTERN_CHEVRON_DEFS}}"}.</CardDescription></CardHeader>
                <CardContent>
                  <form action={addSketchAction} className="flex flex-col gap-3">
                    <input type="hidden" name="projectId" value={p.id} />
                    <Field label="Titolo"><Input name="title" required /></Field>
                    <Field label="SVG"><Textarea name="svg" required className="min-h-[140px] font-mono text-xs" placeholder={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">…</svg>'} /></Field>
                    <Button type="submit" size="sm">Salva sketch</Button>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Carica un riferimento</CardTitle><CardDescription>PNG, JPEG, WebP, GIF o PDF (max 10 MB), in archivio privato.</CardDescription></CardHeader>
                <CardContent>
                  <form action={uploadReferenceAction} className="flex flex-col gap-3">
                    <input type="hidden" name="projectId" value={p.id} />
                    <Field label="Titolo"><Input name="title" placeholder="Moodboard, foto campione, tech pack…" /></Field>
                    <Field label="Tipo"><Select name="kind" defaultValue="REFERENCE"><option value="REFERENCE">Riferimento</option><option value="TECHPACK">Tech pack</option></Select></Field>
                    <Field label="File"><Input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" required /></Field>
                    <Button type="submit" size="sm" variant="outline">Carica</Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>

        <Card>
          <CardHeader><CardTitle>Progetto</CardTitle><CardDescription>Concept prima di tutto; il brief chiude la fase di design.</CardDescription></CardHeader>
          <CardContent>
            <form action={updateDesignProjectAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={p.id} />
              <Field label="Nome"><Input name="name" defaultValue={p.name} disabled={!canEdit} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Linea"><Select name="line" defaultValue={p.line} disabled={!canEdit}>{Object.entries(DESIGN_LINE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Fase"><Select name="stage" defaultValue={p.stage} disabled={!canEdit}>{Object.entries(DESIGN_STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
              </div>
              <Field label="Concept"><Textarea name="concept" defaultValue={p.concept ?? ""} disabled={!canEdit} className="min-h-[60px]" /></Field>
              <Field label="Narrativa / moodboard"><Textarea name="narrative" defaultValue={p.narrative ?? ""} disabled={!canEdit} /></Field>
              <Field label="Riferimenti (virgola)"><Input name="references" defaultValue={p.references.join(", ")} disabled={!canEdit} placeholder="Soar Running, Represent 247" /></Field>
              <Field label="Capi (virgola)"><Input name="garments" defaultValue={p.garments.join(", ")} disabled={!canEdit} placeholder={GARMENTS.join(", ")} /></Field>
              <Field label="Data target"><Input name="targetDate" type="date" defaultValue={toDate(p.targetDate)} disabled={!canEdit} /></Field>
              <Field label="Brief (markdown)"><Textarea name="brief" defaultValue={p.brief ?? ""} disabled={!canEdit} className="min-h-[160px] font-mono text-xs" /></Field>
              <Field label="Note"><Textarea name="notes" defaultValue={p.notes ?? ""} disabled={!canEdit} /></Field>
              {canEdit ? <Button type="submit" size="sm">Salva</Button> : null}
            </form>
            <p className="mt-3 text-[11px] text-graphite">Creato {fmtDate(p.createdAt, auth.timezone, true)} · aggiornato {fmtRelative(p.updatedAt)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
