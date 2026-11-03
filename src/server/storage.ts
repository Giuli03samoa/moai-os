import fs from "fs/promises";
import path from "path";
import type { DocumentKind } from "@prisma/client";
import { db } from "./db";
import { sha256Hex } from "./crypto";

/**
 * Private document storage. Files are never served from a public path: they are read
 * back only through authenticated, organization-scoped server code.
 * Driver "local" is for development / a single VM with an encrypted EU volume.
 * For object storage implement the same three functions against an EU S3-compatible bucket
 * with server-side encryption and no public ACLs.
 */
function root() {
  return path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage");
}

function resolveKey(key: string) {
  if (!/^[a-z0-9]+\/[a-f0-9]{64}$/i.test(key)) throw new Error("Invalid storage key");
  return path.join(root(), key);
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function storeDocument(args: {
  organizationId: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  content: Buffer;
  uploadedById?: string | null;
}) {
  if (args.content.length > MAX_UPLOAD_BYTES) throw new Error("File troppo grande (max 10 MB)");
  const sha256 = sha256Hex(args.content);
  const existing = await db.document.findUnique({
    where: { organizationId_sha256: { organizationId: args.organizationId, sha256 } },
  });
  if (existing) return { document: existing, duplicate: true };
  const storageKey = `${args.organizationId}/${sha256}`;
  const full = resolveKey(storageKey);
  await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await fs.writeFile(full, args.content, { mode: 0o600 });
  const document = await db.document.create({
    data: {
      organizationId: args.organizationId,
      kind: args.kind,
      storageKey,
      filename: sanitizeFilename(args.filename),
      mimeType: args.mimeType,
      size: args.content.length,
      sha256,
      uploadedById: args.uploadedById ?? null,
    },
  });
  return { document, duplicate: false };
}

export async function readDocument(organizationId: string, documentId: string): Promise<{ filename: string; mimeType: string; content: Buffer }> {
  const doc = await db.document.findFirst({ where: { id: documentId, organizationId } });
  if (!doc) throw new Error("Documento non trovato");
  return { filename: doc.filename, mimeType: doc.mimeType, content: await fs.readFile(resolveKey(doc.storageKey)) };
}

export function sanitizeFilename(name: string) {
  return path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200) || "file";
}
