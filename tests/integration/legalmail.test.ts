import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import MailComposer from "nodemailer/lib/mail-composer";
import { db } from "@/server/db";
import { encryptJson } from "@/server/crypto";
import { makeSyncHandler } from "@/server/connectors/legalmail/sync";
import type { MailSource } from "@/server/connectors/legalmail/mailbox";
import type { JobContext } from "@/server/jobs/types";
import { makeOrg } from "./helpers";

const fx = (n: string) => readFileSync(path.join(__dirname, "../fixtures", n));
const build = (o: ConstructorParameters<typeof MailComposer>[0]) => new MailComposer(o).compile().build();

async function pec(filename: string, content: Buffer) {
  const inner = await build({ from: "sdi01@pec.fatturapa.it", to: "x@legalmail.it", subject: "Invio", text: "t", attachments: [{ filename, content }, { filename: filename.replace(".xml", "_MT_001.xml"), content: "<m/>" }] });
  return build({ from: "posta-certificata@pec.fatturapa.it", to: "x@legalmail.it", subject: "POSTA CERTIFICATA", text: "t", attachments: [{ filename: "daticert.xml", content: "<d/>" }, { filename: "postacert.eml", content: inner, contentType: "message/rfc822" }] });
}

function memoryBox(messages: Map<number, Buffer>, uidValidity = "7"): MailSource & { downloads: number[] } {
  const downloads: number[] = [];
  return {
    downloads,
    uidValidity,
    messageCount: messages.size,
    listUids: async ({ afterUid }) => [...messages.keys()].filter((u) => u > afterUid).sort((a, b) => a - b),
    size: async (uid) => messages.get(uid)!.length,
    download: async (uid) => { downloads.push(uid); return messages.get(uid)!; },
    countFrom: async () => 0,
  };
}

function jobCtx(organizationId: string, payload: Record<string, unknown> = {}) {
  const log: string[] = [];
  const continued: Array<Record<string, unknown>> = [];
  const ctx = { job: {} as JobContext["job"], organizationId, payload, log: (l: string) => log.push(l), checkpoint: async () => {}, continueWith: async (p: Record<string, unknown>) => { continued.push(p); } } satisfies JobContext;
  return { ctx, log, continued };
}

async function setup() {
  const org = await makeOrg("01234567890");
  const conn = await db.integrationConnection.create({ data: { organizationId: org.id, key: "legalmail", provider: "EMAIL", displayName: "Legalmail", status: "CONNECTED", secretsEnc: encryptJson({ username: "M7B123", password: "p" }), config: {} } });
  return { org, conn };
}

describe("Legalmail: importazione", () => {
  it("importa la fattura una volta sola, scarta il resto e riprende da dove era", async () => {
    const { org, conn } = await setup();
    const passive = fx("fatturapa-passive.xml");
    const messages = new Map<number, Buffer>([
      [10, await pec("IT09876543210_00778.xml", passive)],
      [11, await build({ from: "a@b.it", to: "x@legalmail.it", subject: "Ciao", text: "nessun allegato" })],
      [12, await pec("copia_IT09876543210.xml", passive)],
      [13, await pec("rotto.xml", Buffer.from("<non-una-fattura/>"))],
    ]);
    const box = memoryBox(messages);
    const handler = makeSyncHandler((async (_s: unknown, fn: (b: MailSource) => Promise<unknown>) => fn(box)) as never);

    const first = (await handler(jobCtx(org.id).ctx)) as Record<string, number>;
    expect(first).toMatchObject({ messages: 4, invoicesCreated: 1, invoicesKnown: 1, unreadable: 1, remaining: 0 });
    const invoices = await db.invoice.findMany({ where: { organizationId: org.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ direction: "PASSIVE", source: "PEC_EMAIL", number: "778" });
    let c = await db.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(c.cursors).toMatchObject({ uidValidity: "7", lastUid: 13 });
    expect(c.lastSyncAt).not.toBeNull();

    // Second run: nothing new, nothing downloaded again.
    box.downloads.length = 0;
    const second = (await handler(jobCtx(org.id).ctx)) as Record<string, number>;
    expect(second.messages).toBe(0);
    expect(box.downloads).toEqual([]);

    // A new message is the only one read.
    messages.set(20, await pec("IT09876543210_00778.xml", passive));
    const third = (await handler(jobCtx(org.id).ctx)) as Record<string, number>;
    expect(box.downloads).toEqual([20]);
    expect(third).toMatchObject({ messages: 1, invoicesCreated: 0, invoicesKnown: 1 });
    expect(await db.invoice.count({ where: { organizationId: org.id } })).toBe(1);

    // Changed UIDVALIDITY means the numbering restarted: rescan safely, no duplicates.
    const rescan = memoryBox(messages, "8");
    const h2 = makeSyncHandler((async (_s: unknown, fn: (b: MailSource) => Promise<unknown>) => fn(rescan)) as never);
    await h2(jobCtx(org.id).ctx);
    expect(rescan.downloads.length).toBe(5);
    expect(await db.invoice.count({ where: { organizationId: org.id } })).toBe(1);
    c = await db.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(c.cursors).toMatchObject({ uidValidity: "8", lastUid: 20 });
  });

  it("non archivia fatture di altre aziende", async () => {
    const { org } = await setup();
    await db.organization.update({ where: { id: org.id }, data: { vatNumber: "99999999999" } });
    const box = memoryBox(new Map([[1, await pec("IT09876543210_00778.xml", fx("fatturapa-passive.xml"))]]));
    const handler = makeSyncHandler((async (_s: unknown, fn: (b: MailSource) => Promise<unknown>) => fn(box)) as never);
    const r = (await handler(jobCtx(org.id).ctx)) as Record<string, number>;
    expect(r).toMatchObject({ messages: 1, invoicesCreated: 0, notOurs: 1 });
    expect(await db.invoice.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await db.document.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("un .p7m rovinato non blocca i messaggi successivi", async () => {
    const { org } = await setup();
    const box = memoryBox(new Map([[1, await pec("IT09876543210_00001.xml.p7m", Buffer.from([0x30, 0x82, 0x00, 0x01, 0xff]))], [2, await pec("IT09876543210_00778.xml", fx("fatturapa-passive.xml"))]]));
    const handler = makeSyncHandler((async (_s: unknown, fn: (b: MailSource) => Promise<unknown>) => fn(box)) as never);
    const r = (await handler(jobCtx(org.id).ctx)) as Record<string, number>;
    expect(r).toMatchObject({ messages: 2, invoicesCreated: 1, unreadable: 1 });
  });

  it("spezza le caselle grandi in più passaggi", async () => {
    const { org } = await setup();
    const msg = await build({ from: "a@b.it", to: "c@d.it", subject: "x", text: "x" });
    const box = memoryBox(new Map(Array.from({ length: 105 }, (_, i) => [i + 1, msg] as [number, Buffer])));
    const handler = makeSyncHandler((async (_s: unknown, fn: (b: MailSource) => Promise<unknown>) => fn(box)) as never);
    const a = jobCtx(org.id);
    const r1 = (await handler(a.ctx)) as Record<string, number>;
    expect(r1).toMatchObject({ messages: 100, remaining: 5 });
    expect(a.continued[0]).toMatchObject({ afterUid: 100 });
    const b = jobCtx(org.id, a.continued[0]);
    const r2 = (await handler(b.ctx)) as Record<string, number>;
    expect(r2).toMatchObject({ messages: 105, remaining: 0 });
  });

  it("se il download fallisce il cursore non supera il messaggio", async () => {
    const { org, conn } = await setup();
    const msg = await build({ from: "a@b.it", to: "c@d.it", subject: "x", text: "x" });
    const box = memoryBox(new Map([[1, msg], [2, msg]]));
    const realDownload = box.download;
    box.download = async (uid) => { if (uid === 2) throw new Error("rete"); return realDownload(uid); };
    const handler = makeSyncHandler((async (_s: unknown, fn: (b: MailSource) => Promise<unknown>) => fn(box)) as never);
    await expect(handler(jobCtx(org.id).ctx)).rejects.toThrow("rete");
    const c = await db.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(c.cursors).toMatchObject({ lastUid: 1 });
    expect(c.lastError).toContain("rete");
  });
});
