import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db";
import { readDocument } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a design asset for <img>. Inline SVGs get a locked-down CSP (no scripts, no network);
 * uploaded references are streamed from private storage with their stored MIME type.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("VIEWER");
  const { id } = await params;
  const asset = await db.designAsset.findFirst({ where: { id: id.replace(/\.svg$/, ""), organizationId: auth.organizationId } });
  if (!asset) return new Response("not found", { status: 404 });
  if (asset.svg) {
    return new Response(asset.svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${asset.title.replace(/[^A-Za-z0-9._-]/g, "_")}.svg"`, "Cache-Control": "private, max-age=300" } });
  }
  if (asset.documentId) {
    try {
      const doc = await readDocument(auth.organizationId, asset.documentId);
      const safe = /^image\/(png|jpeg|webp|gif)$|^application\/pdf$/.test(doc.mimeType) ? doc.mimeType : "application/octet-stream";
      return new Response(new Uint8Array(doc.content), { headers: { "Content-Type": safe, "X-Content-Type-Options": "nosniff", "Content-Disposition": `${safe === "application/octet-stream" ? "attachment" : "inline"}; filename="${doc.filename}"`, "Cache-Control": "private, max-age=300" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }
  return new Response("not found", { status: 404 });
}
