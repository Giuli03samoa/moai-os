import type { ConnectorDefinition, VerifyResult } from "../types";
import { PacklinkClient, type PacklinkEnv } from "./client";

export const packlinkConnector: ConnectorDefinition = {
  key: "packlink",
  provider: "PACKLINK",
  displayName: "Packlink PRO",
  description: "Monitoraggio spedizioni: stato, tracking e costi. L'integrazione ufficiale Shopify–Packlink PRO resta la fonte che crea le spedizioni.",
  secretFields: [{ name: "apiKey", label: "API key Packlink PRO", type: "password", required: true, help: "Packlink PRO → Impostazioni → API key" }],
  configFields: [
    { name: "environment", label: "Ambiente", type: "select", options: [{ value: "production", label: "Produzione" }, { value: "sandbox", label: "Sandbox" }] },
    { name: "sampleReference", label: "Riferimento spedizione di prova", type: "text", help: "Un riferimento Packlink reale (es. IT2026...) per verificare che la lettura spedizioni sia abilitata" },
  ],
  jobs: [
    { type: "packlink.shipments.refresh", label: "Aggiorna spedizioni Packlink", description: "Rilegge stato, tracking e costo delle spedizioni con riferimento Packlink non ancora consegnate", scheduled: true },
    { type: "shipments.detect_problems", label: "Segnala spedizioni problematiche", description: "Marca spedizioni ferme o in eccezione", scheduled: true },
  ],
  notes: [
    "MOAI OS non crea spedizioni su Packlink: le crea l'integrazione ufficiale da Shopify. Qui vengono solo lette per evitare duplicati.",
    "L'elenco completo delle spedizioni non fa parte dell'API pubblica documentata: i riferimenti Packlink entrano da Shopify (tracking del fulfillment), dall'export CSV di Packlink PRO (Shipping → Importa CSV) o manualmente.",
    "Verifica in fase di setup, con un riferimento reale, quali campi (stato, costo, tracking) l'account autorizzato espone davvero: la verifica registra l'esito in Capabilities.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    if (!ctx.secrets.apiKey) return { status: "NOT_CONFIGURED", message: "Inserisci la API key" };
    const client = new PacklinkClient({ apiKey: ctx.secrets.apiKey, env: (ctx.config.environment as PacklinkEnv) ?? "production", log: ctx.log });
    const services = await client.probe();
    ctx.log(`Probe servizi Packlink: ${services} servizi`);
    const capabilities: Record<string, boolean | string> = { apiKey: true, servicesQuote: true, createShipments: "disabilitato per progetto", listShipments: "non documentato — usa CSV/Shopify" };
    const ref = String(ctx.config.sampleReference ?? "").trim();
    if (ref) {
      try {
        const s = await client.getShipment(ref);
        capabilities.shipmentLookup = true;
        capabilities.shipmentFields = Object.keys(s).slice(0, 25).join(",");
        try {
          const t = await client.getTracking(ref);
          capabilities.tracking = Array.isArray(t) ? `${t.length} eventi` : "formato inatteso";
        } catch (e) {
          capabilities.tracking = `non disponibile: ${(e as Error).message}`;
        }
      } catch (e) {
        capabilities.shipmentLookup = `fallita: ${(e as Error).message}`;
      }
    } else {
      capabilities.shipmentLookup = "da verificare: inserisci un riferimento di prova";
    }
    return { status: "CONNECTED", message: `API key valida (${services} servizi disponibili). Lettura spedizioni: ${capabilities.shipmentLookup}`, capabilities };
  },
};
