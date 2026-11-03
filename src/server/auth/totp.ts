import { Secret, TOTP } from "otpauth";
import { randomBytes } from "crypto";
import { hashPassword, verifyPassword } from "./password";

const ISSUER = "MOAI OS";

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secretBase32: string, email: string): string {
  return new TOTP({ issuer: ISSUER, label: email, secret: Secret.fromBase32(secretBase32), digits: 6, period: 30 }).toString();
}

/** Accepts ±1 period of clock drift. */
export function verifyTotp(secretBase32: string, code: string): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const totp = new TOTP({ issuer: ISSUER, secret: Secret.fromBase32(secretBase32), digits: 6, period: 30 });
  return totp.validate({ token: clean, window: 1 }) !== null;
}

export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hashPassword(c)));
}

/** Returns the index of the matching hashed code, or -1. */
export async function matchRecoveryCode(code: string, hashes: string[]): Promise<number> {
  const clean = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await verifyPassword(clean, hashes[i]!)) return i;
  }
  return -1;
}
