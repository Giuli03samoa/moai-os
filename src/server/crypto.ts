import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * AES-256-GCM envelope for secrets at rest (integration credentials, TOTP secrets).
 * Format: v1.<keyId>.<iv b64>.<tag b64>.<ciphertext b64>
 * keyId lets us rotate APP_ENCRYPTION_KEY: new writes use the current key,
 * reads fall back to APP_ENCRYPTION_KEY_PREVIOUS.
 */
function keys() {
  const current = process.env.APP_ENCRYPTION_KEY ?? "";
  const previous = process.env.APP_ENCRYPTION_KEY_PREVIOUS ?? "";
  const cur = Buffer.from(current, "base64");
  if (cur.length !== 32) throw new Error("APP_ENCRYPTION_KEY missing or not 32 bytes (base64)");
  const list = [{ id: keyId(cur), key: cur }];
  const prev = Buffer.from(previous, "base64");
  if (prev.length === 32) list.push({ id: keyId(prev), key: prev });
  return list;
}

function keyId(key: Buffer) {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function encrypt(plaintext: string): string {
  const [{ id, key }] = keys() as [{ id: string; key: Buffer }];
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", id, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [v, id, ivB64, tagB64, ctB64] = payload.split(".");
  if (v !== "v1" || !id || !ivB64 || !tagB64 || !ctB64) throw new Error("Unsupported ciphertext format");
  const entry = keys().find((k) => k.id === id);
  if (!entry) throw new Error("Ciphertext was encrypted with an unknown key");
  const decipher = createDecipheriv("aes-256-gcm", entry.key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  return JSON.parse(decrypt(payload)) as T;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time HMAC-SHA256 verification (base64 digest), used for webhooks. */
export function verifyHmacBase64(rawBody: string | Buffer, secret: string, received: string | null): boolean {
  if (!received || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let got: Buffer;
  try {
    got = Buffer.from(received, "base64");
  } catch {
    return false;
  }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Redacts anything that looks like a secret before it reaches logs or the UI. */
export function redact(text: string): string {
  return text
    .replace(/(shpat|shpca|shppa|shpss)_[A-Za-z0-9]+/g, "$1_***")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***")
    .replace(/("?(?:password|secret|token|access_token|refresh_token|apiKey|client_secret)"?\s*[:=]\s*"?)[^",\s}&]+/gi, "$1***");
}
