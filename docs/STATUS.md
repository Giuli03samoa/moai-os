# Stato — MOAI OS 2.0 (agente) e MVP v1.0

## 2.0 · "MOAI OS come sistema operativo con assistente" — 4 novembre 2026

| Componente | Stato | Nota |
|---|---|---|
| Motore agente (Claude, tool tipizzati, streaming SSE, storico append-only, costi) | ✅ codice · ⏳ collaudo | Verificato senza chiave API: UI, approvazioni, monitor, briefing a regole. La prima conversazione reale richiede `ANTHROPIC_API_KEY`. |
| 25 strumenti di lettura, 14 di scrittura interna, 4 con approvazione umana | ✅ | Nessuno scrive su Shopify/Aruba/Packlink/gateway/SdI. Test sul registro. |
| Approvazioni umane (AgentApproval) con esecuzione a nome dell'approvatore e audit | ✅ | Scadenza 7 giorni. |
| Monitor avvisi (15 regole deterministiche, dedupe, auto-risoluzione) | ✅ | Job `agent.monitor` ogni 15 min; regole testate. |
| Briefing giornaliero (Claude o regole) | ✅ | Job `agent.briefing` dalle 7:00; rigenerabile dal cockpit. |
| Cockpit, Attività, Avvisi, Approvazioni, Memoria | ✅ | |
| Design Studio: progetti, sketch SVG con brand check, mockup, riferimenti, tech pack stampabile | ✅ | Brand check e mockup testati. |
| Produzione e costi: fornitori, ordini di produzione, spese, stima margine | ✅ | Dati gestionali, non contabili. |
| Marketing: connettori Meta (Instagram/Facebook/Ads), GA4, Klaviyo | ✅ codice · ✗ collaudo | Sola lettura. Nessun account reale collegato: la verifica registra in Capabilities cosa restituisce l'API. |
| Telegram (briefing e avvisi critici in uscita, messaggi dell'agente con approvazione) | ✅ codice · ✗ collaudo | Nessun bot configurato. |
| Server MCP (`/api/mcp`, solo lettura, token hashati) | ✅ | Test JSON-RPC; da provare con Claude Code. |
| Test | ✅ | 67 unitari (38 preesistenti + 29 nuovi) verdi; 5 di integrazione preesistenti. |

## MVP v1.0 — Definition of Done

Aggiornato al 17 ottobre 2026. ✅ verificato · ⏳ bloccato da credenziali/autorizzazioni (codice pronto, collaudo da fare) · ✗ non fatto.

| Criterio | Stato | Evidenza / nota |
|---|---|---|
| L'applicazione si avvia correttamente | ✅ | `npm run db:local` + `db:migrate` + `dev`; `/api/health` → `{"ok":true}`; `typecheck` pulito; flusso setup → MFA → dashboard eseguito in locale |
| La connessione Shopify funziona con credenziali autorizzate | ✅ | **Collaudata il 28/10/2026** con l'app Dev Dashboard installata sul negozio reale (client credentials): verifica `CONNECTED`, scope letti dall'API, 12 prodotti / 121 varianti importati, sync ordini, clienti e Shopify Payments eseguite senza errori (payout e transazioni: 0, il negozio non ha ancora attività). Due correzioni emerse dal collaudo: scope `read_shopify_payments_accounts` obbligatorio per `shopifyPaymentsAccount`; sort key `PROCESSED_AT` per `balanceTransactions`. |
| Ordini importati e aggiornati senza duplicazioni | ✅ (locale) / ⏳ (reale) | Upsert idempotente su `(org, source, externalId)`, aggiornamenti stale ignorati, righe/transazioni/fulfillment riconciliati per id — test di integrazione verde. Sul negozio reale la pipeline gira (1 pagina, 0 ordini: nessun ordine negli ultimi 60 giorni); da confermare con i primi ordini veri o con `read_all_orders`. |
| Fatture XML lette e archiviate correttamente | ✅ | Parser FatturaPA (FPR12) + P7M (CAdES, anche costruito/indefinito, base64), dedupe fiscale, righe, scadenze, classificazione emesse/ricevute per P.IVA, warning su totali — test unit + integrazione verdi. Firma P7M non verificata (dichiarato). |
| Riconciliazione distingue pagamenti, commissioni e accrediti | ✅ | Due ledger (ordine/gateway) + payout + banca; regole R1–R3/P1–P3/I1–I3 testate; dashboard spiega che pagamenti e accrediti non sono ricavi aggiuntivi. |
| Stati di spedizione associati agli ordini | ✅ (da Shopify/CSV/manuale) / ⏳ (lookup API Packlink) | Fulfillment → `Shipment` con tracking; CSV Packlink arricchisce la stessa riga. **API key Packlink PRO collaudata il 28/10/2026** (probe ok); la lettura di una singola spedizione verrà confermata automaticamente dal job di refresh alla prima spedizione reale. |
| Errori di sincronizzazione visibili e recuperabili | ✅ | Pagina Sync con stati, tentativi, log redatto, retry/annulla; job `DEAD` evidenziati in Overview; test coda verde. |
| Il sistema supera i test dei principali casi operativi | ✅ | 38 test unitari + 5 di integrazione (archivio fatture, upsert ordini, riconciliazione, coda) — vedi `npm test`, `npm run test:integration`. |
| Nessuna operazione finanziaria o fiscale irreversibile automatizzata | ✅ | Nessuna scrittura verso Shopify/Aruba/Packlink/gateway; niente invio SdI; marcature reversibili e auditate. |

## Blocchi da sbloccare con il brand

1. **Shopify** — creare l'app nel Dev Dashboard dell'organizzazione del negozio, rilasciare la versione con gli scope in sola lettura, installarla, inserire Client ID/secret in Integrations. Richiedere `read_all_orders` se serve lo storico > 60 giorni e `read_shopify_payments_payouts` per i payout.
2. **Aruba** — confermare se l'account FE è Premium (o ottenere delega). Se Base: usare l'upload XML/P7M (già funzionante) o l'export massivo dal portale Aruba.
3. **Gateway** — identificare gli account reali (PayPal business? Stripe? Satispay? Klarna/Scalapay?). Nel frattempo i CSV con i preset coprono l'operatività; la sync API diretta si attiva dopo il collaudo.
4. **Packlink PRO** — API key dal pannello PRO + un riferimento spedizione reale per la verifica capacità; esportare il CSV spedizioni per avere i costi.
5. **Banca** — export CSV dell'estratto conto (formato da mappare una volta, poi preset salvato).
6. **P.IVA e fuso orario** dell'organizzazione in Settings prima del primo caricamento fatture.

## Non incluso nell'MVP (volutamente)

- Invio fatture allo SdI, conservazione a norma, verifica firma P7M.
- Sync API diretta PayPal/Stripe (prevista dopo identificazione account).
- Grafici: Analytics usa tabelle e barre di quota; una libreria grafica può essere aggiunta sopra `getDailySales`.
- Rate limiter distribuito, SSO, notifiche email/Slack sugli errori di sync.
