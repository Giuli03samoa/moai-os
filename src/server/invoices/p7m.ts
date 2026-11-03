/**
 * Extracts the signed XML payload from a CAdES (.p7m) envelope.
 *
 * A .p7m is a CMS ContentInfo → SignedData → encapContentInfo → eContent (OCTET STRING).
 * The OCTET STRING may be primitive or constructed (chunked, BER indefinite length), so we
 * walk the ASN.1 structure instead of searching for "<?xml" in the bytes.
 *
 * IMPORTANT: this does NOT verify the digital signature or the certificate chain.
 * The archive stores the original file untouched; legal validity checks and
 * "conservazione a norma" remain with Aruba / the accredited conservator.
 */

type Node = { tag: number; constructed: boolean; cls: number; start: number; headerLen: number; len: number | null; end: number };

const MAX_DEPTH = 64;

function readNode(buf: Buffer, pos: number): Node {
  const start = pos;
  if (pos >= buf.length) throw new Error("p7m: unexpected end of data");
  const first = buf[pos++]!;
  const cls = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let b: number;
    do {
      b = buf[pos++]!;
      tag = (tag << 7) | (b & 0x7f);
    } while (b & 0x80);
  }
  const lenByte = buf[pos++]!;
  let len: number | null;
  if (lenByte === 0x80) len = null; // indefinite
  else if (lenByte & 0x80) {
    const n = lenByte & 0x7f;
    if (n > 4) throw new Error("p7m: length too large");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos++]!;
  } else len = lenByte;
  const headerLen = pos - start;
  let end: number;
  if (len === null) end = findIndefiniteEnd(buf, pos, 0);
  else end = pos + len;
  if (end > buf.length) throw new Error("p7m: truncated");
  return { tag, constructed, cls, start, headerLen, len, end };
}

function findIndefiniteEnd(buf: Buffer, pos: number, depth: number): number {
  if (depth > MAX_DEPTH) throw new Error("p7m: nesting too deep");
  while (pos < buf.length) {
    if (buf[pos] === 0 && buf[pos + 1] === 0) return pos + 2;
    const child = readNode(buf, pos);
    pos = child.end;
  }
  throw new Error("p7m: unterminated indefinite length");
}

function children(buf: Buffer, node: Node): Node[] {
  const out: Node[] = [];
  let pos = node.start + node.headerLen;
  const stop = node.len === null ? node.end - 2 : node.end;
  while (pos < stop) {
    const c = readNode(buf, pos);
    out.push(c);
    pos = c.end;
  }
  return out;
}

function octetStringContent(buf: Buffer, node: Node, depth = 0): Buffer {
  if (depth > MAX_DEPTH) throw new Error("p7m: nesting too deep");
  if (!node.constructed) return buf.subarray(node.start + node.headerLen, node.end);
  return Buffer.concat(children(buf, node).map((c) => octetStringContent(buf, c, depth + 1)));
}

const OID_SIGNED_DATA = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);

export function extractP7mPayload(input: Buffer): Buffer {
  let der = input;
  // Some systems deliver the .p7m base64-encoded (optionally with PEM headers).
  const head = input.subarray(0, 64).toString("latin1");
  if (/^[A-Za-z0-9+/=\s-]+$/.test(head) && !head.startsWith("0")) {
    const text = input.toString("latin1").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    der = Buffer.from(text, "base64");
  }
  const contentInfo = readNode(der, 0);
  const [oid, explicit0] = children(der, contentInfo);
  if (!oid || !explicit0 || !der.subarray(oid.start + oid.headerLen, oid.end).equals(OID_SIGNED_DATA)) {
    throw new Error("p7m: non è una busta CMS SignedData");
  }
  const signedData = children(der, explicit0)[0];
  if (!signedData) throw new Error("p7m: SignedData mancante");
  // SignedData ::= SEQUENCE { version, digestAlgorithms SET, encapContentInfo SEQUENCE, ... }
  const encap = children(der, signedData)[2];
  if (!encap) throw new Error("p7m: encapContentInfo mancante");
  const eContentWrapper = children(der, encap)[1]; // [0] EXPLICIT
  if (!eContentWrapper) throw new Error("p7m: firma detached, contenuto non incluso");
  const octet = children(der, eContentWrapper)[0];
  if (!octet) throw new Error("p7m: eContent mancante");
  return octetStringContent(der, octet);
}

export function looksLikeP7m(filename: string, content: Buffer): boolean {
  if (/\.p7m$/i.test(filename)) return true;
  return content[0] === 0x30 && content.subarray(0, 200).indexOf(OID_SIGNED_DATA) !== -1;
}
