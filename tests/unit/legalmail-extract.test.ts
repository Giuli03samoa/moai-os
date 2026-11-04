import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import MailComposer from "nodemailer/lib/mail-composer";
import { extractInvoiceFiles, isInvoiceFilename } from "@/server/connectors/legalmail/extract";

const invoice = readFileSync(path.join(__dirname, "../fixtures/fatturapa-passive.xml"));
const build = (opts: ConstructorParameters<typeof MailComposer>[0]) => new MailComposer(opts).compile().build();

/** A delivery from the SdI as it lands in a PEC inbox: envelope → postacert.eml → invoice + metadata. */
async function pecFromSdi(attachments: Array<{ filename: string; content: Buffer | string }>) {
  const inner = await build({ from: "sdi01@pec.fatturapa.it", to: "moai@legalmail.it", subject: "Invio File 123", text: "Fattura", attachments });
  return build({
    from: "Per conto di: sdi01@pec.fatturapa.it <posta-certificata@pec.fatturapa.it>",
    to: "moai@legalmail.it",
    subject: "POSTA CERTIFICATA: Invio File 123",
    text: "Messaggio di posta certificata",
    attachments: [
      { filename: "daticert.xml", content: "<postacert/>", contentType: "application/xml" },
      { filename: "postacert.eml", content: inner, contentType: "message/rfc822" },
      { filename: "smime.p7s", content: Buffer.from("firma"), contentType: "application/pkcs7-signature" },
    ],
  });
}

describe("Legalmail: estrazione fatture", () => {
  it("riconosce i nomi file di fatture e scarta quelli di servizio", () => {
    expect(isInvoiceFilename("IT09876543210_00778.xml")).toBe(true);
    expect(isInvoiceFilename("IT09876543210_00778.XML.p7m")).toBe(true);
    expect(isInvoiceFilename("IT09876543210_00778.p7m")).toBe(true);
    for (const n of ["IT09876543210_00778_MT_001.xml", "IT09876543210_00778_RC_001.xml", "IT09876543210_00778_NS_002.xml", "daticert.xml", "smime.p7s", "smime.p7m", "postacert.eml", "fattura.pdf", "../../IT1_MT_1.xml"]) expect(isInvoiceFilename(n)).toBe(false);
  });

  it("apre la busta PEC e prende solo la fattura, non metadati né daticert", async () => {
    const raw = await pecFromSdi([
      { filename: "IT09876543210_00778.xml", content: invoice },
      { filename: "IT09876543210_00778_MT_001.xml", content: "<metadati/>" },
    ]);
    const files = await extractInvoiceFiles(raw);
    expect(files.map((f) => f.filename)).toEqual(["IT09876543210_00778.xml"]);
    expect(files[0]!.content.equals(invoice)).toBe(true);
  });

  it("prende anche i .p7m binari senza alterarli", async () => {
    const bytes = Buffer.from([0x30, 0x82, 0xff, 0x00, 0x10, 0x80]);
    const raw = await pecFromSdi([{ filename: "IT09876543210_00779.xml.p7m", content: bytes }]);
    const files = await extractInvoiceFiles(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.content.equals(bytes)).toBe(true);
  });

  it("legge una fattura allegata direttamente a una mail normale", async () => {
    const raw = await build({ from: "fornitore@pec.it", to: "moai@legalmail.it", subject: "Fattura", text: "In allegato", attachments: [{ filename: "IT09876543210_00780.xml", content: invoice }, { filename: "cortesia.pdf", content: Buffer.from("%PDF") }] });
    expect((await extractInvoiceFiles(raw)).map((f) => f.filename)).toEqual(["IT09876543210_00780.xml"]);
  });

  it("non trova nulla in un messaggio senza fatture e ripulisce i percorsi nei nomi", async () => {
    const plain = await build({ from: "a@b.it", to: "c@d.it", subject: "Ciao", text: "Nessun allegato" });
    expect(await extractInvoiceFiles(plain)).toEqual([]);
    const traversal = await build({ from: "a@b.it", to: "c@d.it", subject: "x", text: "x", attachments: [{ filename: "../../evil.xml", content: "<a/>" }] });
    expect((await extractInvoiceFiles(traversal)).map((f) => f.filename)).toEqual(["evil.xml"]);
  });
});
