import Link from "next/link";
import { requireAuth, hasRole } from "@/server/auth/session";
import { db } from "@/server/db";
import { agentModel, agentMonthlyBudgetUsd, isAgentConfigured } from "@/server/agent/config";
import { monthSpendUsd } from "@/server/agent/engine";
import { archiveConversationAction, decideApprovalAction, newConversationAction } from "@/server/actions/agent";
import { Plus, Sparkles } from "lucide-react";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Card, CardContent, CardHeader, CardTitle, Notice, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Chat, type ChatMessage } from "./chat";
import { SUGGESTIONS } from "./suggestions";

type Block = { type: string; text?: string; name?: string; id?: string; tool_use_id?: string; is_error?: boolean; content?: unknown };

function toChatMessages(rows: Array<{ id: string; role: string; content: unknown }>): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const r of rows) {
    const blocks = (Array.isArray(r.content) ? r.content : []) as Block[];
    if (r.role === "system") continue;
    if (r.role === "user") {
      if (blocks.every((b) => b.type === "tool_result")) {
        // attach results to the previous assistant message
        const prev = out[out.length - 1];
        if (prev?.role === "assistant") {
          for (const b of blocks) {
            const t = prev.tools.find((x) => x.id === b.tool_use_id);
            if (t) {
              t.ok = !b.is_error;
              try {
                const parsed = typeof b.content === "string" ? (JSON.parse(b.content) as { status?: string; approvalId?: string; error?: string }) : null;
                if (parsed?.status === "PENDING_APPROVAL") t.approvalId = parsed.approvalId;
                if (parsed?.error) t.summary = parsed.error.slice(0, 160);
              } catch {}
            }
          }
        }
        continue;
      }
      const text = blocks.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n").trim();
      out.push({ id: r.id, role: text.startsWith("[Esito approvazione]") ? "note" : "user", text, tools: [] });
    } else {
      const text = blocks.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n").trim();
      const tools = blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id ?? "", name: b.name ?? "" }));
      const prev = out[out.length - 1];
      if (prev?.role === "assistant" && !prev.text && !text && tools.length) {
        prev.tools.push(...tools);
        continue;
      }
      if (prev?.role === "assistant" && prev.tools.length && !prev.text) {
        prev.text = text;
        prev.tools.push(...tools);
        continue;
      }
      out.push({ id: r.id, role: "assistant", text, tools });
    }
  }
  return out;
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; notice?: string }> }) {
  const auth = await requireAuth();
  const sp = await searchParams;
  const configured = isAgentConfigured();
  const [conversations, spent] = await Promise.all([
    db.agentConversation.findMany({ where: { organizationId: auth.organizationId, userId: auth.userId, archivedAt: null }, orderBy: { lastMessageAt: "desc" }, take: 30 }),
    monthSpendUsd(auth.organizationId),
  ]);
  const current = sp.c ? conversations.find((c) => c.id === sp.c) ?? (await db.agentConversation.findFirst({ where: { id: sp.c, organizationId: auth.organizationId, userId: auth.userId } })) : null;
  const [rows, approvals] = current
    ? await Promise.all([
        db.agentMessage.findMany({ where: { conversationId: current.id }, orderBy: { createdAt: "asc" } }),
        db.agentApproval.findMany({ where: { conversationId: current.id, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
      ])
    : [[], []];
  const canApprove = hasRole(auth.role, "OPERATIONS");
  const budget = agentMonthlyBudgetUsd();
  return (
    <div>
      <PageHeader title="Assistente" subtitle={`Il tuo assistente operativo su MOAI OS. Modello ${agentModel()} · speso questo mese ${spent.toFixed(2)} / ${budget} USD.`} actions={<><Button asChild variant="ghost" size="sm"><Link href="/assistant/approvals">Approvazioni</Link></Button><Button asChild variant="ghost" size="sm"><Link href="/assistant/memory">Memoria</Link></Button><form action={newConversationAction}><Button type="submit" size="sm">Nuova conversazione</Button></form></>} />
      {sp.notice ? <div className="mb-4"><Notice tone="ok">{sp.notice}</Notice></div> : null}
      {!configured ? <div className="mb-4"><Notice tone="warn">L&apos;assistente non è configurato: aggiungi <code>ANTHROPIC_API_KEY</code> al file <code>.env</code> del server (chiave da console.anthropic.com) e riavvia. Il resto di MOAI OS funziona comunque.</Notice></div> : null}
      <div className="grid gap-5 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_290px]">
        <aside className="surface flex max-h-[calc(100vh-13rem)] flex-col rounded-[18px] border border-[var(--hairline)] p-2 lg:sticky lg:top-24">
          <form action={newConversationAction} className="p-1"><Button type="submit" variant="secondary" size="sm" className="w-full justify-start"><Plus /> Nuova conversazione</Button></form>
          <p className="px-3 pb-1 pt-3 text-[11px] font-medium text-space">Conversazioni</p>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {conversations.length === 0 ? <p className="px-3 py-2 text-xs text-graphite">Nessuna conversazione.</p> : null}
            {conversations.map((c) => (
              <Link key={c.id} href={`/assistant?c=${c.id}`} className={cn("rounded-xl px-3 py-2 text-sm transition-colors", current?.id === c.id ? "bg-blackout text-crocus" : "text-blackout hover:bg-cloud")}>
                <span className="block truncate">{c.title}</span>
                <span className={cn("block text-[10px]", current?.id === c.id ? "text-crocus/60" : "text-space")}>{fmtRelative(c.lastMessageAt)}</span>
              </Link>
            ))}
          </div>
          {current ? <form action={archiveConversationAction} className="border-t border-smoke px-3 pb-1 pt-2"><input type="hidden" name="id" value={current.id} /><button className="text-xs text-graphite underline-offset-4 hover:text-blackout hover:underline">Archivia questa conversazione</button></form> : null}
        </aside>
        <div className="min-w-0">
          {current ? (
            <Chat key={current.id} conversationId={current.id} initialMessages={toChatMessages(rows)} initialPrompt={sp.q} configured={configured} />
          ) : (
            <div className="surface flex min-h-[520px] flex-col items-center justify-center rounded-[22px] border border-[var(--hairline)] px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blackout text-crocus"><Sparkles className="h-6 w-6" strokeWidth={1.5} /></div>
              <h2 className="mt-5 text-2xl font-medium tracking-[-0.035em]">Cosa vuoi sapere o fare oggi?</h2>
              <p className="mt-2 max-w-md text-sm text-graphite">Leggo ordini, pagamenti, fatture, produzione e marketing. Creo attività, progetti e sketch. Le azioni delicate aspettano sempre il tuo sì.</p>
              <form action={newConversationAction} className="mt-6 flex w-full max-w-xl items-center gap-2 rounded-full border border-smoke bg-white p-1.5 pl-5 focus-within:border-steel">
                <input name="prompt" placeholder="Es. Come va il business questo mese?" className="h-10 min-w-0 flex-1 bg-transparent text-sm text-blackout outline-none placeholder:text-space" disabled={!configured} />
                <Button type="submit" className="h-10 px-5" disabled={!configured}>Inizia</Button>
              </form>
              {configured ? (
                <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((q) => (
                    <form key={q} action={newConversationAction}>
                      <input type="hidden" name="prompt" value={q} />
                      <button className="h-full w-full rounded-2xl border border-smoke bg-white/60 px-4 py-3 text-left text-xs leading-relaxed text-graphite transition-colors hover:border-steel hover:bg-white hover:text-blackout">{q}</button>
                    </form>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <aside className="hidden flex-col gap-4 xl:flex">
          <Card>
            <CardHeader><CardTitle className="text-sm">Approvazioni di questa chat</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {approvals.length === 0 ? <p className="text-xs text-graphite">Nessuna azione in attesa.</p> : null}
              {approvals.map((a) => (
                <div key={a.id} className="rounded-xl border border-warn/25 bg-warn-bg p-3">
                  <p className="text-xs font-medium text-warn">{a.toolName}</p>
                  <p className="mt-1 text-xs text-blackout">{a.summary}</p>
                  <p className="mt-1 text-[10px] text-graphite">Richiede ruolo {a.requiredRole} · scade {fmtRelative(a.expiresAt).replace(" fa", "")}</p>
                  {canApprove ? (
                    <div className="mt-2 flex gap-1">
                      <form action={decideApprovalAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="APPROVE" /><input type="hidden" name="returnTo" value={`/assistant?c=${current?.id}`} /><Button size="sm">Approva</Button></form>
                      <form action={decideApprovalAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="REJECT" /><input type="hidden" name="returnTo" value={`/assistant?c=${current?.id}`} /><Button size="sm" variant="outline">Rifiuta</Button></form>
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Cosa può fare</CardTitle></CardHeader>
            <CardContent className="text-xs text-graphite">
              <ul className="list-disc space-y-1 pl-4">
                <li><Badge tone="muted">legge</Badge> ordini, pagamenti, fatture, spedizioni, prodotti, marketing, produzione, avvisi, task</li>
                <li><Badge tone="ok">esegue</Badge> task, memoria, spese, fornitori, progetti e sketch di design, avvio sync (tracciati nell&apos;audit)</li>
                <li><Badge tone="warn">propone</Badge> riconciliazioni, rate pagate, modifiche spedizioni, email e messaggi Telegram → le approvi tu</li>
                <li><Badge tone="bad">mai</Badge> scritture su Shopify, Aruba, Packlink, gateway, SdI, pagamenti</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
