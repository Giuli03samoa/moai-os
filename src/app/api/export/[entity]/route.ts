import { requireAuth } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { exportEntity, type ExportEntity } from "@/server/export/csv";
import { resolvePeriod } from "@/lib/periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTITIES: ExportEntity[] = ["orders", "payments", "payouts", "invoices", "shipments", "reconciliations", "bank"];

export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const auth = await requireAuth("VIEWER");
  const { entity } = await params;
  if (!ENTITIES.includes(entity as ExportEntity)) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const range = resolvePeriod({ period: url.searchParams.get("period") ?? undefined, from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }, auth.timezone);
  const { filename, csv } = await exportEntity(auth.organizationId, entity as ExportEntity, range);
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "export.csv", metadata: { entity, from: range.from, to: range.to } });
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
