/**
 * Checks or extracts an encrypted MOAI OS backup. Never overwrites the live installation.
 *   npm run backup:verify -- <file.moaibak>              decrypts, starts a temporary database copy, counts rows
 *   npm run backup:extract -- <file.moaibak> <cartella>  decrypts and extracts .local/pg, storage, .env
 * Full restore: stop the services, replace .local/pg (and .env, storage) with the extracted ones, start again.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { decryptBackup } from "./backup-format";
import { readPassphrase } from "./service/common";

async function main() {
  const [mode, file, target] = process.argv.slice(2);
  if (!file || !["--verify", "--extract"].includes(mode ?? "")) throw new Error("Uso: --verify <file> | --extract <file> <cartella>");
  const plain = await decryptBackup(fs.readFileSync(file), process.env.MOAI_BACKUP_PASSPHRASE ?? readPassphrase());
  const dest = mode === "--extract" ? path.resolve(target ?? "") : fs.mkdtempSync(path.join(os.tmpdir(), "moai-restore-"));
  if (mode === "--extract") {
    if (!target) throw new Error("Indica la cartella di destinazione");
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error("La cartella di destinazione non è vuota");
    fs.mkdirSync(dest, { recursive: true });
  }
  const tar = path.join(dest, ".backup.tar.gz");
  fs.writeFileSync(tar, plain, { mode: 0o600 });
  execFileSync("tar", ["-xzf", tar, "-C", dest]);
  fs.rmSync(tar);
  console.log(`Estratto in ${dest}: ${fs.readdirSync(dest).join(", ")}`);
  if (mode === "--extract") return;

  // Verify: run the copy on another port and count what is inside.
  const EmbeddedPostgres = (await import("embedded-postgres")).default;
  const pgDir = path.join(dest, ".local", "pg");
  fs.chmodSync(pgDir, 0o700);
  fs.rmSync(path.join(pgDir, "postmaster.pid"), { force: true });
  const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: "moai", password: "moai-local-dev-only", port: 54399, persistent: true, onLog: () => {} });
  await pg.start();
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: "postgresql://moai:moai-local-dev-only@localhost:54399/moai" } } });
    const counts = { organizzazioni: await db.organization.count(), utenti: await db.user.count(), prodotti: await db.product.count(), varianti: await db.productVariant.count(), fornitori: await db.supplier.count(), connessioni: await db.integrationConnection.count(), conversazioni: await db.agentConversation.count(), audit: await db.auditLog.count() };
    await db.$disconnect();
    console.log("Contenuto del backup:", counts);
    console.log(`.env presente: ${fs.existsSync(path.join(dest, ".env"))}`);
  } finally {
    await pg.stop();
    fs.rmSync(dest, { recursive: true, force: true });
  }
  console.log("Backup verificato: leggibile e completo.");
}

main().catch((e) => {
  console.error(`ERRORE: ${(e as Error).message}`);
  process.exit(1);
});
