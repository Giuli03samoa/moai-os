/**
 * Agent configuration. The Anthropic API key lives only in the server environment
 * (ANTHROPIC_API_KEY); nothing here is ever sent to the browser.
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const DEFAULT_MODEL = "claude-opus-5-5";

export function agentModel(): string {
  return process.env.AGENT_MODEL?.trim() || DEFAULT_MODEL;
}

export function agentEffort(): Effort {
  const e = process.env.AGENT_EFFORT?.trim();
  return e === "low" || e === "medium" || e === "high" || e === "xhigh" || e === "max" ? e : "medium";
}

/** Monthly spend cap in USD (API list prices). The agent refuses new turns once it is reached. */
export function agentMonthlyBudgetUsd(): number {
  const n = Number(process.env.AGENT_MONTHLY_BUDGET_USD ?? 60);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export function isAgentConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export class AgentNotConfiguredError extends Error {
  constructor() {
    super("Assistente non configurato: imposta ANTHROPIC_API_KEY nel file .env del server e riavvia MOAI OS.");
    this.name = "AgentNotConfiguredError";
  }
}

/** USD per million tokens (Anthropic list prices, cached 2026-10). Unknown models fall back to Opus 5.5. */
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

export function estimateCostUsd(model: string, u: Usage): number {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k)) ?? DEFAULT_MODEL;
  const p = PRICING[key]!;
  const cost = (u.input_tokens * p.input + u.output_tokens * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function sumUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  };
}

export const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
