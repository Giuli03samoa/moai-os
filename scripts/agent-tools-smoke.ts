/**
 * Collaudo del layer strumenti dell'assistente SENZA modello: esegue una serie di tool reali
 * contro il database corrente a nome di un utente e stampa esito e anteprima.
 *   npx tsx scripts/agent-tools-smoke.ts --user owner@moai.it
 * Non lascia tracce: il task e l'approvazione di prova vengono rimossi alla fine.
 */
import { PrismaClient } from "@prisma/client";
import { executeToolCall, toApiTools, toolsForContext } from "../src/server/agent/tools/registry";
import type { ToolContext } from "../src/server/agent/tools/types";

const db = new PrismaClient();
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? ""] : [])).filter((x) => x.length));

async function main() {
  const email = String(args.user ?? "").toLowerCase();
  if (!email) throw new Error("--user <email> obbligatorio");
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const membership = await db.membership.findFirstOrThrow({ where: { userId: user.id }, include: { organization: true } });
  const org = membership.organization;
  const ctx: ToolContext = { organizationId: org.id, userId: user.id, role: membership.role, timezone: org.timezone, currency: org.baseCurrency, channel: "web", log: () => {} };
  const web = toolsForContext({ role: membership.role, channel: "web" });
  console.log(`Utente ${email} (${membership.role}) su ${org.name}: ${web.length} tool visibili in chat, ${toolsForContext({ role: membership.role, channel: "mcp" }).length} via MCP, ${toApiTools(web).length} definizioni API generate.`);
  const calls: Array<[string, unknown]> = [
    ["get_business_overview", { period: "30d" }],
    ["search_orders", { status: "UNFULFILLED", limit: 3 }],
    ["list_invoices", { overdueOnly: true }],
    ["list_products", { lowStockThreshold: 0, limit: 3 }],
    ["get_pnl_estimate", { period: "last_month" }],
    ["get_integrations_status", {}],
    ["list_alerts", {}],
    ["get_marketing_overview", {}],
    ["list_design_projects", {}],
    ["load_skill", { name: "sketch-svg" }],
    ["remember", { key: "collaudo-smoke", content: "Fatto di prova del collaudo tool", category: "general" }],
    ["search_memory", { query: "collaudo" }],
    ["forget", { key: "collaudo-smoke" }],
    ["create_task", { title: "Task di prova (collaudo tool)", priority: "LOW" }],
    ["decide_reconciliation", { id: "nope", decision: "REJECT", reason: "collaudo approvazione" }],
    ["get_order", { name: "#1015" }],
    ["tool_inesistente", {}],
    ["search_orders", { limit: 999 }],
  ];
  for (const [name, input] of calls) {
    const r = await executeToolCall(ctx, name, input);
    const preview = r.kind === "result" ? JSON.stringify(r.result).slice(0, 150) : r.kind === "approval" ? `APPROVAL ${r.approvalId} (ruolo ${r.requiredRole}) ${r.summary}` : `ERROR ${r.error.slice(0, 140)}`;
    console.log(`${name.padEnd(24)} ${r.kind.padEnd(9)} ${preview}`);
  }
  await db.task.deleteMany({ where: { organizationId: org.id, title: "Task di prova (collaudo tool)" } });
  await db.agentApproval.deleteMany({ where: { organizationId: org.id, toolName: "decide_reconciliation", summary: { contains: "collaudo approvazione" } } });
  await db.auditLog.deleteMany({ where: { organizationId: org.id, userId: user.id, action: { startsWith: "agent." }, metadata: { path: ["summary"], string_contains: "collaudo" } } });
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => db.$disconnect());
