import { requireAuth } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { annualDetail, detailCsv } from "@/server/reports/annual-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every revenue and cost line of one year, for the accountant. */
export async function GET(req: Request) {
  const auth = await requireAuth("VIEWER");
  const anno = Number(new URL(req.url).searchParams.get("anno"));
  const year = Number.isInteger(anno) && anno >= 2024 && anno <= 2100 ? anno : new Date().getFullYear();
  const csv = detailCsv(await annualDetail(auth.organizationId, year));
  await audit({ organizationId: auth.organizationId, userId: auth.userId, action: "export.csv", metadata: { entity: "conti", year } });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="MOAI-conti-${year}.csv"`, "Cache-Control": "no-store" } });
}
