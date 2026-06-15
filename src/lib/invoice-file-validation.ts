/**
 * Magic-byte validation for e-invoicing intake uploads.
 *
 * Separate from file-validation.ts (the staff-onboarding validator) so adding
 * XML support here doesn't broaden what the onboarding upload accepts. Invoices
 * are PDF / image (scanned or rendered) or XML (UBL / PINT-AE). The portal's
 * analyser does the real content parse — this just gates the file type + maps to
 * the upload channel.
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

// Sniff the first bytes as XML text: a declaration or a bare opening tag. Lenient
// (some UBL files omit <?xml…?>) but still rejects HTML-ish junk that isn't a tag.
function looksLikeXml(bytes: Uint8Array): boolean {
  let head = new TextDecoder('utf-8').decode(bytes.subarray(0, 512));
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1); // strip UTF-8 BOM
  head = head.trimStart();
  if (head.startsWith('<?xml')) return true;
  return /^<([a-zA-Z_][\w.:-]*)[\s>/]/.test(head);
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

  // XML (text sniff, last so binary formats win first).
  if (looksLikeXml(bytes)) {
    return { ext: '.xml', mime: 'application/xml', channel: 'digital_xml' };
  }

  return null;
}
