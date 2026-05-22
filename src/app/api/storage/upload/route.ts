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

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const submissionId = String(form.get('submissionId') ?? '');
    const type = String(form.get('type') ?? '');
    const passportPage = form.get('passportPage') ? String(form.get('passportPage')) : null;
    const file = form.get('file');

    if (!isValidSubmissionId(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 });
    }
    if (!isAllowedType(type)) {
      return NextResponse.json({ error: 'invalid_type' }, { status: 400 });
    }
    if (passportPage !== null && !isAllowedPassportPage(passportPage)) {
      return NextResponse.json({ error: 'invalid_passport_page' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missing_file' }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'file_size_out_of_range' }, { status: 413 });
    }

    const supabase = getSupabaseAdmin();

    // The form's submissionId is the URL link_token (rotatable). Resolve to
    // the Supabase row id so storage paths stay stable across reissues —
    // otherwise rotated rows would orphan their earlier uploads under the
    // old folder.
    const rowId = await resolveSubmissionIdByLinkToken(submissionId);
    if (!rowId) {
      return NextResponse.json({ error: 'submission_not_found' }, { status: 404 });
    }

    // Verify status (use resolved id from here on).
    const { data: row, error: rowErr } = await supabase
      .from('staff_onboarding_submissions')
      .select('id,status')
      .eq('id', rowId)
      .maybeSingle();

    if (rowErr) {
      console.error('storage/upload: row lookup failed');
      return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'submission_not_found' }, { status: 404 });
    }
    if (row.status === 'complete' || row.status === 'cancelled') {
      return NextResponse.json({ error: 'submission_closed' }, { status: 409 });
    }

    const buf = new Uint8Array(await file.arrayBuffer());
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

    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKET)
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
    const displayName = String(file.name).replace(/[^a-zA-Z0-9.\-_ ]/g, '_').slice(0, 200);

    return NextResponse.json({ path, filename: displayName });
  } catch (err) {
    console.error('storage/upload: unexpected error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
