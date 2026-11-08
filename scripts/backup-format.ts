import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from "crypto";

/**
 * Encrypted backup file format (version 1):
 *   "MOAIBK1\n" | salt (16) | iv (12) | ciphertext | GCM tag (16)
 * Key = scrypt(passphrase, salt, 32 bytes, N=2^17, r=8, p=1). AES-256-GCM authenticates the whole
 * archive, so a wrong passphrase or a damaged file fails before anything is extracted.
 */
export const MAGIC = Buffer.from("MOAIBK1\n");
const SCRYPT: ScryptOptions = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => scryptCb(passphrase, salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
}

export async function encryptBackup(plain: Buffer, passphrase: string): Promise<Buffer> {
  if (passphrase.length < 12) throw new Error("La password del backup deve avere almeno 12 caratteri");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}

export async function decryptBackup(file: Buffer, passphrase: string): Promise<Buffer> {
  if (file.length < MAGIC.length + 16 + 12 + 16 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Non è un backup di MOAI OS");
  let o = MAGIC.length;
  const salt = file.subarray(o, (o += 16));
  const iv = file.subarray(o, (o += 12));
  const tag = file.subarray(file.length - 16);
  const body = file.subarray(o, file.length - 16);
  const d = createDecipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(body), d.final()]);
  } catch {
    throw new Error("Password sbagliata o file danneggiato");
  }
}
