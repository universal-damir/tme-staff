/**
 * Supabase side of the server AI verdicts (see document-checks.ts).
 *
 *  - `loadStoredFileForCheck` downloads the stored file an AI route was
 *    pointed at, so the check runs on the bytes TME will receive, not on
 *    whatever the browser sent.
 *  - `recordServerCheck` writes the verdict into `documents.server_checks`
 *    with a compare-and-set on `updated_at`, so it never overwrites a
 *    documents save that landed in between (and vice versa).
 */

import { createHash } from 'crypto';
import { getSupabaseAdmin, STORAGE_BUCKET } from './supabase-server';
import { countPdfPagesServer } from './pdf-page-count-server';
import { comparePhotos, type ComparePhotoInput, type PhotoCompareResult } from './photo-compare';
import { validatePhoto } from './photo-validation';
import { validatePassportPage, type PassportPageType } from './passport-page-validation';
import { extractEid } from './eid-extraction';
import {
  applyCheckRecord,
  isPathForKind,
  type CheckUpdate,
  type ServerCheckKind,
} from './document-checks';

const TABLE = 'staff_onboarding_submissions';

/**
 * The Anthropic API refuses an image whose base64 is over 5 MB (5,242,880
 * characters). Stay a little under it.
 */
export const MAX_BOUND_IMAGE_BASE64 = 5_000_000;
/** PDFs go as a document block; the upload limit (10 MB) is well inside the API limit. */
export const MAX_BOUND_PDF_BYTES = 10 * 1024 * 1024;

type StoredMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf';

function detectMedia(buf: Buffer): StoredMedia | null {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

export type StoredFileForCheck =
  | {
      ok: true;
      sha256: string;
      /**
       * The stored file as a data URL for the AI, or null when it cannot be
       * sent as is (too large, HEIC, a PDF where the check takes images
       * only). The route then checks the browser's copy and the verdict is
       * recorded as not bound.
       */
      dataUrl: string | null;
      /** Page count of a stored PDF (null = not a PDF / unknown). */
      pdfPages: number | null;
    }
  | { ok: false; status: number; error: string; infra?: boolean };

export async function loadStoredFileForCheck(
  rowId: string,
  kind: ServerCheckKind,
  path: unknown,
  opts: { allowPdf: boolean }
): Promise<StoredFileForCheck> {
  if (!isPathForKind(rowId, kind, path)) {
    return { ok: false, status: 400, error: 'Invalid document path' };
  }
  const { data, error } = await getSupabaseAdmin().storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) {
    console.error(`[document-checks] could not read the stored file (row ${rowId}, ${kind})`);
    return { ok: false, status: 500, error: 'Could not read the uploaded file', infra: true };
  }
  const buf = Buffer.from(await data.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const media = detectMedia(buf);

  if (media === 'application/pdf') {
    const base64 = buf.toString('base64');
    const pdfPages = countPdfPagesServer(base64);
    const usable = opts.allowPdf && buf.length <= MAX_BOUND_PDF_BYTES;
    return { ok: true, sha256, dataUrl: usable ? `data:application/pdf;base64,${base64}` : null, pdfPages };
  }
  if (media) {
    const base64 = buf.toString('base64');
    const usable = base64.length <= MAX_BOUND_IMAGE_BASE64;
    return { ok: true, sha256, dataUrl: usable ? `data:${media};base64,${base64}` : null, pdfPages: null };
  }
  // HEIC or anything else the AI cannot read.
  return { ok: true, sha256, dataUrl: null, pdfPages: null };
}

const MAX_WRITE_ATTEMPTS = 5;

/** Returns false when the verdict could not be saved (the caller answers "check unavailable"). */
export async function recordServerCheck(
  rowId: string,
  path: string,
  update: CheckUpdate
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data: fresh, error: readErr } = await supabase
      .from(TABLE)
      .select('documents, onboarding_type, updated_at')
      .eq('id', rowId)
      .maybeSingle();
    if (readErr || !fresh) {
      console.error(`[document-checks] could not read row ${rowId}`);
      return false;
    }
    const row = fresh as { documents: unknown; onboarding_type: string | null; updated_at: string | null };
    const documents = applyCheckRecord(row.documents, path, update, row.onboarding_type);

    let q = supabase
      .from(TABLE)
      .update({ documents, updated_at: new Date().toISOString() })
      .eq('id', rowId);
    q = row.updated_at === null ? q.is('updated_at', null) : q.eq('updated_at', row.updated_at);
    const { data: written, error: writeErr } = await q.select('id');
    if (writeErr) {
      console.error(`[document-checks] could not save the check for row ${rowId}`);
      return false;
    }
    if (written && written.length > 0) {
      console.log(
        `[document-checks] row ${rowId} ${update.kind}: verdict=${update.verdict ?? '-'} bound=${update.bound ?? '-'} samePhoto=${update.samePhoto ?? '-'}`
      );
      return true;
    }
    // Another write landed in between: read again.
  }
  console.error(`[document-checks] gave up saving the check for row ${rowId} (busy row)`);
  return false;
}

// ---------------------------------------------------------------------------
// Server check before a hand check (documents route)
// ---------------------------------------------------------------------------

const PASSPORT_PAGE_OF_KIND: Partial<Record<ServerCheckKind, PassportPageType>> = {
  'passport:COVER': 'COVER',
  'passport:INSIDE_PAGES': 'INSIDE_PAGES',
  'passport:ADDITIONAL_PAGE': 'ADDITIONAL_PAGE',
};

/**
 * Run the same AI check the validate-photo / validate-passport-page /
 * extract-eid routes run, on the STORED file, and record the verdict. Used by
 * the documents route when a hand check is asked for a kind the AI never
 * looked at (the strikes happened in the browser only). The verdict does
 * not decide the hand check (a human reviews the file anyway); it makes
 * sure the AI ran. A check that cannot run is recorded as `infra`.
 * One AI call; no same-photo comparison (the reviewer sees the file).
 */
export async function runServerCheckForHandCheck(
  rowId: string,
  kind: ServerCheckKind,
  path: string
): Promise<boolean> {
  const stored = await loadStoredFileForCheck(rowId, kind, path, { allowPdf: kind !== 'photo' });
  if (!stored.ok) {
    return recordServerCheck(rowId, path, { kind, infra: true, sha256: '' });
  }
  const { sha256, dataUrl, pdfPages } = stored;
  if (kind !== 'photo' && pdfPages !== null && pdfPages > 1) {
    return recordServerCheck(rowId, path, { kind, verdict: 'fail', bound: true, sha256 });
  }
  if (!dataUrl || !process.env.ANTHROPIC_API_KEY) {
    return recordServerCheck(rowId, path, { kind, infra: true, sha256 });
  }
  let update: CheckUpdate;
  try {
    if (kind === 'photo') {
      const result = await validatePhoto(dataUrl);
      update = result.infra
        ? { kind, infra: true, sha256 }
        : { kind, verdict: result.valid ? 'pass' : 'fail', bound: true, sha256 };
    } else if (kind === 'eid:front' || kind === 'eid:back') {
      const result = await extractEid(dataUrl, kind === 'eid:back' ? 'back' : 'front');
      // Same rule as extract-eid: the front must yield an EID number.
      const passed = kind === 'eid:front' ? result.success && !!result.data?.emirates_id_number : result.success;
      update = result.infra ? { kind, infra: true, sha256 } : { kind, verdict: passed ? 'pass' : 'fail', bound: true, sha256 };
    } else {
      const expected = PASSPORT_PAGE_OF_KIND[kind] as PassportPageType;
      const result = await validatePassportPage(dataUrl, expected);
      update = result.infra
        ? { kind, infra: true, sha256 }
        : { kind, verdict: result.page_type === expected ? 'pass' : 'fail', bound: true, sha256 };
    }
  } catch {
    console.error(`[document-checks] hand-check server check failed (row ${rowId}, ${kind})`);
    update = { kind, infra: true, sha256 };
  }
  return recordServerCheck(rowId, path, update);
}

// ---------------------------------------------------------------------------
// Renewal same-photo comparison (shared by validate-photo and compare-photo)
// ---------------------------------------------------------------------------

/**
 * Claude caps images at ~5MB; the photo on file is served as-is (no
 * server-side re-compression), so skip the check rather than fail on an
 * oversized original.
 */
const MAX_EXISTING_PHOTO_BYTES = 4.5 * 1024 * 1024;

function compareMediaType(buf: Buffer): ComparePhotoInput['mediaType'] | null {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  return null;
}

/** A data URL (browser copy or stored file) as a comparison input. */
export function parsePhotoDataUrl(image: string): ComparePhotoInput {
  const data = image.replace(/^data:[^;]+;base64,/, '');
  let mediaType: ComparePhotoInput['mediaType'] = 'image/jpeg';
  if (image.startsWith('data:image/png')) mediaType = 'image/png';
  else if (image.startsWith('data:image/gif')) mediaType = 'image/gif';
  else if (image.startsWith('data:image/webp')) mediaType = 'image/webp';
  else if (image.startsWith('data:application/pdf')) mediaType = 'application/pdf';
  return { data, mediaType };
}

/** The storage path of the photo on file (written by TME Portal), or null. */
export function photoOnFilePath(existingDocuments: Record<string, unknown> | null | undefined): string | null {
  const entry = (existingDocuments ?? {})['photo'] as { path?: unknown } | undefined;
  return entry && typeof entry.path === 'string' && entry.path ? entry.path : null;
}

/**
 * Forms that compare a new photo with the one on file: every type with a
 * photo on file except a cancel copy (the person chose to replace it) and a
 * first-time dependent (mirrors the `existingPhoto` prop of PhotoUpload).
 */
export function comparesPhotoOnFile(onboardingType: string | null | undefined): boolean {
  return onboardingType !== 'cancel_copy' && onboardingType !== 'dependent';
}

/**
 * Compare `newPhoto` with the photo on file. The photo on file is NEVER
 * taken from the client: its path comes from the row, and the file is read
 * with the service role. `skipped` = nothing to compare against.
 */
export async function compareWithPhotoOnFile(
  existingDocuments: Record<string, unknown> | null | undefined,
  newPhoto: ComparePhotoInput
): Promise<PhotoCompareResult> {
  const onFile = photoOnFilePath(existingDocuments);
  if (!onFile) return { samePhoto: false, confidence: 0, skipped: true };

  const { data: blob, error } = await getSupabaseAdmin().storage.from(STORAGE_BUCKET).download(onFile);
  if (error || !blob) {
    console.error('[Compare Photo] Could not download photo on file');
    return { samePhoto: false, confidence: 0, infra: true };
  }
  const existingBuf = Buffer.from(await blob.arrayBuffer());
  const existingMediaType = compareMediaType(existingBuf);
  if (!existingMediaType || existingBuf.length > MAX_EXISTING_PHOTO_BYTES) {
    // Unrecognized format or too large for the vision API: skip rather than
    // block; the SHA-256 fast path and the portal sync backstop remain.
    console.warn(
      `[Compare Photo] Skipping: existing photo ${existingMediaType ?? 'unknown format'}, ${existingBuf.length} bytes`
    );
    return { samePhoto: false, confidence: 0, infra: true };
  }
  return comparePhotos({ data: existingBuf.toString('base64'), mediaType: existingMediaType }, newPhoto);
}
