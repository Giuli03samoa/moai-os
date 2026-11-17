import Link from "next/link";
import { db } from "@/server/db";
import { upsertMaterialAction } from "@/server/actions/garments";
import { MATERIAL_KIND_LABEL, MATERIAL_KINDS, materialPurchases } from "@/server/production/garments";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Empty, Field, Input, Select, TBody, TD, TH, THead, TR, Table, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export async function MaterialsTab({ orgId, currency, tz, canEdit, editId }: { orgId: string; currency: string; tz: string; canEdit: boolean; editId?: string }) {
  const [materials, suppliers] = await Promise.all([
    db.material.findMany({ where: { organizationId: orgId, archivedAt: null }, include: { supplier: { select: { id: true, name: true } }, components: { include: { garment: { select: { id: true, name: true, archivedAt: true } } } } }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const purchases = await Promise.all(materials.map((m) => materialPurchases(orgId, m)));
  const editing = editId ? materials.find((m) => m.id === editId) : undefined;
  const qty = (v: string) => Number(v).toLocaleString("it-IT", { maximumFractionDigits: 2 });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent className="pt-5">
          {materials.length === 0 ? <Empty title="Nessun tessuto o materiale">Aggiungili dal modulo a destra: gli acquisti si leggono da soli dalle fatture dei fornitori.</Empty> : (
            <Table>
              <THead><TR><TH>Materiale</TH><TH>Fornitore</TH><TH>Composizione</TH><TH className="text-right">Prezzo</TH><TH className="text-right">Comprato</TH><TH>Ultimo acquisto</TH><TH>Usato in</TH>{canEdit ? <TH></TH> : null}</TR></THead>
              <TBody>
                {materials.map((m, i) => {
                  const p = purchases[i]!;
                  const used = m.components.filter((c) => !c.garment.archivedAt);
                  return (
                    <TR key={m.id} className={editing?.id === m.id ? "bg-cloud/70" : undefined}>
                      <TD>
                        <p className="font-medium">{m.name}</p>
                        <p className="text-[11px] text-graphite">{[MATERIAL_KIND_LABEL[m.kind], m.variant, m.weightGsm ? `${m.weightGsm} g/m²` : null, m.widthCm ? `h ${m.widthCm} cm` : null].filter(Boolean).join(" · ")}</p>
                      </TD>
                      <TD className="text-xs">{m.supplier?.name ?? "—"}</TD>
                      <TD className="max-w-[220px] text-xs">{m.composition ?? <span className="text-space">non indicata</span>}</TD>
                      <TD className="whitespace-nowrap text-right tabular">{m.unitPrice ? `${fmtMoney(m.unitPrice.toString(), currency)}/${m.unit}` : "—"}</TD>
                      <TD className="whitespace-nowrap text-right tabular">{p.purchases.length ? <>{qty(p.qty)} {m.unit}<span className="block text-[11px] text-graphite">{fmtMoney(p.amount, currency)}</span></> : <span className="text-space">—</span>}</TD>
                      <TD className="whitespace-nowrap text-xs">{p.last ? <>{fmtDate(p.last.date, tz)}<span className="block text-[11px] text-graphite">{p.last.qty ? `${qty(p.last.qty)} ${m.unit}` : ""} · ft. {p.last.invoice}</span></> : <span className="text-space">{m.invoiceMatch ? "nessuna fattura" : "—"}</span>}</TD>
                      <TD><div className="flex flex-wrap gap-1">{used.length ? used.map((c) => <Link key={c.id} href={`/production/garments/${c.garment.id}`}><Badge tone="outline" className="hover:border-graphite">{c.garment.name}</Badge></Link>) : <span className="text-xs text-space">—</span>}</div></TD>
                      {canEdit ? <TD><Link href={`/production?tab=materials&edit=${m.id}`} className="text-xs text-graphite hover:text-blackout hover:underline">Modifica</Link></TD> : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
          <p className="mt-4 text-xs text-space">«Comprato» somma le righe delle fatture ricevute che contengono il testo di riconoscimento del materiale, al netto delle note di credito. Prezzi IVA esclusa.</p>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `Modifica ${editing.name}` : "Nuovo tessuto o materiale"}</CardTitle>
            <CardDescription>{editing ? <Link href="/production?tab=materials" className="hover:underline">Annulla e creane uno nuovo</Link> : "Tessuti, costine, etichette, loghi: tutto quello che entra in un capo."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form key={editing?.id ?? "new"} action={upsertMaterialAction} className="flex flex-col gap-3">
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <Field label="Nome"><Input name="name" required defaultValue={editing?.name} placeholder="Renew Action" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tipo"><Select name="kind" defaultValue={editing?.kind ?? "FABRIC"}>{MATERIAL_KINDS.map((k) => <option key={k} value={k}>{MATERIAL_KIND_LABEL[k]}</option>)}</Select></Field>
                <Field label="Colore / base"><Input name="variant" defaultValue={editing?.variant ?? ""} placeholder="nero, bianco per stampa" /></Field>
              </div>
              <Field label="Fornitore"><Select name="supplierId" defaultValue={editing?.supplierId ?? ""}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Composizione"><Input name="composition" defaultValue={editing?.composition ?? ""} placeholder="PL riciclato 81%, elastan 14%…" /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Prezzo"><Input name="unitPrice" defaultValue={editing?.unitPrice ? editing.unitPrice.toFixed(2).replace(".", ",") : ""} placeholder="4,60" /></Field>
                <Field label="Unità"><Select name="unit" defaultValue={editing?.unit ?? "m"}><option value="m">metro</option><option value="pz">pezzo</option><option value="foglio">foglio</option><option value="kg">kg</option></Select></Field>
                <Field label="g/m²"><Input name="weightGsm" type="number" min={1} defaultValue={editing?.weightGsm ?? ""} /></Field>
              </div>
              <Field label="Altezza (cm)"><Input name="widthCm" type="number" min={1} defaultValue={editing?.widthCm ?? ""} /></Field>
              <Field label="Testo in fattura" help="Come compare nelle righe della fattura del fornitore, per ritrovare gli acquisti (es. RENEW ACTION X STAMPA)."><Input name="invoiceMatch" defaultValue={editing?.invoiceMatch ?? ""} /></Field>
              <Field label="Note"><Textarea name="notes" defaultValue={editing?.notes ?? ""} className="min-h-[60px]" /></Field>
              <Button type="submit" size="sm">Salva</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
