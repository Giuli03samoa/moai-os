"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, Loader2, Send, ShieldAlert, Wrench, XCircle } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import { SUGGESTIONS } from "./suggestions";

export type ChatTool = { id: string; name: string; summary?: string; ok?: boolean; approvalId?: string; pending?: boolean };
export type ChatMessage = { id: string; role: "user" | "assistant" | "note"; text: string; tools: ChatTool[]; status?: string[] };


export function Chat({ conversationId, initialMessages, initialPrompt, configured }: { conversationId: string; initialMessages: ChatMessage[]; initialPrompt?: string; configured: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    if (initialPrompt && !sentInitial.current && configured) {
      sentInitial.current = true;
      void send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    const userId = `u-${Date.now()}`;
    const asstId = `a-${Date.now()}`;
    setMessages((m) => [...m, { id: userId, role: "user", text: msg, tools: [] }, { id: asstId, role: "assistant", text: "", tools: [] }]);
    const patch = (fn: (a: ChatMessage) => ChatMessage) => setMessages((m) => m.map((x) => (x.id === asstId ? fn(x) : x)));
    try {
      const res = await fetch("/api/agent/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, message: msg }) });
      if (!res.ok || !res.body) {
        setError(res.status === 429 ? "Troppe richieste: riprova tra qualche minuto." : `Errore ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let ev: { type: string; [k: string]: unknown };
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "text_delta") patch((a) => ({ ...a, text: a.text + String(ev.text) }));
          else if (ev.type === "tool_start") patch((a) => ({ ...a, tools: [...a.tools, { id: String(ev.id), name: String(ev.name), pending: true }] }));
          else if (ev.type === "tool_result") patch((a) => ({ ...a, tools: a.tools.some((t) => t.id === ev.id) ? a.tools.map((t) => (t.id === ev.id ? { ...t, pending: false, ok: Boolean(ev.ok), summary: String(ev.summary ?? ""), approvalId: ev.approvalId as string | undefined } : t)) : [...a.tools, { id: String(ev.id), name: String(ev.name), ok: Boolean(ev.ok), summary: String(ev.summary ?? ""), approvalId: ev.approvalId as string | undefined }] }));
          else if (ev.type === "status") patch((a) => ({ ...a, status: [...(a.status ?? []), String(ev.text)] }));
          else if (ev.type === "error") setError(String(ev.message));
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="surface flex h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden rounded-[22px] border border-[var(--hairline)]">
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {messages.length === 0 ? (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 pt-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blackout text-crocus"><Bot className="h-6 w-6" strokeWidth={1.5} /></div>
            <h2 className="text-lg font-medium">Cosa vuoi sapere o fare oggi?</h2>
            <p className="text-sm text-graphite">Leggo ordini, pagamenti, fatture, spedizioni, prodotti, marketing e produzione. Creo task, progetti di design e sketch. Le azioni delicate passano sempre da una tua approvazione.</p>
            {!configured ? <p className="rounded-lg border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">Assistente non configurato: imposta ANTHROPIC_API_KEY nel file .env del server e riavvia MOAI OS.</p> : null}
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={!configured || busy} onClick={() => send(s)} className="rounded-2xl border border-smoke bg-white/60 px-4 py-3 text-left text-xs leading-relaxed text-graphite transition-colors hover:border-steel hover:bg-white hover:text-blackout disabled:opacity-50">{s}</button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "note" ? (
                <div className="w-full rounded-lg border border-dashed border-steel px-3 py-2 text-xs text-graphite">{m.text}</div>
              ) : m.role === "user" ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-blackout px-4 py-2.5 text-sm text-crocus shadow-sm">{m.text}</div>
              ) : (
                <div className="flex max-w-[94%] min-w-[40%] gap-3"><div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-cloud text-graphite"><Bot className="h-4 w-4" strokeWidth={1.6} /></div><div className="min-w-0 flex-1">
                  {m.tools.length ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {m.tools.map((t) => (
                        <span key={t.id} title={t.summary} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", t.pending ? "border-steel text-graphite" : t.approvalId ? "border-warn/40 bg-warn-bg text-warn" : t.ok ? "border-smoke bg-cloud text-graphite" : "border-bad/30 bg-bad-bg text-bad")}>
                          {t.pending ? <Loader2 className="h-3 w-3 animate-spin" /> : t.approvalId ? <ShieldAlert className="h-3 w-3" /> : t.ok ? <Wrench className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {t.name}
                          {t.summary && !t.pending ? <span className="max-w-[260px] truncate opacity-80">· {t.summary}</span> : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {m.text ? <div className="rounded-[20px] rounded-tl-md border border-smoke/80 bg-white px-4 py-3"><Markdown>{m.text}</Markdown></div> : busy && m.id === messages[messages.length - 1]?.id ? <div className="flex items-center gap-2 text-xs text-graphite"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sto lavorando…</div> : null}
                  {m.status?.length ? <p className="mt-1 text-[11px] text-graphite">{m.status.join(" · ")}</p> : null}
                  {m.tools.some((t) => t.approvalId) ? <p className="mt-2 inline-flex items-center gap-1 text-xs text-warn"><ShieldAlert className="h-3.5 w-3.5" /> Una o più azioni aspettano la tua approvazione (riquadro a destra o pagina Approvazioni).</p> : null}
                </div></div>
              )}
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </div>
      {error ? <div className="mx-4 mb-2 rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-xs text-bad md:mx-6">{error}</div> : null}
      <form
        className="m-3 flex items-end gap-2 rounded-[20px] border border-smoke bg-white p-2 pl-4 transition-colors focus-within:border-steel md:mx-6"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          disabled={!configured || busy}
          placeholder={configured ? "Scrivi all'assistente… (Invio per inviare, Shift+Invio a capo)" : "Assistente non configurato"}
          className="min-h-[44px] flex-1 resize-none bg-transparent py-2 text-sm text-blackout outline-none placeholder:text-space disabled:opacity-50"
        />
        <button type="submit" disabled={!configured || busy || !input.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blackout text-crocus transition-colors hover:bg-blackout/85 disabled:opacity-40" aria-label="Invia">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
      <p className="px-4 pb-3 text-[10px] text-space md:px-7">Modello Claude via API Anthropic. Le risposte si basano sui dati di MOAI OS; verifica i numeri importanti. <CheckCircle2 className="inline h-3 w-3" /> azione eseguita · <ShieldAlert className="inline h-3 w-3" /> in attesa di approvazione.</p>
    </div>
  );
}
