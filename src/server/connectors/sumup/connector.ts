import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import type { ConnectorDefinition, VerifyResult } from "../types";
import { SumUpClient } from "./client";

export const sumupConnector: ConnectorDefinition = {
  key: "sumup",
  provider: "PAYMENT_GATEWAY",
  displayName: "SumUp",
  description: "Vendite in presenza (eventi, pop-up), commissioni e accrediti letti dall'API SumUp. Sola lettura.",
  secretFields: [{ name: "apiKey", label: "Chiave API SumUp (sup_sk_…)", type: "password", required: true, help: "me.sumup.com → Impostazioni → Per sviluppatori → Chiavi API → Crea chiave" }],
  configFields: [
    { name: "merchantCode", label: "Codice esercente", type: "text", placeholder: "es. MH4H92C7", help: "Lo trovi nel profilo SumUp. Se lo lasci vuoto MOAI OS prova a leggerlo da solo." },
    { name: "syncFrom", label: "Importa le vendite dal", type: "date", help: "Vuoto = ultimi 90 giorni" },
  ],
  jobs: [{ type: "sumup.sync", label: "Sincronizza SumUp", description: "Legge vendite, rimborsi, commissioni e accrediti", scheduled: true, manualPayload: { full: true } }],
  notes: [
    "MOAI OS legge soltanto: non incassa, non rimborsa e non modifica nulla su SumUp.",
    "Le vendite fatte di persona sono segnate come «in presenza»: non hanno un ordine Shopify e non vengono abbinate agli ordini online.",
    "SumUp non conosce i dati fiscali del cliente e non emette scontrini: il documento commerciale (o la fattura, entro 12 giorni) resta da emettere a parte.",
    "Il calcolo degli accrediti (netto in banca per bonifico) va confermato con il primo accredito reale.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    if (!ctx.secrets.apiKey) return { status: "NOT_CONFIGURED", message: "Inserisci la chiave API" };
    let merchantCode = String(ctx.config.merchantCode ?? "").trim();
    const capabilities: Record<string, boolean | string> = { writes: "disabilitate per progetto" };
    if (!merchantCode) {
      try {
        const me = await new SumUpClient({ apiKey: ctx.secrets.apiKey, log: ctx.log }).discoverMerchantCode();
        if (me.merchantCode) {
          merchantCode = me.merchantCode;
          await db.integrationConnection.update({ where: { id: ctx.connection.id }, data: { config: { ...ctx.config, merchantCode } as Prisma.InputJsonValue } });
          ctx.log(`Codice esercente letto dal profilo: ${merchantCode}`);
        }
      } catch (e) {
        ctx.log(`Profilo non leggibile: ${(e as Error).message}`);
      }
    }
    if (!merchantCode) return { status: "BLOCKED", message: "Inserisci il codice esercente (profilo SumUp)", blockedReason: "Codice esercente mancante" };
    const client = new SumUpClient({ apiKey: ctx.secrets.apiKey, merchantCode, log: ctx.log });
    let seen = 0;
    for await (const page of client.history({ oldestTime: new Date(Date.now() - 30 * 86_400_000), pageSize: 5, maxPages: 1 })) seen += page.length;
    capabilities.transactions = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const p = await client.listPayouts(new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10), today);
      capabilities.payouts = Array.isArray(p) ? true : "formato inatteso";
    } catch (e) {
      capabilities.payouts = `non disponibile: ${(e as Error).message}`;
    }
    return { status: "CONNECTED", message: `Chiave valida per l'esercente ${merchantCode}. ${seen ? `Transazioni recenti trovate.` : "Nessuna transazione negli ultimi 30 giorni."} Accrediti: ${capabilities.payouts === true ? "leggibili" : capabilities.payouts}`, capabilities };
  },
};
