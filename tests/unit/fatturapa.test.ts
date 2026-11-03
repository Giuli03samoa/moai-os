import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeInvoiceFile, parseFatturaPA, isCreditNote } from "@/server/invoices/fatturapa";
import { classifyDirection, invoiceDedupeKey } from "@/server/invoices/archive";

const fx = (n: string) => readFileSync(path.join(__dirname, "../fixtures", n));

describe("FatturaPA parser", () => {
  it("reads an active invoice with order reference", () => {
    const { xml, signed } = decodeInvoiceFile("IT01234567890_00042.xml", fx("fatturapa-active.xml"));
    expect(signed).toBe(false);
    const p = parseFatturaPA(xml);
    expect(p.formato).toBe("FPR12");
    expect(p.sender.vat).toBe("01234567890");
    expect(p.receiver.fiscalCode).toBe("RSSMRA80A01H501U");
    expect(p.receiver.name).toBe("Mario Rossi");
    expect(p.invoices).toHaveLength(1);
    const inv = p.invoices[0]!;
    expect(inv.number).toBe("2026/0042");
    expect(inv.totalAmount.toFixed(2)).toBe("89.00");
    expect(inv.taxableAmount.toFixed(2)).toBe("72.95");
    expect(inv.taxAmount.toFixed(2)).toBe("16.05");
    expect(inv.orderReference).toBe("#1042");
    expect(inv.lines[0]!.vatRate.toFixed(2)).toBe("22.00");
    expect(inv.installments[0]!.method).toBe("MP08");
    expect(inv.warnings).toEqual([]);
  });
  it("reads a passive invoice with two installments", () => {
    const p = parseFatturaPA(fx("fatturapa-passive.xml").toString("utf8"));
    const inv = p.invoices[0]!;
    expect(inv.totalAmount.toFixed(2)).toBe("1220.00");
    expect(inv.lines).toHaveLength(2);
    expect(inv.installments).toHaveLength(2);
    expect(inv.installments[1]!.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-29");
    expect(inv.installments.reduce((a, i) => a.plus(i.amount), inv.totalAmount.minus(inv.totalAmount)).toFixed(2)).toBe("1220.00");
  });
  it("classifies direction from the organization VAT", () => {
    const active = parseFatturaPA(fx("fatturapa-active.xml").toString("utf8"));
    const passive = parseFatturaPA(fx("fatturapa-passive.xml").toString("utf8"));
    const org = { vatNumber: "IT01234567890", fiscalCode: null };
    expect(classifyDirection(org, active)).toBe("ACTIVE");
    expect(classifyDirection(org, passive)).toBe("PASSIVE");
    expect(classifyDirection({ vatNumber: "11111111111", fiscalCode: null }, active)).toBeNull();
    expect(invoiceDedupeKey("ACTIVE", active, active.invoices[0]!)).toBe("ACTIVE:01234567890:TD01:2026/0042:2026-09-15");
  });
  it("rejects XXE / DOCTYPE and non-FatturaPA documents", () => {
    expect(() => parseFatturaPA('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><FatturaElettronica/>')).toThrow(/DOCTYPE/);
    expect(() => parseFatturaPA("<root/>")).toThrow(/FatturaPA/);
    expect(() => parseFatturaPA("<FatturaElettronica><FatturaElettronicaBody><DatiGenerali/></FatturaElettronicaBody></FatturaElettronica>")).toThrow(/Numero o Data/);
  });
  it("warns when declared total disagrees with the summary", () => {
    const xml = fx("fatturapa-active.xml").toString("utf8").replace("<ImportoTotaleDocumento>89.00", "<ImportoTotaleDocumento>91.00");
    const p = parseFatturaPA(xml);
    expect(p.invoices[0]!.totalAmount.toFixed(2)).toBe("91.00");
    expect(p.invoices[0]!.warnings[0]).toMatch(/diverso/);
  });
  it("knows credit notes", () => {
    expect(isCreditNote("TD04")).toBe(true);
    expect(isCreditNote("TD01")).toBe(false);
  });
});
