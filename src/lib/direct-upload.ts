// ===================================================================
// DIRECT UPLOAD (server side): large files go browser -> Supabase
// ===================================================================
//
// Netlify refuses a request body over about 6 MB before our route runs, and
// multipart encoding leaves room for files up to about 4.5 MB only. A phone
// scan of a passport is often bigger. For those files the route hands out a
// one-time Supabase upload URL instead, the browser sends the file straight
// to Supabase, and the route then fetches it back, checks it exactly like a
// normal upload (size, magic bytes) and stores it under its final name.
//
// Flow, all in the existing upload route of each form:
//   1. JSON { step: 'start', size }      -> { uploadUrl, uploadId }
//   2. browser PUTs the file to uploadUrl (Supabase, not Netlify)
//   3. JSON { step: 'finish', uploadId, filename, ...form fields }
//      -> same answer as a normal multipart upload.
//
// The incoming copy lives under `_incoming/<row id>/<uuid>` in the form's
// own bucket and is removed once the file is checked and stored.
//
// Every minted upload URL also leaves a small marker
// `_incoming/<row id>/.slot-<uuid>` (removed on finish), so the per-row cap
// counts URLs handed out, not only files that already arrived: an open link
// cannot mint unlimited URLs and park a file behind each one. Copies and
// markers older than INCOMING_STALE_MS (the life of a signed upload URL) no
// longer count and are removed when next counted, so leftovers of closed
// tabs never block a row for good.

import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from './supabase-server';
import { MAX_FILE_BYTES } from './file-validation';

/** Largest file any form accepts (matches the staff-documents bucket limit). */
export const UPLOAD_MAX_BYTES = MAX_FILE_BYTES;

const INCOMING_PREFIX = '_incoming';
/**
 * Incoming copies one row may have waiting at once. A normal form sends one
 * large file at a time and removes its copy on finish; abandoned copies
 * (closed tab mid-upload) stay until cleaned, so this caps what an open link
 * can park in the bucket without ever finishing.
 */
export const MAX_PENDING_PER_ROW = 10;
/** A signed upload URL lives 2 hours; anything older under _incoming is a leftover. */
export const INCOMING_STALE_MS = 2 * 60 * 60 * 1000;
const SLOT_MARKER_PREFIX = '.slot-';
const LIST_PAGE = 100;
const MAX_LIST_DEPTH = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DirectUploadRequest {
  step: 'start' | 'finish';
  size?: unknown;
  uploadId?: unknown;
  filename?: unknown;
  [field: string]: unknown;
}

/** A JSON body (direct upload step) instead of multipart. */
export function isDirectUploadRequest(contentType: string | null): boolean {
  return (contentType ?? '').toLowerCase().startsWith('application/json');
}

export async function readDirectUploadRequest(
  req: Request
): Promise<DirectUploadRequest | null> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.step !== 'start' && body.step !== 'finish') return null;
    return body as DirectUploadRequest;
  } catch {
    return null;
  }
}

export type DirectUploadError = { ok: false; status: number; error: string };

/** Step 1: a one-time URL the browser uploads the file to. */
export async function startDirectUpload(
  bucket: string,
  rowId: string,
  size: unknown,
  maxBytes: number = UPLOAD_MAX_BYTES
): Promise<{ ok: true; uploadUrl: string; uploadId: string } | DirectUploadError> {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > maxBytes) {
    return { ok: false, status: 413, error: 'file_size_out_of_range' };
  }
  const pending = await countPendingUploads(bucket, rowId);
  if (pending === null) {
    console.error('direct-upload: could not count the pending uploads');
    return { ok: false, status: 503, error: 'upload_failed' };
  }
  if (pending >= MAX_PENDING_PER_ROW) {
    return { ok: false, status: 409, error: 'too_many_files' };
  }
  const uploadId = randomUUID();
  // The slot marker: counted until finish (or until it is stale). Best
  // effort: without it the cap still counts the files that arrived.
  try {
    const { error: markErr } = await getSupabaseAdmin()
      .storage.from(bucket)
      .upload(slotMarkerPath(rowId, uploadId), new Uint8Array(0), {
        contentType: 'application/octet-stream',
        upsert: false,
      });
    if (markErr) console.error('direct-upload: could not write the slot marker');
  } catch {
    console.error('direct-upload: could not write the slot marker');
  }
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUploadUrl(`${INCOMING_PREFIX}/${rowId}/${uploadId}`);
  if (error || !data?.signedUrl) {
    console.error('direct-upload: could not create upload URL', error?.message);
    return { ok: false, status: 500, error: 'upload_failed' };
  }
  return { ok: true, uploadUrl: data.signedUrl, uploadId };
}

/**
 * Step 3: read the uploaded copy back. Returns its bytes for the route's
 * normal checks and storage; call removeDirectUpload afterwards.
 */
export async function readDirectUpload(
  bucket: string,
  rowId: string,
  uploadId: unknown,
  maxBytes: number = UPLOAD_MAX_BYTES
): Promise<{ ok: true; bytes: Uint8Array } | DirectUploadError> {
  if (typeof uploadId !== 'string' || !UUID_RE.test(uploadId)) {
    return { ok: false, status: 400, error: 'invalid_upload_id' };
  }
  const path = `${INCOMING_PREFIX}/${rowId}/${uploadId}`;
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(path);
  if (error || !data) {
    // Never arrived (browser upload failed or the id is not this row's).
    return { ok: false, status: 400, error: 'upload_not_received' };
  }
  if (data.size === 0 || data.size > maxBytes) {
    await removeDirectUpload(bucket, rowId, uploadId);
    return { ok: false, status: 413, error: 'file_size_out_of_range' };
  }
  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
}

function slotMarkerPath(rowId: string, uploadId: string): string {
  return `${INCOMING_PREFIX}/${rowId}/${SLOT_MARKER_PREFIX}${uploadId}`;
}

/** Remove the incoming copy and its slot marker. Best effort: a leftover in a private bucket harms nobody. */
export async function removeDirectUpload(
  bucket: string,
  rowId: string,
  uploadId: unknown
): Promise<void> {
  if (typeof uploadId !== 'string' || !UUID_RE.test(uploadId)) return;
  try {
    await getSupabaseAdmin()
      .storage.from(bucket)
      .remove([`${INCOMING_PREFIX}/${rowId}/${uploadId}`, slotMarkerPath(rowId, uploadId)]);
  } catch {
    // ignore
  }
}

/**
 * Direct uploads of a row still in progress: each upload id with a slot
 * marker or an incoming copy younger than INCOMING_STALE_MS counts once.
 * Older entries are removed (best effort) and not counted. Null when the
 * folder could not be listed. Stops counting past MAX_PENDING_PER_ROW * 10
 * entries (far beyond the cap).
 */
export async function countPendingUploads(
  bucket: string,
  rowId: string,
  now: number = Date.now()
): Promise<number | null> {
  const storage = getSupabaseAdmin().storage.from(bucket);
  const folder = `${INCOMING_PREFIX}/${rowId}`;
  const live = new Set<string>();
  const stale: string[] = [];
  const maxEntries = MAX_PENDING_PER_ROW * 10;
  let seen = 0;
  for (let offset = 0; seen < maxEntries; offset += LIST_PAGE) {
    const { data, error } = await storage.list(folder, { limit: LIST_PAGE, offset });
    if (error || !data) return null;
    for (const obj of data) {
      seen += 1;
      // A sub-folder (no id) is not something the direct upload writes; count it.
      const created = obj.id ? Date.parse(String((obj as { created_at?: unknown }).created_at ?? '')) : NaN;
      if (Number.isFinite(created) && now - created > INCOMING_STALE_MS) {
        stale.push(`${folder}/${obj.name}`);
        continue;
      }
      live.add(obj.name.startsWith(SLOT_MARKER_PREFIX) ? obj.name.slice(SLOT_MARKER_PREFIX.length) : obj.name);
    }
    if (data.length < LIST_PAGE) break;
  }
  if (stale.length > 0) {
    try {
      await storage.remove(stale);
    } catch {
      // ignore: counted as gone either way
    }
  }
  return live.size;
}

/**
 * Count the files under `prefix` (sub-folders included, a few levels deep).
 * Stops once the count passes `stopAfter`. Null when listing failed.
 */
export async function countStoredObjects(
  bucket: string,
  prefix: string,
  stopAfter: number
): Promise<number | null> {
  const storage = getSupabaseAdmin().storage.from(bucket);
  let count = 0;
  const walk = async (folder: string, depth: number): Promise<boolean> => {
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await storage.list(folder, { limit: LIST_PAGE, offset });
      if (error || !data) return false;
      for (const obj of data) {
        // Supabase lists a sub-folder as an entry without an id.
        if (obj.id) count += 1;
        else if (depth < MAX_LIST_DEPTH && !(await walk(`${folder}/${obj.name}`, depth + 1))) return false;
        if (count > stopAfter) return true;
      }
      if (data.length < LIST_PAGE) return true;
    }
  };
  return (await walk(prefix, 0)) ? count : null;
}
