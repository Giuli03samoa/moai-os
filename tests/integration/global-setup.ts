import { execSync } from "node:child_process";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://moai:moai-local-dev-only@localhost:54329/moai_test";

/** Applies migrations to the dedicated test database (never the dev/prod one). */
export default function setup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } });
}
