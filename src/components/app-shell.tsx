import Link from "next/link";
import { logoutAction } from "@/server/actions/auth";
import type { AuthContext } from "@/server/auth/session";
import { NAV } from "./nav-items";
import { SidebarNav } from "./sidebar-nav";

export function AppShell({ auth, demo, children }: { auth: AuthContext; demo: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-blackout text-crocus md:flex">
        <div className="px-6 pb-4 pt-7">
          <Link href="/" className="block">
            <span className="text-xl font-medium tracking-[-0.04em]">MOAI</span>
            <span className="ml-1.5 text-xs uppercase tracking-[0.2em] text-space">OS</span>
          </Link>
          <p className="mt-1 truncate text-xs text-space">{auth.orgName}</p>
        </div>
        <SidebarNav />
        <div className="chevron-pattern mt-auto border-t border-white/10 px-6 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-space">Discipline over noise</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {demo ? (
          <div className="bg-warn-bg px-4 py-1.5 text-center text-xs font-medium text-warn">
            AMBIENTE DEMO — i dati contrassegnati come demo sono fittizi e servono solo a mostrare l&apos;interfaccia
          </div>
        ) : null}
        <header className="flex h-14 items-center justify-between gap-4 border-b border-smoke bg-crocus/80 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3 md:hidden">
            <Link href="/" className="text-lg font-medium">MOAI OS</Link>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-graphite sm:inline">{auth.name}</span>
            <span className="rounded-full bg-cloud px-2 py-0.5 text-[11px] uppercase tracking-wide text-graphite">{auth.role}</span>
            <form action={logoutAction}>
              <button className="text-sm text-graphite underline-offset-4 hover:text-blackout hover:underline">Esci</button>
            </form>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-smoke px-2 py-1 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3 py-1 text-xs text-graphite hover:bg-cloud">
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
