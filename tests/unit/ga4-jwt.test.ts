import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createVerify } from "crypto";
import { buildJwt, ga4Date, parseServiceAccount, reportToRows } from "@/server/connectors/ga4/client";

describe("GA4 client helpers", () => {
  it("signs a RS256 JWT the token endpoint can verify", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = parseServiceAccount(JSON.stringify({ client_email: "sa@example.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
    const jwt = buildJwt(sa, 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.exp - claims.iat).toBe(3600);
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
  });
  it("rejects malformed service accounts and maps report rows", () => {
    expect(() => parseServiceAccount("{}")).toThrow();
    expect(() => parseServiceAccount("nope")).toThrow();
    const rows = reportToRows({ dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }], rows: [{ dimensionValues: [{ value: "20261103" }], metricValues: [{ value: "42" }] }] });
    expect(rows).toEqual([{ date: "20261103", sessions: "42" }]);
    expect(ga4Date("20261103")).toBe("2026-11-03");
  });
});
