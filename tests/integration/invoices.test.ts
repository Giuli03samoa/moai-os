import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ingestInvoiceFile, refreshInvoicePaymentStatus } from "@/server/invoices/archive";
import { makeOrg } from "./helpers";

const fx = (n: string) => readFileSync(path.join(__dirname, "../fixtures", n));

describe("invoice archive", () => {
  it("ingests, deduplicates and keeps manual payment marks across re-imports", async () => {
    const org = await makeOrg();
    const a1 = await ingestInvoiceFile({ organizationId: org.id, filename: "IT01234567890_00042.xml", content: fx("fatturapa-active.xml"), source: "XML_UPLOAD" });
    expect(a1.invoices[0]).toMatchObject({ number: "2026/0042", direction: "ACTIVE", created: true });
    const a2 = await ingestInvoiceFile({ organizationId: org.id, filename: "copia.xml", content: fx("fatturapa-active.xml"), source: "XML_UPLOAD" });
    expect(a2.duplicateFile).toBe(true);
    expect(a2.invoices[0]!.created).toBe(false);
    expect(await db.invoice.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await db.document.count({ where: { organizationId: org.id } })).toBe(1);

    const p = await ingestInvoiceFile({ organizationId: org.id, filename: "IT09876543210_778.xml", content: fx("fatturapa-passive.xml"), source: "XML_UPLOAD" });
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: p.invoices[0]!.id }, include: { installments: true, lines: true } });
    expect(inv.direction).toBe("PASSIVE");
    expect(inv.paymentStatus).toBe("UNPAID");
    expect(inv.nextDueDate?.toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(inv.lines).toHaveLength(2);
    expect(inv.installments).toHaveLength(2);

    await db.invoiceInstallment.update({ where: { id: inv.installments[0]!.id }, data: { paidAt: new Date() } });
    await refreshInvoicePaymentStatus(inv.id);
    let after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.paymentStatus).toBe("PARTIAL");
    expect(after.nextDueDate?.toISOString().slice(0, 10)).toBe("2026-11-29");

    // Re-import of the same document (e.g. from Aruba later) must not reset the manual mark.
    await ingestInvoiceFile({ organizationId: org.id, filename: "IT09876543210_778.xml", content: fx("fatturapa-passive.xml"), source: "ARUBA_API", directionHint: "PASSIVE", aruba: { id: "A1", sdiId: "S1", statusCode: 7, statusDescription: "Consegnata" } });
    after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { installments: true } });
    expect(after.paymentStatus).toBe("PARTIAL");
    expect(after.sdiStatusCode).toBe(7);
    expect(await db.invoice.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("refuses files whose parties do not include the organization", async () => {
    const org = await makeOrg("99999999999");
    await expect(ingestInvoiceFile({ organizationId: org.id, filename: "x.xml", content: fx("fatturapa-active.xml"), source: "XML_UPLOAD" })).rejects.toThrow(/P.IVA/);
  });
});

describe("invoices imported already past due", () => {
  it("wait for the user's answer instead of raising a critical overdue alert", async () => {
    const { needsPaymentConfirmation } = await import("@/server/invoices/archive");
    const { collectSnapshot, computeAlerts } = await import("@/server/agent/monitor");
    const org = await makeOrg("01234567890");
    // The passive fixture's installments fall due on 30/10 and 29/11/2026; evaluate as if imported after both.
    const later = new Date("2027-01-15T10:00:00Z");
    expect(needsPaymentConfirmation({ issueDate: new Date("2026-10-01"), installments: [{ dueDate: new Date("2026-10-30") }] }, later)).toBe(true);
    expect(needsPaymentConfirmation({ issueDate: new Date("2026-10-01"), installments: [{ dueDate: new Date("2027-02-01") }] }, later)).toBe(false);
    expect(needsPaymentConfirmation({ issueDate: new Date("2026-12-20"), installments: [] }, later)).toBe(false);
    expect(needsPaymentConfirmation({ issueDate: new Date("2026-11-01"), installments: [] }, later)).toBe(true);

    const p = await ingestInvoiceFile({ organizationId: org.id, filename: "IT09876543210_778.xml", content: fx("fatturapa-passive.xml"), source: "XML_UPLOAD" });
    const id = p.invoices[0]!.id;
    // Force the "arrived late" situation regardless of today's date.
    await db.invoice.update({ where: { id }, data: { paymentToConfirm: true, nextDueDate: new Date("2026-10-30") } });

    let alerts = computeAlerts(await collectSnapshot(org.id));
    expect(alerts.find((a) => a.kind === "invoices.overdue")).toBeUndefined();
    const ask = alerts.find((a) => a.kind === "invoices.to_confirm");
    expect(ask?.severity).toBe("WARNING"); // never CRITICAL, never emailed

    // Re-importing the same file does not clear the question.
    await ingestInvoiceFile({ organizationId: org.id, filename: "copia.xml", content: fx("fatturapa-passive.xml"), source: "XML_UPLOAD" });
    expect((await db.invoice.findUniqueOrThrow({ where: { id } })).paymentToConfirm).toBe(true);

    // Answer "to pay": it becomes an ordinary overdue invoice again.
    await db.invoice.update({ where: { id }, data: { paymentToConfirm: false } });
    alerts = computeAlerts(await collectSnapshot(org.id));
    expect(alerts.find((a) => a.kind === "invoices.overdue")?.severity).toBe("CRITICAL");
    expect(alerts.find((a) => a.kind === "invoices.to_confirm")).toBeUndefined();
  });
});
