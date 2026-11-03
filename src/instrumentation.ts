/**
 * Next.js instrumentation hook. With INLINE_WORKER=true the job worker runs inside the
 * web process (handy for development and for a single-VM deployment). In production
 * prefer a dedicated `npm run worker` process and leave INLINE_WORKER unset.
 *
 * The NEXT_RUNTIME check must be the outer `if`: Next replaces it at build time so the
 * Edge compile drops the branch and never tries to bundle Node-only modules.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.INLINE_WORKER === "true") {
      const g = globalThis as unknown as { __moaiInlineWorker?: boolean };
      if (g.__moaiInlineWorker) return;
      g.__moaiInlineWorker = true;
      const { startWorkerLoop } = await import("./server/jobs/worker");
      void startWorkerLoop({
        workerId: `inline:${process.pid}`,
        pollMs: Number(process.env.WORKER_POLL_MS ?? 3000),
        scheduleMinutes: Number(process.env.WORKER_SCHEDULE_MINUTES ?? 15),
        log: (l) => console.log(`[worker] ${l}`),
      });
    }
  }
}
