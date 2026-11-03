import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY must be 32 bytes, base64"),
  APP_ENCRYPTION_KEY_PREVIOUS: z.string().optional().default(""),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/).default("2026-10"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(3000),
  WORKER_SCHEDULE_MINUTES: z.coerce.number().int().positive().default(15),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
