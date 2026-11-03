import type { ConnectorDefinition, VerifyResult } from "../types";
import { ConnectorError } from "../types";
import { ArubaClient, type ArubaEnv } from "./client";

export const arubaConnector: ConnectorDefinition = {
  key: "aruba",
  provider: "ARUBA",
  displayName: "Aruba Fatturazione Elettronica",
  description: "Importazione fatture attive e passive (XML FatturaPA) e stato SdI. Nessun invio automatico.",
  secretFields: [
    { name: "username", label: "Username Aruba FE", type: "text", required: true },
    { name: "password", label: "Password", type: "password", required: true },
  ],
  configFields: [
    { name: "environment", label: "Ambiente", type: "select", options: [{ value: "production", label: "Produzione" }, { value: "demo", label: "Demo Aruba" }] },
    { name: "since", label: "Importa fatture dal", type: "date", help: "Data di partenza della prima importazione (default: 1° gennaio dell'anno scorso)" },
  ],
  jobs: [
    { type: "aruba.invoices.sync", label: "Sincronizza fatture", description: "Fatture emesse e ricevute, stato SdI", scheduled: true },
    { type: "aruba.invoices.sync", label: "Reimporta tutto lo storico", description: "Ripercorre dalla data iniziale (idempotente)", scheduled: false, manualPayload: { full: true } },
  ],
  notes: [
    "I web service Aruba sono disponibili solo per account Premium o account Base con delega verso un Premium: con un account Base la verifica restituirà BLOCCATO. In quel caso usa il caricamento manuale XML/P7M in Invoices.",
    "MOAI OS non invia fatture allo SdI e non sostituisce la conservazione a norma: l'archivio interno è una copia di lavoro ricercabile.",
    "La P.IVA dell'organizzazione (Settings) viene usata per filtrare le fatture degli account Premium multi-azienda e per classificare emesse/ricevute.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    if (!ctx.secrets.username || !ctx.secrets.password) return { status: "NOT_CONFIGURED", message: "Inserisci username e password" };
    const env = (ctx.config.environment as ArubaEnv) ?? "production";
    const client = new ArubaClient({ env, username: ctx.secrets.username, password: ctx.secrets.password, log: ctx.log });
    await client.signin();
    ctx.log("Signin Aruba riuscito");
    const capabilities: Record<string, boolean | string> = { environment: env, signin: true, sendToSdi: "disabilitato per progetto", conservazione: "a carico di Aruba" };
    const org = await import("../../db").then((m) => m.db.organization.findUnique({ where: { id: ctx.organizationId }, select: { vatNumber: true, countryCode: true } }));
    const vat = org?.vatNumber?.replace(/^IT/i, "") ?? undefined;
    const probe = async (dir: "out" | "in") => {
      try {
        const page = await client.findInvoices(dir, { size: 1, country: vat ? org?.countryCode ?? "IT" : undefined, vatcode: vat });
        return { ok: true as const, total: page.totalElements };
      } catch (e) {
        if (e instanceof ConnectorError && (e.httpStatus === 401 || e.httpStatus === 403)) return { ok: false as const, blocked: true, message: e.message };
        return { ok: false as const, blocked: false, message: (e as Error).message };
      }
    };
    const out = await probe("out");
    const inn = await probe("in");
    capabilities.outInvoices = out.ok ? `${out.total} documenti` : out.message;
    capabilities.inInvoices = inn.ok ? `${inn.total} documenti` : inn.message;
    if (!out.ok && !inn.ok && (out.blocked || inn.blocked)) {
      return { status: "BLOCKED", message: "Credenziali valide ma web service non abilitati (serve Premium o delega)", blockedReason: "Account non Premium / senza delega", capabilities };
    }
    if (!out.ok && !inn.ok) return { status: "ERROR", message: `Signin ok ma ricerca fallita: ${out.message}`, capabilities };
    return { status: "CONNECTED", message: `Connesso (${env}). Emesse: ${capabilities.outInvoices}; ricevute: ${capabilities.inInvoices}`, capabilities };
  },
};
