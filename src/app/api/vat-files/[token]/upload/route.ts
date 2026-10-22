import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { inflateRawSync } from 'zlib';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  isDirectUploadRequest,
  readDirectUploadRequest,
  startDirectUpload,
  readDirectUpload,
  removeDirectUpload,
} from '@/lib/direct-upload';
import {
  VAT_FILES_MAX_BYTES,
  VAT_FILES_MAX_TOTAL,
  VAT_FILES_MAX_STORED,
  VAT_ZIP_PART_MAX_BYTES,
  buildStoragePath,
  checkVatFile,
  displayFileName,
  isAcceptedExtension,
  isUploadPathForLink,
  linkFolder,
  vatFilesRateLimited,
} from '@/lib/vat-files';
import { isVatCustomsDocKind, sanitizePageLines } from '@/lib/vat-customs';
import { listVatLinkFolder, verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import { vatFilesViewer } from '@/lib/vat-files-code';
import { VAT_FILES_BUCKET, type VatCustomsDocKind, type VatFileRequestRow } from '@/types/vat-files';

export const runtime = 'nodejs';

// POST /api/vat-files/[token]/upload   multipart: file
// (or JSON { step: 'start' | 'finish', ... } for files over ~4 MB, see
// lib/direct-upload.ts). Checks the file (size, type from the first bytes,
// matching extension) and stores it in the private `vat-files` bucket at
// `{environment}/{link_token}/{uuid}-{safeName}`. The row is NOT changed
// here: the file joins the row's `files` only when the client presses Send.
// Round 3: optional fields `lineId` (a customs line of THIS row) + `docKind`
// ('boe' | 'invoice' | 'other') say the file belongs to a row of the customs
// table; they are checked here and echoed back, and the page sends them with
// the path at Send, where they are checked again and kept on the file entry.
// Answer: { path, name, size, lineId?, docKind? }.
// Round 4 B: like every route of the page, 401 `email_code_required` when the
// row needs an email code and the browser has no valid proof (vat-files-code.ts).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  if (vatFilesRateLimited(getClientIp(req))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const access = await verifyVatFilesAccess(token);
  if (!access.ok || !access.row) {
    return NextResponse.json(vatFilesAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const viewer = await vatFilesViewer(req, access.row);
  if (!viewer.ok) return NextResponse.json(viewer.body, { status: viewer.status });
  const row = access.row;
  if ((row.files ?? []).length >= VAT_FILES_MAX_TOTAL) {
    return NextResponse.json({ error: 'too_many_files' }, { status: 409 });
  }
  // Uploaded but never sent counts too: a link's folder never grows past the cap.
  const inFolder = await listVatLinkFolder(linkFolder(row.environment, row.link_token), { stopAfter: VAT_FILES_MAX_STORED });
  if (!inFolder) {
    console.error('vat-files/upload: could not count the stored files');
    return NextResponse.json({ error: 'upload_failed' }, { status: 503 });
  }
  if (inFolder.size > VAT_FILES_MAX_STORED) {
    return NextResponse.json({ error: 'too_many_files' }, { status: 409 });
  }

  if (isDirectUploadRequest(req.headers.get('content-type'))) {
    const body = await readDirectUploadRequest(req);
    if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

    const target = readLineTarget(row, body.lineId, body.docKind);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });

    if (body.step === 'start') {
      // Refuse an unknown extension before the browser sends 20 MB.
      if (typeof body.filename === 'string' && !isAcceptedExtension(body.filename)) {
        return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
      }
      const started = await startDirectUpload(VAT_FILES_BUCKET, row.id, body.size, VAT_FILES_MAX_BYTES);
      if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
      return NextResponse.json({ uploadUrl: started.uploadUrl, uploadId: started.uploadId });
    }

    const received = await readDirectUpload(VAT_FILES_BUCKET, row.id, body.uploadId, VAT_FILES_MAX_BYTES);
    if (!received.ok) return NextResponse.json({ error: received.error }, { status: received.status });
    try {
      return await store(row, received.bytes, String(body.filename ?? ''), target);
    } finally {
      await removeDirectUpload(VAT_FILES_BUCKET, row.id, body.uploadId);
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'upload_failed' }, { status: 413 });
  }
  const target = readLineTarget(row, form.get('lineId'), form.get('docKind'));
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size === 0 || file.size > VAT_FILES_MAX_BYTES) {
    return NextResponse.json({ error: 'file_size_out_of_range' }, { status: 413 });
  }
  return store(row, new Uint8Array(await file.arrayBuffer()), String(file.name ?? ''), target);
}

type LineTarget = { ok: true; lineId?: number; docKind?: VatCustomsDocKind } | { ok: false; error: string };

/** The optional customs line of an upload: absent = a general file; present = a line of this row + a kind. */
function readLineTarget(row: VatFileRequestRow, rawLineId: unknown, rawDocKind: unknown): LineTarget {
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  if (empty(rawLineId)) return empty(rawDocKind) ? { ok: true } : { ok: false, error: 'invalid_line' };
  const lineId = typeof rawLineId === 'number' ? rawLineId : /^\d{1,15}$/.test(String(rawLineId)) ? Number(rawLineId) : NaN;
  if (!Number.isSafeInteger(lineId) || lineId <= 0) return { ok: false, error: 'invalid_line' };
  if (!sanitizePageLines(row.customs_lines).some((l) => l.id === lineId)) return { ok: false, error: 'unknown_line' };
  if (!isVatCustomsDocKind(rawDocKind)) return { ok: false, error: 'invalid_line' };
  return { ok: true, lineId, docKind: rawDocKind };
}

async function store(
  row: VatFileRequestRow,
  bytes: Uint8Array,
  originalName: string,
  target: { lineId?: number; docKind?: VatCustomsDocKind } = {}
): Promise<NextResponse> {
  // maxOutputLength: a zip bomb throws here (caught in the check = refused)
  // instead of inflating gigabytes into memory.
  const checked = checkVatFile(bytes, originalName, {
    inflateRaw: (data) => inflateRawSync(data, { maxOutputLength: VAT_ZIP_PART_MAX_BYTES }),
  });
  if (!checked.ok) {
    if (checked.reason === 'wrong_type') {
      return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
    }
    // Macros / a program attached to an email: 422 + a sentence the page shows as is.
    return NextResponse.json(
      { error: checked.reason === 'macros' ? 'file_has_macros' : 'risky_attachment', errorMessage: checked.message },
      { status: 422 }
    );
  }
  const detected = checked.type;
  const path = buildStoragePath(row.environment, row.link_token, randomUUID(), originalName);
  const { error } = await getSupabaseAdmin()
    .storage.from(VAT_FILES_BUCKET)
    .upload(path, bytes, { contentType: detected.mime, cacheControl: '3600', upsert: false });
  if (error) {
    console.error('vat-files/upload: storage upload failed');
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
  return NextResponse.json({
    path,
    name: displayFileName(originalName),
    size: bytes.length,
    ...(target.lineId ? { lineId: target.lineId, docKind: target.docKind } : {}),
  });
}

// DELETE /api/vat-files/[token]/upload?path=...
// The client removes a file it uploaded but has not sent yet. Files already
// sent (in the row's `files`) stay: the portal may have pulled them.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  if (vatFilesRateLimited(getClientIp(req))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const access = await verifyVatFilesAccess(token);
  if (!access.ok || !access.row) {
    return NextResponse.json(vatFilesAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const viewer = await vatFilesViewer(req, access.row);
  if (!viewer.ok) return NextResponse.json(viewer.body, { status: viewer.status });
  const row = access.row;
  const path = req.nextUrl.searchParams.get('path');
  if (!isUploadPathForLink(path, row.environment, row.link_token)) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }
  if ((row.files ?? []).some((f) => f.path === path)) {
    return NextResponse.json({ error: 'already_sent' }, { status: 409 });
  }
  // The FTA import list the portal put in this folder is never the client's to remove.
  if (path === row.customs_list_path) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }
  try {
    await getSupabaseAdmin().storage.from(VAT_FILES_BUCKET).remove([path]);
  } catch {
    // Best effort: an unsent file in a private bucket harms nobody.
  }
  return NextResponse.json({ removed: true });
}
