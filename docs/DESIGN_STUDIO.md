# Design Studio

Spazio per le grafiche dei capi, le capsule e i drop, dentro il sistema MOAI (brand guide Softriver 2026).

## Oggetti

- **DesignProject**: nome, linea (ESSENTIALS, MOTION, Capsule, Merch), fase (Idea → Concept → Brief → Campione → Approvato → In produzione → Archiviato), concept in una frase, narrativa, riferimenti di tendenza, capi, data target, brief in markdown, note. Può avere ordini di produzione collegati.
- **DesignAsset**: sketch SVG, mockup SVG, riferimenti caricati (PNG/JPEG/WebP/GIF/PDF in archivio privato), tech pack.

## Brand check (`src/server/design/brand-check.ts`)

Ogni SVG salvato passa un controllo puro, testato:

- **errori** (l'asset viene rifiutato): colori fuori palette (ammessi solo Black Out #222222, Early Crocus #EAE7E7, Graphite #6E7180, Space #9DA2B3, Steel #BCBFCC, Smoke #D3D6E0, Cloud #EDEFF7), gradienti, font diverso da Geist, `<script>`, gestori di eventi, `<foreignObject>`, riferimenti esterni (http, //, javascript:), data URI non immagine, contorni sul logo;
- **avvertenze** (salvato, segnalato): opacità, rotazioni non ortogonali, filtri, viewBox mancante, nessun colore esplicito.

Gli SVG vengono serviti da `/api/design/assets/[id]` come immagine con una CSP che vieta script e rete, e mostrati solo dentro `<img>`.

## Asset ufficiali

`public/brand/` contiene logo primario/secondario, icona nelle due varianti e lo swatch del pattern chevron (dal kit Softriver). Negli sketch si usano i token `{{LOGO_BLACK}}`, `{{LOGO_CREAM}}`, `{{ICON_BLACK}}`, `{{ICON_CREAM}}` (sostituiti con il PNG reale come data URI) e `{{PATTERN_CHEVRON_DEFS}}` (pattern `#moai-chevron` in Graphite). Così l'assistente non ridisegna mai il marchio.

## Mockup (`mockup.ts`)

Compone uno sketch su una silhouette schematica (tee, hoodie, tote) in Black Out o Early Crocus nel riquadro scelto: petto sinistro, centro petto, retro alto, retro centro, manica, orlo. Serve a valutare posizione e scala, non è una foto prodotto.

## Tech pack

`/design/[id]/techpack`: pagina stampabile (Cmd+P → PDF) con concept, brief, grafiche e posizionamenti, palette, tipografia e regole del logo.

## Con l'assistente

Il pulsante "Chiedi all'assistente" apre una conversazione già impostata sul progetto. L'assistente carica le skill `design-direction`, `brand-guide` e `sketch-svg`, chiede il concept se manca, propone 2–3 direzioni dichiarando i riferimenti (UVU, Patencials, On, Satisfy, District Vision, Represent 247, Soar), scrive lo sketch SVG, lo salva (dopo brand check), genera il mockup e il brief per lo stampatore.
