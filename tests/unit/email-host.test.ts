import { describe, expect, it } from "vitest";
import { isValidSmtpHost } from "@/server/notify/email";
import { emailConnector } from "@/server/connectors/email/connector";

const SECRET_LIKE = "abcd efgh ijkl mnop";

describe("email: campo server", () => {
  it("accetta solo nomi di host", () => {
    for (const h of ["smtp.gmail.com", "smtp.mail.me.com", "smtps.aruba.it"]) expect(isValidSmtpHost(h)).toBe(true);
    for (const h of [SECRET_LIKE, "abcdefghijklmnop", "smtp gmail.com", "", ".gmail.com", "smtp.gmail.com/x"]) expect(isValidSmtpHost(h)).toBe(false);
  });
  it("non ripete mai nel messaggio il valore sbagliato", async () => {
    const r = await emailConnector.verify({ organizationId: "o", connection: {} as never, secrets: { smtpPassword: SECRET_LIKE }, config: { smtpHost: SECRET_LIKE, smtpUser: "a@gmail.com", to: "a@gmail.com" }, log: () => {} });
    expect(r.status).toBe("ERROR");
    expect(r.message).toContain("smtp.gmail.com");
    expect(r.message).not.toContain("abcd");
  });
});
