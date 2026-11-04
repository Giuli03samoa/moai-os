import type { Role } from "@prisma/client";
import { db } from "../db";
import { sha256Hex } from "../crypto";
import { executeToolCall, jsonSchemaOf, toolsForContext } from "../agent/tools/registry";
import type { ToolContext } from "../agent/tools/types";

/**
 * Minimal MCP server (JSON-RPC 2.0 over Streamable HTTP, stateless) exposing MOAI OS READ tools to
 * external agents such as Claude Desktop or Claude Code. No SDK dependency: three methods matter
 * (initialize, tools/list, tools/call). Auth: Bearer API token created in Settings; the token is
 * stored hashed and bound to a user, whose role bounds what the tools may read. Writes are never exposed.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export type McpPrincipal = { organizationId: string; userId: string; role: Role; timezone: string; currency: string; tokenId: string };

export async function authenticateToken(authorization: string | null): Promise<McpPrincipal | null> {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!m) return null;
  const token = await db.apiToken.findUnique({ where: { tokenHash: sha256Hex(m[1]!.trim()) }, include: { organization: true } });
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < new Date()) || token.organization.deletedAt) return null;
  const membership = await db.membership.findUnique({ where: { userId_organizationId: { userId: token.userId, organizationId: token.organizationId } }, include: { user: true } });
  if (!membership || membership.user.deletedAt) return null;
  await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { organizationId: token.organizationId, userId: token.userId, role: membership.role, timezone: token.organization.timezone, currency: token.organization.baseCurrency, tokenId: token.id };
}

export function mcpToolList(role: Role) {
  return toolsForContext({ role, channel: "mcp" })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchemaOf(t.schema) }));
}

type Deps = { runTool?: (ctx: ToolContext, name: string, input: unknown) => ReturnType<typeof executeToolCall> };

/** Dispatches one JSON-RPC message. Notifications (no id) return null. */
export async function handleMcpMessage(p: McpPrincipal, msg: JsonRpcRequest, deps: Deps = {}): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string, data?: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message, data } });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid Request");
  if (msg.method.startsWith("notifications/")) return null;
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "moai-os", version: "2.0.0" }, instructions: "MOAI OS: dati operativi di MOAI Athletics in sola lettura (ordini, pagamenti, fatture, spedizioni, prodotti, marketing, design, produzione). I numeri vanno citati con fonte e aggiornamento; pagamenti e payout non sono ricavi aggiuntivi." });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: mcpToolList(p.role) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments as unknown) ?? {};
      const allowed = toolsForContext({ role: p.role, channel: "mcp" }).some((t) => t.name === name);
      if (!allowed) return fail(-32602, `Unknown or not permitted tool: ${name}`);
      const ctx: ToolContext = { organizationId: p.organizationId, userId: p.userId, role: p.role, timezone: p.timezone, currency: p.currency, channel: "mcp", log: () => {} };
      const outcome = await (deps.runTool ?? executeToolCall)(ctx, name, args);
      if (outcome.kind === "result") return reply({ content: [{ type: "text", text: JSON.stringify(outcome.result ?? null) }], isError: false });
      if (outcome.kind === "approval") return reply({ content: [{ type: "text", text: "Operazione non disponibile via MCP" }], isError: true });
      return reply({ content: [{ type: "text", text: outcome.error }], isError: true });
    }
    case "resources/list":
    case "prompts/list":
      return reply(msg.method === "resources/list" ? { resources: [] } : { prompts: [] });
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}
