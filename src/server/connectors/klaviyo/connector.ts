import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import { markSynced, requireConnected } from "../registry";
import type { JobContext } from "../../jobs/types";
import { ConnectorError, type ConnectorDefinition, type VerifyResult } from "../types";

/** Klaviyo (email/SMS marketing), read-only with a private API key. */
const REVISION = "2025-10-15";

async function klaviyo<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`https://a.klaviyo.com/api${path}`, { headers: { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: REVISION, Accept: "application/vnd.api+json" } });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new ConnectorError("Klaviyo: chiave non valida o senza scope di lettura", { httpStatus: res.status });
  if (res.status === 429) throw new ConnectorError("Klaviyo: rate limit", { retryable: true, retryAfterMs: 30_000, httpStatus: 429 });
  if (!res.ok) throw new ConnectorError(`Klaviyo HTTP ${res.status}: ${text.slice(0, 200)}`, { httpStatus: res.status, retryable: res.status >= 500 });
  return JSON.parse(text) as T;
}

type JsonApiList<T> = { data?: Array<{ id: string; attributes?: T }> };

export const klaviyoConnector: ConnectorDefinition = {
  key: "klaviyo",
  provider: "KLAVIYO",
  displayName: "Klaviyo (email marketing)",
  description: "Liste, iscritti e campagne email recenti (sola lettura).",
  secretFields: [{ name: "privateKey", label: "Private API key (pk_…)", type: "password", required: true, help: "Klaviyo → Settings → API keys → crea una chiave con scope di sola lettura: accounts:read, lists:read, campaigns:read, profiles:read" }],
  configFields: [],
  jobs: [{ type: "klaviyo.metrics.sync", label: "Aggiorna metriche email", description: "Numero liste e campagne inviate negli ultimi 30 giorni", scheduled: true }],
  notes: ["Sola lettura: nessun invio né modifica di liste.", "Non ancora collaudato su un account reale."],
  async verify(ctx): Promise<VerifyResult> {
    if (!ctx.secrets.privateKey) return { status: "NOT_CONFIGURED", message: "Inserisci la private API key" };
    const acc = await klaviyo<JsonApiList<{ contact_information?: { organization_name?: string }; timezone?: string }>>(ctx.secrets.privateKey, "/accounts/");
    const a = acc.data?.[0]?.attributes;
    return { status: "CONNECTED", message: `Account ${a?.contact_information?.organization_name ?? acc.data?.[0]?.id ?? "ok"}`, capabilities: { account: a?.contact_information?.organization_name ?? "ok", timezone: a?.timezone ?? "?", writes: "non previste" } };
  },
};

export async function syncKlaviyoMetrics(ctx: JobContext) {
  const orgId = ctx.organizationId;
  const { connection, secrets } = await requireConnected(orgId, "klaviyo");
  try {
    const lists = await klaviyo<JsonApiList<{ name?: string }>>(secrets.privateKey!, "/lists/");
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const campaigns = await klaviyo<JsonApiList<{ name?: string; status?: string; send_time?: string }>>(secrets.privateKey!, `/campaigns/?filter=${encodeURIComponent(`and(equals(messages.channel,'email'),greater-than(created_at,${since}))`)}&sort=-created_at`);
    const sent = (campaigns.data ?? []).filter((c) => c.attributes?.status === "Sent");
    const date = new Date().toISOString().slice(0, 10);
    const metrics = { lists: lists.data?.length ?? 0, campaigns30d: campaigns.data?.length ?? 0, campaignsSent30d: sent.length, lastCampaignAt: sent[0]?.attributes?.send_time ?? null };
    await db.marketingSnapshot.upsert({
      where: { organizationId_channel_date: { organizationId: orgId, channel: "email", date } },
      create: { organizationId: orgId, source: "KLAVIYO_API", channel: "email", date, metrics: metrics as Prisma.InputJsonValue },
      update: { metrics: metrics as Prisma.InputJsonValue, syncedAt: new Date() },
    });
    ctx.log(`Klaviyo: ${metrics.lists} liste, ${metrics.campaignsSent30d} campagne inviate in 30 giorni`);
    await markSynced(connection.id);
    return metrics;
  } catch (e) {
    await markSynced(connection.id, (e as Error).message);
    throw e;
  }
}
