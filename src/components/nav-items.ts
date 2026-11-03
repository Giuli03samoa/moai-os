// Plain data shared by server and client components (icons are resolved client-side by name).
export const NAV = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/orders", label: "Orders", icon: "orders" },
  { href: "/payments", label: "Payments", icon: "payments" },
  { href: "/invoices", label: "Invoices", icon: "invoices" },
  { href: "/shipping", label: "Shipping", icon: "shipping" },
  { href: "/products", label: "Products", icon: "products" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/integrations", label: "Integrations", icon: "integrations" },
  { href: "/sync", label: "Sync", icon: "sync" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

export type NavIcon = (typeof NAV)[number]["icon"];
