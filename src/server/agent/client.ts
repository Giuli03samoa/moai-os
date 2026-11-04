import Anthropic from "@anthropic-ai/sdk";
import { AgentNotConfiguredError, isAgentConfigured } from "./config";

let cached: Anthropic | null = null;

/** Server-only Anthropic client. Credentials come from ANTHROPIC_API_KEY; never from the database or the browser. */
export function anthropic(): Anthropic {
  if (!isAgentConfigured()) throw new AgentNotConfiguredError();
  if (!cached) cached = new Anthropic({ maxRetries: 2, timeout: 10 * 60_000 });
  return cached;
}

/** Maps SDK errors to a short Italian message safe to show in the UI (no secrets, no stack). */
export function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Chiave API Anthropic non valida o revocata.";
  if (e instanceof Anthropic.PermissionDeniedError) return "La chiave API non ha i permessi per questo modello.";
  if (e instanceof Anthropic.RateLimitError) return "Limite di richieste Anthropic raggiunto: riprova tra qualche secondo.";
  if (e instanceof Anthropic.BadRequestError) return `Richiesta non valida per l'API Anthropic: ${e.message.slice(0, 300)}`;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "Timeout nella connessione ad Anthropic.";
  if (e instanceof Anthropic.APIConnectionError) return "Impossibile raggiungere l'API Anthropic (rete).";
  if (e instanceof Anthropic.APIError) return `Errore API Anthropic ${e.status ?? ""}: ${e.message.slice(0, 300)}`;
  return (e as Error)?.message?.slice(0, 300) ?? "Errore sconosciuto";
}

export function isFallbackRejection(e: unknown): boolean {
  return e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message);
}
