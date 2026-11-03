import { beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { decrypt, encrypt, encryptJson, decryptJson, redact, verifyHmacBase64 } from "@/server/crypto";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.APP_ENCRYPTION_KEY_PREVIOUS = Buffer.alloc(32, 2).toString("base64");
});

describe("encryption", () => {
  it("round-trips and never repeats ciphertext", () => {
    const a = encrypt("shpat_secret");
    const b = encrypt("shpat_secret");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("shpat_secret");
    expect(decryptJson<{ x: number }>(encryptJson({ x: 1 }))).toEqual({ x: 1 });
  });
  it("detects tampering", () => {
    const c = encrypt("hello");
    const parts = c.split(".");
    parts[4] = Buffer.from("zzzz").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("decrypts with the previous key after rotation", () => {
    const cur = process.env.APP_ENCRYPTION_KEY!;
    process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY_PREVIOUS!;
    const old = encrypt("rotated");
    process.env.APP_ENCRYPTION_KEY = cur;
    expect(decrypt(old)).toBe("rotated");
  });
});

describe("webhook hmac", () => {
  it("verifies Shopify-style base64 HMAC", () => {
    const body = '{"id":1}';
    const sig = createHmac("sha256", "secret").update(body).digest("base64");
    expect(verifyHmacBase64(body, "secret", sig)).toBe(true);
    expect(verifyHmacBase64(body, "other", sig)).toBe(false);
    expect(verifyHmacBase64(body, "secret", null)).toBe(false);
    expect(verifyHmacBase64(body, "secret", "AAAA")).toBe(false);
  });
});

describe("redact", () => {
  it("masks tokens and secrets in logs", () => {
    const s = redact('token shpat_abc123 Authorization: Bearer eyJhbGciOi.xx "client_secret":"shhh" password=pw1');
    expect(s).not.toContain("abc123");
    expect(s).not.toContain("eyJhbGciOi");
    expect(s).not.toContain("shhh");
    expect(s).not.toContain("pw1");
  });
});
