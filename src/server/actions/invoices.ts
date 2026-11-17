"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { ingestInvoiceFile } from "../invoices/archive";
import { refreshInvoicePaymentStatus } from "../invoices/archive";
import { InvoiceParseError } from "../invoices/fatturapa";
import { MAX_UPLOAD_BYTES } from "../storage";

const ALLOWED = /\.(xml|p7m)$/i;

export async function uploadInvoicesAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) redirect(`/invoices?error=${encodeURIComponent("Seleziona almeno un file XML o P7M.")}`);
  if (files.length > 50) redirect(`/invoices?error=${encodeURIComponent("Massimo 50 file per caricamento.")}`);
  const summary: string[] = [];
  let ok = 0, dup = 0, failed = 0;
  for (const f of files) {
    if (!ALLOWED.test(f.name)) { failed++; summary.push(`${f.name}: estensione non ammessa`); continue; }
    if (f.size > MAX_UPLOAD_BYTES) { failed++; summary.push(`${f.name}: troppo grande`); continue; }
    try {
      const r = await ingestInvoiceFile({ organizationId: auth.organizationId, filename: f.name, content: Buffer.from(await f.arrayBuffer()), source: "XML_UPLOAD", userId: auth.userId });
      if (r.duplicateFile && r.invoices.every((i) => !i.created)) dup++;
      else ok++;
      for (const w of r.warnings.slice(0, 3)) summary.push(`${f.name}: ${w}`);
    } catch (e) {
      failed++;
      summary.push(`${f.name}: ${e instanceof InvoiceParseError ? e.message : "errore interno durante l'archiviazione"}`);
    }
  }
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "invoice.upload", metadata: { files: files.length, ok, dup, failed } });
  revalidatePath("/invoices");
  const msg = `Caricati ${ok} file, ${dup} già presenti, ${failed} falliti.${summary.length ? " " + summary.slice(0, 5).join(" · ") : ""}`;
  redirect(`/invoices?${failed ? "error" : "notice"}=${encodeURIComponent(msg)}`);
}

/** Manual payment marking on an installment. Always a human decision, always audited. */
export async function setInstallmentPaidAction(formData: FormData) {
  const auth = await requireAuth("ACCOUNTANT");
  const id = String(formData.get("id") ?? "");
  const paid = formData.get("paid") === "true";
  const inst = await db.invoiceInstallment.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!inst) redirect("/invoices");
  await db.invoiceInstallment.update({ where: { id }, data: { paidAt: paid ? new Date() : null } });
  await refreshInvoicePaymentStatus(inst.invoiceId);
  // Marking an installment is an answer about the invoice: it no longer waits for confirmation.
  await db.invoice.update({ where: { id: inst.invoiceId }, data: { paymentToConfirm: false } });
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: paid ? "invoice.installment_paid" : "invoice.installment_unpaid", entityType: "InvoiceInstallment", entityId: id });
  revalidatePath(`/invoices/${inst.invoiceId}`);
  redirect(`/invoices/${inst.invoiceId}`);
}

/**
 * Answer for invoices imported already past due: "paid" (every open installment paid at its due date, or a single
 * installment created when the file has none) or "to pay" (they become ordinary unpaid invoices, alerts included).
 */
export async function confirmInvoicePaymentAction(formData: FormData) {
  const auth = await requireAuth("ACCOUNTANT");
  const ids = formData.getAll("id").map(String).filter(Boolean).slice(0, 200);
  const paid = formData.get("decision") === "paid";
  const invoices = await db.invoice.findMany({ where: { id: { in: ids }, organizationId: auth.organizationId, paymentToConfirm: true }, include: { installments: true } });
  for (const inv of invoices) {
    if (paid) {
      if (inv.installments.length === 0) {
        await db.invoiceInstallment.create({ data: { organizationId: auth.organizationId, invoiceId: inv.id, position: 1, amount: inv.totalAmount, dueDate: inv.issueDate, paidAt: inv.issueDate } });
      } else {
        for (const r of inv.installments.filter((x) => !x.paidAt)) await db.invoiceInstallment.update({ where: { id: r.id }, data: { paidAt: r.dueDate ?? inv.issueDate } });
      }
      await refreshInvoicePaymentStatus(inv.id);
    }
    await db.invoice.update({ where: { id: inv.id }, data: { paymentToConfirm: false } });
    await audit({ organizationId: auth.organizationId, userId: auth.userId, action: paid ? "invoice.confirmed_paid" : "invoice.confirmed_unpaid", entityType: "Invoice", entityId: inv.id, metadata: { number: inv.number, supplier: inv.senderName } });
  }
  revalidatePath("/invoices");
  const n = invoices.length;
  const msg = n === 0 ? "Nessuna fattura da confermare." : paid ? `${n === 1 ? "Fattura segnata" : `${n} fatture segnate`} come pagate.` : `${n === 1 ? "Fattura lasciata" : `${n} fatture lasciate`} da pagare: da ora contano nelle scadenze.`;
  redirect(`/invoices?notice=${encodeURIComponent(msg)}`);
}
