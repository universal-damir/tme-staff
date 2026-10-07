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

import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from './supabase-server';
import { MAX_FILE_BYTES } from './file-validation';

/** Largest file any form accepts (matches the staff-documents bucket limit). */
export const UPLOAD_MAX_BYTES = MAX_FILE_BYTES;

const INCOMING_PREFIX = '_incoming';
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
  const uploadId = randomUUID();
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

/** Remove the incoming copy. Best effort: a leftover in a private bucket harms nobody. */
export async function removeDirectUpload(
  bucket: string,
  rowId: string,
  uploadId: unknown
): Promise<void> {
  if (typeof uploadId !== 'string' || !UUID_RE.test(uploadId)) return;
  try {
    await getSupabaseAdmin()
      .storage.from(bucket)
      .remove([`${INCOMING_PREFIX}/${rowId}/${uploadId}`]);
  } catch {
    // ignore
  }
}
