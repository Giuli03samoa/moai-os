"use client";

import { useActionState, useMemo, useState } from "react";
import { importCsvAction, type ImportState } from "@/server/actions/imports";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Notice, Select, TBody, TD, TH, THead, TR, Table, Textarea } from "@/components/ui/primitives";

type Preset = { name: string; kind: string; mapping: Record<string, unknown>; builtin: boolean };
const KINDS = [
  { v: "PAYMENTS", l: "Transazioni gateway" }, { v: "PAYOUTS", l: "Payout gateway" }, { v: "BANK", l: "Estratto conto bancario" }, { v: "SHIPMENTS", l: "Spedizioni Packlink" },
];

export function ImportForm({ presets, fields, initialKind, tz }: { presets: Preset[]; fields: Record<string, { required: string[]; optional: string[] }>; initialKind: string; tz: string }) {
  const [kind, setKind] = useState(initialKind);
  const [presetName, setPresetName] = useState("");
  const blank = useMemo(() => JSON.stringify({ kind, provider: "", delimiter: "auto", decimalSeparator: ",", dateFormat: "DD/MM/YYYY", timezone: tz, columns: Object.fromEntries([...fields[kind]!.required, ...fields[kind]!.optional].map((f) => [f, ""])), valueMaps: {}, defaults: {}, skipWhen: {}, absoluteAmounts: kind !== "BANK" }, null, 2), [kind, fields, tz]);
  const [mapping, setMapping] = useState(blank);
  const [state, action, pending] = useActionState<ImportState, FormData>(importCsvAction, {});
  const list = presets.filter((p) => p.kind === kind);

  const choosePreset = (name: string) => {
    setPresetName(name);
    const p = presets.find((x) => x.name === name && x.kind === kind);
    setMapping(p ? JSON.stringify(p.mapping, null, 2) : blank);
  };

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader><CardTitle>1 · File e mapping</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Tipo di dati">
            <Select value={kind} onChange={(e) => { setKind(e.target.value); setPresetName(""); setMapping(""); setTimeout(() => setMapping((m) => m || blank), 0); }}>
              {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
            </Select>
          </Field>
          <Field label="Preset" help="I preset sono punti di partenza: controlla sempre l'anteprima con un export reale.">
            <Select value={presetName} onChange={(e) => choosePreset(e.target.value)}>
              <option value="">— mapping manuale —</option>
              {list.map((p) => <option key={p.name} value={p.name}>{p.name}{p.builtin ? "" : " (salvato)"}</option>)}
            </Select>
          </Field>
          <input type="hidden" name="presetName" value={presetName} />
          <Field label="Gateway / provider" help="shopify_payments, paypal, stripe, satispay, klarna…"><Input name="provider" placeholder="paypal" /></Field>
          {kind === "BANK" ? <Field label="Etichetta conto"><Input name="accountLabel" placeholder="Conto principale" /></Field> : null}
          <Field label="File CSV (max 10 MB)"><Input type="file" name="file" accept=".csv,text/csv" required className="file:mr-3 file:rounded-full file:border-0 file:bg-blackout file:px-3 file:py-1 file:text-xs file:text-crocus" /></Field>
          <Field label="Mapping (JSON)" help={`Campi obbligatori: ${fields[kind]!.required.join(", ")}. Opzionali: ${fields[kind]!.optional.join(", ")}. "columns" associa ogni campo all'intestazione CSV; "valueMaps" traduce i valori (es. tipo → SALE/REFUND).`}>
            <Textarea name="mapping" value={mapping || blank} onChange={(e) => setMapping(e.target.value)} className="min-h-[320px] font-mono text-xs" spellCheck={false} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>Anteprima</Button>
            <Button type="submit" name="intent" value="save_preset" variant="outline" disabled={pending} onClick={(e) => { const n = window.prompt("Nome del preset", presetName || `${kind.toLowerCase()}-custom`); if (!n) e.preventDefault(); else setPresetName(n); }}>Salva come preset</Button>
            <Button type="submit" name="intent" value="commit" disabled={pending || !state.preview}>{pending ? "Elaboro…" : "Importa"}</Button>
          </div>
          {!state.preview ? <p className="text-xs text-graphite">L&apos;importazione si attiva dopo un&apos;anteprima senza errori bloccanti.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>2 · Anteprima e risultato</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state.error ? <Notice tone={state.error.startsWith("Preset") ? "ok" : "bad"}>{state.error}</Notice> : null}
          {state.result ? (
            <Notice tone="ok">Importazione completata: {state.result.imported} righe nuove, {state.result.updated} aggiornate, {state.result.skipped} saltate, {state.result.errors} con errori su {state.result.total}. La riconciliazione è stata messa in coda.</Notice>
          ) : null}
          {state.preview ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-cloud px-2 py-0.5">{state.preview.total} righe</span>
                <span className="rounded-full bg-ok-bg px-2 py-0.5 text-ok">{state.preview.valid} valide</span>
                <span className="rounded-full bg-cloud px-2 py-0.5">{state.preview.skipped} ignorate (skipWhen)</span>
                <span className={`rounded-full px-2 py-0.5 ${state.preview.errors.length ? "bg-bad-bg text-bad" : "bg-cloud"}`}>{state.preview.errors.length} errori</span>
              </div>
              <p className="text-xs text-graphite">Intestazioni trovate: {state.preview.headers.join(" · ")}</p>
              {state.preview.errors.length ? (
                <div className="max-h-40 overflow-auto rounded-lg border border-bad/30 bg-bad-bg p-2 text-xs text-bad">
                  {state.preview.errors.map((e, i) => <div key={i}>riga {e.row}: {e.message}</div>)}
                </div>
              ) : null}
              {state.preview.rows.length ? (
                <div className="max-h-[480px] overflow-auto rounded-lg border border-smoke">
                  <Table>
                    <THead><TR>{state.preview.columns.map((c) => <TH key={c}>{c}</TH>)}</TR></THead>
                    <TBody>{state.preview.rows.map((r, i) => <TR key={i}>{state.preview!.columns.map((c) => <TD key={c} className="whitespace-nowrap text-xs">{r[c]}</TD>)}</TR>)}</TBody>
                  </Table>
                </div>
              ) : null}
              <p className="text-xs text-graphite">Prime 25 righe normalizzate. Le righe con errore non vengono importate; le altre sì, in modo idempotente (stesso ID = aggiornamento, non duplicato).</p>
            </>
          ) : (
            <p className="text-sm text-graphite">Carica un file e premi Anteprima.</p>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
