/** Minimal markdown → email HTML (headings, bold, lists, tables, paragraphs). No raw HTML passes through. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { const lvl = h[1]!.length + 1; out.push(`<h${lvl} style="font-weight:500;margin:18px 0 6px">${inline(h[2]!)}</h${lvl}>`); i++; continue; }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(`<table style="border-collapse:collapse;width:100%;font-size:14px">${head ? `<tr>${head.map((c) => `<th style="text-align:left;border-bottom:1px solid #D3D6E0;padding:4px 6px;font-size:11px;text-transform:uppercase;color:#6E7180">${inline(c)}</th>`).join("")}</tr>` : ""}${body.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid #EDEFF7;padding:4px 6px">${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*[-*]\s+/, "")); i++; }
      out.push(`<ul style="margin:6px 0 6px 18px;padding:0">${items.map((t) => `<li style="margin:3px 0">${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|\|.*\||\s*[-*]\s)/.test(lines[i]!)) { para.push(lines[i]!); i++; }
    out.push(`<p style="margin:6px 0">${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#EAE7E7;font-family:Geist,-apple-system,Helvetica,Arial,sans-serif;color:#222222"><div style="max-width:640px;margin:0 auto;padding:24px"><div style="background:#222222;color:#EAE7E7;padding:14px 20px;border-radius:12px 12px 0 0"><span style="font-size:18px;font-weight:500;letter-spacing:-0.04em">MOAI</span> <span style="font-size:11px;letter-spacing:0.2em;color:#9DA2B3">OS</span><div style="font-size:12px;color:#9DA2B3;margin-top:4px">${esc(title)}</div></div><div style="background:#ffffff;padding:20px;border-radius:0 0 12px 12px;font-size:15px;line-height:1.5">${bodyHtml}</div><p style="font-size:11px;color:#6E7180;margin-top:12px">Inviato da MOAI OS · Discipline Over Noise</p></div></body></html>`;
}
