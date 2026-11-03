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
