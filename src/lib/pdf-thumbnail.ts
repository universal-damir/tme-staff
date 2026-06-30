// ===================================================================
// PDF FIRST-PAGE THUMBNAIL
// ===================================================================
//
// Renders page 1 of a PDF to a JPEG data URL so an uploaded PDF can be
// previewed inline (via <img>) the same way a photo is — instead of the
// generic "PDF uploaded / Open PDF" placeholder. This works under the
// strict CSP (`object-src 'none'`) because the result is just an image,
// and `img-src` already allows `data:`/`blob:`.
//
// Client-only: pdfjs is dynamically imported so it never runs during SSR
// and stays out of the bundle until a PDF is actually previewed. The
// worker is loaded same-origin via `new URL(..., import.meta.url)` so it
// satisfies `script-src 'self'` (a CDN worker would be blocked by CSP).

let workerConfigured = false;

function base64ToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Render the first page of a PDF to a JPEG data URL.
 *
 * @param source Either a `data:application/pdf;base64,...` URL (fresh
 *   upload) or an http(s) URL (a previously-saved page fetched from
 *   storage — pdfjs fetches it, and the Supabase origin is already in the
 *   CSP `connect-src` allowlist).
 * @param maxWidth Target render width in CSS px; the page is scaled to fit.
 * @returns A `data:image/jpeg;base64,...` thumbnail of page 1.
 */
export async function renderPdfFirstPage(
  source: string,
  maxWidth = 1400
): Promise<string> {
  const pdfjs = await import('pdfjs-dist');

  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    workerConfigured = true;
  }

  const docInit = source.startsWith('data:')
    ? { data: base64ToBytes(source) }
    : { url: source };

  const pdf = await pdfjs.getDocument(docInit).promise;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    // Cap the scale at 2x so a small page isn't upscaled into a blurry,
    // oversized canvas; otherwise fit the page to maxWidth.
    const scale = Math.min(2, maxWidth / baseViewport.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas context');

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    // Release worker-side resources for this document.
    pdf.destroy();
  }
}

/**
 * Count the pages in a PDF file.
 *
 * Used to enforce the single-page identity-document rule (one passport / ID
 * page per file) before any AI validation, upload, or page-1 flatten — see
 * single-page-pdf.ts. Reads the bytes straight from the File (no base64
 * round-trip) and only reads `numPages`, so it never rasterizes a page.
 *
 * Client-only, same as renderPdfFirstPage: pdfjs is dynamically imported so it
 * never runs during SSR, and the worker is loaded same-origin to satisfy CSP.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const pdfjs = await import('pdfjs-dist');

  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    workerConfigured = true;
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    return pdf.numPages;
  } finally {
    pdf.destroy();
  }
}
