import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin, COMPANY_SETUP_BUCKET } from '@/lib/supabase-server';
import {
  verifyCompanySetupAccess,
  isCompanySetupDocSlot,
} from '@/lib/company-setup-token';
import { MAX_FILE_BYTES, detectExtFromMagic, mimeForExt } from '@/lib/file-validation';
import { getClientIp, rateLimitCheck } from '@/lib/ai-route-guard';
import type { CompanySetupDocuments } from '@/types/company-setup';

export const runtime = 'nodejs';

// Per-submission ceiling. The portal sync enforces the same 100MB budget when
// it pulls the files across, so anything above this could never land anyway.
const MAX_SUBMISSION_BYTES = 100 * 1024 * 1024;
const MAX_SUBMISSION_FILES = 40;

interface UsageTally {
  bytes: number;
  files: number;
  expiresAt: number;
}

// Best-effort per-submission tally. In-memory, exactly like the AI guard's
// rate limiter: a warm Netlify instance shares it, a cold start starts over.
// Seeded on every request from the number of refs actually recorded on the
// row, so a resumed draft is never credited a clean slate for its file COUNT
// (byte totals are not stored on the refs, so those only count this instance's
// own uploads). Combined with the per-IP rate limit this is enough to stop a
// script filling the bucket; it is not a hard quota.
const TALLY_TTL_MS = 6 * 60 * 60 * 1000;
const usageState = new Map<string, UsageTally>();

function countRecordedRefs(documents: CompanySetupDocuments | null): number {
  if (!documents) return 0;
  let count = 0;
  for (const slots of Object.values(documents)) {
    if (!slots || typeof slots !== 'object') continue;
    for (const ref of Object.values(slots)) {
      if (ref && typeof ref === 'object' && typeof ref.path === 'string') count += 1;
    }
  }
  return count;
}

function getTally(rowId: string, recordedFiles: number): UsageTally {
  const now = Date.now();
  const existing = usageState.get(rowId);
  if (!existing || existing.expiresAt <= now) {
    const fresh: UsageTally = { bytes: 0, files: recordedFiles, expiresAt: now + TALLY_TTL_MS };
    usageState.set(rowId, fresh);
    return fresh;
  }
  if (recordedFiles > existing.files) existing.files = recordedFiles;
  return existing;
}

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

  // Same per-IP budget the AI routes use — without it this route was an
  // unmetered file sink for anyone holding a live link.
  if (rateLimitCheck(getClientIp(req)).blocked) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

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

  // Per-submission ceiling — one link must not be able to fill the bucket.
  const tally = getTally(row.id, countRecordedRefs(row.documents));
  if (tally.files + 1 > MAX_SUBMISSION_FILES) {
    return NextResponse.json({ error: 'too_many_files' }, { status: 413 });
  }
  if (tally.bytes + file.size > MAX_SUBMISSION_BYTES) {
    return NextResponse.json({ error: 'submission_quota_exceeded' }, { status: 413 });
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

  tally.bytes += file.size;
  tally.files += 1;

  // Preserve the original (sanitised) display filename in the response so the
  // form can still show "passport.pdf" to the user, while the on-storage name
  // is opaque.
  const displayName = String(file.name).replace(/[^a-zA-Z0-9.\-_ ]/g, '_').slice(0, 200);

  return NextResponse.json({ path, filename: displayName });
}
