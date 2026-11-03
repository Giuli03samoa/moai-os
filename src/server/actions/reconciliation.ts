"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ReconciliationType } from "@prisma/client";
import { db } from "../db";
import { requireAuth } from "../auth/session";
import { decideReconciliation, manualLink } from "../reconciliation/engine";
import { enqueue } from "../jobs/queue";

const RET = "/payments?tab=reconciliation";
function back(msg: string, kind: "error" | "notice" = "notice"): never {
  redirect(`${RET}&${kind}=${encodeURIComponent(msg)}`);
}

export async function decideReconciliationAction(formData: FormData) {
  const auth = await requireAuth("ACCOUNTANT");
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "CONFIRM" ? "CONFIRM" : "REJECT";
  try {
    await decideReconciliation(auth.organizationId, id, decision, auth.userId);
  } catch (e) {
    back((e as Error).message, "error");
  }
  revalidatePath("/payments");
  back(decision === "CONFIRM" ? "Corrispondenza confermata." : "Proposta scartata.");
}

export async function manualLinkAction(formData: FormData) {
  const auth = await requireAuth("ACCOUNTANT");
  const type = String(formData.get("type") ?? "") as ReconciliationType;
  const leftId = String(formData.get("leftId") ?? "");
  let rightId = String(formData.get("rightId") ?? "");
  const orderName = String(formData.get("orderName") ?? "").trim();
  if (!["PAYMENT_ORDER", "PAYOUT_BANK", "INVOICE_ORDER"].includes(type)) back("Tipo non valido", "error");
  if (!rightId && orderName) {
    const order = await db.order.findFirst({ where: { organizationId: auth.organizationId, deletedAt: null, OR: [{ name: orderName }, { name: `#${orderName.replace(/^#/, "")}` }] } });
    if (!order) back(`Ordine ${orderName} non trovato`, "error");
    rightId = order.id;
  }
  if (!leftId || !rightId) back("Seleziona entrambi gli elementi da collegare", "error");
  try {
    await manualLink(auth.organizationId, auth.userId, { type, leftId, rightId });
  } catch (e) {
    back((e as Error).message, "error");
  }
  revalidatePath("/payments");
  back("Collegamento manuale registrato.");
}

export async function runReconciliationAction() {
  const auth = await requireAuth("ACCOUNTANT");
  const { deduplicated } = await enqueue({ organizationId: auth.organizationId, type: "reconciliation.run", dedupeKey: `reconciliation.run:${auth.organizationId}`, triggeredBy: `user:${auth.userId}` });
  back(deduplicated ? "Riconciliazione già in corso." : "Riconciliazione avviata: ricarica tra qualche secondo.");
}
