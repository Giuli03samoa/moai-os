# Sicurezza

| Requisito | Implementazione |
|---|---|
| **MFA** | TOTP (RFC 6238, 6 cifre, finestra ±1) obbligatoria per tutti: senza MFA attiva nessuna pagina applicativa è raggiungibile. 8 codici di recupero monouso (hash scrypt). Reset MFA da parte di un ADMIN con revoca sessioni. |
| **Password** | scrypt (N=2¹⁵, r=8, p=1), policy ≥12 caratteri con maiuscole/minuscole/numeri, normalizzazione NFKC. Lockout 15 min dopo 5 tentativi (persistito su DB) + rate limit per IP ed email. |
| **Sessioni** | Token casuale 256 bit in cookie `httpOnly`, `SameSite=Lax`, `Secure` in produzione; sul DB solo lo SHA-256. Scadenza 12 h, inattività 2 h, revoca esplicita, `mfaVerified` per sessione. |
| **Least privilege** | Ruoli lineari `VIEWER < OPERATIONS < ACCOUNTANT < ADMIN < OWNER`; ogni Server Action chiama `requireAuth(ruoloMinimo)`. Scope Shopify in sola lettura. |
| **Segregazione per organizzazione** | Ogni query usa `organizationId` dalla sessione; vincoli `@@unique([organizationId, …])`; download documenti e webhook risolvono sempre il tenant. |
| **Secrets management** | Credenziali integrazioni e secret TOTP cifrati **AES-256-GCM** con `APP_ENCRYPTION_KEY` (32 byte); formato versionato con id chiave → rotazione tramite `APP_ENCRYPTION_KEY_PREVIOUS`. Mai inviati al browser; i form non li riespongono; i log passano da `redact()`. |
| **Webhook** | HMAC-SHA256 in confronto a tempo costante, dedupe su event id (tabella `WebhookEvent`), rate limit, payload mai usato come fonte di verità. |
| **XML** | Rifiuto di `DOCTYPE`/`ENTITY` (XXE, billion laughs), parser con entità disabilitate, limite 5 MB, estensioni ammesse `.xml/.p7m`, P7M letto con parser ASN.1 proprio senza eseguire nulla. La firma digitale **non viene verificata** (dichiarato nell'archivio). |
| **Storage documenti** | Cartella privata, chiavi opache `<org>/<sha256>`, nessun URL pubblico: download solo via route autenticata e scoped. In produzione volume cifrato UE o bucket S3-compatibile UE senza ACL pubbliche. |
| **Header HTTP** | CSP (`default-src 'self'`, `frame-ancestors 'none'`), HSTS, `X-Frame-Options DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, `poweredByHeader: false`. |
| **Rate limiting** | Login (IP+email), MFA, webhook. In-memory per istanza + lockout su DB; con più istanze sostituire con Redis. |
| **Audit log** | Accessi (riusciti/falliti/lockout), MFA, modifiche integrazioni (solo nomi campi), job, decisioni di riconciliazione, pagamenti fatture, modifiche manuali spedizioni, export, download documenti, GDPR. |
| **GDPR** | Dati personali clienti importati solo con scope + opzione esplicita; webhook `customers/redact` anonimizza mantenendo lo storico; `customers/data_request`/`shop/redact` auditati per gestione manuale; export e download tracciati; nessun dato personale in URL. |
| **CSV** | Neutralizzazione formule (`=`, `+`, `-`, `@`) in export; limiti dimensione/righe in import. |
| **Nessuna credenziale nei sorgenti** | `.env` ignorato da git; `.env.example` senza valori reali; demo con dati fittizi. |
| **Operazioni irreversibili** | Nessuna: niente invio SdI, niente pagamenti, niente scritture su Shopify/Packlink. Le marcature (pagato, confermato) sono reversibili e auditate. |

## Backup e ripristino

Vedi [DEPLOYMENT.md](DEPLOYMENT.md#backup-e-test-di-ripristino): dump giornaliero cifrato + storage documenti, test di ripristino mensile documentato.

## Cose da fare prima della produzione

- Impostare `APP_URL` HTTPS reale e `secure` cookie (automatico con `NODE_ENV=production`).
- Chiave di cifratura in un secret manager (non in file), rotazione pianificata.
- Rate limiter distribuito se >1 istanza web.
- Verifica firma P7M (opzionale) se si vuole dipendere dall'archivio interno per controlli formali.


## Assistente (2.0)

- La chiave API Anthropic vive solo in `ANTHROPIC_API_KEY` sul server; nessun segreto è nel database né nel browser.
- Ogni strumento dichiara rischio (`read` / `write` / `approval`) e ruolo minimo. Gli strumenti `approval` non eseguono nulla: creano una richiesta che una persona approva; l'esecuzione avviene con l'identità e il ruolo dell'approvatore ed è auditata (`agent.approval.*`). Le scritture interne sono auditate (`agent.tool.write`).
- Non esistono strumenti che scrivono su sistemi esterni o su denaro/fisco; l'elenco è verificato da un test.
- I risultati dei tool (note ordini, caption, descrizioni bancarie) sono dichiarati "dati, non istruzioni" nel system prompt; il contenuto proveniente dall'esterno non viene mai eseguito.
- Storico append-only, rate limit per utente, budget mensile con stop automatico, `stop_reason: refusal` gestito.
- MCP: solo lettura, token hashati con sha256, scadenza, revoca, 240 richieste/min, ruolo dell'utente proprietario come limite.
- SVG del Design Studio: controllo che rifiuta script, handler, foreignObject e riferimenti esterni; serviti come immagine con CSP `default-src 'none'` e usati solo in `<img>`.
