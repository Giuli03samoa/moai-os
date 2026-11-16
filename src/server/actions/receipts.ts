"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../auth/session";
import { FISCAL_DOC_KINDS, FISCAL_DOC_LABEL, clearFiscalDoc, markFiscalDoc, type FiscalDocKind } from "../receipts/receipts";

function back(view: string, msg: string, kind: "error" | "notice" = "notice"): never {
  const qs = new URLSearchParams({ ...(view ? { view } : {}), [kind]: msg });
  redirect(`/receipts?${qs}`);
}

/** "I issued the document for this sale": a statement about something done on the AdE portal, not an emission. */
export async function markReceiptAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const view = String(formData.get("view") ?? "");
  const kindRaw = String(formData.get("kind") ?? "RECEIPT");
  const kind = (FISCAL_DOC_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as FiscalDocKind) : "RECEIPT";
  try {
    await markFiscalDoc(auth.organizationId, auth.userId, id, { kind, ref: String(formData.get("ref") ?? "") });
  } catch (e) {
    back(view, (e as Error).message, "error");
  }
  revalidatePath("/receipts");
  back(view, `${FISCAL_DOC_LABEL[kind]} segnato come fatto.`);
}

export async function unmarkReceiptAction(formData: FormData) {
  const auth = await requireAuth("OPERATIONS");
  const id = String(formData.get("id") ?? "");
  const view = String(formData.get("view") ?? "");
  try {
    await clearFiscalDoc(auth.organizationId, auth.userId, id);
  } catch (e) {
    back(view, (e as Error).message, "error");
  }
  revalidatePath("/receipts");
  back(view, "Segno tolto: l'incasso è di nuovo tra quelli da fare.");
}
