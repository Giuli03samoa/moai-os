import { describe, expect, it } from "vitest";
import { upsertProduct } from "@/server/connectors/shopify/mappers";
import { collectSnapshot } from "@/server/agent/monitor";
import { listProducts } from "@/server/agent/tools/read";
import type { ToolContext } from "@/server/agent/tools/types";
import { makeOrg } from "./helpers";

const variant = (id: string, qty: number, tracked: boolean) => ({ id, sku: id, title: id, price: "10.00", inventoryQuantity: qty, updatedAt: "2026-11-01T00:00:00Z", inventoryItem: { tracked } });
const product = (id: string, title: string, variants: ReturnType<typeof variant>[]) => ({ id, title, handle: title, status: "ACTIVE", vendor: "MOAI", productType: "Top", updatedAt: "2026-11-01T00:00:00Z", variants: { nodes: variants } });

describe("scorte tracciate e non tracciate", () => {
  it("non segnala come esaurite le varianti che Shopify non traccia", async () => {
    const org = await makeOrg();
    await upsertProduct(org.id, product("p1", "Motion Tee", [variant("v1", 0, false), variant("v2", 0, false)]));
    await upsertProduct(org.id, product("p2", "Essential Tee", [variant("v3", 2, true), variant("v4", 10, true)]));
    const snap = await collectSnapshot(org.id);
    expect(snap.lowStock.map((v) => v.sku)).toEqual(["v3"]);

    const ctx: ToolContext = { organizationId: org.id, userId: null, role: "OWNER", timezone: "Europe/Rome", currency: "EUR", channel: "web", log: () => {} };
    const out = (await listProducts.run(ctx, {})) as unknown as { productsTotal: number; summary: Array<{ product: string; trackedVariants: number; stockOfTrackedVariants: number }>; variants: Array<{ sku: string; inventory: number | null; tracked: boolean }> };
    expect(out.productsTotal).toBe(2);
    expect(out.summary.find((p) => p.product === "Motion Tee")).toMatchObject({ trackedVariants: 0, stockOfTrackedVariants: 0 });
    expect(out.summary.find((p) => p.product === "Essential Tee")).toMatchObject({ trackedVariants: 2, stockOfTrackedVariants: 12 });
    expect(out.variants.find((v) => v.sku === "v1")).toMatchObject({ inventory: null, tracked: false });
    const low = (await listProducts.run(ctx, { lowStockThreshold: 0 })) as unknown as { variantsMatching: number };
    expect(low.variantsMatching).toBe(0);
  });
});
