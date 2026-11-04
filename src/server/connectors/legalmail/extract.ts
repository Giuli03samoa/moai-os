import { simpleParser, type Attachment } from "mailparser";

/**
 * Finds FatturaPA files inside a raw email. A PEC is an envelope: the original message sits in
 * postacert.eml (message/rfc822) next to daticert.xml and the S/MIME signature, so attachments are
 * walked recursively. Pure function: nothing from the email is stored or logged except the invoices.
 */
export type InvoiceFile = { filename: string; content: Buffer };

const MAX_DEPTH = 4;
/** SdI service files share the invoice's name with a suffix: metadata, receipts, notifications. */
const SDI_SERVICE_FILE = /_(MT|RC|NS|MC|NE|EC|SE|DT|AT)_[A-Za-z0-9]+\.xml(\.p7m)?$/i;
const PEC_ENVELOPE_FILE = /^(daticert\.xml|smime\.p7[ms]|postacert\.eml)$/i;

export function isInvoiceFilename(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? "";
  if (PEC_ENVELOPE_FILE.test(base) || SDI_SERVICE_FILE.test(base)) return false;
  return /\.xml(\.p7m)?$/i.test(base) || /\.p7m$/i.test(base);
}

function isEmbeddedEmail(a: Attachment): boolean {
  return a.contentType === "message/rfc822" || /\.eml$/i.test(a.filename ?? "");
}

export async function extractInvoiceFiles(raw: Buffer, depth = 0): Promise<InvoiceFile[]> {
  if (depth > MAX_DEPTH) return [];
  const mail = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true });
  const found: InvoiceFile[] = [];
  for (const a of mail.attachments ?? []) {
    if (isEmbeddedEmail(a)) found.push(...(await extractInvoiceFiles(a.content, depth + 1)));
    else if (a.filename && isInvoiceFilename(a.filename)) found.push({ filename: a.filename.split(/[\\/]/).pop()!, content: a.content });
  }
  return found;
}
