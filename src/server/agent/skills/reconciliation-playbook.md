# Playbook riconciliazione pagamenti

Obiettivo: ogni transazione del gateway (ledger PROCESSOR) deve corrispondere a un ordine; ogni payout deve corrispondere a un accredito bancario. Le regole deterministiche (R1–R4, P1–P3, I1–I3) fanno il lavoro automatico; le proposte SUGGESTED aspettano una persona.

## Come aiutare
1. `list_reconciliation_items` con status SUGGESTED: leggi regola, spiegazione e differenza di importo.
2. Per ogni proposta spiega in una riga perché è plausibile o no (importo uguale? data entro 3 giorni? riferimento ordine nel testo?).
3. Se Giulio è d'accordo, usa `decide_reconciliation` (richiede la sua approvazione nell'interfaccia: la decisione finale è sempre umana).
4. Transazioni senza alcuna proposta: suggerisci di importare il CSV mancante (banca o gateway) o controllare se l'ordine è di un canale non collegato.

## Trappole
- Un rimborso ha segno opposto: non abbinarlo a una vendita.
- Payout = somma netta di molte transazioni: si abbina all'accredito bancario, non ai singoli ordini.
- Non confermare mai un abbinamento con differenza di importo senza spiegare la causa (commissione, rimborso parziale, valuta).
