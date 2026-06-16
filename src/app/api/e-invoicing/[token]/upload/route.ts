import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin, GAP_INTAKE_BUCKET } from '@/lib/supabase-server';
import { verifyGapIntakeAccess, type GapIntakeFileRef } from '@/lib/gap-intake-token';
import { detectInvoiceFile, MAX_FILE_BYTES } from '@/lib/invoice-file-validation';

export const runtime = 'nodejs';

// Cap how many sample invoices one submission can hold (keeps storage + the
// portal's per-submission analysis budget bounded).
const MAX_FILES_PER_SUBMISSION = 10;

// POST /api/e-invoicing/[token]/upload  (multipart: file)
// Validates the token + file, uploads to the gap-intake bucket, and appends the
// reference to the submission's invoice_files. Returns the updated file list.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // Writes: an already-submitted/synced row is closed.
  const access = await verifyGapIntakeAccess(token, { allowSubmitted: false });
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
    return NextResponse.json(
      { error: 'upload_failed' },
      { status: 413 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'file_size_out_of_range' }, { status: 413 });
  }

  const existing = row.invoice_files ?? [];
  if (existing.length >= MAX_FILES_PER_SUBMISSION) {
    return NextResponse.json({ error: 'too_many_files' }, { status: 409 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const detected = detectInvoiceFile(buf);
  if (!detected) {
    return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
  }

  const supabase = getSupabaseAdmin();
  const opaqueName = `${randomUUID()}${detected.ext}`;
  const path = `${row.id}/${opaqueName}`;

  const { error: upErr } = await supabase.storage
    .from(GAP_INTAKE_BUCKET)
    .upload(path, buf, {
      contentType: detected.mime,
      cacheControl: '3600',
      upsert: false,
    });

  if (upErr) {
    console.error('e-invoicing/upload: supabase upload failed');
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  const displayName = String(file.name)
    .replace(/[^a-zA-Z0-9.\-_ ]/g, '_')
    .slice(0, 200);

  const ref: GapIntakeFileRef = {
    path,
    filename: displayName,
    channel: detected.channel,
  };

  // Append to invoice_files. Read-modify-write is fine here — a single client
  // uploads one file at a time from the form.
  const updatedFiles = [...existing, ref];
  const { error: updErr } = await supabase
    .from('gap_intake_submissions')
    .update({ invoice_files: updatedFiles })
    .eq('id', row.id);

  if (updErr) {
    console.error('e-invoicing/upload: failed to append file ref');
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  return NextResponse.json({
    filename: displayName,
    channel: detected.channel,
    files: updatedFiles.map((f) => ({ filename: f.filename, channel: f.channel })),
  });
}

// DELETE /api/e-invoicing/[token]/upload?index=N
// Removes a single uploaded file (client realised they picked the wrong one).
// Deletes by array index — a single client uploads one at a time, so the index
// the page rendered is stable. Returns the updated file list.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // Writes: an already-submitted/synced row is closed.
  const access = await verifyGapIntakeAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }
  const row = access.row;

  const index = Number(req.nextUrl.searchParams.get('index'));
  const existing = row.invoice_files ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= existing.length) {
    return NextResponse.json({ error: 'invalid_index' }, { status: 400 });
  }

  const target = existing[index];
  const updatedFiles = existing.filter((_, i) => i !== index);

  const supabase = getSupabaseAdmin();

  // Update the row FIRST so a failed storage delete leaves a harmless orphan
  // object, never a DB ref pointing at bytes that are already gone.
  const { error: updErr } = await supabase
    .from('gap_intake_submissions')
    .update({ invoice_files: updatedFiles })
    .eq('id', row.id);

  if (updErr) {
    console.error('e-invoicing/upload: failed to remove file ref');
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  if (target?.path) {
    const { error: rmErr } = await supabase.storage
      .from(GAP_INTAKE_BUCKET)
      .remove([target.path]);
    if (rmErr) console.error('e-invoicing/upload: storage remove failed (orphan left)');
  }

  return NextResponse.json({
    files: updatedFiles.map((f) => ({ filename: f.filename, channel: f.channel })),
  });
}
