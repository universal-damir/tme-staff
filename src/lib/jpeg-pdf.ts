// ===================================================================
// JPEG PAGES -> PDF
// ===================================================================
//
// Builds a minimal, valid PDF whose pages are JPEG images, one image per
// page, each page sized to its image. Used to rebuild a large PDF (an
// iPhone scan is often 3-6 MB per page) into a small one for the AI checks,
// so the request stays under Netlify's request-size limit while the server
// still receives a PDF with the SAME number of pages (the multi-page guard
// in ai-route-guard counts `/Type /Page`).
//
// Pure: no DOM, no pdfjs. The JPEG bytes are embedded as-is (DCTDecode).

export interface JpegPage {
  /** Raw JPEG file bytes (starting FF D8). */
  bytes: Uint8Array;
  /** Pixel width of the JPEG. */
  width: number;
  /** Pixel height of the JPEG. */
  height: number;
}

const encoder = new TextEncoder();

/** Build a PDF from JPEG pages. Throws on an empty list. */
export function buildPdfFromJpegs(pages: JpegPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('No pages to write');

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (num: number) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  };

  // Object numbers: 1 catalog, 2 page tree, then per page i:
  // page = 3 + 3i, image = 4 + 3i, content = 5 + 3i.
  const pageNum = (i: number) => 3 + 3 * i;
  const objectCount = 2 + 3 * pages.length;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  startObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  const kids = pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const p = pageNum(i);
    const w = page.width;
    const h = page.height;

    startObject(p);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im${i} ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>\nendobj\n`
    );

    startObject(p + 1);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`
    );
    push(page.bytes);
    push('\nendstream\nendobj\n');

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    startObject(p + 2);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= objectCount; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
