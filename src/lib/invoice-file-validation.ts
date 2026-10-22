/**
 * Magic-byte validation for e-invoicing intake uploads.
 *
 * Separate from file-validation.ts (the staff-onboarding validator) so adding
 * XML support here doesn't broaden what the onboarding upload accepts. Invoices
 * are PDF / image (scanned or rendered) or XML (UBL / PINT-AE). The portal's
 * analyser does the real content parse — this gates the file type + maps to the
 * upload channel. XML must be a UBL Invoice / CreditNote (the only XML the portal
 * reads); HTML, DOCTYPE/ENTITY and script content are refused.
 */

import { MAX_FILE_BYTES } from './file-validation';

export { MAX_FILE_BYTES };

export type InvoiceExt = '.pdf' | '.jpg' | '.png' | '.webp' | '.xml';

export interface InvoiceFileType {
  ext: InvoiceExt;
  mime: string;
  // 'digital_xml' (structured) vs 'physical' (PDF/image) — drives the channel
  // recorded on the submission so the gap analysis distinguishes the two.
  channel: 'digital_xml' | 'physical';
}

// The only XML the portal's gap analyser understands is UBL 2.1 (PINT-AE is a
// UBL specialisation): root <Invoice> or <CreditNote>, any prefix, in the UBL
// namespace. Anything else (HTML, SVG, random XML) is refused here so it is never
// stored and served back as application/xml.
const UBL_NAMESPACES: Record<string, string> = {
  Invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  CreditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
};

// Content that has no place in an invoice and could run in a browser or a parser:
// a DOCTYPE / ENTITY (XXE, entity expansion), a script element under any prefix,
// an XSLT stylesheet instruction, or the XHTML / SVG namespaces (elements in
// those namespaces render as live HTML/SVG inside an XML document).
const FORBIDDEN_XML = [
  /<!DOCTYPE/i,
  /<!ENTITY/i,
  /<\s*(?:[\w.-]+:)?script\b/i,
  /<\?xml-stylesheet/i,
  /http:\/\/www\.w3\.org\/1999\/xhtml/i,
  /http:\/\/www\.w3\.org\/2000\/svg/i,
];

// Every namespace an XML invoice may declare (xmlns / xmlns:prefix): the UBL
// 2.x document, component and data-type namespaces, XML Signature / XAdES
// (signed UBL) and XML Schema. An allowlist, not a blocklist: a namespace that
// renders as live content (XHTML, SVG, MathML, XSLT, ...) can be spelled many
// ways, an unknown namespace has no place in a UBL invoice.
const UBL_XSD = 'urn:oasis:names:specification:ubl:schema:xsd:';
const ALLOWED_NAMESPACES: ReadonlySet<string> = new Set([
  '', // xmlns="" (no namespace) renders nothing
  ...[
    'Invoice-2',
    'CreditNote-2',
    'CommonAggregateComponents-2',
    'CommonBasicComponents-2',
    'CommonExtensionComponents-2',
    'CommonSignatureComponents-2',
    'SignatureAggregateComponents-2',
    'SignatureBasicComponents-2',
    'QualifiedDataTypes-2',
    'UnqualifiedDataTypes-2',
  ].map((n) => UBL_XSD + n),
  'urn:un:unece:uncefact:data:specification:CoreComponentTypeSchemaModule:2',
  'urn:un:unece:uncefact:documentation:2',
  'http://www.w3.org/2000/09/xmldsig#',
  'http://www.w3.org/2009/xmldsig11#',
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://uri.etsi.org/01903/v1.3.2#',
  'http://uri.etsi.org/01903/v1.4.1#',
  'http://www.w3.org/2001/XMLSchema-instance',
  'http://www.w3.org/2001/XMLSchema',
  'http://www.w3.org/XML/1998/namespace',
]);

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * Character references (&#58; &#x3A;) and the five predefined entities, as an
 * XML parser reads them, so a namespace or element spelled with them cannot
 * dodge the checks. One pass, like the parser (`&amp;#58;` stays `&#58;`).
 */
export function decodeXmlReferences(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(lt|gt|amp|quot|apos));/g, (m, dec, hex, named) => {
    if (named) return NAMED_ENTITIES[named];
    const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
    return String.fromCodePoint(code);
  });
}

/** Every namespace declaration (xmlns / xmlns:p) is on the allowlist. */
function namespacesAllowed(text: string): boolean {
  const re = /(?:^|[\s"'])xmlns(?::[^\s=/>]+)?\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = decodeXmlReferences(m[1] ?? m[2] ?? '').trim();
    if (!ALLOWED_NAMESPACES.has(value)) return false;
  }
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True only for a UBL Invoice / CreditNote document with no active content. */
export function isUblInvoiceXml(bytes: Uint8Array): boolean {
  // Lenient decode (the portal also reads the file as UTF-8): a stray Latin-1
  // byte becomes U+FFFD and does not affect the structural checks below.
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
  if (FORBIDDEN_XML.some((re) => re.test(text))) return false;
  // The same checks on the text as a parser reads it (references decoded).
  const decoded = decodeXmlReferences(text);
  if (decoded !== text && FORBIDDEN_XML.some((re) => re.test(decoded))) return false;
  if (!namespacesAllowed(text)) return false;

  // Skip whitespace, an optional XML declaration and comments before the root.
  let rest = text.trimStart();
  if (rest.startsWith('<?xml')) {
    const end = rest.indexOf('?>');
    if (end === -1) return false;
    rest = rest.slice(end + 2).trimStart();
  }
  while (rest.startsWith('<!--')) {
    const end = rest.indexOf('-->', 4);
    if (end === -1) return false;
    rest = rest.slice(end + 3).trimStart();
  }

  // Root start tag: <[prefix:]Invoice ...> or <[prefix:]CreditNote ...>.
  const m = /^<(?:([a-zA-Z_][\w.-]*):)?(Invoice|CreditNote)(?=[\s>/])([^>]*)>/.exec(rest);
  if (!m) return false;
  const [, prefix, localName, attrs] = m;

  // The root's own prefix (or the default namespace) must be bound to the UBL
  // namespace for that document type.
  const xmlnsAttr = prefix ? `xmlns:${escapeRegExp(prefix)}` : 'xmlns';
  const nsRe = new RegExp(
    `(?:^|\\s)${xmlnsAttr}\\s*=\\s*(["'])${escapeRegExp(UBL_NAMESPACES[localName])}\\1`
  );
  return nsRe.test(attrs);
}

/** Detect an allowed invoice file from its magic bytes, or null if unsupported. */
export function detectInvoiceFile(bytes: Uint8Array): InvoiceFileType | null {
  if (bytes.length < 5) return null;

  // PDF: 25 50 44 46 2D  (%PDF-)
  if (
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return { ext: '.pdf', mime: 'application/pdf', channel: 'physical' };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg', channel: 'physical' };
  }

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: '.png', mime: 'image/png', channel: 'physical' };
  }

  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ext: '.webp', mime: 'image/webp', channel: 'physical' };
  }

  // XML (text check, last so binary formats win first): UBL Invoice / CreditNote only.
  if (isUblInvoiceXml(bytes)) {
    return { ext: '.xml', mime: 'application/xml', channel: 'digital_xml' };
  }

  return null;
}
