import { describe, expect, it } from "vitest";
import { PRESETS, mappingSchema, parseBank, parsePayments, parsePayouts, parseShipments, parseDate } from "@/server/imports/csv-mapping";

describe("parseDate", () => {
  it("interprets local dates in the mapping timezone", () => {
    const d = parseDate("01/10/2026", "DD/MM/YYYY", "Europe/Rome", "10:30:00")!;
    expect(d.toISOString()).toBe("2026-10-01T08:30:00.000Z"); // CEST = UTC+2
    expect(parseDate("2026-10-01 12:00:00", "ISO", "UTC")!.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(parseDate("2026-10-01T12:00:00+02:00", "ISO", "UTC")!.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(parseDate("10/01/2026", "MM/DD/YYYY", "UTC")!.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(parseDate("31/13/2026", "DD/MM/YYYY", "UTC")).toBeNull();
  });
});

describe("PayPal activity preset", () => {
  const csv = [
    '"Data","Orario","Fuso orario","Nome","Tipo","Stato","Valuta","Lordo","Tariffa","Netto","Numero fattura","Codice transazione","Codice transazione di riferimento"',
    '"01/10/2026","10:15:02","CEST","Mario Rossi","Pagamento Express Checkout","Completata","EUR","89,00","-3,27","85,73","#1042","TX1","" ',
    '"02/10/2026","09:00:00","CEST","Luca Bianchi","Rimborso","Completata","EUR","-45,00","1,20","-43,80","#1043","TX2","TX0"',
    '"03/10/2026","18:00:00","CEST","","Trasferimento standard al conto bancario","Completata","EUR","-120,00","0,00","-120,00","","TX3",""',
  ].join("\n");
  it("normalises rows, skips bank transfers and keeps amounts positive", () => {
    const r = parsePayments(csv, PRESETS["paypal-activity"]!);
    expect(r.errors).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(r.rows).toHaveLength(2);
    const sale = r.rows[0]!;
    expect(sale.kind).toBe("SALE");
    expect(sale.amount.toFixed(2)).toBe("89.00");
    expect(sale.fee!.toFixed(2)).toBe("3.27");
    expect(sale.net!.toFixed(2)).toBe("85.73");
    expect(sale.orderRef).toBe("#1042");
    expect(sale.processedAt.toISOString()).toBe("2026-10-01T08:15:02.000Z");
    const refund = r.rows[1]!;
    expect(refund.kind).toBe("REFUND");
    expect(refund.amount.toFixed(2)).toBe("45.00");
    expect(refund.parentExternalId).toBe("TX0");
  });
  it("reports unmapped values per row instead of failing the file", () => {
    const r = parsePayments(csv.replace("Rimborso", "Tipo Sconosciuto"), PRESETS["paypal-activity"]!);
    expect(r.rows).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3 });
    expect(r.errors[0]!.message).toMatch(/non mappato/);
  });
  it("fails fast when a required column is missing", () => {
    const r = parsePayments(csv.replace("Codice transazione", "ID"), PRESETS["paypal-activity"]!);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]!.message).toMatch(/obbligatorie/);
  });
});

describe("Stripe presets", () => {
  it("parses balance history and payouts", () => {
    const bh = "id,Type,Amount,Fee,Net,Currency,Created (UTC),Description,Transfer\ntxn_1,charge,89.00,2.74,86.26,eur,2026-10-01 08:00:00,Order #1042,po_1\ntxn_2,payout,-86.26,0,-86.26,eur,2026-10-02 00:00:00,,po_1";
    const r = parsePayments(bh, PRESETS["stripe-balance-history"]!);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.rows[0]!.currency).toBe("EUR");
    expect(r.rows[0]!.payoutExternalId).toBe("po_1");
    const po = parsePayouts("id,Amount,Currency,Created (UTC),Arrival Date (UTC),Status\npo_1,86.26,eur,2026-10-02 00:00:00,2026-10-04 00:00:00,paid", PRESETS["stripe-payouts"]!);
    expect(po.rows[0]).toMatchObject({ externalId: "po_1", status: "PAID" });
    expect(po.rows[0]!.netAmount.toFixed(2)).toBe("86.26");
  });
});

describe("Bank statements", () => {
  it("handles signed amounts, generates stable ids and keeps duplicates distinct", () => {
    const csv = "Data contabile;Data valuta;Importo;Descrizione\n05/10/2026;05/10/2026;1.234,56;ACCREDITO SHOPIFY PAYMENTS\n05/10/2026;05/10/2026;1.234,56;ACCREDITO SHOPIFY PAYMENTS\n06/10/2026;06/10/2026;-50,00;CANONE";
    const r = parseBank(csv, PRESETS["banca-generico-it"]!);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]!.amount.toFixed(2)).toBe("1234.56");
    expect(r.rows[2]!.amount.toFixed(2)).toBe("-50.00");
    expect(r.rows[0]!.externalId).not.toBe(r.rows[1]!.externalId);
    expect(parseBank(csv, PRESETS["banca-generico-it"]!).rows[0]!.externalId).toBe(r.rows[0]!.externalId);
  });
  it("supports separate debit/credit columns", () => {
    const m = mappingSchema.parse({ kind: "BANK", delimiter: ";", decimalSeparator: ",", dateFormat: "DD/MM/YYYY", columns: { bookingDate: "Data", description: "Causale", credit: "Avere", debit: "Dare" } });
    const r = parseBank("Data;Causale;Dare;Avere\n01/10/2026;ACCREDITO;;100,00\n02/10/2026;ADDEBITO;30,00;", m);
    expect(r.rows.map((x) => x.amount.toFixed(2))).toEqual(["100.00", "-30.00"]);
  });
});

describe("Packlink shipments CSV", () => {
  it("maps statuses and costs", () => {
    const csv = "Riferimento;Riferimento ordine;Numero di tracking;Corriere;Servizio;Stato;Prezzo;Data\nIT2026ABC;#1042;1Z999;UPS;Standard;Consegnato;7,90;01/10/2026\nIT2026DEF;#1043;;BRT;Express;Stato strano;6,50;02/10/2026";
    const r = parseShipments(csv, PRESETS["packlink-pro-spedizioni"]!);
    expect(r.rows[0]).toMatchObject({ reference: "IT2026ABC", status: "DELIVERED", orderRef: "#1042" });
    expect(r.rows[0]!.cost!.toFixed(2)).toBe("7.90");
    expect(r.rows[1]!.status).toBe("UNKNOWN");
    expect(r.rows[1]!.rawStatus).toBe("Stato strano");
  });
});
