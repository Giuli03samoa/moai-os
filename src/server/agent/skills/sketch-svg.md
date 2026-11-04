# Come scrivere uno sketch SVG per il Design Studio

Lo sketch è un SVG scritto da te e salvato con `add_design_sketch`. Viene controllato automaticamente (brand check): colori fuori palette, gradienti, font diverso da Geist, script o riferimenti esterni lo fanno rifiutare. Correggi e riprova.

## Regole tecniche
- Radice: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">`. Area di stampa quadrata o verticale; il mockup la scala nel riquadro di posizionamento.
- Solo tinte piatte della palette: #222222 #EAE7E7 #6E7180 #9DA2B3 #BCBFCC #D3D6E0 #EDEFF7 (oppure `none`).
- Sfondo: NON disegnare il colore del capo: lascia trasparente; il mockup aggiunge il capo. Se la grafica è pensata per capo Black Out usa Early Crocus/Steel per i tratti, e viceversa.
- Testo: `font-family="Geist, sans-serif"`, `font-weight="500"` o `"400"`, `letter-spacing` negativo (-0.03em per titoli). Usa `text-anchor="middle"` per centrare.
- Niente `<script>`, `<foreignObject>`, `href` http, filtri, gradienti, opacità.
- Logo e icona ufficiali: NON ridisegnarli. Usa i token, che vengono sostituiti con il PNG reale:
  `<image href="{{ICON_CREAM}}" x="400" y="300" width="200" height="95"/>` (icona Early Crocus, rapporto 2.11:1)
  `{{ICON_BLACK}}` (icona Black Out), `{{LOGO_CREAM}}` / `{{LOGO_BLACK}}` (logo completo, rapporto 3:1).
  Rispetta le proporzioni (es. 200×95 per l'icona, 300×100 per il logo); mai stirare, ruotare o contornare.
- Pattern chevron: inserisci `{{PATTERN_CHEVRON_DEFS}}` subito dopo `<svg …>` e usa `fill="url(#moai-chevron)"` su una forma. Come dettaglio (bordo, striscia sottile), non come riempimento del capo.

## Composizioni tipiche
- Petto sinistro: solo icona 60–80 px in un viewBox 200×200.
- Retro statement: titolo H2 (75px) + riga Caption (20–24px) in Geist, allineati a sinistra o centrati, molto spazio vuoto.
- Badge: rettangolo arrotondato `rx="6"` con bordo 3px Graphite, testo Medium maiuscolo spaziato +0.15em.
- Tagline di prodotto: coppia superiore "Made to Endure" / "Built on Discipline" ai lati dell'icona, coppia inferiore "Movement with Purpose." / "Timeless Performance.".

## Dopo lo sketch
Chiama `render_mockup` con garment (tee/hoodie/tote), color (blackout/crocus), placement (chest-left, chest-center, back-center, back-top, sleeve, hem) per ottenere la vista sul capo. Poi descrivi a Giulio dimensione reale consigliata in cm e tecnica (serigrafia 1 colore, transfer, ricamo per l'icona piccola).
