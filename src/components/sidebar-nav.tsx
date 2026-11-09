"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "./nav-items";
import { NAV_ICONS } from "./nav-icons";
import { cn } from "@/lib/utils";

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar links. In the collapsed rail only icons remain, with the label as a tooltip. */
export function SidebarNav({ badges, onNavigate }: { badges?: Partial<Record<string, number>>; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="sidebar-scroll flex flex-1 flex-col gap-3.5 overflow-y-auto px-3 pb-3">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[#6e7180] collapsed:invisible collapsed:h-2 collapsed:pb-0">{section.title}</p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = NAV_ICONS[item.icon];
              const badge = badges?.[item.href];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-[34px] items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors collapsed:justify-center collapsed:px-0",
                    active ? "bg-[#eae7e7] text-[#222222]" : "text-[#bcbfcc] hover:bg-[var(--sidebar-hover)] hover:text-[#eae7e7]",
                  )}
                >
                  <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={active ? 2 : 1.6} />
                  <span className="truncate collapsed:hidden">{item.label}</span>
                  {badge ? (
                    <span className={cn("ml-auto min-w-5 rounded-full px-1.5 text-center text-[10px] leading-5 tabular collapsed:absolute collapsed:right-1 collapsed:top-0.5 collapsed:ml-0 collapsed:min-w-4 collapsed:px-1 collapsed:leading-4", active ? "bg-[#222222] text-[#eae7e7]" : "bg-[#eae7e7]/12 text-[#eae7e7]")}>{badge > 99 ? "99+" : badge}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
