import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { decideReconciliationAction, manualLinkAction, runReconciliationAction } from "@/server/actions/reconciliation";
import { resolvePeriod } from "@/lib/periods";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PAYMENT_KIND_LABEL, RECONCILIATION_STATUS_LABEL } from "@/lib/labels";
import { DataTable, parseTableQuery } from "@/components/data-table";
import { PeriodFilter } from "@/components/period-filter";
import { SourceTag } from "@/components/source-tag";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Notice, PageHeader, Select, TBody, TD, TH, THead, TR, Table, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | undefined>;
const TABS = [
  { key: "transactions", label: "Transazioni" }, { key: "payouts", label: "Payout" }, { key: "bank", label: "Banca" }, { key: "reconciliation", label: "Riconciliazione" },
];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "transactions";
  const range = resolvePeriod(sp, auth.timezone);
  const orgId = auth.organizationId;
  const extra = { tab, period: range.key, from: sp.from, to: sp.to, ledger: sp.ledger, provider: sp.provider };
  const exportQs = new URLSearchParams(Object.fromEntries(Object.entries({ period: range.key, from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>).toString();

  const [captured, fees, payoutsPaid, suggested] = await Promise.all([
    db.paymentTransaction.aggregate({ _sum: { amount: true }, where: { organizationId: orgId, deletedAt: null, ledger: "ORDER", status: "SUCCESS", kind: { in: ["SALE", "CAPTURE"] }, processedAt: { gte: range.from, lte: range.to } } }),
    db.paymentTransaction.aggregate({ _sum: { fee: true }, where: { organizationId: orgId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", processedAt: { gte: range.from, lte: range.to } } }),
    db.payout.aggregate({ _sum: { netAmount: true }, where: { organizationId: orgId, deletedAt: null, status: "PAID", issuedAt: { gte: range.from, lte: range.to } } }),
    db.reconciliation.count({ where: { organizationId: orgId, status: "SUGGESTED" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Pagamenti"
        subtitle="Due ledger distinti: cosa ha registrato il negozio e cosa dice il gateway. La riconciliazione li collega senza mai sommare lo stesso denaro due volte."
        actions={
          <>
            <PeriodFilter basePath="/payments" current={range.key} from={range.from} to={range.to} tz={auth.timezone} extra={{ tab }} />
            {hasRole(auth.role, "OPERATIONS") ? <Button asChild size="sm"><Link href="/payments/import">Importa CSV</Link></Button> : null}
          </>
        }
      />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {sp.error ? <div className="mb-4"><Notice tone="bad">{sp.error}</Notice></div> : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Pagamenti acquisiti (ledger ordini)", fmtMoney(captured._sum.amount?.toString() ?? 0, auth.currency), "Σ SALE/CAPTURE riuscite sugli ordini"],
          ["Commissioni gateway (ledger gateway)", fmtMoney(fees._sum.fee?.toString() ?? 0, auth.currency), "Σ fee da API/CSV dei gateway"],
          ["Payout liquidati", fmtMoney(payoutsPaid._sum.netAmount?.toString() ?? 0, auth.currency), "Σ netto payout PAID: stesso denaro degli acquisiti, al netto delle commissioni"],
        ].map(([l, v, d]) => (
          <Card key={l}><div className="p-4"><p className="text-[11px] uppercase tracking-wide text-graphite">{l}</p><p className="mt-1 text-xl font-medium tabular">{v}</p><p className="mt-1 text-xs text-graphite">{d}</p></div></Card>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-full bg-cloud p-1 w-fit">
        {TABS.map((t) => (
          <Link key={t.key} href={`/payments?${new URLSearchParams({ tab: t.key, period: range.key, ...(sp.from ? { from: sp.from, to: sp.to ?? "" } : {}) })}`} className={`rounded-full px-3 py-1 text-xs ${tab === t.key ? "bg-blackout text-crocus" : "text-graphite hover:text-blackout"}`}>
            {t.label}{t.key === "reconciliation" && suggested ? <span className="ml-1 rounded-full bg-warn-bg px-1.5 text-warn">{suggested}</span> : null}
          </Link>
        ))}
      </div>

      {tab === "transactions" ? <Transactions sp={sp} range={range} auth={auth} extra={extra} exportQs={exportQs} /> : null}
      {tab === "payouts" ? <Payouts sp={sp} range={range} auth={auth} extra={extra} exportQs={exportQs} /> : null}
      {tab === "bank" ? <Bank sp={sp} range={range} auth={auth} extra={extra} exportQs={exportQs} /> : null}
      {tab === "reconciliation" ? <Reconciliation auth={auth} exportQs={exportQs} /> : null}
    </div>
  );
}

type Ctx = { sp: SP; range: { from: Date; to: Date }; auth: Awaited<ReturnType<typeof requireAuth>>; extra: Record<string, string | undefined>; exportQs: string };

async function Transactions({ sp, range, auth, extra, exportQs }: Ctx) {
  const SORT = ["processedAt", "amount", "provider", "kind", "status"];
  const q = parseTableQuery(sp, { sort: "processedAt" }, SORT);
  const where: Prisma.PaymentTransactionWhereInput = {
    organizationId: auth.organizationId, deletedAt: null, processedAt: { gte: range.from, lte: range.to },
    ...(sp.ledger === "ORDER" || sp.ledger === "PROCESSOR" ? { ledger: sp.ledger } : {}),
    ...(sp.provider ? { provider: sp.provider } : {}),
    ...(q.q ? { OR: [{ externalId: { contains: q.q, mode: "insensitive" } }, { orderRef: { contains: q.q, mode: "insensitive" } }, { order: { name: { contains: q.q, mode: "insensitive" } } }, { payoutExternalId: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, providers] = await Promise.all([
    db.paymentTransaction.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { order: { select: { id: true, name: true } }, reconciliations: { where: { type: "PAYMENT_ORDER" }, select: { status: true } } } }),
    db.paymentTransaction.count({ where }),
    db.paymentTransaction.groupBy({ by: ["provider"], where: { organizationId: auth.organizationId } }),
  ]);
  return (
    <div className="flex flex-col gap-3">
      <form action="/payments" className="flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="tab" value="transactions" /><input type="hidden" name="period" value={extra.period} />
        {sp.from ? <><input type="hidden" name="from" value={sp.from} /><input type="hidden" name="to" value={sp.to} /></> : null}
        <Select name="ledger" defaultValue={sp.ledger ?? ""} className="h-8 w-auto text-xs"><option value="">Entrambi i ledger</option><option value="ORDER">Ledger ordini (negozio)</option><option value="PROCESSOR">Ledger gateway</option></Select>
        <Select name="provider" defaultValue={sp.provider ?? ""} className="h-8 w-auto text-xs"><option value="">Tutti i gateway</option>{providers.map((p) => <option key={p.provider} value={p.provider}>{p.provider}</option>)}</Select>
        <Button type="submit" variant="outline" size="sm">Filtra</Button>
        <Button asChild variant="ghost" size="sm" className="ml-auto"><a href={`/api/export/payments?${exportQs}`}>Esporta CSV</a></Button>
      </form>
      <DataTable rows={rows} total={total} query={q} basePath="/payments" params={extra} rowKey={(r) => r.id} emptyTitle="Nessuna transazione nel periodo" searchPlaceholder="ID transazione, ordine, payout…"
        columns={[
          { key: "processedAt", label: "Data", sortable: true, render: (r) => fmtDate(r.processedAt, auth.timezone, true) },
          { key: "ledger", label: "Ledger", render: (r) => <Badge tone={r.ledger === "ORDER" ? "dark" : "outline"}>{r.ledger === "ORDER" ? "ordine" : "gateway"}</Badge> },
          { key: "provider", label: "Gateway", sortable: true, render: (r) => r.provider },
          { key: "kind", label: "Tipo", sortable: true, render: (r) => PAYMENT_KIND_LABEL[r.kind] ?? r.kind },
          { key: "status", label: "Stato", sortable: true, render: (r) => <Badge tone={r.status === "SUCCESS" ? "ok" : r.status === "PENDING" ? "warn" : "bad"}>{r.status}</Badge> },
          { key: "amount", label: "Importo", sortable: true, align: "right", render: (r) => fmtMoney(r.amount.toString(), r.currency) },
          { key: "fee", label: "Commissione", align: "right", render: (r) => (r.fee ? fmtMoney(r.fee.toString(), r.currency) : <span className="text-graphite">—</span>) },
          { key: "net", label: "Netto", align: "right", render: (r) => (r.net ? fmtMoney(r.net.toString(), r.currency) : <span className="text-graphite">—</span>) },
          { key: "order", label: "Ordine", render: (r) => (r.order ? <Link href={`/orders/${r.order.id}`} className="hover:underline">{r.order.name}</Link> : r.ledger === "PROCESSOR" ? <span className="text-xs text-warn">{r.reconciliations.some((x) => x.status === "SUGGESTED") ? "da verificare" : "non riconciliata"}</span> : <span className="text-graphite">{r.orderRef ?? "—"}</span>) },
          { key: "source", label: "Origine", render: (r) => <SourceTag source={r.source} updatedAt={r.syncedAt} demo={r.isDemo} /> },
        ]} />
    </div>
  );
}

async function Payouts({ sp, range, auth, extra, exportQs }: Ctx) {
  const q = parseTableQuery(sp, { sort: "issuedAt" }, ["issuedAt", "netAmount", "status", "provider"]);
  const where: Prisma.PayoutWhereInput = { organizationId: auth.organizationId, deletedAt: null, issuedAt: { gte: range.from, lte: range.to }, ...(q.q ? { OR: [{ externalId: { contains: q.q, mode: "insensitive" } }, { bankReference: { contains: q.q, mode: "insensitive" } }] } : {}) };
  const [rows, total] = await Promise.all([
    db.payout.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { _count: { select: { transactions: true } }, reconciliations: { where: { type: "PAYOUT_BANK" }, select: { status: true } } } }),
    db.payout.count({ where }),
  ]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end"><Button asChild variant="ghost" size="sm"><a href={`/api/export/payouts?${exportQs}`}>Esporta CSV</a></Button></div>
      <DataTable rows={rows} total={total} query={q} basePath="/payments" params={extra} rowKey={(r) => r.id} emptyTitle="Nessun payout nel periodo" searchPlaceholder="ID payout, riferimento banca…"
        columns={[
          { key: "issuedAt", label: "Emesso", sortable: true, render: (r) => fmtDate(r.issuedAt, auth.timezone) },
          { key: "arrivalDate", label: "Accredito previsto", render: (r) => fmtDate(r.arrivalDate, auth.timezone) },
          { key: "provider", label: "Gateway", sortable: true, render: (r) => r.provider },
          { key: "status", label: "Stato", sortable: true, render: (r) => <Badge tone={r.status === "PAID" ? "ok" : r.status === "FAILED" || r.status === "CANCELED" ? "bad" : "warn"}>{r.status}</Badge> },
          { key: "grossAmount", label: "Lordo", align: "right", render: (r) => (r.grossAmount ? fmtMoney(r.grossAmount.toString(), r.currency) : "—") },
          { key: "feeAmount", label: "Commissioni", align: "right", render: (r) => (r.feeAmount ? fmtMoney(r.feeAmount.toString(), r.currency) : "—") },
          { key: "netAmount", label: "Netto", sortable: true, align: "right", render: (r) => <span className="font-medium">{fmtMoney(r.netAmount.toString(), r.currency)}</span> },
          { key: "tx", label: "Transazioni", align: "right", render: (r) => r._count.transactions },
          { key: "bank", label: "Banca", render: (r) => { const s = r.reconciliations[0]?.status; return s === "AUTO_MATCHED" || s === "CONFIRMED" ? <Badge tone="ok">accreditato</Badge> : s === "SUGGESTED" ? <Badge tone="warn">da verificare</Badge> : <Badge tone="muted">non abbinato</Badge>; } },
          { key: "source", label: "Origine", render: (r) => <SourceTag source={r.source} updatedAt={r.syncedAt} demo={r.isDemo} /> },
        ]} />
    </div>
  );
}

async function Bank({ sp, range, auth, extra, exportQs }: Ctx) {
  const q = parseTableQuery(sp, { sort: "bookingDate" }, ["bookingDate", "amount", "description"]);
  const where: Prisma.BankTransactionWhereInput = { organizationId: auth.organizationId, deletedAt: null, bookingDate: { gte: range.from, lte: range.to }, ...(q.q ? { OR: [{ description: { contains: q.q, mode: "insensitive" } }, { reference: { contains: q.q, mode: "insensitive" } }, { counterparty: { contains: q.q, mode: "insensitive" } }] } : {}) };
  const [rows, total] = await Promise.all([
    db.bankTransaction.findMany({ where, orderBy: { [q.sort]: q.dir }, skip: q.skip, take: q.take, include: { reconciliations: { where: { type: "PAYOUT_BANK" }, select: { status: true } } } }),
    db.bankTransaction.count({ where }),
  ]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end"><Button asChild variant="ghost" size="sm"><a href={`/api/export/bank?${exportQs}`}>Esporta CSV</a></Button></div>
      <DataTable rows={rows} total={total} query={q} basePath="/payments" params={extra} rowKey={(r) => r.id} emptyTitle="Nessun movimento bancario: importa l'estratto conto CSV" searchPlaceholder="Descrizione, riferimento…"
        columns={[
          { key: "bookingDate", label: "Data", sortable: true, render: (r) => fmtDate(r.bookingDate, auth.timezone) },
          { key: "accountLabel", label: "Conto", render: (r) => r.accountLabel },
          { key: "description", label: "Descrizione", sortable: true, render: (r) => <span className="text-xs">{r.description}</span> },
          { key: "amount", label: "Importo", sortable: true, align: "right", render: (r) => <span className={r.amount.gt(0) ? "text-ok" : ""}>{fmtMoney(r.amount.toString(), r.currency)}</span> },
          { key: "match", label: "Abbinamento", render: (r) => { const s = r.reconciliations[0]?.status; return s === "AUTO_MATCHED" || s === "CONFIRMED" ? <Badge tone="ok">payout</Badge> : s === "SUGGESTED" ? <Badge tone="warn">da verificare</Badge> : r.amount.gt(0) ? <Badge tone="muted">—</Badge> : null; } },
          { key: "source", label: "Origine", render: (r) => <SourceTag source={r.source} updatedAt={r.syncedAt} demo={r.isDemo} /> },
        ]} />
    </div>
  );
}

async function Reconciliation({ auth, exportQs }: { auth: Ctx["auth"]; exportQs: string }) {
  const orgId = auth.organizationId;
  const canDecide = hasRole(auth.role, "ACCOUNTANT");
  const settled = { in: ["AUTO_MATCHED", "CONFIRMED"] as const };
  const [suggestions, unmatchedTx, unmatchedPayouts, bankCredits, stats] = await Promise.all([
    db.reconciliation.findMany({ where: { organizationId: orgId, status: "SUGGESTED" }, orderBy: { createdAt: "desc" }, take: 100, include: { paymentTransaction: true, order: true, payout: true, bankTransaction: true, invoice: true } }),
    db.paymentTransaction.findMany({ where: { organizationId: orgId, deletedAt: null, ledger: "PROCESSOR", status: "SUCCESS", kind: { in: ["SALE", "CAPTURE", "REFUND", "CHARGEBACK"] }, reconciliations: { none: { type: "PAYMENT_ORDER", status: { in: [...settled.in] } } } }, orderBy: { processedAt: "desc" }, take: 50 }),
    db.payout.findMany({ where: { organizationId: orgId, deletedAt: null, status: { in: ["PAID", "IN_TRANSIT"] }, reconciliations: { none: { type: "PAYOUT_BANK", status: { in: [...settled.in] } } } }, orderBy: { issuedAt: "desc" }, take: 50 }),
    db.bankTransaction.findMany({ where: { organizationId: orgId, deletedAt: null, amount: { gt: 0 }, reconciliations: { none: { type: "PAYOUT_BANK", status: { in: [...settled.in] } } } }, orderBy: { bookingDate: "desc" }, take: 100 }),
    db.reconciliation.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: { _all: true } }),
  ]);
  const count = (s: string) => stats.find((x) => x.status === s)?._count._all ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone="ok">{count("AUTO_MATCHED")} automatiche</Badge><Badge tone="ok">{count("CONFIRMED")} confermate</Badge><Badge tone="warn">{count("SUGGESTED")} da verificare</Badge><Badge tone="muted">{count("REJECTED")} scartate</Badge>
        <form action={runReconciliationAction} className="ml-auto flex gap-2">
          <Button asChild variant="ghost" size="sm"><a href={`/api/export/reconciliations?${exportQs}`}>Esporta CSV</a></Button>
          {canDecide ? <Button type="submit" variant="outline" size="sm">Esegui riconciliazione</Button> : null}
        </form>
      </div>
      <p className="text-xs text-graphite">Regole deterministiche: R1 id transazione, R2 riferimento ordine + importo, R3 importo + valuta + data (mai automatica), P1 riferimento payout in causale, P2/P3 importo netto + finestra date. Le corrispondenze incerte restano qui finché una persona non decide.</p>

      <Card>
        <CardHeader><CardTitle>Proposte da verificare ({suggestions.length})</CardTitle></CardHeader>
        <CardContent>
          {suggestions.length === 0 ? <Empty title="Nessuna proposta in attesa" /> : (
            <Table>
              <THead><TR><TH>Tipo</TH><TH>Elemento</TH><TH>Proposta</TH><TH>Confidenza</TH><TH>Spiegazione</TH><TH className="text-right">Δ</TH><TH></TH></TR></THead>
              <TBody>
                {suggestions.map((r) => {
                  const left = r.paymentTransaction ? `${r.paymentTransaction.provider} · ${PAYMENT_KIND_LABEL[r.paymentTransaction.kind]} ${fmtMoney(r.paymentTransaction.amount.toString(), r.paymentTransaction.currency)} · ${fmtDate(r.paymentTransaction.processedAt, auth.timezone)}`
                    : r.payout ? `Payout ${r.payout.provider} ${fmtMoney(r.payout.netAmount.toString(), r.payout.currency)} · ${fmtDate(r.payout.issuedAt, auth.timezone)}`
                    : r.invoice ? `Fattura ${r.invoice.number} ${fmtMoney(r.invoice.totalAmount.toString(), r.invoice.currency)}` : "—";
                  const right = r.type === "PAYOUT_BANK" && r.bankTransaction ? `${fmtDate(r.bankTransaction.bookingDate, auth.timezone)} ${fmtMoney(r.bankTransaction.amount.toString(), r.bankTransaction.currency)} — ${r.bankTransaction.description.slice(0, 60)}` : r.order ? <Link href={`/orders/${r.order.id}`} className="hover:underline">{r.order.name} · {fmtMoney(r.order.totalPrice.toString(), r.order.currency)}</Link> : "—";
                  return (
                    <TR key={r.id}>
                      <TD className="text-xs">{r.type.replace("_", " → ")}</TD>
                      <TD className="text-xs">{left}</TD>
                      <TD className="text-xs">{right}</TD>
                      <TD><Badge tone={r.confidence === "HIGH" ? "warn" : "muted"}>{r.confidence}</Badge></TD>
                      <TD className="text-xs text-graphite">{r.explanation} <span className="font-mono">[{r.rule}]</span></TD>
                      <TD className="text-right tabular text-xs">{r.amountDifference && !r.amountDifference.isZero() ? r.amountDifference.toFixed(2) : "—"}</TD>
                      <TD>
                        {canDecide ? (
                          <div className="flex gap-1">
                            <form action={decideReconciliationAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="CONFIRM" /><Button size="sm">Conferma</Button></form>
                            <form action={decideReconciliationAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="REJECT" /><Button size="sm" variant="ghost">Scarta</Button></form>
                          </div>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Transazioni gateway senza ordine ({unmatchedTx.length})</CardTitle></CardHeader>
          <CardContent>
            {unmatchedTx.length === 0 ? <Empty title="Tutte le transazioni gateway sono collegate" /> : (
              <Table>
                <THead><TR><TH>Data</TH><TH>Gateway</TH><TH>Tipo</TH><TH className="text-right">Importo</TH><TH>Rif.</TH>{canDecide ? <TH>Collega a ordine</TH> : null}</TR></THead>
                <TBody>
                  {unmatchedTx.map((t) => (
                    <TR key={t.id}>
                      <TD className="text-xs">{fmtDate(t.processedAt, auth.timezone)}</TD><TD className="text-xs">{t.provider}</TD><TD className="text-xs">{PAYMENT_KIND_LABEL[t.kind]}</TD><TD className="text-right tabular text-xs">{fmtMoney(t.amount.toString(), t.currency)}</TD><TD className="font-mono text-[11px]">{t.orderRef ?? "—"}</TD>
                      {canDecide ? <TD><form action={manualLinkAction} className="flex gap-1"><input type="hidden" name="type" value="PAYMENT_ORDER" /><input type="hidden" name="leftId" value={t.id} /><Input name="orderName" placeholder="#1001" className="h-7 w-24 text-xs" /><Button size="sm" variant="outline">OK</Button></form></TD> : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payout senza accredito bancario ({unmatchedPayouts.length})</CardTitle></CardHeader>
          <CardContent>
            {unmatchedPayouts.length === 0 ? <Empty title="Tutti i payout sono abbinati a un accredito" /> : (
              <Table>
                <THead><TR><TH>Emesso</TH><TH>Gateway</TH><TH className="text-right">Netto</TH><TH>Stato</TH>{canDecide ? <TH>Abbina accredito</TH> : null}</TR></THead>
                <TBody>
                  {unmatchedPayouts.map((p) => (
                    <TR key={p.id}>
                      <TD className="text-xs">{fmtDate(p.issuedAt, auth.timezone)}</TD><TD className="text-xs">{p.provider}</TD><TD className="text-right tabular text-xs">{fmtMoney(p.netAmount.toString(), p.currency)}</TD><TD><Badge tone={p.status === "PAID" ? "ok" : "warn"}>{p.status}</Badge></TD>
                      {canDecide ? (
                        <TD>
                          <form action={manualLinkAction} className="flex gap-1">
                            <input type="hidden" name="type" value="PAYOUT_BANK" /><input type="hidden" name="leftId" value={p.id} />
                            <Select name="rightId" className="h-7 w-56 text-xs" defaultValue="">
                              <option value="">— accredito —</option>
                              {bankCredits.filter((b) => b.currency === p.currency).map((b) => <option key={b.id} value={b.id}>{fmtDate(b.bookingDate, auth.timezone)} · {b.amount.toFixed(2)} · {b.description.slice(0, 30)}</option>)}
                            </Select>
                            <Button size="sm" variant="outline">OK</Button>
                          </form>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-graphite">Legenda stati: {Object.entries(RECONCILIATION_STATUS_LABEL).map(([k, v]) => `${v.label} (${k})`).join(" · ")}</p>
    </div>
  );
}
