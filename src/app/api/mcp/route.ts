import { rateLimit } from "@/server/rate-limit";
import { authenticateToken, handleMcpMessage, type JsonRpcRequest } from "@/server/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/** MCP endpoint (Streamable HTTP, stateless, JSON responses). Clients: Claude Code `claude mcp add --transport http`, Claude Desktop connectors. */
export async function POST(req: Request) {
  const principal = await authenticateToken(req.headers.get("authorization"));
  if (!principal) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }), { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } });
  const rl = rateLimit(`mcp:${principal.tokenId}`, 240, 60_000);
  if (!rl.ok) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Rate limited" } }), { status: 429, headers: { ...headers, "Retry-After": String(rl.retryAfterSec) } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers });
  }
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[];
  const responses = (await Promise.all(messages.map((m) => handleMcpMessage(principal, m)))).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(Array.isArray(body) ? responses : responses[0]), { status: 200, headers });
}

export async function GET() {
  return new Response(JSON.stringify({ error: "SSE stream not supported: use POST (stateless JSON)" }), { status: 405, headers: { ...headers, Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
