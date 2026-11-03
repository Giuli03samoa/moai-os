import { db } from "../../db";
import type { ConnectorDefinition, VerifyResult } from "../types";

/**
 * Multi-payment module.
 * One connector per gateway; all of them write to the same PROCESSOR ledger
 * (PaymentTransaction.ledger = PROCESSOR) and to Payout, so reconciliation is gateway-agnostic.
 *
 * Status of each gateway in this MVP:
 *  - shopify_payments  → direct API sync via the Shopify connection (job shopify.payments.sync)
 *  - stripe, paypal    → credential verification prepared; automatic sync deliberately OFF until the
 *                        real accounts are identified (CSV import works today)
 *  - satispay, klarna, scalapay, amazon_pay, other → CSV import with configurable mapping
 */

const csvNote = "Importazione via CSV (Payments → Importa CSV) con mapping configurabile. La connessione API diretta verrà attivata solo dopo aver identificato l'account reale.";

export const shopifyPaymentsConnector: ConnectorDefinition = {
  key: "shopify_payments",
  provider: "PAYMENT_GATEWAY",
  displayName: "Shopify Payments",
  description: "Payout, commissioni e saldo letti dall'API Shopify (scope read_shopify_payments_payouts).",
  secretFields: [],
  configFields: [],
  jobs: [],
  notes: ["Usa la connessione Shopify: non servono credenziali separate. La sincronizzazione è il job shopify.payments.sync."],
  async verify(ctx): Promise<VerifyResult> {
    const shopify = await db.integrationConnection.findUnique({ where: { organizationId_key: { organizationId: ctx.organizationId, key: "shopify" } } });
    if (!shopify || shopify.status !== "CONNECTED") return { status: "BLOCKED", message: "Connetti prima Shopify", blockedReason: "Shopify non connesso" };
    const g = shopify.grantedScopes;
    const missing = ["read_shopify_payments_accounts", "read_shopify_payments_payouts"].filter((s) => !g.includes(s) && !g.includes("read_shopify_payments"));
    if (missing.length) return { status: "BLOCKED", message: `Scope non concessi all'app Shopify: ${missing.join(", ")}`, blockedReason: `Scope mancanti: ${missing.join(", ")}`, capabilities: { csvImport: true } };
    return { status: "CONNECTED", message: "Lettura payout e commissioni abilitata", capabilities: { payouts: true, balanceTransactions: true, csvImport: true } };
  },
};

export const stripeConnector: ConnectorDefinition = {
  key: "stripe",
  provider: "PAYMENT_GATEWAY",
  displayName: "Stripe",
  description: "Transazioni, commissioni e payout Stripe.",
  secretFields: [{ name: "secretKey", label: "Secret key (sk_live_… / rk_live_…)", type: "password", help: "Consigliata una restricted key in sola lettura su Balance e Payouts" }],
  configFields: [],
  jobs: [],
  notes: [csvNote, "Preset CSV disponibili: stripe-balance-history (Balance → Export), stripe-payouts.", "La verifica credenziali chiama GET /v1/balance in sola lettura."],
  async verify(ctx): Promise<VerifyResult> {
    if (!ctx.secrets.secretKey) return { status: "BLOCKED", message: "Account Stripe non ancora identificato: CSV disponibile", blockedReason: "Credenziali non inserite", capabilities: { csvImport: true } };
    const res = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${ctx.secrets.secretKey}` } });
    if (res.status === 401) return { status: "ERROR", message: "Stripe: chiave non valida" };
    if (!res.ok) return { status: "ERROR", message: `Stripe HTTP ${res.status}` };
    const json = (await res.json()) as { livemode?: boolean };
    return { status: "CONNECTED", message: `Chiave valida (${json.livemode ? "live" : "test"}). Sync API automatica non attiva nell'MVP: usa CSV.`, capabilities: { livemode: !!json.livemode, apiSync: "da attivare dopo collaudo", csvImport: true } };
  },
};

export const paypalConnector: ConnectorDefinition = {
  key: "paypal",
  provider: "PAYMENT_GATEWAY",
  displayName: "PayPal",
  description: "Transazioni, commissioni e prelievi PayPal.",
  secretFields: [
    { name: "clientId", label: "Client ID (REST app)", type: "text" },
    { name: "clientSecret", label: "Client secret", type: "password" },
  ],
  configFields: [{ name: "environment", label: "Ambiente", type: "select", options: [{ value: "production", label: "Live" }, { value: "sandbox", label: "Sandbox" }] }],
  jobs: [],
  notes: [csvNote, "Preset CSV: paypal-activity (Attività → Scarica → CSV, tutte le colonne).", "La verifica chiama solo POST /v1/oauth2/token."],
  async verify(ctx): Promise<VerifyResult> {
    if (!ctx.secrets.clientId || !ctx.secrets.clientSecret) return { status: "BLOCKED", message: "Account PayPal non ancora identificato: CSV disponibile", blockedReason: "Credenziali non inserite", capabilities: { csvImport: true } };
    const base = ctx.config.environment === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${ctx.secrets.clientId}:${ctx.secrets.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (res.status === 401) return { status: "ERROR", message: "PayPal: credenziali non valide" };
    if (!res.ok) return { status: "ERROR", message: `PayPal HTTP ${res.status}` };
    return { status: "CONNECTED", message: "Credenziali valide. Sync API (Transaction Search) non attiva nell'MVP: usa CSV.", capabilities: { apiSync: "da attivare dopo collaudo", csvImport: true } };
  },
};

function csvOnly(key: string, displayName: string, preset?: string): ConnectorDefinition {
  return {
    key,
    provider: "PAYMENT_GATEWAY",
    displayName,
    description: `Transazioni ${displayName} importate da CSV.`,
    secretFields: [],
    configFields: [],
    jobs: [],
    notes: [csvNote, preset ? `Preset CSV: ${preset}.` : "Nessun preset: crea il mapping dalla prima importazione e salvalo."],
    async verify(): Promise<VerifyResult> {
      return { status: "CONNECTED", message: "Solo importazione CSV", capabilities: { csvImport: true, apiSync: false } };
    },
  };
}

export const paymentConnectors: ConnectorDefinition[] = [
  shopifyPaymentsConnector,
  stripeConnector,
  paypalConnector,
  csvOnly("satispay", "Satispay"),
  csvOnly("klarna", "Klarna"),
  csvOnly("scalapay", "Scalapay"),
  csvOnly("bank", "Banca (estratto conto)", "banca-generico-it"),
];

export const PAYMENT_PROVIDERS = ["shopify_payments", "paypal", "stripe", "satispay", "klarna", "scalapay", "amazon_pay", "manual", "other"] as const;
