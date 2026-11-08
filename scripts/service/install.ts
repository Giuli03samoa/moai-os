/**
 * Installs MOAI OS as three per-user launchd agents (no admin rights needed):
 *   db     PostgreSQL locale, at login, restarted after a crash
 *   app    MOAI OS on http://localhost:3000 (production build), restarted after a crash
 *   backup daily encrypted backup at 13:00 (run at wake if the Mac was asleep)
 *   npx tsx scripts/service/install.ts [--backup-dir <path>] [--uninstall]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_BACKUP_DIR, LABELS, LOG_DIR, REPO, domain, isLoaded, launchctl } from "./common";

const args = process.argv.slice(2);
const uninstall = args.includes("--uninstall");
const backupDir = (() => { const i = args.indexOf("--backup-dir"); return i >= 0 ? path.resolve(args[i + 1]!) : DEFAULT_BACKUP_DIR; })();
const agentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const nodeDir = path.dirname(process.execPath);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function plist(label: string, script: string, extra: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${esc(path.join(REPO, "scripts", "service", script))}</string></array>
  <key>WorkingDirectory</key><string>${esc(REPO)}</string>
  <key>EnvironmentVariables</key><dict><key>MOAI_BACKUP_DIR</key><string>${esc(backupDir)}</string></dict>
  <key>StandardOutPath</key><string>${esc(path.join(LOG_DIR, `${label.split(".").pop()}.log`))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(LOG_DIR, `${label.split(".").pop()}.log`))}</string>
  <key>ProcessType</key><string>Background</string>
${extra}
</dict></plist>
`;
}

const defs = [
  { label: LABELS.db, script: "run-db.sh", extra: "  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>" },
  { label: LABELS.app, script: "run-app.sh", extra: "  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>30</integer>" },
  { label: LABELS.backup, script: "run-backup.sh", extra: "  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>" },
];

for (const d of defs) {
  const file = path.join(agentsDir, `${d.label}.plist`);
  if (isLoaded(d.label)) launchctl(["bootout", `${domain()}/${d.label}`], { allowFail: true });
  if (uninstall) {
    fs.rmSync(file, { force: true });
    console.log(`rimosso ${d.label}`);
    continue;
  }
  for (const s of ["run-app.sh", "run-db.sh", "run-backup.sh"]) {
    const p = path.join(REPO, "scripts", "service", s);
    const tpl = fs.readFileSync(p, "utf8");
    if (tpl.includes("__NODE_DIR__")) {
      const out = path.join(REPO, ".local", "service", s);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, tpl.replace("__NODE_DIR__", nodeDir).replace('cd "$(dirname "$0")/../.."', `cd ${JSON.stringify(REPO)}`), { mode: 0o755 });
    }
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(file, plist(d.label, d.script, d.extra).replace(path.join(REPO, "scripts", "service", d.script), path.join(REPO, ".local", "service", d.script)));
  launchctl(["bootstrap", domain(), file]);
  console.log(`installato ${d.label}`);
}
if (!uninstall) console.log(`Log: ${LOG_DIR}\nBackup: ${backupDir}\nNode: ${nodeDir} (se cambi versione di Node, rilancia questo comando)`);
