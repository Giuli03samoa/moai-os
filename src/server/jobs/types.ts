import type { SyncJob } from "@prisma/client";

export type JobContext = {
  job: SyncJob;
  organizationId: string;
  payload: Record<string, unknown>;
  /** Appends a line to the job log (secrets are redacted before storage). */
  log: (line: string) => void;
  /** Persists partial progress so a crash or retry does not lose the page cursor. */
  checkpoint: (partial: Record<string, unknown>) => Promise<void>;
  /** Asks the worker to enqueue the next slice of a long sync once this job has succeeded. */
  continueWith: (payload: Record<string, unknown>) => Promise<void>;
};

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;
