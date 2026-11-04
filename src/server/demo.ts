import fs from "fs/promises";
import path from "path";
import { db } from "./db";

/**
 * Removes every row flagged isDemo for an organization, plus the archived invoice files that no
 * invoice references any more. Real data is never touched: the flag is set only by the demo seed.
 * Used by Settings → "Elimina tutti i dati demo" and by `npm run db:demo-delete`.
 */
export async function deleteDemoData(orgId: string) {
  const counts = await db.$transaction(async (tx) => {
    const demoOrderIds = (await tx.order.findMany({ where: { organizationId: orgId, isDemo: true }, select: { id: true } })).map((o) => o.id);
    const demoInvoiceIds = (await tx.invoice.findMany({ where: { organizationId: orgId, isDemo: true }, select: { id: true } })).map((i) => i.id);
    await tx.reconciliation.deleteMany({ where: { organizationId: orgId, OR: [{ orderId: { in: demoOrderIds } }, { invoiceId: { in: demoInvoiceIds } }, { paymentTransaction: { isDemo: true } }, { payout: { isDemo: true } }, { bankTransaction: { isDemo: true } }] } });
    await tx.inventoryMovement.deleteMany({ where: { organizationId: orgId, OR: [{ orderId: { in: demoOrderIds } }, { variant: { isDemo: true } }] } });
    return {
      payments: (await tx.paymentTransaction.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      payouts: (await tx.payout.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      bank: (await tx.bankTransaction.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      shipments: (await tx.shipment.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      invoices: (await tx.invoice.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      orders: (await tx.order.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      variants: (await tx.productVariant.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      products: (await tx.product.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
      customers: (await tx.customer.deleteMany({ where: { organizationId: orgId, isDemo: true } })).count,
    };
  });
  // Orphaned invoice files (archived by the demo seed, referenced by nothing now).
  const orphans = await db.document.findMany({ where: { organizationId: orgId, kind: { in: ["INVOICE_XML", "INVOICE_P7M"] }, invoices: { none: {} }, importBatches: { none: {} } } });
  let documents = 0;
  for (const d of orphans) {
    await fs.rm(path.join(path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage"), d.storageKey), { force: true });
    await db.document.delete({ where: { id: d.id } });
    documents++;
  }
  return { ...counts, documents };
}
