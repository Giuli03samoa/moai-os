"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, CornerDownLeft, LogOut, Monitor, Moon, Search, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { NAV } from "./nav-items";
import { NAV_ICONS } from "./nav-icons";
import { setTheme } from "./theme-toggle";
import { newConversationAction } from "@/server/actions/agent";
import { logoutAction } from "@/server/actions/auth";
import { cn } from "@/lib/utils";

type Item = { id: string; group: string; label: string; hint?: string; Icon: LucideIcon; keywords?: string; run: () => void };

const QUICK_PROMPTS = ["Cosa devo fare oggi?", "Come va il mese rispetto al precedente?", "Quali ordini pagati non sono ancora spediti?", "Fammi il punto sui costi di produzione del 2026"];

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** ⌘K: go anywhere, search inside a section, ask the assistant, switch theme. */
export function CommandPalette({ open, onOpenChange, assistantEnabled }: { open: boolean; onOpenChange: (v: boolean) => void; assistantEnabled: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const askForm = useRef<HTMLFormElement>(null);
  const askInput = useRef<HTMLInputElement>(null);
  const logoutForm = useRef<HTMLFormElement>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const go = useCallback((href: string) => { close(); router.push(href); }, [close, router]);
  const ask = useCallback((prompt: string) => {
    if (!askInput.current || !askForm.current) return;
    askInput.current.value = prompt;
    close();
    askForm.current.requestSubmit();
  }, [close]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const nq = norm(query);
    const out: Item[] = [];
    if (query && assistantEnabled) out.push({ id: "ask", group: "Assistente", label: `Chiedi all'assistente: “${query}”`, Icon: Sparkles, run: () => ask(query) });
    const pages = NAV.filter((n) => !nq || norm(`${n.label} ${n.hint} ${n.keywords ?? ""}`).includes(nq));
    for (const n of pages) out.push({ id: `nav-${n.href}`, group: "Vai a", label: n.label, hint: n.hint, Icon: NAV_ICONS[n.icon], run: () => go(n.href) });
    if (query) for (const n of NAV.filter((x) => x.searchable)) out.push({ id: `search-${n.href}`, group: "Cerca dentro", label: `Cerca “${query}” in ${n.label}`, Icon: Search, run: () => go(`${n.href}?q=${encodeURIComponent(query)}`) });
    if (!query && assistantEnabled) for (const p of QUICK_PROMPTS) out.push({ id: `qp-${p}`, group: "Chiedi subito", label: p, Icon: Bot, run: () => ask(p) });
    const actions: Item[] = [
      { id: "new-chat", group: "Azioni", label: "Nuova conversazione con l'assistente", Icon: Bot, keywords: "chat nuova", run: () => ask("") },
      { id: "approvals", group: "Azioni", label: "Approvazioni in attesa", Icon: ArrowRight, keywords: "approva conferma", run: () => go("/assistant/approvals") },
      { id: "theme-light", group: "Tema", label: "Tema chiaro", Icon: Sun, keywords: "luce bianco", run: () => { setTheme("light"); close(); } },
      { id: "theme-dark", group: "Tema", label: "Tema scuro", Icon: Moon, keywords: "notte nero dark", run: () => { setTheme("dark"); close(); } },
      { id: "theme-system", group: "Tema", label: "Tema automatico, come il Mac", Icon: Monitor, keywords: "sistema auto", run: () => { setTheme("system"); close(); } },
      { id: "logout", group: "Account", label: "Esci da MOAI OS", Icon: LogOut, keywords: "logout disconnetti", run: () => { close(); logoutForm.current?.requestSubmit(); } },
    ];
    for (const a of actions) if (!nq || norm(`${a.label} ${a.keywords ?? ""}`).includes(nq)) out.push(a);
    return out;
  }, [q, assistantEnabled, ask, go, close]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const groups = useMemo(() => {
    const g: Array<{ name: string; items: Array<Item & { idx: number }> }> = [];
    items.forEach((it, idx) => {
      const last = g[g.length - 1];
      if (last && last.name === it.group) last.items.push({ ...it, idx });
      else g.push({ name: it.group, items: [{ ...it, idx }] });
    });
    return g;
  }, [items]);

  return (
    <>
      <form ref={askForm} action={newConversationAction} className="hidden"><input ref={askInput} name="prompt" /></form>
      <form ref={logoutForm} action={logoutAction} className="hidden" />
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#111]/30 px-4 pt-[12vh] backdrop-blur-[2px] animate-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="glass shadow-float w-full max-w-[620px] overflow-hidden rounded-[22px] border border-[var(--hairline)] animate-pop" role="dialog" aria-label="Cerca o chiedi">
            <div className="flex items-center gap-3 border-b border-smoke px-5">
              <Search className="h-[18px] w-[18px] shrink-0 text-graphite" strokeWidth={1.75} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
                  else if (e.key === "Escape") { e.preventDefault(); close(); }
                }}
                placeholder={assistantEnabled ? "Cerca una pagina, un ordine… o chiedi all'assistente" : "Cerca una pagina o un ordine…"}
                className="h-14 flex-1 bg-transparent text-[15px] text-blackout outline-none placeholder:text-space"
              />
              <kbd className="hidden rounded-md border border-smoke px-1.5 py-0.5 text-[10px] text-graphite sm:block">esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
              {items.length === 0 ? <p className="px-3 py-8 text-center text-sm text-graphite">Nessun risultato.</p> : null}
              {groups.map((g) => (
                <div key={g.name} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-space">{g.name}</p>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      data-idx={it.idx}
                      onMouseMove={() => setSel(it.idx)}
                      onClick={() => it.run()}
                      className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors", sel === it.idx ? "bg-blackout text-crocus" : "text-blackout")}
                    >
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", sel === it.idx ? "bg-crocus/15" : "bg-cloud text-graphite")}>
                        <it.Icon className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint ? <span className={cn("hidden truncate text-xs sm:block", sel === it.idx ? "text-crocus/60" : "text-space")}>{it.hint}</span> : null}
                      {sel === it.idx ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-60" /> : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 border-t border-smoke px-5 py-2.5 text-[11px] text-space">
              <span><kbd className="font-sans">↑↓</kbd> scegli</span>
              <span><kbd className="font-sans">↵</kbd> apri</span>
              <span className="ml-auto">⌘K per aprire ovunque · ⌘J assistente</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
