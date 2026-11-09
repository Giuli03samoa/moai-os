"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, Search, Settings, Sparkles, X } from "lucide-react";
import { logoutAction } from "@/server/actions/auth";
import { NAV } from "./nav-items";
import { NAV_ICONS } from "./nav-icons";
import { SidebarNav, isActive } from "./sidebar-nav";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

export type ShellUser = { name: string; role: string; orgName: string };

const ROLE_LABEL: Record<string, string> = { OWNER: "Titolare", ADMIN: "Admin", ACCOUNTANT: "Contabilità", OPERATIONS: "Operazioni", VIEWER: "Lettura" };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "M";
}

export function AppShell({ user, demo, badges, assistantEnabled, children }: { user: ShellUser; demo: boolean; badges?: Partial<Record<string, number>>; assistantEnabled: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = [...NAV].reverse().find((n) => isActive(pathname, n.href)) ?? NAV[0]!;
  const CurrentIcon = NAV_ICONS[current.icon];

  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);
  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
    try { localStorage.setItem("moai-sidebar", next ? "collapsed" : "open"); } catch {}
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
      else if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); router.push("/assistant"); }
      else if (mod && e.key === "\\") { e.preventDefault(); toggleCollapsed(); }
      else if (e.key === "/" && !palette && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement)?.isContentEditable)) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, palette, toggleCollapsed]);

  useEffect(() => { setDrawer(false); setMenu(false); }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const on = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", on);
    return () => window.removeEventListener("mousedown", on);
  }, [menu]);

  const alerts = badges?.["/alerts"] ?? 0;

  const sidebar = (onNavigate?: () => void) => (
    <>
      <div className="desktop-titlebar-pad px-6 pb-4 pt-5 collapsed:px-0">
        <Link href="/" className="flex items-center gap-2 collapsed:justify-center" onClick={onNavigate}>
          <Image src="/brand/moai-logo-secondary-cream.png" alt="MOAI Athletics" width={128} height={43} priority className="h-auto w-[128px] collapsed:hidden" />
          <Image src="/brand/moai-icon-cream.png" alt="MOAI" width={40} height={19} className="hidden h-auto w-[40px] collapsed:block" />
        </Link>
        <p className="mt-1.5 truncate text-[9px] uppercase tracking-[0.3em] text-[#6e7180] collapsed:hidden">Operating System</p>
      </div>
      <SidebarNav badges={badges} onNavigate={onNavigate} />
      <div className="chevron-pattern mt-auto flex items-center gap-2 border-t border-white/[0.06] px-4 py-3 collapsed:justify-center collapsed:px-0">
        <p className="flex-1 truncate pl-2 text-[10px] uppercase tracking-[0.2em] text-[#6e7180] collapsed:hidden">Discipline over noise</p>
        <button type="button" onClick={toggleCollapsed} title={collapsed ? "Espandi la barra (⌘\\)" : "Riduci la barra (⌘\\)"} className="hidden h-8 w-8 items-center justify-center rounded-lg text-[#9da2b3] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[#eae7e7] md:flex">
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-[var(--sidebar)] text-[#eae7e7] transition-[width] duration-200 print:hidden md:flex collapsed:w-[76px]">
        {sidebar()}
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-[#111]/40 animate-fade" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-[var(--sidebar)] text-[#eae7e7] shadow-float animate-pop">
            <button type="button" onClick={() => setDrawer(false)} className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-[#9da2b3] hover:text-[#eae7e7]" aria-label="Chiudi menu"><X className="h-5 w-5" /></button>
            {sidebar(() => setDrawer(false))}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass desktop-titlebar-pad sticky top-0 z-30 border-b border-[var(--hairline)] print:hidden">
          {demo ? <div className="bg-warn-bg px-4 py-1 text-center text-[11px] font-medium text-warn">Ambiente demo: i dati contrassegnati come demo sono fittizi</div> : null}
          <div className="flex h-14 items-center gap-3 px-4 md:px-8">
            <button type="button" onClick={() => setDrawer(true)} className="-ml-1 rounded-lg p-1.5 text-graphite hover:bg-cloud hover:text-blackout md:hidden" aria-label="Apri menu"><Menu className="h-5 w-5" /></button>
            <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
              <CurrentIcon className="h-4 w-4 shrink-0 text-graphite" strokeWidth={1.75} />
              <span className="truncate font-medium">{current.label}</span>
            </div>
            <button type="button" onClick={() => setPalette(true)} className="group flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-smoke bg-white/70 px-3.5 text-left text-sm text-space transition-colors hover:border-steel hover:bg-white sm:max-w-md lg:mx-auto">
              <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="flex-1 truncate">{assistantEnabled ? "Cerca o chiedi all'assistente…" : "Cerca…"}</span>
              <kbd className="hidden rounded-md border border-smoke bg-crocus/60 px-1.5 text-[10px] font-medium text-graphite sm:block">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              {assistantEnabled ? (
                <Link href="/assistant" title="Assistente (⌘J)" className="hidden h-9 items-center gap-1.5 rounded-full bg-blackout px-3.5 text-xs font-medium text-crocus transition-colors hover:bg-blackout/85 sm:inline-flex">
                  <Sparkles className="h-3.5 w-3.5" /> Assistente
                </Link>
              ) : null}
              <Link href="/alerts" title="Avvisi" className="relative flex h-9 w-9 items-center justify-center rounded-full text-graphite transition-colors hover:bg-cloud hover:text-blackout">
                <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
                {alerts ? <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-medium text-[#fff] tabular">{alerts > 9 ? "9+" : alerts}</span> : null}
              </Link>
              <div className="relative" ref={menuRef}>
                <button type="button" onClick={() => setMenu((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-full bg-blackout text-[11px] font-medium text-crocus transition-transform hover:scale-105" aria-label="Menu utente" aria-expanded={menu}>
                  {initials(user.name)}
                </button>
                {menu ? (
                  <div className="glass shadow-float absolute right-0 top-11 z-40 w-64 rounded-2xl border border-[var(--hairline)] p-2 animate-pop">
                    <div className="px-3 pb-3 pt-2">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <p className="truncate text-xs text-graphite">{ROLE_LABEL[user.role] ?? user.role} · {user.orgName}</p>
                    </div>
                    <div className="flex items-center justify-between rounded-xl px-3 py-2">
                      <span className="text-xs text-graphite">Tema</span>
                      <ThemeToggle />
                    </div>
                    <Link href="/settings" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-cloud"><Settings className="h-4 w-4 text-graphite" strokeWidth={1.75} /> Impostazioni</Link>
                    <form action={logoutAction}>
                      <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-cloud"><LogOut className="h-4 w-4 text-graphite" strokeWidth={1.75} /> Esci</button>
                    </form>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        <main key={pathname} className="page-enter mx-auto w-full max-w-[1400px] flex-1 px-4 py-7 md:px-8 md:py-9 print:max-w-none print:p-0">{children}</main>
      </div>

      <CommandPalette open={palette} onOpenChange={setPalette} assistantEnabled={assistantEnabled} />
    </div>
  );
}
