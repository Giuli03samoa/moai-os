import type { Prisma } from "@prisma/client";
import { db } from "../db";

/**
 * Persistent job queue on PostgreSQL (the SyncJob table *is* the queue).
 * - Survives restarts; every job, error and retry is visible in the UI.
 * - Workers claim jobs with FOR UPDATE SKIP LOCKED (safe with N workers).
 * - dedupeKey: at most one QUEUED/RUNNING job per key, e.g. "shopify.orders.sync:<conn>".
 */
export async function enqueue(args: {
  organizationId: string;
  type: string;
  payload?: Prisma.InputJsonValue;
  connectionId?: string | null;
  dedupeKey?: string;
  triggeredBy: string;
  runAt?: Date;
  maxAttempts?: number;
}) {
  return db.$transaction(async (tx) => {
    if (args.dedupeKey) {
      // Serialize enqueues per key to make the dedupe check race-free.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${args.dedupeKey}))`;
      const existing = await tx.syncJob.findFirst({
        where: { dedupeKey: args.dedupeKey, status: { in: ["QUEUED", "RUNNING"] } },
      });
      if (existing) return { job: existing, deduplicated: true };
    }
    const job = await tx.syncJob.create({
      data: {
        organizationId: args.organizationId,
        connectionId: args.connectionId ?? null,
        type: args.type,
        payload: args.payload ?? {},
        dedupeKey: args.dedupeKey,
        triggeredBy: args.triggeredBy,
        runAt: args.runAt ?? new Date(),
        maxAttempts: args.maxAttempts ?? 5,
      },
    });
    return { job, deduplicated: false };
  });
}

export async function claimNext(workerId: string) {
  // Prisma stores DateTime as UTC in `timestamp(3)` (no tz): a bare now() would be in the DB
  // session timezone and shift lock/start times and backoff by the local UTC offset.
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "SyncJob" SET status = 'RUNNING', "lockedAt" = (now() at time zone 'utc'), "lockedBy" = ${workerId},
           "startedAt" = (now() at time zone 'utc'), attempts = attempts + 1, "updatedAt" = (now() at time zone 'utc')
    WHERE id = (
      SELECT id FROM "SyncJob"
      WHERE status IN ('QUEUED', 'FAILED') AND "runAt" <= (now() at time zone 'utc')
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  if (!rows[0]) return null;
  return db.syncJob.findUnique({ where: { id: rows[0].id } });
}

/** Exponential backoff: 30s, 2m, 8m, 32m, ~2h. Retry-After from APIs wins when larger. */
export function backoffMs(attempt: number, retryAfterMs?: number) {
  const base = 30_000 * 4 ** Math.max(0, attempt - 1);
  return Math.max(Math.min(base, 3 * 60 * 60 * 1000), retryAfterMs ?? 0);
}

/** Jobs left RUNNING by a crashed worker are released after 30 minutes. */
export async function releaseStaleJobs() {
  return db.syncJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
    data: { status: "FAILED", lastError: "Worker interrotto: job rilasciato per un nuovo tentativo", lockedAt: null, lockedBy: null },
  });
}

/** Manual retry from the UI (also for DEAD jobs). */
export async function retryJob(organizationId: string, jobId: string, userId: string) {
  const job = await db.syncJob.findFirst({ where: { id: jobId, organizationId } });
  if (!job) throw new Error("Job non trovato");
  if (job.status === "RUNNING" || job.status === "QUEUED") return job;
  return db.syncJob.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      runAt: new Date(),
      attempts: 0,
      lastError: null,
      log: { push: `Ritentato manualmente da ${userId} il ${new Date().toISOString()}` },
    },
  });
}
