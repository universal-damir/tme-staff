import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin, EKYC_BUCKET } from '@/lib/supabase-server';
import {
  EKYC_OPEN_STATUSES,
  EKYC_TABLE,
  ekycAccessErrorBody,
  isEkycDocumentSlot,
  isEkycPathForRow,
  scrubDocumentsForClient,
  verifyEkycAccess,
} from '@/lib/ekyc-token';
import { EKYC_MAX_UPLOAD_BYTES } from '@/lib/ekyc-form';
import { detectExtFromMagic, mimeForExt, type AllowedExt } from '@/lib/file-validation';
import { getClientIp, rateLimitCheck } from '@/lib/ai-route-guard';
import type { EkycDocumentRef, EkycDocuments, EkycDocumentSlot } from '@/types/ekyc';
import {
  isDirectUploadRequest,
  readDirectUploadRequest,
  startDirectUpload,
  readDirectUpload,
  removeDirectUpload,
} from '@/lib/direct-upload';

export const runtime = 'nodejs';

// Files over ~4 MB travel by direct upload (lib/direct-upload.ts), because
// Netlify cuts request bodies at about 6 MB.
const MAX_EKYC_FILE_BYTES = EKYC_MAX_UPLOAD_BYTES;
// The request asks for PDF, JPG or PNG; the magic bytes decide, not the name.
const EKYC_ALLOWED_EXTS: readonly AllowedExt[] = ['.pdf', '.jpg', '.png'];
// Optimistic write of the documents column: retry when another write landed
// between our read and our update.
const MAX_WRITE_ATTEMPTS = 4;

/** Display name kept for the AML team: letters of any script, digits, . - _ space. */
function displayFilename(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[^\p{L}\p{N}.\-_ ]/gu, '_').trim();
  return (cleaned || 'document').slice(0, 200);
}

async function removeObject(path: string): Promise<void> {
  try {
    await getSupabaseAdmin().storage.from(EKYC_BUCKET).remove([path]);
  } catch {
    // Best effort: an orphan file in a private bucket harms nobody.
  }
}

// POST /api/kyc/[token]/upload   multipart: slot, file
// Individual forms only (decision D4). The file is checked (size, magic
// bytes), stored as <submission id>/<slot>-<uuid>.<ext> in the private
// `ekyc-documents` bucket, and its ref is written into the row's `documents`
// column right here (never through the draft save). A replaced file is
// removed from the bucket. The response never contains the storage path.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  if (rateLimitCheck(getClientIp(req)).blocked) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const access = await verifyEkycAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(ekycAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const row = access.row;
  if (row.type !== 'individual') {
    return NextResponse.json({ error: 'uploads_not_allowed' }, { status: 400 });
  }

  // Large files (over ~4 MB) cannot pass Netlify as multipart: the browser
  // sends them straight to Supabase (see lib/direct-upload.ts).
  if (isDirectUploadRequest(req.headers.get('content-type'))) {
    const body = await readDirectUploadRequest(req);
    if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const slot = String(body.slot ?? '');
    if (!isEkycDocumentSlot(slot)) {
      return NextResponse.json({ error: 'invalid_slot' }, { status: 400 });
    }
    if (body.step === 'start') {
      const started = await startDirectUpload(EKYC_BUCKET, row.id, body.size, MAX_EKYC_FILE_BYTES);
      if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
      return NextResponse.json({ uploadUrl: started.uploadUrl, uploadId: started.uploadId });
    }
    const received = await readDirectUpload(EKYC_BUCKET, row.id, body.uploadId, MAX_EKYC_FILE_BYTES);
    if (!received.ok) return NextResponse.json({ error: received.error }, { status: received.status });
    try {
      return await storeAndRecord(row.id, slot, received.bytes, String(body.filename ?? ''));
    } finally {
      await removeDirectUpload(EKYC_BUCKET, row.id, body.uploadId);
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'upload_failed' }, { status: 413 });
  }
  const slot = String(form.get('slot') ?? '');
  const file = form.get('file');
  if (!isEkycDocumentSlot(slot)) {
    return NextResponse.json({ error: 'invalid_slot' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_EKYC_FILE_BYTES) {
    return NextResponse.json({ error: 'file_size_out_of_range' }, { status: 413 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  return storeAndRecord(row.id, slot, buf, String(file.name ?? ''));
}

/**
 * Magic-byte check, store as <submission id>/<slot>-<uuid>.<ext>, and write
 * the ref into the row. Same for both upload paths.
 */
async function storeAndRecord(
  rowId: string,
  slot: EkycDocumentSlot,
  buf: Uint8Array,
  originalName: string
): Promise<NextResponse> {
  const ext = detectExtFromMagic(buf);
  if (!ext || !EKYC_ALLOWED_EXTS.includes(ext)) {
    return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
  }

  const supabase = getSupabaseAdmin();
  const mimeType = mimeForExt(ext);
  const path = `${rowId}/${slot}-${randomUUID()}${ext}`;
  const { error: upErr } = await supabase.storage
    .from(EKYC_BUCKET)
    .upload(path, buf, { contentType: mimeType, cacheControl: '3600', upsert: false });
  if (upErr) {
    console.error('kyc/upload: storage upload failed');
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  const ref: EkycDocumentRef = {
    path,
    filename: displayFilename(originalName),
    mimeType,
    size: buf.length,
    uploadedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data: fresh, error: readErr } = await supabase
      .from(EKYC_TABLE)
      .select('documents, status, updated_at')
      .eq('id', rowId)
      .maybeSingle();
    if (readErr || !fresh) {
      await removeObject(path);
      return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
    }
    const current = fresh as { documents: EkycDocuments | null; status: string; updated_at: string };
    if (!(EKYC_OPEN_STATUSES as readonly string[]).includes(current.status)) {
      await removeObject(path);
      return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
    }

    const documents: EkycDocuments = { ...(current.documents ?? {}) };
    const previous = documents[slot];
    documents[slot] = ref;

    const { data: written, error: writeErr } = await supabase
      .from(EKYC_TABLE)
      .update({ documents, status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', rowId)
      .eq('updated_at', current.updated_at)
      .in('status', EKYC_OPEN_STATUSES as string[])
      .select('id');
    if (writeErr) {
      await removeObject(path);
      console.error('kyc/upload: saving the file reference failed');
      return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
    }
    if (written && written.length > 0) {
      if (previous && previous.path !== path && isEkycPathForRow(previous.path, rowId)) {
        await removeObject(previous.path);
      }
      return NextResponse.json({ slot, document: scrubDocumentsForClient({ [slot]: ref })[slot] });
    }
    // Another write landed in between (a draft save or a second upload): read again.
  }

  await removeObject(path);
  return NextResponse.json({ error: 'upload_failed' }, { status: 503 });
}
