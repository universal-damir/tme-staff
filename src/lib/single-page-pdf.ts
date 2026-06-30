import { getPdfPageCount } from './pdf-thumbnail';

/**
 * Single-page identity-document rule.
 *
 * Identity documents must be uploaded as ONE page per file — a single passport
 * data-page spread, a single ID side, etc. A multi-page PDF is the exact path
 * that let a wrong page slip past validation: the vision model passes a file as
 * long as ONE of its pages looks right, while any extra pages (e.g. the address
 * page bundled behind the data page) ride along unseen. We reject multi-page
 * PDFs deterministically here — before any AI call, upload, or page-1 flatten —
 * so a file can never be accepted on the strength of one good page.
 *
 * JPEG photos are inherently a single frame, so they pass without a check; the
 * check only ever opens a PDF.
 *
 * @param file the user-selected file
 * @param noun what a single page should contain, woven into the message
 *             (e.g. "passport data-page spread")
 * @returns an error string to show the user, or null when the file is acceptable
 */
export async function singlePagePdfError(
  file: File,
  noun = 'page'
): Promise<string | null> {
  if (file.type !== 'application/pdf') return null;

  let pages: number;
  try {
    pages = await getPdfPageCount(file);
  } catch {
    return 'We could not read this PDF. Please upload a single-page PDF (just the one page requested above) or a clear JPEG.';
  }

  if (pages > 1) {
    return `This PDF has ${pages} pages. Please upload only a single ${noun} — one page per file. Remove the extra pages and upload just the page requested above.`;
  }
  if (pages < 1) {
    return 'This PDF appears to be empty. Please upload a valid single-page PDF or a JPEG.';
  }
  return null;
}
