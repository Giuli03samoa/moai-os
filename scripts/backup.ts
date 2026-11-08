/**
 * Daily encrypted backup: stops the local database for a few seconds, archives database files,
 * uploaded documents and .env, restarts the database, encrypts the archive (AES-256-GCM, key from a
 * passphrase kept in the macOS Keychain) and writes it to the backup folder. Keeps the last 30.
 *   npm run backup:now
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { encryptBackup } from "./backup-format";
import { DEFAULT_BACKUP_DIR, LABELS, REPO, domain, isLoaded, launchctl, readPassphrase, waitPort } from "./service/common";

const KEEP = 30;

async function main() {
  const passphrase = readPassphrase();
  const dir = process.env.MOAI_BACKUP_DIR ?? DEFAULT_BACKUP_DIR;
  if (!isLoaded(LABELS.db)) throw new Error("Il servizio database non è installato: esegui npm run service:install (il backup deve poter fermare il database).");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moai-backup-"));
  const tar = path.join(tmp, "backup.tar.gz");
  const t0 = Date.now();
  launchctl(["kill", "SIGTERM", `${domain()}/${LABELS.db}`]);
  try {
    if (!(await waitPort(54329, false, 60_000))) throw new Error("Il database non si è fermato entro 60 secondi");
    await new Promise((r) => setTimeout(r, 1500));
    const items = [".local/pg", ".env", ...(fs.existsSync(path.join(REPO, "storage")) ? ["storage"] : [])];
    execFileSync("tar", ["-czf", tar, "-C", REPO, ...items]);
  } finally {
    launchctl(["kickstart", `${domain()}/${LABELS.db}`]);
  }
  const offline = Math.round((Date.now() - t0) / 1000);
  const enc = await encryptBackup(fs.readFileSync(tar), passphrase);
  fs.rmSync(tmp, { recursive: true, force: true });
  const out = path.join(dir, `moai-os-${stamp}.moaibak`);
  fs.writeFileSync(`${out}.part`, enc, { mode: 0o600 });
  fs.renameSync(`${out}.part`, out);
  const all = fs.readdirSync(dir).filter((f) => /^moai-os-.*\.moaibak$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(dir, old));
  const up = await waitPort(54329, true, 60_000);
  if (up) {
    const { db } = await import("../src/server/db");
    try {
      const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
      await db.auditLog.create({ data: { organizationId: org?.id ?? null, action: "backup.created", metadata: { file: path.basename(out), bytes: enc.length, offlineSeconds: offline } } });
    } finally {
      await db.$disconnect();
    }
  }
  console.log(`${new Date().toISOString()} backup ${path.basename(out)} · ${(enc.length / 1048576).toFixed(1)} MB · database fermo ${offline}s · conservati ${Math.min(all.length, KEEP)}`);
}

main().catch((e) => {
  console.error(`${new Date().toISOString()} BACKUP FALLITO: ${(e as Error).message}`);
  process.exit(1);
});
