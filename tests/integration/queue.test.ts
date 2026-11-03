import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { claimNext, enqueue, retryJob } from "@/server/jobs/queue";
import { runJob } from "@/server/jobs/worker";
import { makeOrg, makeUser } from "./helpers";

describe("persistent job queue", () => {
  it("deduplicates, claims, records failures and allows manual retry", async () => {
    const org = await makeOrg();
    const user = await makeUser(org.id);
    const a = await enqueue({ organizationId: org.id, type: "unknown.job", dedupeKey: `k:${org.id}`, triggeredBy: "test" });
    const b = await enqueue({ organizationId: org.id, type: "unknown.job", dedupeKey: `k:${org.id}`, triggeredBy: "test" });
    expect(a.deduplicated).toBe(false);
    expect(b.deduplicated).toBe(true);
    expect(b.job.id).toBe(a.job.id);

    const claimed = await claimNext("w1");
    expect(claimed?.status).toBe("RUNNING");
    await runJob(claimed!);
    const dead = await db.syncJob.findUniqueOrThrow({ where: { id: a.job.id } });
    expect(dead.status).toBe("DEAD"); // no handler → non-retryable
    expect(dead.lastError).toMatch(/Nessun handler/);
    expect(dead.log.some((l) => l.includes("Errore"))).toBe(true);

    // Dead jobs are visible and recoverable from the UI.
    const retried = await retryJob(org.id, a.job.id, user.id);
    expect(retried.status).toBe("QUEUED");
    expect(retried.attempts).toBe(0);

    // A reconciliation job runs end-to-end on an empty org.
    const rec = await enqueue({ organizationId: org.id, type: "reconciliation.run", triggeredBy: "test" });
    await db.syncJob.update({ where: { id: a.job.id }, data: { status: "CANCELLED" } });
    const next = await claimNext("w1");
    expect(next?.id).toBe(rec.job.id);
    await runJob(next!);
    expect((await db.syncJob.findUniqueOrThrow({ where: { id: rec.job.id } })).status).toBe("SUCCEEDED");
  });
});
