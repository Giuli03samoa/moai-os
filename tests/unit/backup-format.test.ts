import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, MAGIC } from "../../scripts/backup-format";

describe("formato backup cifrato", () => {
  const data = Buffer.from("contenuto di prova del backup ".repeat(100));
  it("cifra e decifra con la stessa password, e il file non contiene il testo in chiaro", async () => {
    const enc = await encryptBackup(data, "una-password-lunga-123");
    expect(enc.subarray(0, MAGIC.length).equals(MAGIC)).toBe(true);
    expect(enc.includes(Buffer.from("contenuto di prova"))).toBe(false);
    expect((await decryptBackup(enc, "una-password-lunga-123")).equals(data)).toBe(true);
  }, 30_000);
  it("rifiuta password sbagliata, file alterato e password corta", async () => {
    const enc = await encryptBackup(data, "una-password-lunga-123");
    await expect(decryptBackup(enc, "password-sbagliata-999")).rejects.toThrow(/sbagliata|danneggiato/);
    const broken = Buffer.from(enc); const i = broken.length - 40; broken[i] = broken[i]! ^ 0xff;
    await expect(decryptBackup(broken, "una-password-lunga-123")).rejects.toThrow(/danneggiato/);
    await expect(decryptBackup(Buffer.from("ciao"), "x")).rejects.toThrow(/Non è un backup/);
    await expect(encryptBackup(data, "corta")).rejects.toThrow(/12 caratteri/);
  }, 30_000);
});
