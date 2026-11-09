// Plain data shared by server and client components (icons are resolved client-side by name).
export type NavIcon = "overview" | "assistant" | "alerts" | "tasks" | "orders" | "payments" | "invoices" | "shipping" | "products" | "production" | "design" | "marketing" | "analytics" | "integrations" | "sync" | "settings";
export type NavItem = { href: string; label: string; icon: NavIcon; hint: string; keywords?: string; searchable?: boolean };
export type NavSection = { title: string; items: readonly NavItem[] };

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: "Cockpit",
    items: [
      { href: "/", label: "Panoramica", icon: "overview", hint: "Briefing, numeri, avvisi e cose da fare", keywords: "home cockpit dashboard oggi" },
      { href: "/assistant", label: "Assistente", icon: "assistant", hint: "Chiedi, analizza, fai preparare", keywords: "chat claude ai agente approvazioni memoria" },
      { href: "/alerts", label: "Avvisi", icon: "alerts", hint: "Cosa richiede attenzione", keywords: "notifiche problemi monitor" },
      { href: "/tasks", label: "Attività", icon: "tasks", hint: "Le cose da fare del team", keywords: "task todo da fare" },
    ],
  },
  {
    title: "Operazioni",
    items: [
      { href: "/orders", label: "Ordini", icon: "orders", hint: "Ordini Shopify e stato", keywords: "vendite clienti shopify", searchable: true },
      { href: "/payments", label: "Pagamenti", icon: "payments", hint: "Incassi, accrediti, banca", keywords: "paypal stripe shopify payments payout banca riconciliazione", searchable: true },
      { href: "/invoices", label: "Fatture", icon: "invoices", hint: "Archivio fatture attive e passive", keywords: "fattura xml sdi fornitori cassetto", searchable: true },
      { href: "/shipping", label: "Spedizioni", icon: "shipping", hint: "Packlink e tracking", keywords: "packlink corriere tracking", searchable: true },
      { href: "/products", label: "Prodotti", icon: "products", hint: "Catalogo e giacenze", keywords: "catalogo varianti magazzino scorte", searchable: true },
      { href: "/production", label: "Produzione e costi", icon: "production", hint: "Fornitori, ordini di produzione, spese", keywords: "fornitori costi margine spese studio 33" },
    ],
  },
  {
    title: "Brand",
    items: [
      { href: "/design", label: "Design Studio", icon: "design", hint: "Grafiche, mockup e tech pack", keywords: "grafica sketch mockup tech pack capi" },
      { href: "/marketing", label: "Marketing", icon: "marketing", hint: "Meta, contenuti e campagne", keywords: "instagram facebook ads social" },
      { href: "/analytics", label: "Analytics", icon: "analytics", hint: "Andamento e margine", keywords: "grafici numeri margine" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/integrations", label: "Integrazioni", icon: "integrations", hint: "Collegamenti esterni", keywords: "connettori shopify packlink legalmail email meta" },
      { href: "/sync", label: "Sync", icon: "sync", hint: "Sincronizzazioni e job", keywords: "job coda aggiornamento", searchable: true },
      { href: "/settings", label: "Impostazioni", icon: "settings", hint: "Organizzazione, utenti, assistente", keywords: "utenti ruoli token mcp budget" },
    ],
  },
];

export const NAV: readonly NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
