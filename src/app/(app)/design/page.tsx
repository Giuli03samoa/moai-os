import Link from "next/link";
import Image from "next/image";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { createDesignProjectAction } from "@/server/actions/design";
import { newConversationAction } from "@/server/actions/agent";
import { PALETTE, REFERENCES, TYPOGRAPHY } from "@/server/design/brand";
import { fmtDate, fmtRelative } from "@/lib/format";
import { DESIGN_LINE_LABEL, DESIGN_STAGE_LABEL } from "@/lib/labels";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Notice, PageHeader, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; stage?: string }> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const projects = await db.designProject.findMany({ where: { organizationId: auth.organizationId, ...(sp.stage === "ARCHIVED" ? { archivedAt: { not: null } } : { archivedAt: null }) }, orderBy: { updatedAt: "desc" }, include: { assets: { where: { kind: { in: ["MOCKUP", "SKETCH"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, kind: true } }, _count: { select: { assets: true } } } });
  const canEdit = hasRole(auth.role, "OPERATIONS");
  return (
    <div>
      <PageHeader title="Design Studio" subtitle="Grafiche per capi, capsule e drop nel sistema MOAI: concept, direzioni, sketch SVG con brand check, mockup sul capo, brief per lo stampatore." actions={<form action={newConversationAction}><input type="hidden" name="prompt" value="Carica le skill design-direction e brand-guide. Voglio lavorare su una nuova grafica: chiedimi il concept del drop con una sola domanda, poi proponi 3 direzioni." /><Button type="submit" size="sm">Lavora con l&apos;assistente</Button></form>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className="flex gap-1"><Link href="/design" className={`rounded-full px-3 py-1 text-xs ${sp.stage !== "ARCHIVED" ? "bg-blackout text-crocus" : "bg-cloud text-graphite"}`}>Attivi</Link><Link href="/design?stage=ARCHIVED" className={`rounded-full px-3 py-1 text-xs ${sp.stage === "ARCHIVED" ? "bg-blackout text-crocus" : "bg-cloud text-graphite"}`}>Archiviati</Link></div>
          {projects.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-graphite">Nessun progetto. Crea il primo a destra o chiedi all&apos;assistente di proporre direzioni per il prossimo drop.</CardContent></Card> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const st = DESIGN_STAGE_LABEL[p.stage]!;
              const preview = p.assets[0];
              return (
                <Link key={p.id} href={`/design/${p.id}`} className="block transition-transform hover:-translate-y-px">
                  <Card className="h-full overflow-hidden">
                    <div className="flex h-40 items-center justify-center bg-cloud">
                      {preview ? <img src={`/api/design/assets/${preview.id}`} alt="" className="max-h-40 w-full object-contain" /> : <Image src="/brand/moai-icon-black.png" alt="" width={120} height={57} className="opacity-20" />}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2"><p className="font-medium">{p.name}</p><Badge tone={st.tone}>{st.label}</Badge></div>
                      <p className="mt-1 text-xs text-graphite">{DESIGN_LINE_LABEL[p.line]}{p.garments.length ? ` · ${p.garments.join(", ")}` : ""}{p.targetDate ? ` · target ${fmtDate(p.targetDate, auth.timezone)}` : ""}</p>
                      {p.concept ? <p className="mt-2 line-clamp-2 text-sm">{p.concept}</p> : <p className="mt-2 text-sm text-space">Concept da definire</p>}
                      <p className="mt-2 text-[11px] text-graphite">{p._count.assets} asset · agg. {fmtRelative(p.updatedAt)}</p>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {canEdit ? (
            <Card>
              <CardHeader><CardTitle>Nuovo progetto</CardTitle><CardDescription>Prima il concept, poi la grafica.</CardDescription></CardHeader>
              <CardContent>
                <form action={createDesignProjectAction} className="flex flex-col gap-3">
                  <Field label="Nome"><Input name="name" required placeholder="Drop 02 · Winter Motion" /></Field>
                  <Field label="Linea"><Select name="line" defaultValue="MOTION">{Object.entries(DESIGN_LINE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <Field label="Concept (una frase)"><Input name="concept" placeholder="Allenarsi al buio d'inverno: luce minima, disciplina massima" /></Field>
                  <Field label="Capi (separati da virgola)"><Input name="garments" placeholder="tee, hoodie" /></Field>
                  <Field label="Data target"><Input name="targetDate" type="date" /></Field>
                  <Button type="submit" size="sm">Crea</Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle>Sistema del brand</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs">
              <div className="flex flex-wrap gap-1.5">{[...PALETTE.primary, ...PALETTE.secondary].map((c) => <span key={c.hex} className="inline-flex items-center gap-1 rounded-full border border-smoke px-2 py-0.5" title={c.hex}><span className="inline-block h-3 w-3 rounded-full border border-smoke" style={{ background: c.hex }} />{c.name}</span>)}</div>
              <p className="text-graphite">Font {TYPOGRAPHY.family} ({TYPOGRAPHY.weights.join("/")}). Pattern chevron come dettaglio. Logo: mai gradienti, rotazioni, opacità, contorni.</p>
              <div className="flex items-center gap-3 rounded-lg bg-blackout p-3"><Image src="/brand/moai-logo-secondary-cream.png" alt="Logo secondario" width={120} height={40} className="h-auto w-[120px]" /><Image src="/brand/moai-icon-cream.png" alt="Icona" width={60} height={28} className="h-auto w-[60px]" /></div>
              <details><summary className="cursor-pointer text-graphite">Riferimenti di tendenza</summary><ul className="mt-2 flex flex-col gap-1 text-graphite">{REFERENCES.map((r) => <li key={r.name}><span className="font-medium text-blackout">{r.name}</span>: {r.lesson}</li>)}</ul></details>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
