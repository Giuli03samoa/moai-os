import type { ConnectionStatus, IntegrationConnection, IntegrationProvider } from "@prisma/client";

/**
 * Every external system is a connector: an independent module with its own
 * configuration schema, credential verification, jobs, error handling and notes.
 * The UI renders connectors generically from these definitions; secrets never leave the server.
 */

export type FieldDef = {
  name: string;
  label: string;
  type: "text" | "password" | "select" | "checkbox" | "date";
  help?: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type VerifyResult = {
  status: ConnectionStatus;
  message: string;
  capabilities?: Record<string, boolean | string>;
  grantedScopes?: string[];
  blockedReason?: string | null;
};

export type ConnectorContext = {
  organizationId: string;
  connection: IntegrationConnection;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
  log: (line: string) => void;
};

export type JobDef = {
  type: string;
  label: string;
  description: string;
  /** true → the scheduler enqueues it periodically for CONNECTED connections. */
  scheduled: boolean;
  /** Payload used when the user clicks "Sincronizza ora". */
  manualPayload?: Record<string, unknown>;
};

export interface ConnectorDefinition {
  key: string;
  provider: IntegrationProvider;
  displayName: string;
  description: string;
  secretFields: FieldDef[];
  configFields: FieldDef[];
  jobs: JobDef[];
  /** Requirements, blockers and limits shown next to the connector in the UI and in docs. */
  notes: string[];
  verify(ctx: ConnectorContext): Promise<VerifyResult>;
}

export class ConnectorError extends Error {
  retryable: boolean;
  retryAfterMs?: number;
  httpStatus?: number;
  constructor(message: string, opts: { retryable?: boolean; retryAfterMs?: number; httpStatus?: number } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
    this.httpStatus = opts.httpStatus;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
}
