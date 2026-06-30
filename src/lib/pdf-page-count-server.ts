/**
 * Server-side PDF page counter — defense-in-depth for the single-page document
 * rule that is enforced strictly on the client (see single-page-pdf.ts). The AI
 * route guard uses this to reject multi-page uploads on a direct API call that
 * skips the browser.
 *
 * Deliberately dependency-free and best-effort:
 *  - It counts `/Type /Page` objects in the raw PDF bytes. Scanner output (the
 *    real-world multi-page case) keeps page objects uncompressed, so this finds
 *    them reliably.
 *  - When the page objects live inside a compressed object stream it cannot see
 *    them and returns null — the guard then lets the file through rather than
 *    risk blocking a legitimate single-page upload. The client check is the
 *    strict gate; this only has to catch the obvious cases.
 *
 * @param base64 the base64 PDF payload (data-URL prefix already stripped)
 * @returns the page count when confidently determined, otherwise null
 */
export function countPdfPagesServer(base64: string): number | null {
  try {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length < 5 || buf.toString('latin1', 0, 5) !== '%PDF-') return null;
    const text = buf.toString('latin1');
    // Page objects are tagged `/Type /Page`; the page-tree root is `/Type
    // /Pages` — the negative lookahead excludes it so the root isn't counted.
    const pageMatches = text.match(/\/Type\s*\/Page(?!s)/g);
    if (pageMatches && pageMatches.length >= 1) return pageMatches.length;
    return null;
  } catch {
    return null;
  }
}
