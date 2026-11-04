"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Bell, Bot, CheckSquare, CreditCard, Factory, FileText, LayoutDashboard, Megaphone, Package, PenTool, Plug, Settings, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import { NAV_SECTIONS, type NavIcon } from "./nav-items";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  assistant: Bot,
  alerts: Bell,
  tasks: CheckSquare,
  orders: ShoppingBag,
  payments: CreditCard,
  invoices: FileText,
  shipping: Truck,
  products: Package,
  production: Factory,
  design: PenTool,
  marketing: Megaphone,
  analytics: BarChart3,
  integrations: Plug,
  sync: Activity,
  settings: Settings,
};

export function SidebarNav({ badges }: { badges?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4 overflow-y-auto px-3 pb-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-space">{section.title}</p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = ICONS[item.icon];
              const badge = badges?.[item.href];
              return (
                <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors", active ? "bg-crocus text-blackout" : "text-steel hover:bg-white/5 hover:text-crocus")}>
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{item.label}</span>
                  {badge ? <span className={cn("ml-auto rounded-full px-1.5 text-[10px] tabular", active ? "bg-blackout text-crocus" : "bg-white/10 text-crocus")}>{badge}</span> : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
