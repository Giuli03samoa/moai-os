// Plain data shared by server and client components (icons are resolved client-side by name).
export type NavIcon = "overview" | "assistant" | "alerts" | "tasks" | "orders" | "payments" | "invoices" | "shipping" | "products" | "production" | "design" | "marketing" | "analytics" | "integrations" | "sync" | "settings";
export type NavItem = { href: string; label: string; icon: NavIcon };
export type NavSection = { title: string; items: readonly NavItem[] };

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: "Cockpit",
    items: [
      { href: "/", label: "Panoramica", icon: "overview" },
      { href: "/assistant", label: "Assistente", icon: "assistant" },
      { href: "/alerts", label: "Avvisi", icon: "alerts" },
      { href: "/tasks", label: "Attività", icon: "tasks" },
    ],
  },
  {
    title: "Operazioni",
    items: [
      { href: "/orders", label: "Ordini", icon: "orders" },
      { href: "/payments", label: "Pagamenti", icon: "payments" },
      { href: "/invoices", label: "Fatture", icon: "invoices" },
      { href: "/shipping", label: "Spedizioni", icon: "shipping" },
      { href: "/products", label: "Prodotti", icon: "products" },
      { href: "/production", label: "Produzione e costi", icon: "production" },
    ],
  },
  {
    title: "Brand",
    items: [
      { href: "/design", label: "Design Studio", icon: "design" },
      { href: "/marketing", label: "Marketing", icon: "marketing" },
      { href: "/analytics", label: "Analytics", icon: "analytics" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/integrations", label: "Integrazioni", icon: "integrations" },
      { href: "/sync", label: "Sync", icon: "sync" },
      { href: "/settings", label: "Impostazioni", icon: "settings" },
    ],
  },
];

export const NAV: readonly NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
