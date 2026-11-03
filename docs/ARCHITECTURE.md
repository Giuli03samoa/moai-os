# Architettura

## Vista d'insieme

```
 Browser (team MOAI)
   │  HTTPS, cookie di sessione httpOnly, MFA
   ▼
 Next.js 15 (App Router, TypeScript strict)
   ├─ src/app/(app)/*        pagine server-rendered: SOLO lettura da DB + Server Actions
   ├─ src/server/actions/*   Server Actions: controllo ruolo → logica → audit log
   ├─ src/app/api/*          webhooks (Shopify), export CSV, download documenti, health
   └─ src/server/*           dominio e integrazioni (mai inviato al browser)
          │
          ├─ connectors/{shopify,aruba,packlink,payments}   moduli indipendenti
          ├─ jobs/  coda persistente su PostgreSQL (tabella SyncJob) + worker + scheduler
          ├─ invoices/  parser FatturaPA + P7M + archivio
          ├─ reconciliation/  regole pure + motore
          └─ imports/  CSV → modelli normalizzati
                 │
                 ▼
 PostgreSQL (Prisma)  ·  storage privato documenti (XML/P7M/CSV)
```

**Separazione frontend / integrazioni.** Le pagine importano solo `db`, `metrics`, `labels` e Server Actions. Tutto ciò che parla con API esterne vive in `src/server/connectors` e viene eseguito dal **worker** (processo separato in produzione, inline in sviluppo). Nessun componente client importa `src/server` se non tramite Server Actions, e le Server Actions non restituiscono mai segreti.

## Connettori

Ogni connettore implementa `ConnectorDefinition` ([src/server/connectors/types.ts](../src/server/connectors/types.ts)):

- `secretFields` / `configFields` → la pagina Integrations si genera da sola; i segreti sono cifrati (AES-256-GCM) in `IntegrationConnection.secretsEnc`.
- `verify(ctx)` → prova le credenziali e **rileva le capacità** (scope concessi, piano Aruba, lookup Packlink…). Lo stato può essere `CONNECTED`, `BLOCKED` (credenziali valide ma manca un'abilitazione) o `ERROR`, sempre con motivazione.
- `jobs[]` → job pianificati (scheduler) o manuali ("Sincronizza ora").
- `notes[]` → requisiti e limiti mostrati nell'interfaccia e in [INTEGRATIONS.md](INTEGRATIONS.md).

Gli errori di rete/API sono `ConnectorError` con `retryable` e `retryAfterMs`: il worker decide backoff o stato `DEAD`.

## Coda job

La tabella `SyncJob` *è* la coda. `claimNext` usa `FOR UPDATE SKIP LOCKED` (più worker in parallelo senza doppie esecuzioni); `enqueue` con `dedupeKey` usa un advisory lock per garantire al massimo un job in coda/esecuzione per chiave. Ogni job conserva `payload`, `result` (checkpoint di avanzamento, es. cursore di pagina), `log[]` (redatto dai segreti), `attempts`, `lastError`. Backoff 30s → 2m → 8m → 32m → 2h; esauriti i tentativi lo stato è `DEAD` e il job è ritentabile dalla UI. Le sincronizzazioni lunghe si spezzano in **continuazioni** (nuovo job con cursore) per rispettare i limiti API.

Scheduler: ogni `WORKER_SCHEDULE_MINUTES` accoda i job pianificati per ogni connessione `CONNECTED`, più `reconciliation.run` e `shipments.detect_problems` per organizzazione.

## Modello dati (Prisma)

18 modelli richiesti: `User, Organization, IntegrationConnection, Customer, Product, ProductVariant, Order, OrderItem, PaymentTransaction, Payout, BankTransaction, Invoice, InvoiceLine, Shipment, InventoryMovement, Reconciliation, SyncJob, AuditLog` + di supporto: `Membership, Session, WebhookEvent, InvoiceInstallment, Document, ImportBatch, CsvMappingPreset`.

Regole trasversali:

- **Tenant**: ogni riga di business ha `organizationId`; ogni query parte da `requireAuth().organizationId`.
- **Identificativi esterni univoci**: `@@unique([organizationId, source, externalId])` (ordini, prodotti, spedizioni…), `@@unique([organizationId, provider, ledger, externalId])` (transazioni), `dedupeKey` fiscale per le fatture (`direzione:PIVA cedente:tipo:numero:data`). Reimportare = aggiornare, mai duplicare.
- **Importi** `Decimal(18,4)` con valuta accanto; nessun `Float`. Parsing con `parseAmount` (gestisce `1.234,56` e `1,234.56`).
- **Tempo** in UTC (`timestamptz`); i confini giornalieri dei report usano `Organization.timezone` (default Europe/Rome).
- **Cancellazione logica** `deletedAt`; nessun dato finanziario viene cancellato fisicamente dall'app (eccetto i dati demo su richiesta).
- **Demo**: `isDemo` + `source=DEMO`.

## I due ledger dei pagamenti (perché non si somma due volte)

| Ledger | Fonte | Cosa dice | Usato per |
|---|---|---|---|
| `ORDER` | Shopify `Order.transactions` | il negozio ha registrato un pagamento di X sull'ordine | "Pagamenti acquisiti" |
| `PROCESSOR` | API/CSV del gateway (Shopify Payments, PayPal, Stripe…) | il gateway ha incassato X, trattenuto fee F, netto N, incluso nel payout P | commissioni, netto, payout |
| `Payout` | gateway | trasferimento N verso la banca | "Accrediti liquidati" |
| `BankTransaction` | estratto conto CSV | accredito N arrivato | chiusura del cerchio |

Il **ricavo** è una sola cosa: gli ordini (netti dei rimborsi). Pagamenti, payout e accrediti sono *viste dello stesso denaro* e vengono solo **collegati** dalla riconciliazione. La dashboard lo dichiara accanto ai valori.

## Riconciliazione

Regole pure in [rules.ts](../src/server/reconciliation/rules.ts) (testate senza DB), applicate da [engine.ts](../src/server/reconciliation/engine.ts):

| Regola | Criterio | Esito |
|---|---|---|
| R1 | id transazione ordine presente nel record del gateway | automatica |
| R2 | riferimento ordine esplicito + importo + valuta | automatica; se l'importo differisce → da verificare (pagamento parziale/multiplo) |
| R3 | stesso importo, valuta, ±3 giorni, nessun riferimento | **mai automatica**: HIGH se unico candidato, LOW se ambigua |
| R4 | rimborso/chargeback con riferimento ordine | da verificare |
| P1 | id payout nella causale bancaria + importo netto | automatica |
| P2 | importo netto + finestra date + parola chiave gateway in causale | da verificare (HIGH) |
| P3 | importo netto + finestra date | da verificare (LOW) |
| I1 | `DatiOrdineAcquisto` = ordine + totale coincidente | automatica |
| I2/I3 | riferimento ordine in causale/righe | da verificare |

Ogni proposta ha `pairKey` univoca (niente duplicati), `rule`, `explanation` e `amountDifference`. Le decisioni umane (`CONFIRMED`/`REJECTED`) sono definitive, auditate e chiudono le proposte concorrenti.

## Sicurezza (sintesi — vedi SECURITY.md)

Sessioni server-side con token hash, MFA obbligatoria, ruoli lineari `VIEWER < OPERATIONS < ACCOUNTANT < ADMIN < OWNER`, segreti cifrati con chiave rotabile, verifica HMAC webhook, XML senza DOCTYPE/entità, storage privato con chiavi opache, rate limit, CSP e header di sicurezza, audit log.
