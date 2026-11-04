import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { imapSettings, startDateFor, withImapMailbox } from "@/server/connectors/legalmail/mailbox";

const settings = imapSettings({ username: "M7B123", password: "p" }, {})!;

function fakeFlow(over: { readOnly?: boolean; connectError?: unknown } = {}) {
  const calls: string[] = [];
  const flow = {
    calls,
    mailbox: { readOnly: over.readOnly ?? true, uidValidity: 42n, exists: 3 },
    connect: vi.fn(async () => { calls.push("connect"); if (over.connectError) throw over.connectError; }),
    mailboxOpen: vi.fn(async (_p: string, _o: { readOnly: boolean }) => { calls.push("open"); }),
    search: vi.fn(async () => [5, 2, 9]),
    fetchOne: vi.fn(async () => ({ size: 1234 })),
    download: vi.fn(async () => ({ content: Readable.from([Buffer.from("raw"), Buffer.from("mail")]) })),
    logout: vi.fn(async () => { calls.push("logout"); }),
  };
  return flow;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMake = (f: ReturnType<typeof fakeFlow>) => (() => f) as any;

describe("Legalmail: casella in sola lettura", () => {
  it("usa i parametri InfoCert di default", () => {
    expect(settings).toMatchObject({ host: "mbox.cert.legalmail.it", port: 993, mailbox: "INBOX" });
    expect(imapSettings({}, {})).toBeNull();
  });
  it("apre sempre con readOnly e chiude la connessione", async () => {
    const f = fakeFlow();
    const r = await withImapMailbox(settings, async (box) => {
      expect(box.uidValidity).toBe("42");
      expect(await box.listUids({ since: new Date(0), afterUid: 2 })).toEqual([5, 9]);
      expect(await box.size(5)).toBe(1234);
      expect((await box.download(5)).toString()).toBe("rawmail");
      return "ok";
    }, asMake(f));
    expect(r).toBe("ok");
    expect(f.mailboxOpen).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(f.calls.at(-1)).toBe("logout");
  });
  it("si ferma se il server non concede la sola lettura", async () => {
    const f = fakeFlow({ readOnly: false });
    const fn = vi.fn();
    await expect(withImapMailbox(settings, fn, asMake(f))).rejects.toThrow(/sola lettura/);
    expect(fn).not.toHaveBeenCalled();
  });
  it("traduce l'accesso rifiutato senza riprovare all'infinito", async () => {
    const f = fakeFlow({ connectError: Object.assign(new Error("Command failed"), { authenticationFailed: true }) });
    const err = (await withImapMailbox(settings, async () => 1, asMake(f)).catch((e) => e)) as { message: string; retryable: boolean };
    expect(err.message).toMatch(/UserID|userID/);
    expect(err.retryable).toBe(false);
  });
  it("calcola la data di partenza", () => {
    expect(startDateFor({ since: "2026-03-01" }).toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(startDateFor({}, new Date("2026-11-05T00:00:00Z")).toISOString().slice(0, 10)).toBe("2025-01-01");
  });
});
