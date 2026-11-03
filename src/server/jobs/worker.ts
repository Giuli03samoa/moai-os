import type { Prisma, SyncJob } from "@prisma/client";
import { db } from "../db";
import { redact } from "../crypto";
import { ConnectorError } from "../connectors/types";
import { handlers } from "./handlers";
import { backoffMs, claimNext, enqueue, releaseStaleJobs } from "./queue";
import { scheduleDueJobs } from "./scheduler";
import type { JobContext } from "./types";

export async function runJob(job: SyncJob): Promise<void> {
  const lines: string[] = [...job.log];
  let result: Record<string, unknown> = (job.result as Record<string, unknown>) ?? {};
  let continuation: Record<string, unknown> | null = null;
  const ctx: JobContext = {
    job,
    organizationId: job.organizationId,
    payload: (job.payload as Record<string, unknown>) ?? {},
    log: (line) => {
      lines.push(`${new Date().toISOString()} ${redact(line)}`);
      if (lines.length > 500) lines.splice(0, lines.length - 500);
    },
    checkpoint: async (partial) => {
      result = { ...result, ...partial };
      await db.syncJob.update({ where: { id: job.id }, data: { result: result as Prisma.InputJsonValue, log: lines } });
    },
    continueWith: async (payload) => {
      continuation = payload;
    },
  };
  const handler = handlers[job.type];
  try {
    if (!handler) throw new ConnectorError(`Nessun handler per il job ${job.type}`);
    const out = await handler(ctx);
    result = { ...result, ...(out ?? {}) };
    await db.syncJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), result: result as Prisma.InputJsonValue, log: lines, lockedAt: null, lockedBy: null } });
    if (continuation) {
      await enqueue({ organizationId: job.organizationId, connectionId: job.connectionId, type: job.type, payload: continuation as Prisma.InputJsonValue, dedupeKey: job.dedupeKey ?? undefined, triggeredBy: `continuation:${job.id}`, maxAttempts: job.maxAttempts });
    }
  } catch (e) {
    const err = e as Error;
    const retryable = !(err instanceof ConnectorError) || err.retryable;
    const exhausted = job.attempts >= job.maxAttempts;
    const dead = exhausted || !retryable;
    ctx.log(`Errore: ${err.message}`);
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: dead ? "DEAD" : "FAILED",
        lastError: redact(err.message).slice(0, 2000),
        finishedAt: dead ? new Date() : null,
        runAt: dead ? job.runAt : new Date(Date.now() + backoffMs(job.attempts, err instanceof ConnectorError ? err.retryAfterMs : undefined)),
        result: result as Prisma.InputJsonValue,
        log: lines,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}

/** Processes one job if any is due. Returns false when the queue is idle. */
export async function runOnce(workerId: string): Promise<boolean> {
  const job = await claimNext(workerId);
  if (!job) return false;
  await runJob(job);
  return true;
}

export async function startWorkerLoop(opts: { workerId: string; pollMs: number; scheduleMinutes: number; signal?: AbortSignal; log?: (l: string) => void }) {
  const log = opts.log ?? (() => {});
  let lastSchedule = 0;
  let lastStaleCheck = 0;
  log(`Worker ${opts.workerId} avviato (poll ${opts.pollMs}ms, schedule ogni ${opts.scheduleMinutes}min)`);
  while (!opts.signal?.aborted) {
    try {
      const now = Date.now();
      if (now - lastStaleCheck > 5 * 60_000) {
        const r = await releaseStaleJobs();
        if (r.count) log(`Rilasciati ${r.count} job bloccati`);
        lastStaleCheck = now;
      }
      if (now - lastSchedule > opts.scheduleMinutes * 60_000) {
        const n = await scheduleDueJobs();
        if (n) log(`Pianificati ${n} job`);
        lastSchedule = now;
      }
      const worked = await runOnce(opts.workerId);
      if (!worked) await new Promise((r) => setTimeout(r, opts.pollMs));
    } catch (e) {
      log(`Errore nel loop del worker: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, opts.pollMs * 3));
    }
  }
  log("Worker fermato");
}
