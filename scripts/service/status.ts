import fs from "fs";
import { DEFAULT_BACKUP_DIR, LABELS, domain, launchctl, waitPort } from "./common";

async function main() {
  for (const [name, label] of Object.entries(LABELS)) {
    const out = launchctl(["print", `${domain()}/${label}`], { allowFail: true });
    const state = /state = (\w+)/.exec(out)?.[1] ?? (out ? "caricato" : "non installato");
    const pid = /pid = (\d+)/.exec(out)?.[1];
    const lastExit = /last exit code = (\S+)/.exec(out)?.[1];
    console.log(`${name.padEnd(7)} ${state}${pid ? ` (pid ${pid})` : ""}${lastExit ? ` · ultima uscita ${lastExit}` : ""}`);
  }
  console.log(`database porta 54329: ${(await waitPort(54329, true, 1000)) ? "aperta" : "chiusa"}`);
  console.log(`app porta 3000: ${(await waitPort(3000, true, 1000)) ? "aperta" : "chiusa"}`);
  const dir = process.env.MOAI_BACKUP_DIR ?? DEFAULT_BACKUP_DIR;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".moaibak")).sort() : [];
  console.log(`backup: ${files.length} in ${dir}${files.length ? ` · ultimo ${files.at(-1)}` : ""}`);
}
main();
