import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma, Role } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";
import { redact } from "../crypto";
import { anthropic, describeApiError, isFallbackRejection } from "./client";
import { agentEffort, agentModel, agentMonthlyBudgetUsd, EMPTY_USAGE, estimateCostUsd, isAgentConfigured, sumUsage, type Usage } from "./config";
import { buildSystemPrompt } from "./prompt";
import { executeToolCall, toApiTools, toolsForContext } from "./tools/registry";
import type { ToolContext } from "./tools/types";

export type AgentAuth = { userId: string; organizationId: string; role: Role; name: string; timezone: string; currency: string; orgName: string };

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; approvalId?: string }
  | { type: "done"; runId: string; costUsd: number; usage: Usage; model: string }
  | { type: "error"; message: string };

const MAX_ITERATIONS = 14;
const MAX_TOKENS = 16000;
const BETAS = ["server-side-fallback-2026-07-01", "compact-2026-01-12"];
const running = new Set<string>();

export async function monthSpendUsd(organizationId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = await db.agentRun.aggregate({ where: { organizationId, startedAt: { gte: start } }, _sum: { costUsd: true } });
  return Number(r._sum.costUsd ?? 0);
}

function contextMessage(auth: AgentAuth): Anthropic.Beta.BetaMessageParam {
  const now = new TZDate(Date.now(), auth.timezone);
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return { role: "system", content: `Contesto turno — data e ora locali: ${stamp} (${auth.timezone}); utente: ${auth.name} (ruolo ${auth.role}); DEMO_MODE=${process.env.DEMO_MODE === "true"}.` };
}

function textOf(content: Anthropic.Beta.BetaContentBlock[] | Anthropic.Beta.BetaContentBlockParam[]): string {
  return content.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n").trim();
}

/**
 * One assistant turn: persist the user message, loop model ↔ tools until end_turn, persist every
 * block verbatim (thinking signatures, compaction blocks) so the history stays append-only and
 * the prompt cache keeps working. Events stream to the UI.
 */
export async function runAgentTurn(args: { auth: AgentAuth; conversationId: string; userText: string; onEvent: (e: AgentEvent) => void; signal?: AbortSignal }): Promise<void> {
  const { auth, conversationId, onEvent } = args;
  if (!isAgentConfigured()) {
    onEvent({ type: "error", message: "Assistente non configurato: imposta ANTHROPIC_API_KEY nel file .env del server e riavvia MOAI OS." });
    return;
  }
  if (running.has(conversationId)) {
    onEvent({ type: "error", message: "C'è già una risposta in corso in questa conversazione." });
    return;
  }
  running.add(conversationId);
  const model = agentModel();
  let run: { id: string } | null = null;
  try {
    const conv = await db.agentConversation.findFirst({ where: { id: conversationId, organizationId: auth.organizationId } });
    if (!conv) throw new Error("Conversazione non trovata");
    const spent = await monthSpendUsd(auth.organizationId);
    const budget = agentMonthlyBudgetUsd();
    if (spent >= budget) {
      onEvent({ type: "error", message: `Budget mensile dell'assistente esaurito (${spent.toFixed(2)} / ${budget} USD). Alza AGENT_MONTHLY_BUDGET_USD o attendi il mese prossimo.` });
      return;
    }

    const stored = await db.agentMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
    const history: Anthropic.Beta.BetaMessageParam[] = stored.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content as unknown as Anthropic.Beta.BetaContentBlockParam[] }) as Anthropic.Beta.BetaMessageParam);

    const userMsg: Anthropic.Beta.BetaMessageParam = { role: "user", content: [{ type: "text", text: args.userText }] };
    const ctxMsg = contextMessage(auth);
    history.push(userMsg, ctxMsg);
    await db.agentMessage.createMany({
      data: [
        { organizationId: auth.organizationId, conversationId, role: "user", content: userMsg.content as unknown as Prisma.InputJsonValue, text: args.userText.slice(0, 500) },
        { organizationId: auth.organizationId, conversationId, role: "system", content: ctxMsg.content as unknown as Prisma.InputJsonValue, text: null },
      ],
    });
    if (stored.length === 0) await db.agentConversation.update({ where: { id: conversationId }, data: { title: args.userText.replace(/\s+/g, " ").slice(0, 70) } });

    run = await db.agentRun.create({ data: { organizationId: auth.organizationId, conversationId, userId: auth.userId, kind: "CHAT", model } });
    const runId = run.id;
    const log: string[] = [];
    const toolCtx: ToolContext = { organizationId: auth.organizationId, userId: auth.userId, role: auth.role, timezone: auth.timezone, currency: auth.currency, conversationId, runId, channel: "web", log: (l) => log.push(redact(l)) };
    const tools = toApiTools(toolsForContext({ role: auth.role, channel: "web" }));
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: buildSystemPrompt({ name: auth.orgName, timezone: auth.timezone, currency: auth.currency }), cache_control: { type: "ephemeral" } }];

    let usage: Usage = EMPTY_USAGE;
    let apiCalls = 0;
    let toolCalls = 0;
    let servedModel = model;
    let stopReason: string | null = null;
    let refusalCategory: string | null = null;
    let allowFallbacks = true;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (args.signal?.aborted) break;
      const client = anthropic();
      const params: Parameters<Anthropic["beta"]["messages"]["stream"]>[0] = {
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages: history,
        output_config: { effort: agentEffort() },
        context_management: { edits: [{ type: "compact_20260112" }] },
        cache_control: { type: "ephemeral" },
        betas: BETAS,
        ...(allowFallbacks ? { fallbacks: "default" as const } : {}),
      };
      let final: Anthropic.Beta.BetaMessage;
      try {
        const stream = client.beta.messages.stream(params, { signal: args.signal });
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onEvent({ type: "text_delta", text: ev.delta.text });
          else if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") onEvent({ type: "tool_start", id: ev.content_block.id, name: ev.content_block.name });
        }
        final = await stream.finalMessage();
      } catch (e) {
        if (allowFallbacks && isFallbackRejection(e)) {
          allowFallbacks = false;
          onEvent({ type: "status", text: "Fallback server-side non disponibile per questo account: riprovo senza." });
          continue;
        }
        throw e;
      }
      apiCalls++;
      usage = sumUsage(usage, final.usage);
      servedModel = final.model || model;
      stopReason = final.stop_reason;
      await db.agentMessage.create({ data: { organizationId: auth.organizationId, conversationId, role: "assistant", content: final.content as unknown as Prisma.InputJsonValue, text: textOf(final.content).slice(0, 2000) || null, runId } });
      history.push({ role: "assistant", content: final.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });

      if (final.stop_reason === "refusal") {
        refusalCategory = final.stop_details?.category ?? null;
        onEvent({ type: "error", message: `La richiesta è stata rifiutata dai sistemi di sicurezza del modello${refusalCategory ? ` (categoria ${refusalCategory})` : ""}. Riformula la domanda.` });
        break;
      }
      if (final.stop_reason === "compaction") {
        onEvent({ type: "status", text: "Conversazione compattata dal server per restare nel contesto." });
        continue;
      }
      if (final.stop_reason === "max_tokens") {
        onEvent({ type: "status", text: "Risposta troncata per lunghezza: chiedi di continuare." });
        break;
      }
      if (final.stop_reason !== "tool_use") break;

      const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        toolCalls++;
        const outcome = await executeToolCall(toolCtx, tu.name, tu.input);
        if (outcome.kind === "result") {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(outcome.result ?? null).slice(0, 60_000) });
          onEvent({ type: "tool_result", id: tu.id, name: tu.name, ok: true, summary: outcome.summary });
        } else if (outcome.kind === "approval") {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ status: "PENDING_APPROVAL", approvalId: outcome.approvalId, requiredRole: outcome.requiredRole, summary: outcome.summary, note: "Verrà eseguito solo dopo l'approvazione di una persona in Assistente → Approvazioni. Informa l'utente e non darlo per fatto." }) });
          onEvent({ type: "tool_result", id: tu.id, name: tu.name, ok: true, summary: `In attesa di approvazione: ${outcome.summary}`, approvalId: outcome.approvalId });
        } else {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: outcome.error }), is_error: true });
          onEvent({ type: "tool_result", id: tu.id, name: tu.name, ok: false, summary: outcome.error.slice(0, 200) });
        }
      }
      const resultMsg: Anthropic.Beta.BetaMessageParam = { role: "user", content: results };
      history.push(resultMsg);
      await db.agentMessage.create({ data: { organizationId: auth.organizationId, conversationId, role: "user", content: results as unknown as Prisma.InputJsonValue, text: null, runId } });
    }

    const costUsd = estimateCostUsd(servedModel, usage);
    await db.agentRun.update({ where: { id: runId }, data: { status: stopReason === "refusal" ? "REFUSED" : "SUCCEEDED", model: servedModel, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0, costUsd, apiCalls, toolCalls, stopReason, refusalCategory, finishedAt: new Date() } });
    await db.agentConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
    onEvent({ type: "done", runId, costUsd, usage, model: servedModel });
  } catch (e) {
    const message = describeApiError(e);
    if (run) await db.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: redact(message), finishedAt: new Date() } }).catch(() => {});
    onEvent({ type: "error", message });
  } finally {
    running.delete(conversationId);
  }
}

/** Non-streaming one-shot completion for background jobs (briefing). Tracked as an AgentRun. */
export async function completeOnce(args: { organizationId: string; kind: "BRIEFING" | "MONITOR" | "DESIGN"; system: string; user: string; maxTokens?: number; effort?: "low" | "medium" | "high" }): Promise<{ text: string; runId: string; costUsd: number }> {
  const model = agentModel();
  const run = await db.agentRun.create({ data: { organizationId: args.organizationId, kind: args.kind, model } });
  try {
    const client = anthropic();
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({ model, max_tokens: args.maxTokens ?? 3000, system: args.system, messages: [{ role: "user", content: args.user }], output_config: { effort: args.effort ?? "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      if (!isFallbackRejection(e)) throw e;
      res = await client.beta.messages.create({ model, max_tokens: args.maxTokens ?? 3000, system: args.system, messages: [{ role: "user", content: args.user }], output_config: { effort: args.effort ?? "low" } });
    }
    const text = textOf(res.content);
    const costUsd = estimateCostUsd(res.model || model, res.usage);
    await db.agentRun.update({ where: { id: run.id }, data: { status: res.stop_reason === "refusal" ? "REFUSED" : "SUCCEEDED", model: res.model || model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, cacheReadTokens: res.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0, costUsd, apiCalls: 1, stopReason: res.stop_reason, refusalCategory: res.stop_details?.category ?? null, finishedAt: new Date() } });
    if (res.stop_reason === "refusal") throw new Error("Il modello ha rifiutato la richiesta");
    return { text, runId: run.id, costUsd };
  } catch (e) {
    await db.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: redact(describeApiError(e)), finishedAt: new Date() } }).catch(() => {});
    throw e;
  }
}
