import { execFileSync } from "child_process";
import os from "os";
import path from "path";

export const REPO = path.resolve(__dirname, "..", "..");
export const LABELS = { db: "it.moaiathletics.os.db", app: "it.moaiathletics.os.app", backup: "it.moaiathletics.os.backup" } as const;
export const KEYCHAIN_SERVICE = "it.moaiathletics.os.backup";
export const LOG_DIR = path.join(os.homedir(), "Library", "Logs", "MOAI OS");
export const DEFAULT_BACKUP_DIR = path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs", "MOAI OS Backup");
export const uid = () => (process.getuid ? process.getuid() : Number(execFileSync("id", ["-u"]).toString().trim()));
export const domain = () => `gui/${uid()}`;

export function launchctl(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync("launchctl", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (e) {
    if (opts.allowFail) return "";
    throw new Error(`launchctl ${args.join(" ")}: ${(e as { stderr?: Buffer }).stderr?.toString().trim() ?? (e as Error).message}`);
  }
}

export function isLoaded(label: string): boolean {
  return launchctl(["print", `${domain()}/${label}`], { allowFail: true }).length > 0;
}

export function readPassphrase(): string {
  try {
    return execFileSync("security", ["find-generic-password", "-a", os.userInfo().username, "-s", KEYCHAIN_SERVICE, "-w"], { stdio: ["ignore", "pipe", "ignore"] }).toString().replace(/\n$/, "");
  } catch {
    throw new Error(`Password del backup non trovata nel Portachiavi (servizio ${KEYCHAIN_SERVICE}). Creala con: security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w`);
  }
}

export async function waitPort(port: number, open: boolean, timeoutMs: number): Promise<boolean> {
  const net = await import("net");
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const isOpen = await new Promise<boolean>((res) => {
      const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); });
      s.on("error", () => res(false));
    });
    if (isOpen === open) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
