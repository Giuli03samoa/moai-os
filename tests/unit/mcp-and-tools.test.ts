import { describe, expect, it } from "vitest";
import { handleMcpMessage, mcpToolList, type McpPrincipal } from "@/server/mcp/server";
import { ALL_TOOLS, jsonSchemaOf, toApiTools, toolsForContext } from "@/server/agent/tools/registry";

const principal: McpPrincipal = { organizationId: "org", userId: "u", role: "VIEWER", timezone: "Europe/Rome", currency: "EUR", tokenId: "t" };

describe("tool registry", () => {
  it("has unique names and valid JSON schemas", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of toApiTools(ALL_TOOLS)) {
      expect(t.input_schema.type).toBe("object");
      expect((t.input_schema as { $schema?: string }).$schema).toBeUndefined();
    }
  });
  it("exposes only read tools over MCP and hides privileged tools from low roles", () => {
    const mcp = toolsForContext({ role: "VIEWER", channel: "mcp" });
    expect(mcp.every((t) => t.risk === "read")).toBe(true);
    expect(mcp.some((t) => t.name === "get_audit_recent")).toBe(false);
    expect(toolsForContext({ role: "ADMIN", channel: "mcp" }).some((t) => t.name === "get_audit_recent")).toBe(true);
    const web = toolsForContext({ role: "VIEWER", channel: "web" });
    expect(web.some((t) => t.name === "create_task")).toBe(false);
    expect(web.some((t) => t.risk === "approval")).toBe(true);
  });
  it("never defines a tool that writes to external systems", () => {
    const forbidden = /shopify_(write|update|create)|send_sdi|refund|create_shipment|pay_/i;
    expect(ALL_TOOLS.some((t) => forbidden.test(t.name))).toBe(false);
    expect(ALL_TOOLS.filter((t) => t.risk === "approval").map((t) => t.name).sort()).toEqual(["decide_reconciliation", "mark_installment_paid", "send_telegram_message", "update_shipment"]);
  });
  it("jsonSchemaOf strips $schema and keeps required/optional", () => {
    const tool = ALL_TOOLS.find((t) => t.name === "create_task")!;
    const js = jsonSchemaOf(tool.schema) as { required?: string[]; properties: Record<string, unknown> };
    expect(js.required).toEqual(["title"]);
    expect(Object.keys(js.properties)).toContain("dueAt");
  });
});

describe("MCP JSON-RPC", () => {
  it("answers initialize, ping and tools/list", async () => {
    const init = await handleMcpMessage(principal, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect((init?.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    expect(await handleMcpMessage(principal, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await handleMcpMessage(principal, { jsonrpc: "2.0", id: 2, method: "ping" }))?.result).toEqual({});
    const list = await handleMcpMessage(principal, { jsonrpc: "2.0", id: 3, method: "tools/list" });
    const tools = (list?.result as { tools: Array<{ name: string; inputSchema: object }> }).tools;
    expect(tools.length).toBe(mcpToolList("VIEWER").length);
    expect(tools.every((t) => typeof t.inputSchema === "object")).toBe(true);
  });
  it("routes tools/call through the injected runner and rejects unknown tools", async () => {
    const r = await handleMcpMessage(principal, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_skills", arguments: {} } }, { runTool: async () => ({ kind: "result", result: [{ name: "x" }], summary: "s" }) });
    expect((r?.result as { isError: boolean; content: Array<{ text: string }> }).isError).toBe(false);
    expect((r?.result as { content: Array<{ text: string }> }).content[0]!.text).toContain("x");
    const bad = await handleMcpMessage(principal, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "create_task", arguments: {} } });
    expect(bad?.error?.code).toBe(-32602);
    const unknown = await handleMcpMessage(principal, { jsonrpc: "2.0", id: 6, method: "nope" });
    expect(unknown?.error?.code).toBe(-32601);
  });
});
