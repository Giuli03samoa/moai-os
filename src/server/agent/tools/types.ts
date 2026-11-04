import type { Role } from "@prisma/client";
import type { z } from "zod/v4";

/**
 * A tool is a typed, audited capability the agent can call.
 *  read     → runs immediately (every role that passes minRole)
 *  write    → internal, reversible change inside MOAI OS; runs immediately and is audited
 *  approval → effect outside MOAI OS or on money/fiscal state: the call is recorded as a pending
 *             AgentApproval and only runs after a human with `minRole` approves it in the UI.
 * Irreversible operations (SdI, Shopify writes, payments, shipment creation) have no tool at all.
 */
export type ToolRisk = "read" | "write" | "approval";

export type ToolChannel = "web" | "mcp" | "system";

export type ToolContext = {
  organizationId: string;
  userId: string | null;
  role: Role;
  timezone: string;
  currency: string;
  conversationId?: string | null;
  runId?: string | null;
  channel: ToolChannel;
  log: (line: string) => void;
};

export interface AgentToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  risk: ToolRisk;
  minRole: Role;
  /** One human sentence: shown in the activity log and in approval cards. */
  summarize: (input: z.infer<S>) => string;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<unknown>;
}

export function defineTool<S extends z.ZodType>(def: AgentToolDef<S>): AgentToolDef<S> {
  return def;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, OPERATIONS: 1, ACCOUNTANT: 2, ADMIN: 3, OWNER: 4 };
export function roleAtLeast(role: Role, min: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Decimal/Date → JSON-friendly values, with the same precision rules as the UI. */
export function plain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (v && typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function" && (v as { constructor?: { name?: string } }).constructor?.name === "Decimal") return (v as { toFixed: (n: number) => string }).toFixed(2);
      return v;
    }),
  ) as T;
}
