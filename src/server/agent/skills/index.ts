import fs from "fs";
import path from "path";

/**
 * Skills = markdown playbooks the agent loads on demand (progressive disclosure keeps the system
 * prompt short and cacheable). Files live next to this module; descriptions are listed in the
 * system prompt, contents arrive through the `load_skill` tool.
 */
export const SKILLS: Array<{ name: string; file: string; description: string }> = [
  { name: "brand-guide", file: "brand-guide.md", description: "Identità, palette, tipografia, regole logo, tono e tagline MOAI (versione operativa)." },
  { name: "brand-guide-full", file: "brand-guide-full.md", description: "Testo integrale delle brand guidelines Softriver: visione, analisi competitiva, direzione fotografica." },
  { name: "brand-story", file: "brand-story.md", description: "Origin story 'The Name' (perché il brand si chiama MOAI), copy pronto per caroselli e about us." },
  { name: "design-direction", file: "design-direction.md", description: "Direzione creativa per grafiche di capi e capsule: 7 riferimenti, trend 2026, processo e regole." },
  { name: "design-moodboard", file: "design-moodboard.md", description: "Profili estesi dei 7 brand di riferimento (UVU, Patencials, On, Satisfy, District Vision, Represent 247, Soar)." },
  { name: "sketch-svg", file: "sketch-svg.md", description: "Come scrivere uno sketch SVG valido per il Design Studio: palette, Geist, token del logo, pattern chevron, mockup." },
  { name: "finance-analysis", file: "finance-analysis.md", description: "Metodo da CFO: ricavi vs pagamenti vs payout, margine stimato, cassa, KPI." },
  { name: "reconciliation-playbook", file: "reconciliation-playbook.md", description: "Come esaminare e proporre decisioni sulle riconciliazioni pagamenti/payout." },
  { name: "drop-launch-checklist", file: "drop-launch-checklist.md", description: "Checklist operativa per lanciare un drop o una capsule, da trasformare in task." },
  { name: "customer-care", file: "customer-care.md", description: "Bozze di risposta ai clienti nel tono MOAI, partendo dai dati di ordine e spedizione." },
];

export function skillDir() {
  return path.join(process.cwd(), "src", "server", "agent", "skills");
}

export function loadSkill(name: string): string | null {
  const s = SKILLS.find((x) => x.name === name);
  if (!s) return null;
  try {
    return fs.readFileSync(path.join(skillDir(), s.file), "utf8");
  } catch {
    return null;
  }
}
