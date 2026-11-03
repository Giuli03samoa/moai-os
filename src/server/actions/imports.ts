"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAuth } from "../auth/session";
import { commitCsvImport, previewCsv } from "../imports/commit";
import { MAX_CSV_BYTES, mappingSchema } from "../imports/csv-mapping";

export type ImportState = {
  error?: string;
  preview?: { kind: string; headers: string[]; columns: string[]; rows: Array<Record<string, string>>; errors: Array<{ row: number; message: string }>; total: number; skipped: number; valid: number };
  result?: { batchId: string; imported: number; updated: number; errors: number; skipped: number; total: number };
};

function plain(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "raw") continue;
    out[k] = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : v instanceof Prisma.Decimal ? v.toFixed(2) : String(v);
  }
  return out;
}

export async function importCsvAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const auth = await requireAuth("OPERATIONS");
  const intent = String(formData.get("intent") ?? "preview");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Seleziona un file CSV." };
  if (file.size > MAX_CSV_BYTES) return { error: "File troppo grande (max 10 MB)." };
  let mapping;
  try {
    mapping = mappingSchema.parse(JSON.parse(String(formData.get("mapping") ?? "{}")));
  } catch (e) {
    return { error: `Mapping non valido: ${(e as Error).message.slice(0, 300)}` };
  }
  const content = Buffer.from(await file.arrayBuffer());
  const provider = String(formData.get("provider") ?? "").trim().toLowerCase() || mapping.provider;
  const presetName = String(formData.get("presetName") ?? "").trim() || undefined;
  const accountLabel = String(formData.get("accountLabel") ?? "").trim() || undefined;

  if (intent === "preview") {
    try {
      const p = previewCsv(content.toString("utf8"), mapping);
      const rows = (p.rows as Array<Record<string, unknown>>).slice(0, 25).map(plain);
      return { preview: { kind: p.kind, headers: p.headers, columns: rows[0] ? Object.keys(rows[0]) : [], rows, errors: p.errors.slice(0, 50), total: p.total, skipped: p.skipped, valid: p.rows.length } };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  if (intent === "save_preset") {
    const name = presetName ?? `custom-${Date.now()}`;
    await db.csvMappingPreset.upsert({
      where: { organizationId_kind_name: { organizationId: auth.organizationId, kind: mapping.kind, name } },
      create: { organizationId: auth.organizationId, kind: mapping.kind, name, mapping: mapping as unknown as Prisma.InputJsonValue },
      update: { mapping: mapping as unknown as Prisma.InputJsonValue },
    });
    await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "import.preset_saved", metadata: { kind: mapping.kind, name } });
    return { error: `Preset "${name}" salvato.` };
  }

  try {
    const r = await commitCsvImport({ organizationId: auth.organizationId, userId: auth.userId, filename: file.name, content, mapping, presetName, provider, accountLabel });
    revalidatePath("/payments");
    revalidatePath("/shipping");
    return { result: { batchId: r.batchId, imported: r.imported, updated: r.updated, errors: r.errors.length, skipped: r.skipped, total: r.total } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
