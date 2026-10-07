import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-server';
import {
  MAX_FILE_BYTES,
  detectExtFromMagic,
  mimeForExt,
  isValidSubmissionId,
  isAllowedType,
  isAllowedPassportPage,
} from '@/lib/file-validation';
import { resolveSubmissionIdByLinkToken } from '@/lib/onboarding-token';
import {
  isDirectUploadRequest,
  readDirectUploadRequest,
  startDirectUpload,
  readDirectUpload,
  removeDirectUpload,
} from '@/lib/direct-upload';

export const runtime = 'nodejs';

type Fail = { ok: false; response: NextResponse };

function fail(error: string, status: number): Fail {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/** Field checks + the submission must exist and still be open. Returns the row id. */
async function authorize(
  submissionId: string,
  type: string,
  passportPage: string | null
): Promise<{ ok: true; rowId: string } | Fail> {
  if (!isValidSubmissionId(submissionId)) return fail('invalid_submission_id', 400);
  if (!isAllowedType(type)) return fail('invalid_type', 400);
  if (passportPage !== null && !isAllowedPassportPage(passportPage)) {
    return fail('invalid_passport_page', 400);
  }

  // The form's submissionId is the URL link_token (rotatable). Resolve to
  // the Supabase row id so storage paths stay stable across reissues —
  // otherwise rotated rows would orphan their earlier uploads under the
  // old folder.
  const rowId = await resolveSubmissionIdByLinkToken(submissionId);
  if (!rowId) return fail('submission_not_found', 404);

  // Verify status (use resolved id from here on).
  const { data: row, error: rowErr } = await getSupabaseAdmin()
    .from('staff_onboarding_submissions')
    .select('id,status')
    .eq('id', rowId)
    .maybeSingle();

  if (rowErr) {
    console.error('storage/upload: row lookup failed');
    return fail('lookup_failed', 500);
  }
  if (!row) return fail('submission_not_found', 404);
  if (row.status === 'complete' || row.status === 'cancelled') {
    return fail('submission_closed', 409);
  }
  return { ok: true, rowId };
}

/** Magic-byte check, then store under an opaque name. Same for both upload paths. */
async function storeBytes(
  rowId: string,
  type: string,
  passportPage: string | null,
  buf: Uint8Array,
  originalName: string
): Promise<NextResponse> {
  const detected = detectExtFromMagic(buf);
  if (!detected) {
    return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
  }

  const opaqueName = `${randomUUID()}${detected}`;
  // Use the resolved row id as the folder, not the URL token. Stable
  // across reissues.
  const path =
    passportPage !== null
      ? `${rowId}/${type}/${passportPage}/${opaqueName}`
      : `${rowId}/${type}/${opaqueName}`;

  const { error: upErr } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .upload(path, buf, {
      contentType: mimeForExt(detected),
      cacheControl: '3600',
      upsert: false,
    });

  if (upErr) {
    console.error('storage/upload: supabase upload failed');
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  // Preserve the original (sanitised) display filename in the response so the
  // form can still show "passport.pdf" to the user, while the on-storage name
  // is opaque.
  const displayName = originalName.replace(/[^a-zA-Z0-9.\-_ ]/g, '_').slice(0, 200);

  return NextResponse.json({ path, filename: displayName });
}

// Large files (over ~4 MB) cannot pass Netlify as multipart: the browser
// sends them straight to Supabase (see lib/direct-upload.ts).
async function handleDirect(req: NextRequest): Promise<NextResponse> {
  const body = await readDirectUploadRequest(req);
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const submissionId = String(body.submissionId ?? '');
  const type = String(body.type ?? '');
  const passportPage = body.passportPage ? String(body.passportPage) : null;

  const auth = await authorize(submissionId, type, passportPage);
  if (!auth.ok) return auth.response;

  if (body.step === 'start') {
    const started = await startDirectUpload(STORAGE_BUCKET, auth.rowId, body.size, MAX_FILE_BYTES);
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
    return NextResponse.json({ uploadUrl: started.uploadUrl, uploadId: started.uploadId });
  }

  const received = await readDirectUpload(STORAGE_BUCKET, auth.rowId, body.uploadId, MAX_FILE_BYTES);
  if (!received.ok) return NextResponse.json({ error: received.error }, { status: received.status });
  try {
    return await storeBytes(auth.rowId, type, passportPage, received.bytes, String(body.filename ?? 'document'));
  } finally {
    await removeDirectUpload(STORAGE_BUCKET, auth.rowId, body.uploadId);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (isDirectUploadRequest(req.headers.get('content-type'))) {
      return await handleDirect(req);
    }

    const form = await req.formData();
    const submissionId = String(form.get('submissionId') ?? '');
    const type = String(form.get('type') ?? '');
    const passportPage = form.get('passportPage') ? String(form.get('passportPage')) : null;
    const file = form.get('file');

    const auth = await authorize(submissionId, type, passportPage);
    if (!auth.ok) return auth.response;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missing_file' }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'file_size_out_of_range' }, { status: 413 });
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    return await storeBytes(auth.rowId, type, passportPage, buf, String(file.name));
  } catch (err) {
    console.error('storage/upload: unexpected error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
