# Deployment (cloud UE)

## Topologia consigliata

```
 Internet ─► reverse proxy TLS (Caddy/nginx o LB del provider)
               ├─► web: `npm start`  (Next.js, 1..n istanze)        → porta 3000
               └─► worker: `npm run worker` (1..n istanze)
 PostgreSQL 16/17 gestito, regione UE (backup automatici, PITR)
 Volume cifrato UE o bucket S3-compatibile UE per `STORAGE_LOCAL_DIR`
```

Provider con regioni UE adatti a questo stack: Hetzner (DE/FI) + PostgreSQL gestito o self-hosted, Scaleway (FR/NL), OVHcloud (FR), Aiven/Neon/Supabase in regione `eu-*`. Evitare regioni extra-UE per DB e storage.

## Variabili d'ambiente (produzione)

| Variabile | Valore |
|---|---|
| `DATABASE_URL` | PostgreSQL gestito UE, `sslmode=require` |
| `APP_ENCRYPTION_KEY` | 32 byte base64 da secret manager — **perderla significa reinserire tutte le credenziali** |
| `APP_ENCRYPTION_KEY_PREVIOUS` | solo durante una rotazione |
| `APP_URL` | `https://os.moai…` (usato per cookie e URL webhook) |
| `DEMO_MODE` | `false` |
| `STORAGE_LOCAL_DIR` | path su volume cifrato (es. `/srv/moai/storage`) |
| `SHOPIFY_API_VERSION` | `2026-10` (aggiornare ogni trimestre insieme alla versione webhook dell'app) |
| `INLINE_WORKER` | **non impostare** (worker dedicato) |
| `WORKER_POLL_MS`, `WORKER_SCHEDULE_MINUTES` | 3000, 15 |

## Procedura

```bash
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy        # migrazioni, idempotente
npm start                        # web
npm run worker                   # worker (processo/servizio separato)
```

Con Docker: immagine `node:22-alpine`, `npm ci && npm run build`, due servizi dallo stesso image con comandi diversi; `prisma migrate deploy` come init job. Health check: `GET /api/health` (verifica DB e stato coda).

Primo avvio: aprire `/setup` **subito** (si disattiva dopo il primo utente) oppure creare l'OWNER con `npm run admin:create -- --email … --role OWNER` dopo aver creato l'organizzazione.

## Backup e test di ripristino

- **Database**: backup automatici del provider + `pg_dump -Fc` giornaliero cifrato (age/gpg) conservato 30 giorni in un bucket UE separato. PITR attivo se disponibile.
- **Documenti** (`STORAGE_LOCAL_DIR`): snapshot del volume o sync cifrato giornaliero verso bucket UE. I file sono indicizzati per SHA-256: un ripristino parziale è verificabile confrontando `Document.sha256`.
- **Chiave di cifratura**: custodita nel secret manager e in una copia offline sigillata; senza di essa il backup DB non permette di riusare le credenziali delle integrazioni (i dati di business restano leggibili).
- **Test di ripristino (mensile)**: 1) nuovo database vuoto; 2) `pg_restore`; 3) `npx prisma migrate status` deve dire *up to date*; 4) avvio app con `DEMO_MODE=false` e `APP_URL` di staging; 5) login con MFA, apertura di un ordine, di una fattura e download del suo XML (verifica storage); 6) `GET /api/health` ok; 7) annotare data, durata e responsabile in `docs/restore-log.md`.

## Osservabilità

- Pagina **Sync**: stato worker (ultimo job completato), job in coda/falliti/morti, ultimo webhook.
- `GET /api/health` per il monitor esterno (503 se il DB non risponde).
- Log applicativi su stdout (`[worker]`, `[webhook shopify]`), senza segreti.
- Alert consigliati: job `DEAD` > 0 per oltre 1 h; nessun job completato da 2× `WORKER_SCHEDULE_MINUTES`; connessione in `ERROR`.

## Aggiornamenti

1. `git pull`, `npm ci`, `npm run build`.
2. `npx prisma migrate deploy` (le migrazioni sono additive; verificare il changelog).
3. Riavvio web e worker (i job `RUNNING` interrotti vengono rilasciati dopo 30 minuti e ritentati).
4. Shopify: controllare ogni trimestre la versione API (`SHOPIFY_API_VERSION`) e la versione webhook nell'app.
