// Human labels for enums (client-safe).

export const SOURCE_LABEL: Record<string, string> = {
  SHOPIFY: "Shopify",
  ARUBA_API: "Aruba API",
  XML_UPLOAD: "XML caricato",
  PAYMENT_API: "API gateway",
  PAYMENT_CSV: "CSV gateway",
  BANK_CSV: "CSV banca",
  PACKLINK_API: "Packlink API",
  PACKLINK_CSV: "CSV Packlink",
  META_API: "Meta API",
  GA4_API: "Google Analytics",
  KLAVIYO_API: "Klaviyo",
  AGENT: "Assistente",
  MANUAL: "Manuale",
  DEMO: "Demo",
};

export const CONNECTION_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  NOT_CONFIGURED: { label: "Non configurato", tone: "muted" },
  PENDING_VERIFICATION: { label: "Da verificare", tone: "warn" },
  CONNECTED: { label: "Connesso", tone: "ok" },
  BLOCKED: { label: "Bloccato", tone: "warn" },
  ERROR: { label: "Errore", tone: "bad" },
  DISABLED: { label: "Disattivato", tone: "muted" },
};

export const JOB_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  QUEUED: { label: "In coda", tone: "muted" },
  RUNNING: { label: "In esecuzione", tone: "warn" },
  SUCCEEDED: { label: "Completato", tone: "ok" },
  FAILED: { label: "Fallito · riprova", tone: "warn" },
  DEAD: { label: "Fallito · intervento", tone: "bad" },
  CANCELLED: { label: "Annullato", tone: "muted" },
};

export const FINANCIAL_STATUS_LABEL: Record<string, string> = {
  PAID: "Pagato", PENDING: "In attesa", AUTHORIZED: "Autorizzato", PARTIALLY_PAID: "Pagato parz.", PARTIALLY_REFUNDED: "Rimborsato parz.", REFUNDED: "Rimborsato", VOIDED: "Annullato", EXPIRED: "Scaduto", UNKNOWN: "—",
};

export const FULFILLMENT_STATUS_LABEL: Record<string, string> = {
  UNFULFILLED: "Da evadere", PARTIALLY_FULFILLED: "Evaso parz.", FULFILLED: "Evaso", IN_PROGRESS: "In lavorazione", ON_HOLD: "In sospeso", SCHEDULED: "Programmato", OPEN: "Aperto", RESTOCKED: "Rientrato", PENDING_FULFILLMENT: "In attesa", REQUEST_DECLINED: "Rifiutato", UNKNOWN: "—",
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "In attesa", READY: "Pronta", IN_TRANSIT: "In transito", OUT_FOR_DELIVERY: "In consegna", DELIVERED: "Consegnata", EXCEPTION: "Eccezione", RETURNED: "Resa", CANCELLED: "Annullata", UNKNOWN: "Sconosciuto",
};

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  AUTHORIZATION: "Autorizzazione", CAPTURE: "Acquisizione", SALE: "Vendita", REFUND: "Rimborso", CHARGEBACK: "Chargeback", CHARGEBACK_REVERSAL: "Storno chargeback", FEE: "Commissione", ADJUSTMENT: "Rettifica", VOID: "Annullo",
};

export const RECONCILIATION_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  AUTO_MATCHED: { label: "Automatica", tone: "ok" },
  SUGGESTED: { label: "Da verificare", tone: "warn" },
  CONFIRMED: { label: "Confermata", tone: "ok" },
  REJECTED: { label: "Scartata", tone: "muted" },
};

export const INVOICE_PAYMENT_LABEL: Record<string, string> = { UNKNOWN: "—", UNPAID: "Da pagare", PARTIAL: "Parziale", PAID: "Pagata" };

export const DOC_TYPE_LABEL: Record<string, string> = {
  TD01: "Fattura", TD02: "Acconto", TD03: "Acconto parcella", TD04: "Nota di credito", TD05: "Nota di debito", TD06: "Parcella", TD07: "Fattura semplificata", TD08: "NC semplificata", TD09: "ND semplificata",
  TD16: "Integrazione RC interno", TD17: "Integrazione acquisto estero", TD18: "Integrazione intra beni", TD19: "Integrazione art.17 c.2", TD20: "Autofattura regolarizzazione", TD24: "Fattura differita", TD25: "Fattura differita triang.", TD26: "Cessione beni ammortizzabili", TD27: "Autoconsumo",
};

export const TASK_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  OPEN: { label: "Aperto", tone: "muted" }, IN_PROGRESS: { label: "In corso", tone: "warn" }, DONE: { label: "Fatto", tone: "ok" }, CANCELLED: { label: "Annullato", tone: "muted" },
};
export const TASK_PRIORITY_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" | "dark" }> = {
  LOW: { label: "Bassa", tone: "muted" }, NORMAL: { label: "Normale", tone: "muted" }, HIGH: { label: "Alta", tone: "warn" }, URGENT: { label: "Urgente", tone: "bad" },
};
export const ALERT_SEVERITY_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  INFO: { label: "Info", tone: "muted" }, WARNING: { label: "Attenzione", tone: "warn" }, CRITICAL: { label: "Critico", tone: "bad" },
};
export const ALERT_STATUS_LABEL: Record<string, string> = { OPEN: "Aperto", ACKNOWLEDGED: "Preso in carico", SNOOZED: "Posticipato", RESOLVED: "Risolto" };
export const APPROVAL_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  PENDING: { label: "In attesa", tone: "warn" }, APPROVED: { label: "Approvata ed eseguita", tone: "ok" }, REJECTED: { label: "Rifiutata", tone: "muted" }, EXPIRED: { label: "Scaduta", tone: "muted" }, FAILED: { label: "Fallita", tone: "bad" },
};
export const DESIGN_STAGE_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" | "dark" }> = {
  IDEA: { label: "Idea", tone: "muted" }, CONCEPT: { label: "Concept", tone: "muted" }, BRIEF: { label: "Brief", tone: "warn" }, SAMPLE: { label: "Campione", tone: "warn" }, APPROVED: { label: "Approvato", tone: "ok" }, PRODUCTION: { label: "In produzione", tone: "dark" }, ARCHIVED: { label: "Archiviato", tone: "muted" },
};
export const DESIGN_LINE_LABEL: Record<string, string> = { ESSENTIALS: "ESSENTIALS", MOTION: "MOTION", CAPSULE: "Capsule", MERCH: "Merch" };
export const ASSET_KIND_LABEL: Record<string, string> = { SKETCH: "Sketch", MOCKUP: "Mockup", TECHPACK: "Tech pack", REFERENCE: "Riferimento" };
export const PRODUCTION_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" | "dark" }> = {
  PLANNED: { label: "Pianificato", tone: "muted" }, QUOTED: { label: "Preventivato", tone: "muted" }, ORDERED: { label: "Ordinato", tone: "warn" }, IN_PRODUCTION: { label: "In produzione", tone: "warn" }, SHIPPED: { label: "Spedito", tone: "dark" }, RECEIVED: { label: "Ricevuto", tone: "ok" }, CANCELLED: { label: "Annullato", tone: "muted" },
};
export const EXPENSE_CATEGORY_LABEL: Record<string, string> = { COGS: "Costo del venduto", SAMPLES: "Campioni", MARKETING: "Marketing", LOGISTICS: "Logistica", SOFTWARE: "Software", FEES: "Commissioni", PHOTOGRAPHY: "Foto e video", CONSULTING: "Consulenze", OTHER: "Altro" };
export const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", meta_ads: "Meta Ads", web: "Sito (GA4)", email: "Email (Klaviyo)" };
