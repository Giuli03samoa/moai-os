import { requireAuth } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { readDocument } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Downloads an archived document (XML/P7M/CSV). Organization-scoped; never a public URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("VIEWER");
  const { id } = await params;
  try {
    const doc = await readDocument(auth.organizationId, id);
    await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "document.download", entityType: "Document", entityId: id });
    return new Response(new Uint8Array(doc.content), {
      headers: { "Content-Type": doc.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${doc.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
