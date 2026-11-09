import fs from "fs";
import path from "path";
import { timingSafeEqual } from "crypto";
import { audit } from "@/server/audit";
import { ingestInvoiceFile } from "@/server/invoices/archive";
import { InvoiceParseError } from "@/server/invoices/fatturapa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temporary bridge for importing invoice files collected in the browser (e.g. from Fatture e
 * Corrispettivi). Active only while .local/import-token exists and has not expired; the token is
 * single-purpose, created from the command line and deleted afterwards. Cross-origin calls are
 * accepted only from the Agenzia delle Entrate portal (CORS + Private Network Access preflight).
 */
const PORTAL_ORIGIN = "https://ivaservizi.agenziaentrate.gov.it";
function cors(req: Request): Record<string, string> {
  if (req.headers.get("origin") !== PORTAL_ORIGIN) return {};
  return { "Access-Control-Allow-Origin": PORTAL_ORIGIN, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type, x-import-token", "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600", Vary: "Origin" };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}
type TokenFile = { token: string; expiresAt: string; organizationId: string; userId: string };

function readToken(): TokenFile | null {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".local", "import-token"), "utf8")) as TokenFile;
    return new Date(t.expiresAt) > new Date() ? t : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const h = cors(req);
  const t = readToken();
  const given = req.headers.get("x-import-token") ?? "";
  if (!t || given.length !== t.token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(t.token))) return new Response("forbidden", { status: 403, headers: h });
  const body = (await req.json().catch(() => null)) as { files?: Array<{ name: string; b64: string; note?: string }> } | null;
  if (!body?.files?.length || body.files.length > 50) return new Response("bad request", { status: 400, headers: h });
  const results: Array<Record<string, unknown>> = [];
  for (const f of body.files) {
    const name = path.basename(String(f.name)).slice(0, 200);
    if (!/\.(xml|p7m)$/i.test(name)) { results.push({ name, ok: false, error: "estensione non ammessa" }); continue; }
    try {
      const r = await ingestInvoiceFile({ organizationId: t.organizationId, filename: name, content: Buffer.from(f.b64, "base64"), source: "XML_UPLOAD", userId: t.userId });
      results.push({ name, ok: true, duplicateFile: r.duplicateFile, invoices: r.invoices, warnings: r.warnings.slice(0, 5) });
    } catch (e) {
      results.push({ name, ok: false, error: e instanceof InvoiceParseError ? e.message : "errore interno" });
    }
  }
  await audit({ organizationId: t.organizationId, userId: t.userId, action: "invoice.import_bridge", metadata: { files: body.files.length, ok: results.filter((r) => r.ok).length } });
  return Response.json({ results }, { headers: h });
}
