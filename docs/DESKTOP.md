# MOAI OS sul desktop

MOAI OS ha un'app nativa per macOS, **MOAI OS.app**: una finestra vera (icona nel Dock, menu, scorciatoie)
che apre l'app locale `http://localhost:3000` servita dal servizio launchd (vedi `DEPLOYMENT.md`).

## Installare / aggiornare

```bash
npm run desktop:build      # compila desktop/MOAIOS.swift e installa ~/Applications/MOAI OS.app
npm run desktop:icons      # rigenera le icone dal monogramma ufficiale (public/brand/moai-icon-cream.png)
```

Serve solo `swiftc` (Command Line Tools di Xcode). L'app è firmata ad-hoc in locale e non va distribuita.

## Cosa fa

- Se il servizio non risponde chiede a launchd di avviarlo (`launchctl kickstart`) e aspetta, con una schermata di avvio.
- Login separato da Safari: i cookie restano nel profilo dell'app. Primo accesso con email, password e codice MFA.
- Link esterni → browser predefinito; download (CSV) → `~/Downloads`; caricamento file (XML, CSV, asset); stampa
  (tech pack → PDF) con ⌘P o con il pulsante della pagina.
- Barra del titolo trasparente: la striscia in alto trascina la finestra, doppio clic la ingrandisce.
- Chiudere la finestra la nasconde (l'icona nel Dock la riapre); ⌘Q chiude l'app. Il servizio continua a girare.
- Il sito riconosce l'app dallo user agent (`MOAIOSDesktop`) e lascia spazio ai pulsanti della finestra.

## Scorciatoie

| Tasti | Azione |
|---|---|
| ⌘K oppure / | Cerca una pagina, cerca dentro ordini/fatture/prodotti, chiedi all'assistente, cambia tema |
| ⌘J | Assistente |
| ⌘\\ | Riduci/espandi la barra laterale |
| ⇧⌘H | Panoramica |
| ⌘[ / ⌘] | Indietro / avanti |
| ⌘R | Ricarica |
| ⌘+ / ⌘- / ⌘0 | Zoom |

## Interfaccia (2026-11-09)

Tema chiaro (Early Crocus), scuro (Black Out) o automatico come il Mac, dal menu utente o da ⌘K.
I colori restano quelli della brand guide: in tema scuro gli stessi nomi (`blackout`, `crocus`, …) vengono
rimappati in `globals.css`, quindi le pagine non hanno classi dedicate al tema. `theme-light` forza il chiaro
(tech pack, stampa), `theme-ink` forza il fondo Black Out (briefing, pannelli col logo).
