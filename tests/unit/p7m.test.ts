import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractP7mPayload, looksLikeP7m } from "@/server/invoices/p7m";
import { decodeInvoiceFile, parseFatturaPA } from "@/server/invoices/fatturapa";

// Minimal DER builder to produce a CMS SignedData envelope around the XML (signature bytes omitted:
// extraction must not depend on them).
function len(n: number) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
const OID_SIGNED = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
const OID_DATA = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);

function envelope(xml: Buffer, opts: { constructedOctets?: boolean } = {}) {
  const octet = opts.constructedOctets
    ? Buffer.concat([Buffer.from([0x24, 0x80]), tlv(0x04, xml.subarray(0, 100)), tlv(0x04, xml.subarray(100)), Buffer.from([0, 0])]) // constructed, indefinite length
    : tlv(0x04, xml);
  const encap = tlv(0x30, Buffer.concat([tlv(0x06, OID_DATA), tlv(0xa0, octet)]));
  const signedData = tlv(0x30, Buffer.concat([tlv(0x02, Buffer.from([1])), tlv(0x31, Buffer.alloc(0)), encap, tlv(0x31, Buffer.alloc(0))]));
  return tlv(0x30, Buffer.concat([tlv(0x06, OID_SIGNED), tlv(0xa0, signedData)]));
}

const xml = readFileSync(path.join(__dirname, "../fixtures/fatturapa-active.xml"));

describe("p7m extraction", () => {
  it("extracts a primitive OCTET STRING payload", () => {
    const der = envelope(xml);
    expect(looksLikeP7m("x.xml.p7m", der)).toBe(true);
    expect(extractP7mPayload(der).equals(xml)).toBe(true);
  });
  it("extracts a constructed, indefinite-length payload", () => {
    const der = envelope(xml, { constructedOctets: true });
    expect(extractP7mPayload(der).equals(xml)).toBe(true);
  });
  it("accepts base64-encoded envelopes", () => {
    const b64 = Buffer.from(envelope(xml).toString("base64"));
    expect(extractP7mPayload(b64).equals(xml)).toBe(true);
  });
  it("flows into the parser through decodeInvoiceFile", () => {
    const { xml: text, signed } = decodeInvoiceFile("IT01234567890_00042.xml.p7m", envelope(xml));
    expect(signed).toBe(true);
    expect(parseFatturaPA(text).invoices[0]!.number).toBe("2026/0042");
  });
  it("rejects non-CMS data", () => {
    expect(() => extractP7mPayload(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]))).toThrow();
    expect(looksLikeP7m("a.xml", xml)).toBe(false);
  });
});
