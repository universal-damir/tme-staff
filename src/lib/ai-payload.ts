// ===================================================================
// FILE -> AI CHECK PAYLOAD
// ===================================================================
//
// Every AI check (passport, ID, photo, visa document, ...) sends the file as
// a base64 data URL inside a JSON request. Netlify refuses any request body
// over about 6 MB before our code runs, and base64 makes a file a third
// bigger. So a 5 MB iPhone-scan PDF never reached the check and the person
// saw a "try again" error that could never succeed (Jesper, 07.10.26).
//
// prepareFileForAI keeps every payload under AI_PAYLOAD_BUDGET:
//   - photos are resized in the browser (compressImageForAI);
//   - small PDFs go as they are (Claude reads them natively);
//   - large PDFs are re-drawn page by page as JPEGs into a new, small PDF
//     with the same number of pages.
// Only the AI check gets the smaller copy. The stored file stays the
// original (see upload-client.ts).

import { compressImageForAI } from './utils';
import { buildPdfFromJpegs } from './jpeg-pdf';
import { renderPdfPagesToJpeg } from './pdf-thumbnail';

/**
 * Largest data URL (characters) sent to an AI route. Well under the Netlify
 * limit, leaving room for the rest of the JSON body.
 */
export const AI_PAYLOAD_BUDGET = 3_500_000;

/** Most pages we re-draw in the browser for one AI check. */
const MAX_PDF_PAGES_FOR_CHECK = 10;

/** Tried in order until the rebuilt PDF fits the budget. */
const PDF_ATTEMPTS: ReadonlyArray<{ maxDim: number; quality: number }> = [
  { maxDim: 2000, quality: 0.82 },
  { maxDim: 1600, quality: 0.72 },
  { maxDim: 1200, quality: 0.6 },
];

/** The file cannot be made small enough for the automatic check. */
export class FileTooLargeForCheckError extends Error {
  constructor(message = 'File too large for the automatic check') {
    super(message);
    this.name = 'FileTooLargeForCheckError';
  }
}

function isPdfDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith('data:application/pdf');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function shrinkPdfForAI(dataUrl: string): Promise<string> {
  if (dataUrl.length <= AI_PAYLOAD_BUDGET) return dataUrl;

  for (const { maxDim, quality } of PDF_ATTEMPTS) {
    let pages;
    try {
      pages = await renderPdfPagesToJpeg(dataUrl, maxDim, quality, MAX_PDF_PAGES_FOR_CHECK);
    } catch {
      // Unreadable PDF or too many pages: no smaller copy is possible.
      throw new FileTooLargeForCheckError();
    }
    const rebuilt = `data:application/pdf;base64,${bytesToBase64(buildPdfFromJpegs(pages))}`;
    if (rebuilt.length <= AI_PAYLOAD_BUDGET) return rebuilt;
  }
  throw new FileTooLargeForCheckError();
}

/**
 * Turn an uploaded file (data URL) into a payload every AI route accepts.
 * Throws FileTooLargeForCheckError when no small enough copy can be made.
 */
export async function prepareFileForAI(dataUrl: string): Promise<string> {
  if (isPdfDataUrl(dataUrl)) return shrinkPdfForAI(dataUrl);
  if (dataUrl.startsWith('data:image/')) {
    const compressed = await compressImageForAI(dataUrl);
    if (compressed.length > AI_PAYLOAD_BUDGET) throw new FileTooLargeForCheckError();
    return compressed;
  }
  if (dataUrl.length > AI_PAYLOAD_BUDGET) throw new FileTooLargeForCheckError();
  return dataUrl;
}
