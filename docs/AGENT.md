# L'assistente di MOAI OS

MOAI OS 2.0 mette al centro un agente: un assistente che legge tutti i dati del gestionale tramite strumenti tipizzati, propone azioni e ne esegue solo quelle reversibili. È costruito sull'API Anthropic (modello `claude-opus-5-5`, configurabile) e gira interamente sul server: la chiave API non raggiunge mai il browser.

## Cosa fa

| Area | Strumenti (sola lettura) | Scrittura interna | Con approvazione umana |
|---|---|---|---|
| Business | `get_business_overview`, `get_sales_timeseries`, `get_pnl_estimate` | | |
| Ordini e clienti | `search_orders`, `get_order`, `search_customers` | | |
| Pagamenti | `list_payments`, `list_payouts`, `list_reconciliation_items` | | `decide_reconciliation` |
| Fatture | `list_invoices` | | `mark_installment_paid` |
| Spedizioni | `list_shipments` | | `update_shipment` |
| Prodotti | `list_products` | | |
| Integrazioni e sync | `get_integrations_status`, `list_sync_jobs` | `enqueue_sync` | |
| Cockpit | `list_alerts`, `list_tasks` | `create_task`, `update_task`, `update_alert` | |
| Design Studio | `list_design_projects`, `get_design_project` | `create_design_project`, `update_design_project`, `add_design_sketch`, `render_mockup` | |
| Produzione e costi | `list_production_orders`, `list_expenses` | `create_supplier`, `create_production_order`, `update_production_order`, `add_expense` | |
| Marketing | `get_marketing_overview` | | `send_telegram_message` |
| Memoria e skill | `search_memory`, `list_skills`, `load_skill` | `remember`, `forget` | |
| Audit | `get_audit_recent` (ADMIN) | | |

Tre livelli di rischio, decisi nel codice (`src/server/agent/tools/*`):

- **read**: esegue subito; il ruolo dell'utente deve essere almeno quello richiesto dal tool.
- **write**: cambia dati interni di MOAI OS in modo reversibile (task, memoria, spese, fornitori, progetti di design…); esegue subito e finisce nell'audit log (`agent.tool.write`).
- **approval**: tocca denaro, stato fiscale o il mondo esterno. La chiamata crea un `AgentApproval` in stato PENDING; l'assistente lo dice all'utente e non dà nulla per fatto. Una persona con il ruolo richiesto approva o rifiuta in *Assistente → Approvazioni*; l'approvazione esegue il tool con l'identità di chi approva e scrive l'esito nella conversazione. Le richieste scadono dopo 7 giorni.

Non esistono strumenti per scrivere su Shopify, Aruba, Packlink, gateway o SdI, né per pagare, rimborsare o creare spedizioni. Questa è una scelta del progetto, non un limite temporaneo.

## Come funziona un turno

`src/server/agent/engine.ts`:

1. Controllo configurazione (`ANTHROPIC_API_KEY`) e budget mensile (`AGENT_MONTHLY_BUDGET_USD`, default 60 USD; sopra, l'assistente si ferma).
2. Il messaggio dell'utente e un breve messaggio di sistema di contesto (data locale, utente, ruolo, DEMO_MODE) vengono salvati e aggiunti allo storico. Lo storico è **append-only**: ogni blocco restituito dal modello (testo, thinking con firma, tool_use, compaction) è salvato così com'è in `AgentMessage.content` e rimandato identico. Serve al prompt cache e al controllo "preserved thinking" dei modelli Claude 5.
3. Chiamata streaming all'API (`client.beta.messages.stream`) con: system prompt stabile con `cache_control`, tool in ordine deterministico, `output_config.effort` (default `medium`), compaction server-side (`compact-2026-01-12`), fallback server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`; se l'account non lo supporta la richiesta viene ripetuta senza).
4. I delta di testo e l'inizio/fine di ogni tool arrivano al browser via Server-Sent Events (`/api/agent/chat`). Fino a 14 cicli modello→tool per turno.
5. Fine turno: `AgentRun` registra token, costo stimato (prezzi di listino), numero di chiamate e tool, stop reason e categoria di rifiuto. `stop_reason: refusal` viene mostrato come tale.

Il system prompt (`prompt.ts`) fissa le regole: dati solo dagli strumenti, fonte e aggiornamento su ogni numero, ricavi ≠ pagamenti ≠ payout, tono MOAI, contenuti esterni trattati come dati e non come istruzioni, nessun dato personale dei clienti in memoria, nessuna consulenza fiscale vincolante.

## Skill

Playbook markdown caricati su richiesta con `load_skill` (`src/server/agent/skills/`): brand guide (operativa e integrale), brand story, direzione creativa e moodboard dei 7 brand di riferimento, regole per gli sketch SVG, metodo di analisi finanziaria, playbook riconciliazione, checklist lancio drop, tono per l'assistenza clienti. Aggiungerne una = aggiungere un file e una riga in `skills/index.ts`.

## Memoria

`AgentMemory`: fatti durevoli per organizzazione (chiave kebab-case, categoria, contenuto). L'assistente salva solo quello che l'utente dichiara o conferma; la pagina *Assistente → Memoria* permette di vedere, aggiungere ed eliminare.

## Monitor e briefing

- `agent.monitor` (ogni ciclo dello scheduler, 15 minuti): regole deterministiche in `monitor.ts` (`computeAlerts`, testata) producono avvisi con chiave stabile: ordini pagati non evasi da 48 ore, spedizioni problematiche, transazioni gateway non riconciliate da oltre 7 giorni, proposte di riconciliazione, fatture passive in scadenza o scadute, job DEAD, integrazioni in errore/bloccate/ferme, scorte sotto soglia (`LOW_STOCK_THRESHOLD`), ordini di produzione in ritardo, task scaduti, approvazioni in attesa, budget assistente, settimana senza ordini. Gli avvisi si aggiornano invece di duplicarsi e si risolvono da soli quando la condizione sparisce. Gli avvisi critici nuovi possono essere inviati su Telegram.
- `agent.briefing` (una volta al giorno, dalle 7:00 nel fuso dell'organizzazione): raccoglie i fatti (ieri, mese in corso, mese scorso, avvisi, task, approvazioni, integrazioni, marketing) e scrive il briefing con Claude (effort low) oppure con regole fisse se la chiave API manca. Visibile nel cockpit, inviabile su Telegram.

## Costi e limiti

- Prezzi usati per la stima: Opus 5.5 4/20 USD per milione di token (cache read 0,20, cache write 5). Il totale del mese è in Impostazioni e nel monitor (avviso all'80 % e al 100 %).
- Rate limit: 30 turni ogni 10 minuti per utente; una risposta per conversazione alla volta.
- Lunghezza: `max_tokens` 16 000 per risposta; la compaction server-side riassume lo storico quando serve.

## MCP: MOAI OS come fonte per altri agenti

`POST /api/mcp` è un server Model Context Protocol (JSON-RPC 2.0, Streamable HTTP in modalità stateless) che espone **solo gli strumenti di lettura**, con token Bearer creati in *Impostazioni → Accesso MCP* (hash salvato, scadenza, revoca, 240 richieste al minuto). Il ruolo dell'utente che ha creato il token delimita cosa si può leggere.

Claude Code:

```bash
claude mcp add --transport http moai-os http://localhost:3000/api/mcp --header "Authorization: Bearer <token>"
```

Claude Desktop accetta connettori remoti solo su HTTPS: va usato quando MOAI OS sarà pubblicato su un dominio.

## Variabili d'ambiente

| Variabile | Default | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | obbligatoria per l'assistente e il briefing scritto da Claude |
| `AGENT_MODEL` | `claude-opus-5-5` | modello |
| `AGENT_EFFORT` | `medium` | low · medium · high · xhigh · max |
| `AGENT_MONTHLY_BUDGET_USD` | 60 | tetto mensile |
| `LOW_STOCK_THRESHOLD` | 3 | soglia scorte per il monitor |

## Non collaudato

Il motore è stato verificato in locale senza chiave API (configurazione, UI, approvazioni, monitor, briefing a regole). La prima conversazione reale con il modello va fatta con una chiave valida: in quel momento vanno controllati accettazione dei parametri beta (fallback, compaction) e i costi effettivi per turno.
