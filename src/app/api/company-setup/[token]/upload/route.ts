import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin, COMPANY_SETUP_BUCKET } from '@/lib/supabase-server';
import {
  verifyCompanySetupAccess,
  isCompanySetupDocSlot,
} from '@/lib/company-setup-token';
import { MAX_FILE_BYTES, detectExtFromMagic, mimeForExt } from '@/lib/file-validation';

export const runtime = 'nodejs';

// POST /api/company-setup/[token]/upload
// Multipart: personIndex ("0".."5"), slot (fixed vocabulary), file.
// Magic-byte validated, stored under an opaque name:
//   {submissionId}/{personIndex}/{slot}/{uuid}{ext}
// Clone of the /api/storage/upload conventions (size budget, magic bytes,
// opaque on-storage name, sanitized display filename) scoped to the
// company-setup bucket + token.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // Writes: an already-submitted row is closed.
  const access = await verifyCompanySetupAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }
  const row = access.row;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'upload_failed' }, { status: 413 });
  }

  const personIndex = String(form.get('personIndex') ?? '');
  const slot = String(form.get('slot') ?? '');
  const file = form.get('file');

  if (!/^[0-5]$/.test(personIndex)) {
    return NextResponse.json({ error: 'invalid_person_index' }, { status: 400 });
  }
  if (!isCompanySetupDocSlot(slot)) {
    return NextResponse.json({ error: 'invalid_slot' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'file_size_out_of_range' }, { status: 413 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const detected = detectExtFromMagic(buf);
  if (!detected) {
    return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
  }

  const supabase = getSupabaseAdmin();
  const opaqueName = `${randomUUID()}${detected}`;
  const path = `${row.id}/${personIndex}/${slot}/${opaqueName}`;

  const { error: upErr } = await supabase.storage
    .from(COMPANY_SETUP_BUCKET)
    .upload(path, buf, {
      contentType: mimeForExt(detected),
      cacheControl: '3600',
      upsert: false,
    });

  if (upErr) {
    console.error('company-setup/upload: supabase upload failed');
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  // Preserve the original (sanitised) display filename in the response so the
  // form can still show "passport.pdf" to the user, while the on-storage name
  // is opaque.
  const displayName = String(file.name).replace(/[^a-zA-Z0-9.\-_ ]/g, '_').slice(0, 200);

  return NextResponse.json({ path, filename: displayName });
}
