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
import {
  verifyOnboardingAccess,
  isTwoPersonEmployerStep,
  EMPLOYER_DOCUMENT_KEYS,
} from '@/lib/onboarding-token';
import {
  isDirectUploadRequest,
  readDirectUploadRequest,
  startDirectUpload,
  readDirectUpload,
  removeDirectUpload,
  countStoredObjects,
  countPendingUploads,
} from '@/lib/direct-upload';

export const runtime = 'nodejs';

type Fail = { ok: false; response: NextResponse };

function fail(error: string, status: number): Fail {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

// Files one onboarding row may hold (all slots, passport pages and every
// re-upload after an AI rejection: a full two-person onboarding stores about
// 20 slots, a few tries each). Stops an open link from filling the bucket.
const MAX_FILES_PER_ROW = 80;

/**
 * Field checks + the same access gate as the documents route: the link token
 * (`submissionId`), the employee token on the employee step, the employer
 * token after a recall; complete / cancelled / expired rows are closed.
 * Returns the row id.
 */
async function authorize(
  submissionId: string,
  type: string,
  passportPage: string | null,
  token: string | null,
  employerToken: string | null
): Promise<{ ok: true; rowId: string } | Fail> {
  if (!isValidSubmissionId(submissionId)) return fail('invalid_submission_id', 400);
  if (!isAllowedType(type)) return fail('invalid_type', 400);
  if (passportPage !== null && !isAllowedPassportPage(passportPage)) {
    return fail('invalid_passport_page', 400);
  }

  // The form's submissionId is the URL link_token (rotatable). The verifier
  // resolves it to the Supabase row id so storage paths stay stable across
  // reissues — otherwise rotated rows would orphan their earlier uploads
  // under the old folder.
  const access = await verifyOnboardingAccess(submissionId, token, {
    expectedStep: 'auto',
    blockIfComplete: true,
    employerToken,
  });
  if (!access.ok || !access.row) {
    if (access.reason === 'token_required' || access.reason === 'token_invalid' || access.reason === 'recalled') {
      return fail('unauthorized', 403);
    }
    if (access.reason === 'cancelled' || access.reason === 'expired' || access.reason === 'already_complete') {
      return fail('submission_closed', 409);
    }
    return fail('submission_not_found', 404);
  }
  const row = access.row;
  // Employer step of a two-person form: the employer uploads the job offer
  // letter only (the documents route keeps the other keys anyway).
  if (isTwoPersonEmployerStep(row) && !(EMPLOYER_DOCUMENT_KEYS as readonly string[]).includes(type)) {
    return fail('unauthorized', 403);
  }

  // Stored files plus incoming copies not yet finished (lib/direct-upload.ts).
  const stored = await countStoredObjects(STORAGE_BUCKET, row.id, MAX_FILES_PER_ROW);
  // In-progress direct uploads (minted slots); stale leftovers do not count.
  const incoming = stored === null ? null : await countPendingUploads(STORAGE_BUCKET, row.id);
  if (stored === null || incoming === null) {
    console.error('storage/upload: could not count the stored files');
    return fail('upload_failed', 503);
  }
  if (stored + incoming >= MAX_FILES_PER_ROW) return fail('too_many_files', 409);
  return { ok: true, rowId: row.id };
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
  const token = typeof body.token === 'string' ? body.token : null;
  const employerToken = typeof body.employerToken === 'string' ? body.employerToken : null;

  const auth = await authorize(submissionId, type, passportPage, token, employerToken);
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
    const token = form.get('token') ? String(form.get('token')) : null;
    const employerToken = form.get('employerToken') ? String(form.get('employerToken')) : null;

    const auth = await authorize(submissionId, type, passportPage, token, employerToken);
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
