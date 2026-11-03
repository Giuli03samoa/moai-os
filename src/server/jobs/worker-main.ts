/**
 * Standalone worker process: `npm run worker`.
 * In development the same loop can run inside the Next.js server (INLINE_WORKER=true).
 * In production run at least one dedicated worker; several can run in parallel safely.
 */
import { hostname } from "os";
import { startWorkerLoop } from "./worker";

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

startWorkerLoop({
  workerId: `${hostname()}:${process.pid}`,
  pollMs: Number(process.env.WORKER_POLL_MS ?? 3000),
  scheduleMinutes: Number(process.env.WORKER_SCHEDULE_MINUTES ?? 15),
  signal: controller.signal,
  log: (l) => console.log(`[worker] ${l}`),
}).then(() => process.exit(0));
