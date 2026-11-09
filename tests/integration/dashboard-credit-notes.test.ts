import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getDashboardMetrics } from "@/server/metrics/dashboard";
import { makeOrg } from "./helpers";

async function inv(orgId: string, direction: "ACTIVE" | "PASSIVE", documentType: string, number: string, total: string) {
  return db.invoice.create({
    data: {
      organizationId: orgId, source: "XML_UPLOAD", direction, dedupeKey: `${direction}:X:${documentType}:${number}:2026-10-01`, documentType, number,
      issueDate: new Date("2026-10-01T10:00:00Z"), currency: "EUR", totalAmount: total, taxableAmount: total, taxAmount: "0",
      senderName: "Fornitore", receiverName: "MOAI",
    },
  });
}

describe("dashboard invoice totals", () => {
  it("subtracts credit notes from received and issued invoices", async () => {
    const org = await makeOrg();
    await inv(org.id, "PASSIVE", "TD24", "F1", "317.20");
    await inv(org.id, "PASSIVE", "TD01", "F2", "100.00");
    await inv(org.id, "PASSIVE", "TD04", "NC1", "298.90");
    await inv(org.id, "PASSIVE", "TD01", "OLD", "50.00").then((i) => db.invoice.update({ where: { id: i.id }, data: { deletedAt: new Date() } }));
    await inv(org.id, "ACTIVE", "TD01", "A1", "200.00");
    await inv(org.id, "ACTIVE", "TD08", "A-NC", "20.00");
    const metrics = await getDashboardMetrics(org.id, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-31T23:59:59Z")}, "EUR");
    const received = metrics.find((m) => m.key === "invoicesReceived")!;
    const issued = metrics.find((m) => m.key === "invoicesIssued")!;
    expect(received.value).toBe("118.30"); // 317.20 + 100.00 − 298.90, deleted invoice ignored
    expect(received.definition).toBe("2 fatture ricevute nel periodo (IVA inclusa), al netto di 1 nota di credito");
    expect(issued.value).toBe("180.00");
  });
});
