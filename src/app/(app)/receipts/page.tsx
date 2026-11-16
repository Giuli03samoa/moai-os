import Link from "next/link";
import { Check, ExternalLink, ReceiptText, Undo2 } from "lucide-react";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { markReceiptAction, unmarkReceiptAction } from "@/server/actions/receipts";
import { FISCAL_DOC_LABEL, inPersonSalesWhere, posVatAmount, refundedAmount, saleDescription, vatSplit, type FiscalDocKind } from "@/server/receipts/receipts";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge, Card, Empty, Input, Notice, PageHeader, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SP = Record<string, string | undefined>;
const VIEWS = [{ key: "todo", label: "Da fare" }, { key: "done", label: "Fatti" }, { key: "all", label: "Tutti" }] as const;
const ADE_PORTAL = "https://ivaservizi.agenziaentrate.gov.it/portale/";

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.view) ? (sp.view as (typeof VIEWS)[number]["key"]) : "todo";
  const base = inPersonSalesWhere(auth.organizationId);
  const canMark = hasRole(auth.role, "OPERATIONS");
  const tz = auth.timezone;

  const [todo, done, rows] = await Promise.all([
    db.paymentTransaction.aggregate({ where: { ...base, fiscalDocAt: null }, _sum: { amount: true }, _count: { _all: true } }),
    db.paymentTransaction.aggregate({ where: { ...base, fiscalDocAt: { not: null } }, _sum: { amount: true }, _count: { _all: true } }),
    db.paymentTransaction.findMany({ where: { ...base, ...(view === "todo" ? { fiscalDocAt: null } : view === "done" ? { fiscalDocAt: { not: null } } : {}) }, orderBy: { processedAt: "desc" }, take: 300 }),
  ]);

  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const dayLabel = (d: Date) => new Intl.DateTimeFormat("it-IT", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  const time = (d: Date) => new Intl.DateTimeFormat("it-IT", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);
  const today = dayKey(new Date());

  const days: { key: string; label: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const key = dayKey(r.processedAt);
    const last = days[days.length - 1];
    if (last?.key === key) last.rows.push(r);
    else days.push({ key, label: dayLabel(r.processedAt), rows: [r] });
  }
  const late = await db.paymentTransaction.count({ where: { ...base, fiscalDocAt: null, processedAt: { lt: startOfLocalDay(tz) } } });
  const money = (v: unknown) => fmtMoney(String(v ?? 0), auth.currency);

  return (
    <div>
      <PageHeader
        eyebrow="Vendite in presenza"
        title="Scontrini"
        subtitle="Ogni incasso fatto di persona ha bisogno del suo scontrino. Lo emetti tu sul portale dell'Agenzia delle Entrate; qui spunti quelli fatti, così non ne resta indietro nessuno."
        actions={<Button asChild variant="outline" size="sm"><a href={ADE_PORTAL} target="_blank" rel="noreferrer">Apri il portale dell&apos;Agenzia <ExternalLink /></a></Button>}
      />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Tile label="Da fare" value={todo._count._all} note={todo._count._all ? money(todo._sum.amount) : "tutto in ordine"} tone={todo._count._all ? "warn" : "ok"} />
        <Tile label="Già fatti" value={done._count._all} note={money(done._sum.amount)} tone="muted" />
        <Tile label="Incassato di persona" value={todo._count._all + done._count._all} note={money(Number(todo._sum.amount ?? 0) + Number(done._sum.amount ?? 0))} tone="muted" />
      </div>

      {late ? (
        <div className="mb-5">
          <Notice tone="warn">
            {late === 1 ? "1 incasso di un giorno passato non ha" : `${late} incassi di giorni passati non hanno`} ancora lo scontrino. Lo scontrino prende la data del giorno in cui lo emetti: per quelli in ritardo senti il commercialista prima di farli.
          </Notice>
        </div>
      ) : null}

      <div className="mb-4 flex w-fit flex-wrap gap-1 rounded-full bg-cloud p-1">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`/receipts?view=${v.key}`} className={cn("rounded-full px-3 py-1 text-xs", view === v.key ? "bg-blackout text-crocus" : "text-graphite hover:text-blackout")}>
            {v.label}{v.key === "todo" && todo._count._all ? <span className="ml-1 rounded-full bg-warn-bg px-1.5 text-warn">{todo._count._all}</span> : null}
          </Link>
        ))}
      </div>

      {days.length === 0 ? (
        <Empty icon={<ReceiptText className="h-5 w-5" strokeWidth={1.75} />} title={view === "todo" ? "Nessuno scontrino da fare" : view === "done" ? "Nessuno scontrino segnato" : "Nessuna vendita in presenza"}>
          {view === "todo" ? "Quando incassi di persona con SumUp, l'incasso compare qui entro pochi minuti." : "Gli incassi fatti di persona arrivano da SumUp e compaiono qui da soli."}
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => {
            const total = day.rows.reduce((a, r) => a + Number(r.amount), 0);
            return (
              <section key={day.key}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
                  <h2 className="text-[15px] font-medium tracking-[-0.02em] first-letter:uppercase">{day.label}{day.key === today ? <span className="ml-2 text-xs font-normal text-graphite">oggi</span> : null}</h2>
                  <p className="text-xs text-graphite tabular">{day.rows.length === 1 ? "1 incasso" : `${day.rows.length} incassi`} · {money(total)}</p>
                </div>
                <Card className="divide-y divide-smoke/60 overflow-hidden">
                  {day.rows.map((r) => {
                    const split = vatSplit(r.amount, posVatAmount(r.raw));
                    const what = saleDescription(r.raw);
                    const refunded = refundedAmount(r.raw);
                    const kind = r.fiscalDocKind as FiscalDocKind | null;
                    return (
                      <div key={r.id} className="grid items-center gap-x-5 gap-y-3 p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium tabular">{time(r.processedAt)}</span>
                            <span className="truncate">{what ?? "Importo libero"}</span>
                            {refunded ? <Badge tone="warn">rimborsati {money(refunded)}</Badge> : null}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-space">{r.provider}{r.gateway && r.gateway !== r.provider ? ` · ${r.gateway.toLowerCase()}` : ""}{r.orderRef ? ` · ${r.orderRef}` : ""}</p>
                        </div>
                        <dl className="flex items-baseline gap-5 tabular">
                          <div><dt className="text-[11px] text-graphite">Totale</dt><dd className="text-lg font-medium tracking-[-0.02em]">{money(split.gross)}</dd></div>
                          <div><dt className="text-[11px] text-graphite">Imponibile</dt><dd className="text-sm">{money(split.net)}</dd></div>
                          <div><dt className="text-[11px] text-graphite">IVA {split.rate}%</dt><dd className="text-sm">{money(split.vat)}</dd></div>
                        </dl>
                        {r.fiscalDocAt ? (
                          <div className="flex items-center justify-between gap-3 md:justify-end">
                            <div className="text-right">
                              <Badge tone="ok"><Check className="h-3 w-3" /> {FISCAL_DOC_LABEL[kind ?? "RECEIPT"]}{r.fiscalDocRef ? ` n. ${r.fiscalDocRef}` : ""}</Badge>
                              <p className="mt-1 text-[11px] text-space">segnato il {fmtDate(r.fiscalDocAt, tz)}</p>
                            </div>
                            {canMark ? (
                              <form action={unmarkReceiptAction}>
                                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="view" value={view} />
                                <Button variant="ghost" size="sm" title="Rimetti tra quelli da fare"><Undo2 /> Annulla</Button>
                              </form>
                            ) : null}
                          </div>
                        ) : canMark ? (
                          <form action={markReceiptAction} className="flex flex-wrap items-center gap-2 md:justify-end">
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="view" value={view} />
                            <Select name="kind" defaultValue="RECEIPT" aria-label="Tipo di documento" className="h-8 w-auto text-xs"><option value="RECEIPT">Scontrino</option><option value="INVOICE">Fattura</option></Select>
                            <Input name="ref" maxLength={60} placeholder="Numero (facoltativo)" aria-label="Numero del documento" className="h-8 w-40 text-xs" />
                            <Button size="sm"><Check /> Fatto</Button>
                          </form>
                        ) : <Badge tone="warn">da fare</Badge>}
                      </div>
                    );
                  })}
                </Card>
              </section>
            );
          })}
        </div>
      )}

      <Card className="mt-8 p-5">
        <h3 className="text-[15px] font-medium tracking-[-0.02em]">Come si fa lo scontrino</h3>
        <ol className="mt-3 grid gap-2 text-sm text-graphite md:grid-cols-2">
          <li><span className="font-medium text-blackout">1.</span> Apri il portale dell&apos;Agenzia ed entra con SPID, scegliendo la società.</li>
          <li><span className="font-medium text-blackout">2.</span> Corrispettivi → «Documento Commerciale on line» → «Genera il tuo documento».</li>
          <li><span className="font-medium text-blackout">3.</span> Scrivi prodotto, prezzo e aliquota IVA; come pagamento scegli quello elettronico.</li>
          <li><span className="font-medium text-blackout">4.</span> Conferma, consegna il PDF al cliente e torna qui a premere «Fatto».</li>
        </ol>
        <p className="mt-4 text-xs text-space">MOAI OS non emette scontrini e non li invia all&apos;Agenzia: «Fatto» è solo il tuo promemoria. Quando SumUp non comunica l&apos;IVA dell&apos;incasso, imponibile e IVA sono calcolati al 22%.</p>
      </Card>
    </div>
  );
}

/** Midnight of the current day in the organization timezone, as a UTC instant. */
function startOfLocalDay(tz: string) {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  const elapsed = (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return new Date(now.getTime() - elapsed * 1000 - now.getMilliseconds());
}

function Tile({ label, value, note, tone }: { label: string; value: number; note: string; tone: "ok" | "warn" | "muted" }) {
  return (
    <Card>
      <div className="flex items-center gap-3.5 p-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", muted: "bg-cloud text-graphite" }[tone])}><ReceiptText className="h-4 w-4" strokeWidth={1.75} /></span>
        <span className="min-w-0">
          <span className="block text-xs text-graphite">{label}</span>
          <span className="flex items-baseline gap-2"><span className="text-xl font-medium tracking-[-0.03em] tabular">{value}</span><span className="truncate text-[11px] text-space tabular">{note}</span></span>
        </span>
      </div>
    </Card>
  );
}
