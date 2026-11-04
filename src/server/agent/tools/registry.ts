import { z } from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db";
import { audit } from "../../audit";
import { redact } from "../../crypto";
import { READ_TOOLS } from "./read";
import { WRITE_TOOLS } from "./write";
import { DESIGN_TOOLS } from "./design";
import { APPROVAL_TOOLS } from "./approval";
import { roleAtLeast, ToolError, type AgentToolDef, type ToolChannel, type ToolContext } from "./types";

export const ALL_TOOLS: AgentToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS, ...DESIGN_TOOLS, ...APPROVAL_TOOLS] as AgentToolDef[];

const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));
if (BY_NAME.size !== ALL_TOOLS.length) throw new Error("Nomi di tool duplicati");

export function getTool(name: string): AgentToolDef | undefined {
  return BY_NAME.get(name);
}

/**
 * Tools visible to a given context. Over MCP only read tools are exposed (external clients never
 * change data). In the web chat, read/write tools require the user's role; approval tools are always
 * listed because the role check happens when a human approves.
 */
export function toolsForContext(opts: { role: ToolContext["role"]; channel: ToolChannel }): AgentToolDef[] {
  return ALL_TOOLS.filter((t) => {
    if (opts.channel === "mcp") return t.risk === "read" && roleAtLeast(opts.role, t.minRole);
    if (t.risk === "approval") return true;
    return roleAtLeast(opts.role, t.minRole);
  });
}

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  if (js.type !== "object") return { type: "object", properties: {}, additionalProperties: false };
  if (!js.properties) js.properties = {};
  return js;
}

export function toApiTools(tools: AgentToolDef[]): Anthropic.Beta.BetaTool[] {
  // Deterministic order keeps the prompt-cache prefix stable across requests.
  return [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchemaOf(t.schema) as Anthropic.Beta.BetaTool.InputSchema }));
}

export type ToolOutcome =
  | { kind: "result"; result: unknown; summary: string }
  | { kind: "approval"; approvalId: string; summary: string; requiredRole: string }
  | { kind: "error"; error: string; summary?: string };

const APPROVAL_TTL_MS = 7 * 86_400_000;

/** Validates, authorises, executes (or parks for approval) one tool call. Never throws. */
export async function executeToolCall(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  const tool = getTool(name);
  if (!tool) return { kind: "error", error: `Tool sconosciuto: ${name}` };
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) return { kind: "error", error: `Input non valido per ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` };
  const input = parsed.data;
  let summary: string;
  try {
    summary = tool.summarize(input);
  } catch {
    summary = name;
  }
  if (tool.risk === "approval") {
    if (ctx.channel === "mcp") return { kind: "error", error: "Operazione non disponibile via MCP" };
    const approval = await db.agentApproval.create({
      data: { organizationId: ctx.organizationId, conversationId: ctx.conversationId ?? null, runId: ctx.runId ?? null, toolName: name, input: input as object, summary, requiredRole: tool.minRole, requestedById: ctx.userId, expiresAt: new Date(Date.now() + APPROVAL_TTL_MS) },
    });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "agent.approval.request", entityType: "AgentApproval", entityId: approval.id, metadata: { tool: name, summary } });
    ctx.log(`Approvazione richiesta: ${summary}`);
    return { kind: "approval", approvalId: approval.id, summary, requiredRole: tool.minRole };
  }
  if (!roleAtLeast(ctx.role, tool.minRole)) return { kind: "error", error: `Permesso negato: ${name} richiede il ruolo ${tool.minRole} (utente ${ctx.role})`, summary };
  try {
    const result = await tool.run(ctx, input);
    if (tool.risk === "write" || ctx.channel === "mcp") {
      await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: `agent.tool.${tool.risk}`, metadata: { tool: name, summary, channel: ctx.channel, conversationId: ctx.conversationId ?? null } });
    }
    ctx.log(`${tool.risk === "read" ? "Letto" : "Eseguito"}: ${summary}`);
    return { kind: "result", result, summary };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : redact((e as Error).message ?? "errore");
    ctx.log(`Errore in ${name}: ${msg}`);
    return { kind: "error", error: msg.slice(0, 1000), summary };
  }
}

/** Runs an already-approved tool with the approver's identity (no second approval round). */
export async function runApprovedTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const tool = getTool(name);
  if (!tool || tool.risk !== "approval") throw new ToolError("Tool non approvabile");
  if (!roleAtLeast(ctx.role, tool.minRole)) throw new ToolError(`Per approvare serve il ruolo ${tool.minRole}`);
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) throw new ToolError("Input dell'approvazione non più valido");
  return tool.run(ctx, parsed.data);
}

export function toolCatalog() {
  return ALL_TOOLS.map((t) => ({ name: t.name, risk: t.risk, minRole: t.minRole, description: t.description }));
}
