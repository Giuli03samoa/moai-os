"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, CreditCard, FileText, LayoutDashboard, Package, Plug, Settings, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import { NAV, type NavIcon } from "./nav-items";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  orders: ShoppingBag,
  payments: CreditCard,
  invoices: FileText,
  shipping: Truck,
  products: Package,
  analytics: BarChart3,
  integrations: Plug,
  sync: Activity,
  settings: Settings,
};

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-crocus text-blackout" : "text-steel hover:bg-white/5 hover:text-crocus",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
