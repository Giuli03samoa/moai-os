import type { ConnectorDefinition, VerifyResult } from "../types";
import { ShopifyClient, normalizeShopDomain } from "./client";
import { SHOP_INFO, type ShopInfo } from "./queries";

/**
 * Minimum scopes (least privilege). Approve them on the app version in the Dev Dashboard:
 *   read_orders                      ordini, transazioni, rimborsi, fulfillment degli ordini
 *   read_products                    prodotti e varianti (inventario per variante)
 *   read_fulfillments                stato spedizioni/tracking dei fulfillment
 * Optional:
 *   read_all_orders                  storico oltre 60 giorni (richiede approvazione Shopify)
 *   read_customers                   anagrafica clienti — dati personali solo con "Protected customer data" approvato
 *   read_shopify_payments_accounts   accesso al campo shopifyPaymentsAccount (verificato sul negozio reale: senza, ACCESS_DENIED)
 *   read_shopify_payments_payouts    payout, saldo e commissioni Shopify Payments
 * Never requested: write_* scopes. MOAI OS non scrive su Shopify.
 */
export const REQUIRED_SCOPES = ["read_orders", "read_products", "read_fulfillments"];
export const OPTIONAL_SCOPES = ["read_all_orders", "read_customers", "read_shopify_payments_accounts", "read_shopify_payments_payouts"];

export const shopifyConnector: ConnectorDefinition = {
  key: "shopify",
  provider: "SHOPIFY",
  displayName: "Shopify",
  description: "Ordini, prodotti, clienti, transazioni e fulfillment via GraphQL Admin API + webhook.",
  secretFields: [
    { name: "clientId", label: "Client ID", type: "text", help: "Dev Dashboard → App → App settings → Credentials" },
    { name: "clientSecret", label: "Client secret", type: "password", help: "Usato anche per verificare la firma HMAC dei webhook" },
    { name: "accessToken", label: "Admin API access token (solo app legacy create dall'admin)", type: "password", help: "Lascia vuoto se usi Client ID/secret" },
  ],
  configFields: [
    { name: "shopDomain", label: "Dominio negozio", type: "text", required: true, placeholder: "moai-athletics.myshopify.com" },
    {
      name: "authMode",
      label: "Metodo di autenticazione",
      type: "select",
      options: [
        { value: "client_credentials", label: "Client credentials (app Dev Dashboard, consigliato)" },
        { value: "access_token", label: "Access token fisso (app legacy creata dall'admin)" },
      ],
    },
    { name: "ordersSince", label: "Importa ordini dal", type: "date", help: "Data di partenza dell'importazione iniziale (vuoto = tutto il disponibile)" },
    { name: "storeCustomerPii", label: "Salva nome ed email dei clienti", type: "checkbox", help: "Richiede read_customers e l'approvazione Protected Customer Data. Disattivo = solo identificativi e totali." },
  ],
  jobs: [
    { type: "shopify.orders.sync", label: "Sincronizza ordini", description: "Importazione incrementale di ordini, transazioni, rimborsi, fulfillment", scheduled: true },
    { type: "shopify.products.sync", label: "Sincronizza prodotti", description: "Prodotti, varianti e snapshot inventario", scheduled: true },
    { type: "shopify.customers.sync", label: "Sincronizza clienti", description: "Solo con scope read_customers", scheduled: true },
    { type: "shopify.payments.sync", label: "Sincronizza Shopify Payments", description: "Payout, commissioni e saldo (scope read_shopify_payments_payouts)", scheduled: true },
    { type: "shopify.orders.sync", label: "Reimporta tutti gli ordini", description: "Ripercorre tutto lo storico disponibile (idempotente)", scheduled: false, manualPayload: { full: true } },
  ],
  notes: [
    "Crea l'app nel Dev Dashboard Shopify, rilascia una versione con gli scope minimi e installala sul negozio MOAI. Il grant client credentials funziona solo se app e negozio sono nella stessa organizzazione.",
    `Scope richiesti: ${REQUIRED_SCOPES.join(", ")}. Opzionali: ${OPTIONAL_SCOPES.join(", ")}. Nessuno scope di scrittura.`,
    "Webhook (app-specific, nella versione dell'app): orders/create, orders/updated, orders/cancelled, orders/paid, refunds/create, fulfillments/create, fulfillments/update, products/update, customers/redact, shop/redact, customers/data_request → URL {APP_URL}/api/webhooks/shopify.",
    "Senza read_all_orders l'API restituisce solo gli ordini degli ultimi 60 giorni.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    const domain = String(ctx.config.shopDomain ?? "");
    if (!domain) return { status: "NOT_CONFIGURED", message: "Inserisci il dominio del negozio" };
    normalizeShopDomain(domain);
    const mode = String(ctx.config.authMode ?? "client_credentials");
    if (mode === "access_token" ? !ctx.secrets.accessToken : !ctx.secrets.clientId || !ctx.secrets.clientSecret) {
      return { status: "NOT_CONFIGURED", message: "Credenziali mancanti" };
    }
    const client = new ShopifyClient(ctx, ctx.log);
    const info = await client.query<ShopInfo>(SHOP_INFO);
    const granted = info.currentAppInstallation.accessScopes.map((s) => s.handle);
    const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s) && !granted.includes(s.replace("read_", "write_")));
    const capabilities: Record<string, boolean | string> = {
      shop: info.shop.name,
      currency: info.shop.currencyCode,
      timezone: info.shop.ianaTimezone,
      plan: info.shop.plan.displayName,
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-10",
      orders: granted.includes("read_orders"),
      ordersHistoryBeyond60Days: granted.includes("read_all_orders"),
      products: granted.includes("read_products"),
      fulfillments: granted.includes("read_fulfillments"),
      customers: granted.includes("read_customers"),
      shopifyPayments:
        (granted.includes("read_shopify_payments_accounts") || granted.includes("read_shopify_payments")) && (granted.includes("read_shopify_payments_payouts") || granted.includes("read_shopify_payments"))
          ? true
          : `mancano: ${["read_shopify_payments_accounts", "read_shopify_payments_payouts"].filter((s) => !granted.includes(s) && !granted.includes("read_shopify_payments")).join(", ")}`,
      writes: "disabilitate per progetto",
    };
    ctx.log(`Negozio ${info.shop.myshopifyDomain}, scope: ${granted.join(" ")}`);
    if (missing.length) {
      return { status: "BLOCKED", message: `Connesso ma mancano scope: ${missing.join(", ")}`, blockedReason: `Scope mancanti: ${missing.join(", ")}`, capabilities, grantedScopes: granted };
    }
    return { status: "CONNECTED", message: `Connesso a ${info.shop.name} (${info.shop.myshopifyDomain})`, capabilities, grantedScopes: granted };
  },
};
