import type { ConnectorDefinition, VerifyResult } from "../types";
import { MetaClient, type IgAccount } from "./client";

export const metaConnector: ConnectorDefinition = {
  key: "meta",
  provider: "META",
  displayName: "Meta · Instagram & Ads",
  description: "Follower, reach e performance dei post Instagram; spesa e risultati delle campagne Meta Ads (sola lettura).",
  secretFields: [{ name: "accessToken", label: "Access token (long-lived / System User)", type: "password", required: true, help: "Meta Business Suite → Impostazioni business → Utenti di sistema → Genera token con instagram_basic, instagram_manage_insights, pages_read_engagement, ads_read" }],
  configFields: [
    { name: "igBusinessAccountId", label: "Instagram Business Account ID", type: "text", help: "ID numerico dell'account Instagram professionale collegato alla pagina Facebook" },
    { name: "facebookPageId", label: "Facebook Page ID", type: "text" },
    { name: "adAccountId", label: "Ad Account ID (senza act_)", type: "text", help: "Solo per leggere spesa e risultati delle campagne" },
    { name: "apiVersion", label: "Versione Graph API", type: "text", placeholder: "v23.0" },
  ],
  jobs: [{ type: "meta.insights.sync", label: "Aggiorna metriche Meta", description: "Follower, reach giornaliero, ultimi 25 post e spesa pubblicitaria degli ultimi 7 giorni", scheduled: true }],
  notes: [
    "Sola lettura: MOAI OS non pubblica, non risponde e non modifica campagne.",
    "Il token deve essere long-lived (System User): i token utente scadono dopo 60 giorni e la connessione passerà in ERRORE.",
    "Non ancora collaudato su un account reale: la prima verifica registra in Capabilities quali metriche l'API restituisce davvero.",
  ],
  async verify(ctx): Promise<VerifyResult> {
    if (!ctx.secrets.accessToken) return { status: "NOT_CONFIGURED", message: "Inserisci l'access token" };
    const client = new MetaClient({ accessToken: ctx.secrets.accessToken, version: String(ctx.config.apiVersion || "v23.0"), log: ctx.log });
    const me = await client.get<{ id: string; name?: string }>("/me", { fields: "id,name" });
    const capabilities: Record<string, boolean | string> = { token: `valido (${me.name ?? me.id})`, writes: "disabilitate per progetto" };
    const ig = String(ctx.config.igBusinessAccountId ?? "").trim();
    const page = String(ctx.config.facebookPageId ?? "").trim();
    const ad = String(ctx.config.adAccountId ?? "").trim();
    const problems: string[] = [];
    if (ig) {
      try {
        const acc = await client.get<IgAccount>(`/${ig}`, { fields: "id,username,followers_count,media_count" });
        capabilities.instagram = `@${acc.username ?? ig} · ${acc.followers_count ?? "?"} follower`;
      } catch (e) {
        capabilities.instagram = `errore: ${(e as Error).message}`;
        problems.push("Instagram");
      }
    } else capabilities.instagram = "non configurato";
    if (page) {
      try {
        const p = await client.get<{ name?: string; followers_count?: number }>(`/${page}`, { fields: "name,followers_count" });
        capabilities.facebookPage = `${p.name ?? page} · ${p.followers_count ?? "?"} follower`;
      } catch (e) {
        capabilities.facebookPage = `errore: ${(e as Error).message}`;
        problems.push("Pagina Facebook");
      }
    } else capabilities.facebookPage = "non configurata";
    if (ad) {
      try {
        const a = await client.get<{ name?: string; currency?: string; account_status?: number }>(`/act_${ad}`, { fields: "name,currency,account_status" });
        capabilities.adAccount = `${a.name ?? ad} · ${a.currency ?? ""} · stato ${a.account_status ?? "?"}`;
      } catch (e) {
        capabilities.adAccount = `errore: ${(e as Error).message}`;
        problems.push("Ad account");
      }
    } else capabilities.adAccount = "non configurato";
    if (!ig && !page && !ad) return { status: "BLOCKED", message: "Token valido ma nessun account configurato", blockedReason: "Inserisci almeno l'Instagram Business Account ID", capabilities };
    if (problems.length) return { status: "BLOCKED", message: `Token valido; accesso negato a: ${problems.join(", ")}`, blockedReason: `Permessi o ID da verificare: ${problems.join(", ")}`, capabilities };
    return { status: "CONNECTED", message: `Connesso: ${[capabilities.instagram, capabilities.facebookPage, capabilities.adAccount].filter((v) => v && !String(v).startsWith("non ")).join(" · ")}`, capabilities };
  },
};
