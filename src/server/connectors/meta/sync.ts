import type { Prisma } from "@prisma/client";
import { db } from "../../db";
import { markSynced, requireConnected } from "../registry";
import type { JobContext } from "../../jobs/types";
import { MetaClient, type AdInsightsRow, type IgAccount, type IgMedia, type Insights } from "./client";

const day = (d: Date) => d.toISOString().slice(0, 10);

async function upsertSnapshot(orgId: string, channel: string, date: string, metrics: Record<string, unknown>) {
  const existing = await db.marketingSnapshot.findUnique({ where: { organizationId_channel_date: { organizationId: orgId, channel, date } } });
  const merged = { ...((existing?.metrics as Record<string, unknown>) ?? {}), ...metrics };
  await db.marketingSnapshot.upsert({
    where: { organizationId_channel_date: { organizationId: orgId, channel, date } },
    create: { organizationId: orgId, source: "META_API", channel, date, metrics: merged as Prisma.InputJsonValue },
    update: { metrics: merged as Prisma.InputJsonValue, syncedAt: new Date() },
  });
}

/** Instagram account snapshot, daily reach, latest posts, ads spend. Each block is independent: a missing permission does not stop the others. */
export async function syncMetaInsights(ctx: JobContext) {
  const orgId = ctx.organizationId;
  const { connection, secrets, config } = await requireConnected(orgId, "meta");
  const client = new MetaClient({ accessToken: secrets.accessToken!, version: String(config.apiVersion || "v23.0"), log: ctx.log });
  const today = day(new Date());
  const out: Record<string, unknown> = {};
  const notes: Record<string, string> = {};
  const ig = String(config.igBusinessAccountId ?? "").trim();
  const page = String(config.facebookPageId ?? "").trim();
  const ad = String(config.adAccountId ?? "").trim();
  try {
    if (ig) {
      const acc = await client.get<IgAccount>(`/${ig}`, { fields: "id,username,followers_count,media_count" });
      await upsertSnapshot(orgId, "instagram", today, { followers: acc.followers_count ?? null, mediaCount: acc.media_count ?? null, username: acc.username ?? null });
      out.instagramFollowers = acc.followers_count ?? null;
      try {
        const since = Math.floor((Date.now() - 14 * 86_400_000) / 1000);
        const ins = await client.get<Insights>(`/${ig}/insights`, { metric: "reach", period: "day", since: String(since), until: String(Math.floor(Date.now() / 1000)) });
        let n = 0;
        for (const m of ins.data ?? []) for (const v of m.values ?? []) {
          if (!v.end_time) continue;
          const d = day(new Date(new Date(v.end_time).getTime() - 86_400_000));
          await upsertSnapshot(orgId, "instagram", d, { [m.name]: typeof v.value === "number" ? v.value : v.value ?? null });
          n++;
        }
        out.instagramInsightDays = n;
      } catch (e) {
        notes.instagramInsights = (e as Error).message;
      }
      try {
        const media = await client.get<{ data?: IgMedia[] }>(`/${ig}/media`, { fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: "25" });
        let posts = 0;
        for (const m of media.data ?? []) {
          await db.socialPost.upsert({
            where: { organizationId_source_externalId: { organizationId: orgId, source: "META_API", externalId: m.id } },
            create: { organizationId: orgId, source: "META_API", externalId: m.id, channel: "instagram", permalink: m.permalink ?? null, caption: m.caption?.slice(0, 2000) ?? null, mediaType: m.media_type ?? null, publishedAt: m.timestamp ? new Date(m.timestamp) : null, metrics: { likes: m.like_count ?? null, comments: m.comments_count ?? null } },
            update: { caption: m.caption?.slice(0, 2000) ?? null, metrics: { likes: m.like_count ?? null, comments: m.comments_count ?? null }, syncedAt: new Date() },
          });
          posts++;
        }
        out.instagramPosts = posts;
      } catch (e) {
        notes.instagramMedia = (e as Error).message;
      }
    }
    if (page) {
      try {
        const p = await client.get<{ followers_count?: number; fan_count?: number }>(`/${page}`, { fields: "followers_count,fan_count" });
        await upsertSnapshot(orgId, "facebook", today, { followers: p.followers_count ?? p.fan_count ?? null });
        out.facebookFollowers = p.followers_count ?? p.fan_count ?? null;
      } catch (e) {
        notes.facebook = (e as Error).message;
      }
    }
    if (ad) {
      try {
        const r = await client.get<{ data?: AdInsightsRow[] }>(`/act_${ad}/insights`, { fields: "spend,impressions,clicks,reach,cpc,ctr", time_increment: "1", date_preset: "last_7d" });
        let n = 0;
        for (const row of r.data ?? []) {
          if (!row.date_start) continue;
          await upsertSnapshot(orgId, "meta_ads", row.date_start, { spend: row.spend ?? null, impressions: row.impressions ?? null, clicks: row.clicks ?? null, reach: row.reach ?? null, cpc: row.cpc ?? null, ctr: row.ctr ?? null });
          n++;
        }
        out.adsDays = n;
      } catch (e) {
        notes.ads = (e as Error).message;
      }
    }
    ctx.log(`Meta: ${JSON.stringify(out)}${Object.keys(notes).length ? ` · limiti: ${JSON.stringify(notes)}` : ""}`);
    await markSynced(connection.id);
    return { ...out, notes };
  } catch (e) {
    await markSynced(connection.id, (e as Error).message);
    throw e;
  }
}
