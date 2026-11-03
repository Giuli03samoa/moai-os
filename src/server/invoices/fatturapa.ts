import { XMLParser } from "fast-xml-parser";
import { Prisma } from "@prisma/client";
import { parseAmount } from "../money";
import { extractP7mPayload, looksLikeP7m } from "./p7m";

/**
 * FatturaPA (tracciato 1.2.x, FPR12/FPA12) reader.
 *
 * Security: XML from outside is untrusted. We reject any DOCTYPE/ENTITY declaration
 * (blocks XXE and billion-laughs), cap the size, and disable entity processing in the parser.
 * Only a read model is produced: nothing is ever sent to SdI.
 */

export const MAX_XML_BYTES = 5 * 1024 * 1024;

export type ParsedParty = {
  name: string;
  vat: string | null; // IdCodice without country
  country: string | null; // IdPaese
  fiscalCode: string | null;
};

export type ParsedInvoice = {
  bodyIndex: number;
  documentType: string;
  currency: string;
  issueDate: Date;
  number: string;
  totalAmount: Prisma.Decimal;
  taxableAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  causale: string | null;
  orderReference: string | null;
  lines: Array<{
    lineNumber: number;
    description: string;
    quantity: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal;
    totalPrice: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    natura: string | null;
  }>;
  installments: Array<{ position: number; method: string | null; dueDate: Date | null; amount: Prisma.Decimal; iban: string | null }>;
  warnings: string[];
};

export type ParsedFile = {
  formato: string | null; // FPR12 | FPA12
  transmissionId: string | null;
  sender: ParsedParty; // CedentePrestatore
  receiver: ParsedParty; // CessionarioCommittente
  invoices: ParsedInvoice[];
};

export class InvoiceParseError extends Error {}

export function decodeInvoiceFile(filename: string, content: Buffer): { xml: string; signed: boolean } {
  let bytes = content;
  let signed = false;
  if (looksLikeP7m(filename, content)) {
    bytes = extractP7mPayload(content);
    signed = true;
  }
  if (bytes.length > MAX_XML_BYTES) throw new InvoiceParseError("XML troppo grande (max 5 MB)");
  let xml = bytes.toString("utf8");
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  // Honour an explicit ISO-8859-1/windows-1252 declaration (seen in some SdI files).
  if (/<\?xml[^>]*encoding=["'](iso-8859-1|windows-1252)["']/i.test(xml.slice(0, 200))) xml = bytes.toString("latin1");
  return { xml, signed };
}

export function parseFatturaPA(xml: string): ParsedFile {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new InvoiceParseError("XML rifiutato: DOCTYPE/ENTITY non ammessi");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    processEntities: false,
    htmlEntities: false,
    parseTagValue: false, // keep "0001" and amounts as strings; we convert explicitly
    trimValues: true,
    isArray: (name) => ["FatturaElettronicaBody", "DettaglioLinee", "DatiRiepilogo", "DettaglioPagamento", "DatiPagamento", "Causale", "DatiOrdineAcquisto"].includes(name),
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml, true) as Record<string, unknown>;
  } catch (e) {
    throw new InvoiceParseError(`XML non valido: ${(e as Error).message}`);
  }
  const root = (doc["FatturaElettronica"] ?? null) as Record<string, any> | null;
  if (!root) throw new InvoiceParseError("Non è una FatturaPA: elemento FatturaElettronica assente");

  const header = root["FatturaElettronicaHeader"] ?? {};
  const bodies: any[] = root["FatturaElettronicaBody"] ?? [];
  if (!bodies.length) throw new InvoiceParseError("FatturaPA senza FatturaElettronicaBody");

  return {
    formato: str(root["@versione"]) ?? str(header?.DatiTrasmissione?.FormatoTrasmissione),
    transmissionId: str(header?.DatiTrasmissione?.ProgressivoInvio),
    sender: party(header?.CedentePrestatore?.DatiAnagrafici),
    receiver: party(header?.CessionarioCommittente?.DatiAnagrafici),
    invoices: bodies.map((b, i) => body(b, i)),
  };
}

function party(da: any): ParsedParty {
  const an = da?.Anagrafica ?? {};
  const name = str(an.Denominazione) ?? [str(an.Nome), str(an.Cognome)].filter(Boolean).join(" ");
  return {
    name: name || "(senza denominazione)",
    vat: str(da?.IdFiscaleIVA?.IdCodice),
    country: str(da?.IdFiscaleIVA?.IdPaese),
    fiscalCode: str(da?.CodiceFiscale),
  };
}

function body(b: any, index: number): ParsedInvoice {
  const warnings: string[] = [];
  const dg = b?.DatiGenerali?.DatiGeneraliDocumento ?? {};
  const number = str(dg.Numero);
  const date = str(dg.Data);
  if (!number || !date) throw new InvoiceParseError(`Body ${index + 1}: Numero o Data mancanti`);
  const issueDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(issueDate.getTime())) throw new InvoiceParseError(`Body ${index + 1}: Data non valida (${date})`);

  const lines = ((b?.DatiBeniServizi?.DettaglioLinee ?? []) as any[]).map((l, i) => ({
    lineNumber: Number(str(l.NumeroLinea) ?? i + 1),
    description: (str(l.Descrizione) ?? "").slice(0, 1000),
    quantity: parseAmount(str(l.Quantita), { decimalSeparator: "." }),
    unitPrice: parseAmount(str(l.PrezzoUnitario), { decimalSeparator: "." }) ?? new Prisma.Decimal(0),
    totalPrice: parseAmount(str(l.PrezzoTotale), { decimalSeparator: "." }) ?? new Prisma.Decimal(0),
    vatRate: parseAmount(str(l.AliquotaIVA), { decimalSeparator: "." }) ?? new Prisma.Decimal(0),
    natura: str(l.Natura),
  }));

  const riepilogo = (b?.DatiBeniServizi?.DatiRiepilogo ?? []) as any[];
  let taxable = new Prisma.Decimal(0);
  let tax = new Prisma.Decimal(0);
  for (const r of riepilogo) {
    taxable = taxable.plus(parseAmount(str(r.ImponibileImporto), { decimalSeparator: "." }) ?? 0);
    tax = tax.plus(parseAmount(str(r.Imposta), { decimalSeparator: "." }) ?? 0);
  }
  const declaredTotal = parseAmount(str(dg.ImportoTotaleDocumento), { decimalSeparator: "." });
  const computedTotal = taxable.plus(tax);
  let total: Prisma.Decimal;
  if (declaredTotal) {
    total = declaredTotal;
    if (declaredTotal.minus(computedTotal).abs().gt("0.01")) {
      warnings.push(`ImportoTotaleDocumento (${declaredTotal}) diverso da imponibile+imposta (${computedTotal}): possibili arrotondamenti, bolli o ritenute.`);
    }
  } else {
    total = computedTotal;
    warnings.push("ImportoTotaleDocumento assente: totale calcolato dai DatiRiepilogo.");
  }

  const installments: ParsedInvoice["installments"] = [];
  let pos = 0;
  for (const dp of (b?.DatiPagamento ?? []) as any[]) {
    for (const d of (dp?.DettaglioPagamento ?? []) as any[]) {
      const due = str(d.DataScadenzaPagamento);
      installments.push({
        position: pos++,
        method: str(d.ModalitaPagamento),
        dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
        amount: parseAmount(str(d.ImportoPagamento), { decimalSeparator: "." }) ?? new Prisma.Decimal(0),
        iban: str(d.IBAN),
      });
    }
  }

  const causale = ((b?.DatiGenerali?.DatiGeneraliDocumento?.Causale ?? []) as unknown[]).map(str).filter(Boolean).join(" ") || null;
  const orderRef = ((b?.DatiGenerali?.DatiOrdineAcquisto ?? []) as any[]).map((o) => str(o?.IdDocumento)).find(Boolean) ?? null;

  return {
    bodyIndex: index,
    documentType: str(dg.TipoDocumento) ?? "TD01",
    currency: str(dg.Divisa) ?? "EUR",
    issueDate,
    number,
    totalAmount: total,
    taxableAmount: taxable,
    taxAmount: tax,
    causale,
    orderReference: orderRef,
    lines,
    installments,
    warnings,
  };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    return t === undefined ? null : String(t).trim() || null;
  }
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Credit notes reduce totals: TD04 (nota di credito), TD08 (nota di credito semplificata). */
export function isCreditNote(documentType: string) {
  return documentType === "TD04" || documentType === "TD08";
}
