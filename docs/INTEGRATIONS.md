# Integrazioni — setup, requisiti, blocchi

Tutte le credenziali si inseriscono in **Integrations** (ruolo ADMIN) e vengono cifrate lato server. Nessuna credenziale va nei sorgenti né in `.env` (eccetto `APP_ENCRYPTION_KEY` e `DATABASE_URL`).

Stato di collaudo onesto, al momento del rilascio dell'MVP:

| Connettore | Codice | Collaudo con account reale |
|---|---|---|
| Shopify (ordini, prodotti, clienti, transazioni, fulfillment, webhook) | completo | ✅ **collaudato il 28/10/2026 sul negozio reale** (`09sgwr-6c.myshopify.com`): verifica, scope, prodotti/varianti e sync ordini/clienti eseguiti; il negozio non aveva ancora ordini negli ultimi 60 giorni |
| Shopify Payments (payout, commissioni) | completo | ✅ **collaudato il 28/10/2026**: con `read_shopify_payments_accounts` + `read_shopify_payments_payouts` il job legge `shopifyPaymentsAccount.payouts` e `balanceTransactions` (sort `ISSUED_AT` / `PROCESSED_AT`, verificati per introspezione); il negozio non ha ancora payout né transazioni |
| Aruba archivio XML/P7M manuale | completo | ✅ collaudato con file FatturaPA di esempio |
| Aruba API | completo | **da fare** — serve account Premium o delega |
| Packlink PRO API (probe, lookup spedizione, tracking) | completo | ✅ **API key collaudata il 28/10/2026** (probe servizi: 12 servizi). Lettura spedizione/tracking: da confermare alla prima spedizione reale — il job di refresh registra automaticamente l'esito in *Capacità*. Elenco spedizioni via API non documentato |
| Packlink CSV / da Shopify | completo | ✅ collaudato con CSV di esempio |
| PayPal / Stripe credenziali | verifica pronta | **da fare**; sync API disattivata fino all'identificazione degli account reali |
| CSV gateway/banca | completo | ✅ collaudato con preset PayPal, Stripe, banca |

---

## Shopify

### Creazione app (Dev Dashboard)

1. [Dev Dashboard Shopify](https://dev.shopify.com) → **Apps → Create app** nell'organizzazione che possiede il negozio MOAI.
2. **Versions → Create version**: App URL qualsiasi (non embedded), **Webhooks API version 2026-10**, scope sotto. **Release**.
3. **Install app** sul negozio MOAI (deve comparire tra i *Dev stores* della stessa organizzazione, altrimenti il grant client credentials fallisce con `shop_not_permitted`).
4. **App settings → Credentials**: copia Client ID e Client secret → Integrations → Shopify → *Salva e verifica*.

Alternativa legacy: app creata direttamente dall'admin (non più creabili) → metodo *Access token fisso*.

### Scope (minimo privilegio, solo lettura)

| Scope | Perché | Obbligatorio |
|---|---|---|
| `read_orders` | ordini, transazioni, rimborsi, fulfillment degli ordini | sì |
| `read_products` | prodotti, varianti, giacenza per variante | sì |
| `read_fulfillments` | stato spedizione/tracking | sì |
| `read_all_orders` | storico oltre 60 giorni (richiede approvazione Shopify) | consigliato |
| `read_customers` | anagrafica clienti; nome/email solo con *Protected Customer Data* approvato e opzione attiva | opzionale |
| `read_shopify_payments_accounts` | accesso al campo `shopifyPaymentsAccount` (senza, l'API risponde ACCESS_DENIED — verificato sul negozio reale) | per il modulo pagamenti |
| `read_shopify_payments_payouts` | payout, saldo e commissioni Shopify Payments | per il modulo pagamenti |

Nessuno scope `write_*`: MOAI OS non modifica mai il negozio. La verifica elenca gli scope **effettivamente concessi** e marca `BLOCKED` se ne manca uno obbligatorio.

### Webhook

Nella versione dell'app (app-specific webhooks) → URL `https://<APP_URL>/api/webhooks/shopify`, topic:
`orders/create, orders/updated, orders/paid, orders/cancelled, refunds/create, fulfillments/create, fulfillments/update, products/update` + obbligatori GDPR `customers/data_request, customers/redact, shop/redact`.

Il ricevitore verifica `X-Shopify-Hmac-Sha256` con il client secret, deduplica su `X-Shopify-Event-Id` e **non si fida del payload**: accoda un job che rilegge la risorsa via API. `customers/redact` cancella i dati personali del cliente mantenendo lo storico anonimo.

### Sincronizzazione

- Ordini: pagine da 10 (costo GraphQL < 1000 punti con righe/transazioni annidate), `sortKey: UPDATED_AT`, cursore `updated_at` con sovrapposizione di 2 minuti → idempotente, riprende da dove si era fermata, continuazioni automatiche. Senza `read_all_orders` solo gli ultimi 60 giorni.
- Prodotti: varianti con snapshot giacenza → `InventoryMovement` sulle differenze.
- Shopify Payments: `shopifyPaymentsAccount.payouts` + `balanceTransactions` (fee, netto, `sourceOrderTransactionId` → regola R1).
- Limiti: 429 con `Retry-After`, `THROTTLED` con attesa calcolata da `throttleStatus`, 5xx con backoff, 401 → rinnovo token.

---

## Aruba Fatturazione Elettronica

**Requisito**: i web service sono disponibili per account **Premium**, o account Base con **delega** a un Premium. Con un account Base la verifica restituisce `BLOCKED` ("web service non abilitati") — in tal caso si usa il **caricamento manuale XML/P7M** (Invoices → Carica), che offre le stesse funzioni d'archivio.

Setup: Integrations → Aruba → username/password dell'account FE, ambiente (produzione / demo Aruba) → *Salva e verifica*. La verifica fa `POST /auth/signin` e una ricerca `size=1` su `invoice/out` e `invoice/in`; registra il numero di documenti visibili.

Importazione: `findByUsername` paginato (100/pagina, `startDate` con sovrapposizione di 7 giorni), `getByFilename` per il contenuto (base64) → stesso parser dell'upload manuale → dedupe fiscale. Lo stato SdI (1 Presa in carico … 7 Consegnata, 8 Accettata, 9 Rifiutata, 10 Decorrenza termini) viene aggiornato a ogni giro senza riscaricare il file.

**Non implementato per scelta**: invio fatture allo SdI, firma, conservazione. L'archivio di MOAI OS è una copia di lavoro; la conservazione a norma resta su Aruba.

P.IVA dell'organizzazione (Settings) → classifica emesse/ricevute e filtra gli account Premium multi-azienda (`vatcodeSender/vatcodeReceiver`).

---

## Pagamenti

### Shopify Payments
Via connessione Shopify (job `shopify.payments.sync`). Nessuna credenziale separata.

### PayPal, Stripe
Credenziali verificabili (solo `GET /v1/balance` Stripe, `POST /v1/oauth2/token` PayPal). La **sincronizzazione API automatica è disattivata** nell'MVP, come richiesto: si attiva solo dopo aver identificato gli account reali e collaudato. Nel frattempo: **CSV**.

### Import CSV (Payments → Importa CSV)
Mapping JSON configurabile: colonne, separatore decimale, formato data, fuso, dizionari valori (`valueMaps`), righe da ignorare (`skipWhen`). Preset inclusi:

| Preset | Export di origine |
|---|---|
| `paypal-activity` | PayPal → Attività → Scarica → CSV, tutte le colonne (IT) |
| `stripe-balance-history` | Stripe → Balance → Export |
| `stripe-payouts` | Stripe → Payouts → Export |
| `banca-generico-it` | estratto conto `Data contabile;Data valuta;Importo;Descrizione` (adatta i nomi colonna o usa `credit`/`debit` separati) |
| `packlink-pro-spedizioni` | Packlink PRO → Spedizioni → Esporta |

Flusso: **Anteprima** (righe normalizzate, errori per riga, righe ignorate) → **Importa** (idempotente: stesso id = aggiornamento) → riconciliazione automatica in coda. I preset si salvano per organizzazione.

---

## Packlink PRO

L'integrazione ufficiale **Shopify–Packlink PRO resta la fonte che crea le spedizioni**. MOAI OS non crea né duplica spedizioni.

Fonti del monitoraggio, in ordine:
1. **Fulfillment Shopify** (tracking, corriere, stato) — sempre disponibili con `read_fulfillments`.
2. **CSV Packlink PRO** — aggiunge riferimento Packlink e **costo**; se il tracking coincide con un fulfillment Shopify arricchisce la stessa riga (una spedizione, una riga).
3. **API Packlink** (`GET /v1/shipments/{ref}`, `/track`) — aggiorna stato/costo delle spedizioni con riferimento. La verifica usa `GET /v1/services` come probe della API key e, se indicato un *riferimento di prova*, registra quali campi l'account espone davvero. **L'elenco di tutte le spedizioni non è parte dell'API pubblica documentata**: va verificato con l'account autorizzato.
4. **Aggiornamenti manuali tracciati** (Shipping → dettaglio) con audit log.

Segnalazioni automatiche (`shipments.detect_problems`): nessun evento da 7 giorni, eccezione/reso del corriere; ordini pagati non evasi con giorni di attesa nella lista "da preparare".
