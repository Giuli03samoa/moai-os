import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { LOGO_RULES, PALETTE, TYPOGRAPHY } from "@/server/design/brand";
import { fmtDate } from "@/lib/format";
import { DESIGN_LINE_LABEL, DESIGN_STAGE_LABEL } from "@/lib/labels";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";

/** Printable tech pack: browser → Stampa → PDF. */
export default async function TechPackPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const p = await db.designProject.findFirst({ where: { id, organizationId: auth.organizationId }, include: { assets: { where: { kind: { in: ["SKETCH", "MOCKUP"] } }, orderBy: { createdAt: "asc" } } } });
  if (!p) notFound();
  type Meta = { garment?: string | null; color?: string | null; placement?: string | null; intendedGarmentColor?: string | null; notes?: string | null };
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-blackout print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden"><Button asChild variant="ghost" size="sm"><Link href={`/design/${p.id}`}>← Progetto</Link></Button><p className="text-xs text-graphite">Stampa questa pagina (Cmd+P) e salva in PDF per lo stampatore.</p></div>
      <header className="flex items-start justify-between border-b border-smoke pb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-graphite">Tech pack · MOAI Athletics</p>
          <h1 className="mt-1 text-2xl font-medium">{p.name}</h1>
          <p className="mt-1 text-sm text-graphite">{DESIGN_LINE_LABEL[p.line]} · {DESIGN_STAGE_LABEL[p.stage]!.label}{p.garments.length ? ` · ${p.garments.join(", ")}` : ""}{p.targetDate ? ` · target ${fmtDate(p.targetDate, auth.timezone)}` : ""}</p>
        </div>
        <Image src="/brand/moai-logo-primary-black.png" alt="MOAI Athletics" width={150} height={50} className="h-auto w-[150px]" />
      </header>
      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-wide text-graphite">Concept</h2>
        <p className="mt-1 text-base">{p.concept ?? "—"}</p>
        {p.narrative ? <p className="mt-2 whitespace-pre-line text-sm text-graphite">{p.narrative}</p> : null}
        {p.references.length ? <p className="mt-2 text-xs text-graphite">Riferimenti di tendenza: {p.references.join(", ")}</p> : null}
      </section>
      {p.brief ? <section className="mt-6"><h2 className="text-[11px] uppercase tracking-wide text-graphite">Brief</h2><div className="mt-1"><Markdown>{p.brief}</Markdown></div></section> : null}
      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-wide text-graphite">Grafiche e posizionamenti</h2>
        {p.assets.length === 0 ? <p className="mt-1 text-sm text-graphite">Nessuno sketch o mockup.</p> : null}
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {p.assets.map((a) => {
            const m = (a.meta ?? {}) as Meta;
            return (
              <figure key={a.id} className="break-inside-avoid rounded-lg border border-smoke p-2">
                <img src={`/api/design/assets/${a.id}`} alt={a.title} className="mx-auto max-h-72 object-contain" />
                <figcaption className="mt-2 text-xs"><span className="font-medium">{a.title}</span> · {a.kind === "MOCKUP" ? "mockup" : "sketch"}{m.garment ? ` · ${m.garment}` : ""}{m.color ?? m.intendedGarmentColor ? ` · capo ${m.color ?? m.intendedGarmentColor}` : ""}{m.placement ? ` · ${m.placement}` : ""}{m.notes ? ` · ${m.notes}` : ""}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>
      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-[11px] uppercase tracking-wide text-graphite">Colori (unici ammessi)</h2>
          <ul className="mt-1 text-sm">{[...PALETTE.primary, ...PALETTE.secondary].map((c) => <li key={c.hex} className="flex items-center gap-2"><span className="inline-block h-3.5 w-3.5 rounded-full border border-smoke" style={{ background: c.hex }} />{c.name} <span className="font-mono text-xs text-graphite">{c.hex}</span></li>)}</ul>
        </div>
        <div>
          <h2 className="text-[11px] uppercase tracking-wide text-graphite">Tipografia e logo</h2>
          <p className="mt-1 text-sm">{TYPOGRAPHY.family} {TYPOGRAPHY.weights.join(" / ")}. Tracking −3% sui titoli, −2% sul testo.</p>
          <ul className="mt-2 list-disc pl-4 text-xs text-graphite">{LOGO_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </section>
      {p.notes ? <section className="mt-6"><h2 className="text-[11px] uppercase tracking-wide text-graphite">Note</h2><p className="mt-1 whitespace-pre-line text-sm">{p.notes}</p></section> : null}
      <footer className="mt-8 border-t border-smoke pt-3 text-[11px] text-graphite">Generato da MOAI OS il {fmtDate(new Date(), auth.timezone, true)} · Discipline Over Noise</footer>
    </div>
  );
}
