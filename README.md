# MOAI OS — MVP v1.0

Piattaforma gestionale interna di **MOAI Athletics**. Non sostituisce Shopify, Aruba Fatturazione Elettronica, i gateway di pagamento o Packlink PRO: li **collega** in un'unica applicazione cloud con login sicuro (MFA), dashboard economica e operativa, archivio fatture, riconciliazione pagamenti e monitoraggio spedizioni.

> Principio non negoziabile: **nessuna operazione finanziaria o fiscale irreversibile è automatizzata.** MOAI OS legge, collega e segnala; le decisioni restano umane e tracciate.

## Avvio rapido (sviluppo locale)

Prerequisiti: Node.js ≥ 20.11 (testato con 24). PostgreSQL non serve installarlo: `npm run db:local` avvia un'istanza locale (PostgreSQL 17) nella cartella `.local/pg`.

```bash
npm install
cp .env.example .env
# genera la chiave di cifratura e incollala in APP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm run db:local        # terminale 1: PostgreSQL locale (porta 54329)
npm run db:migrate      # terminale 2: applica le migrazioni
npm run dev             # http://localhost:3000 (worker job incluso: INLINE_WORKER=true)
```

Al primo avvio `/login` reindirizza a **`/setup`**: crea organizzazione (nome, P.IVA) e utente OWNER, poi attiva la MFA (app TOTP). La pagina `/setup` si disattiva dopo il primo utente.

### Dati demo (facoltativi, etichettati)

Solo con `DEMO_MODE="true"`: `npm run db:seed-demo` popola l'organizzazione con dati **fittizi** (badge DEMO su ogni riga, banner in alto, rimovibili da Settings → *Elimina tutti i dati demo*). Servono a vedere ogni schermata funzionare prima di avere credenziali reali. Non vengono mai mescolati a dati reali: ogni record demo ha `isDemo=true` e `source=DEMO`.

### Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Next.js in sviluppo + worker inline |
| `npm run build && npm start` | Build e avvio produzione |
| `npm run worker` | Worker dedicato per la coda job (produzione) |
| `npm run db:local` | PostgreSQL locale embedded |
| `npm run db:migrate` / `db:deploy` | Migrazioni Prisma (dev / produzione) |
| `npm run db:seed-demo` | Dati demo (richiede `DEMO_MODE=true`) |
| `npm run admin:create -- --email … --name … --role ADMIN` | Crea/resetta un utente da CLI |
| `npm run typecheck` | TypeScript strict su tutto il progetto |
| `npm test` | Test unitari (parser FatturaPA/P7M, regole riconciliazione, CSV, cifratura, importi) |
| `npm run test:integration` | Test con database (`moai_test`): archivio fatture, upsert ordini Shopify, riconciliazione, coda job |

## Cosa c'è dentro

| Area | Stato MVP |
|---|---|
| Login + MFA TOTP obbligatoria, codici di recupero, lockout, sessioni server-side | ✅ eseguibile e collaudato in locale |
| Dashboard (vendite lorde/nette, ordini, pagamenti acquisiti, accrediti, fatture, spedizioni da preparare, rimborsi, non riconciliati) con filtri temporali, fonte e ultimo aggiornamento per ogni valore | ✅ |
| Connettore **Shopify** (GraphQL Admin API 2026-10, client credentials, import iniziale + incrementale di ordini/prodotti/clienti/transazioni/fulfillment, Shopify Payments, webhook con HMAC e dedupe, rate-limit/retry) | ✅ codice completo e testato su dati sintetici · ⏳ **collaudo con negozio reale da fare** (servono Client ID/secret dell'app Dev Dashboard) |
| **Aruba** archivio XML/P7M (upload manuale, parser sicuro, dedupe, scadenze, collegamento ordini) | ✅ collaudato con file di esempio |
| **Aruba** API (signin, fatture attive/passive, stato SdI) con verifica abilitazione Premium/delega | ✅ codice completo · ⏳ collaudo con account reale (BLOCCATO se account Base) |
| Multi-payment: ledger ordini vs ledger gateway, payout, accrediti bancari, import CSV con mapping configurabile (preset PayPal, Stripe, banca, Packlink) | ✅ |
| Riconciliazione deterministica (id → riferimento+importo → importo+data) con verifica manuale per i casi incerti; mai doppio conteggio | ✅ collaudata (unit + DB) |
| **Packlink PRO** monitoraggio (da fulfillment Shopify, CSV Packlink, API lettura con probe capacità), ordini da spedire, costi, segnalazione anomalie | ✅ codice completo · ⏳ collaudo API con API key reale |
| Coda job persistente su PostgreSQL con retry/backoff, dedupe, log per job, retry manuale, pagina Sync | ✅ |
| Export CSV (ordini, pagamenti, payout, fatture, spedizioni, banca, riconciliazioni) | ✅ |
| Audit log, cifratura segreti AES-256-GCM, rate limiting, header di sicurezza, GDPR webhook | ✅ |

Dettagli e blocchi noti: [docs/STATUS.md](docs/STATUS.md). Setup dei connettori: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). Architettura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Sicurezza: [docs/SECURITY.md](docs/SECURITY.md). Deploy UE: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Struttura del repository

```
prisma/              schema Prisma (18 modelli), migrazioni, seed demo
src/app/             Next.js App Router: (auth) login/setup/mfa · (app) overview, orders, payments, invoices,
                     shipping, products, analytics, integrations, sync, settings · api/ webhooks, export, documents, health
src/components/      shell, tabelle, componenti UI (stile shadcn, palette MOAI, font Geist)
src/server/          SOLO lato server — mai importato dal browser
  auth/              password scrypt, TOTP, sessioni, ruoli
  connectors/        shopify/ aruba/ packlink/ payments/ — un modulo per sistema esterno (client, verify, sync)
  invoices/          parser FatturaPA, estrazione P7M, archivio
  reconciliation/    regole pure (rules.ts) + motore su DB (engine.ts)
  imports/           mapping CSV configurabile + commit idempotente
  jobs/              coda persistente, worker, scheduler, handler
  metrics/ export/   KPI dashboard, CSV
  actions/           Server Actions (controllo ruoli + audit)
tests/unit tests/integration tests/fixtures
docs/
scripts/             PostgreSQL locale, creazione admin
```
