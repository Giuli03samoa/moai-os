import type { ConnectorDefinition, VerifyResult } from "../types";
import { Ga4Client, parseServiceAccount, reportToRows } from "./client";

export const ga4Connector: ConnectorDefinition = {
  key: "ga4",
  provider: "GOOGLE_ANALYTICS",
  displayName: "Google Analytics 4",
  description: "Sessioni, utenti, eventi chiave e ricavi ecommerce del sito, per giorno (sola lettura).",
  secretFields: [{ name: "serviceAccountJson", label: "Service account (JSON completo)", type: "password", required: true, help: "Google Cloud → IAM → Service account → Chiavi → JSON. Poi aggiungi la sua email come Lettore (Viewer) nella proprietà GA4." }],
  configFields: [{ name: "propertyId", label: "Property ID GA4", type: "text", required: true, placeholder: "123456789", help: "Admin → Impostazioni proprietà → ID proprietà (solo numeri)" }],
  jobs: [{ type: "ga4.report.sync", label: "Aggiorna metriche sito", description: "Ultimi 14 giorni: sessioni, utenti, nuovi utenti, pagine viste, eventi chiave, acquisti e ricavi", scheduled: true }],
  notes: [
    "Sola lettura tramite Data API v1beta; nessuna modifica alla proprietà.",
    "Il purchaseRevenue di GA4 è una misura di marketing (attribuzione lato browser), non il ricavo contabile: i ricavi veri restano quelli degli ordini Shopify.",
    "Non ancora collaudato su una proprietà reale.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    const propertyId = String(ctx.config.propertyId ?? "").replace(/\D/g, "");
    if (!ctx.secrets.serviceAccountJson) return { status: "NOT_CONFIGURED", message: "Carica il JSON del service account" };
    if (!propertyId) return { status: "NOT_CONFIGURED", message: "Inserisci il Property ID" };
    const sa = parseServiceAccount(ctx.secrets.serviceAccountJson);
    const client = new Ga4Client(sa, propertyId);
    const report = await client.runReport({ startDate: "7daysAgo", endDate: "yesterday", metrics: ["sessions", "totalUsers"] });
    const rows = reportToRows(report);
    const sessions = rows.reduce((a, r) => a + Number(r.sessions ?? 0), 0);
    ctx.log(`GA4 property ${propertyId}: ${rows.length} giorni, ${sessions} sessioni negli ultimi 7 giorni`);
    return { status: "CONNECTED", message: `Proprietà ${propertyId} leggibile (${sessions} sessioni negli ultimi 7 giorni)`, capabilities: { serviceAccount: sa.client_email, property: propertyId, sessions7d: String(sessions), writes: "non previste" } };
  },
};
