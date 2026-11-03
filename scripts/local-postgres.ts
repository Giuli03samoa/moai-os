/**
 * Local development PostgreSQL (no Docker / Homebrew needed).
 * Data lives in ./.local/pg (git-ignored). Runs in the foreground; Ctrl+C stops it.
 * Production must use a managed EU PostgreSQL instead (see docs/DEPLOYMENT.md).
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const dir = path.resolve(".local/pg");
const fresh = !fs.existsSync(path.join(dir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "moai",
  password: "moai-local-dev-only",
  port,
  persistent: true,
  onLog: () => {},
});

async function main() {
  if (fresh) await pg.initialise();
  await pg.start();
  for (const db of ["moai", "moai_test"]) {
    try {
      await pg.createDatabase(db);
    } catch {
      /* already exists */
    }
  }
  console.log(`PostgreSQL locale pronto su porta ${port} (database: moai, moai_test)`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
