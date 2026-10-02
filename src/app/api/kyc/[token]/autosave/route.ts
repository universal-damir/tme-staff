import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  EKYC_OPEN_STATUSES,
  EKYC_TABLE,
  ekycAccessErrorBody,
  verifyEkycAccess,
} from '@/lib/ekyc-token';
import { clearHiddenFields, ekycSchemaFor, sanitizeEkycData } from '@/lib/ekyc-form';

export const runtime = 'nodejs';

// The whole form plus a drawn signature is well under 100 KB; reject
// abuse-sized bodies before JSON.parse (same cap as the company-setup draft).
const EKYC_MAX_AUTOSAVE_BYTES = 256 * 1024;

// POST /api/kyc/[token]/autosave   body: { formData }
// Draft save (R13). Replaces form_data with the sanitized answers. Never
// touches `documents`: uploads are written by the upload route only, so a
// draft save can never drop a file that landed in between.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const access = await verifyEkycAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(ekycAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const row = access.row;

  const raw = await req.text();
  if (raw.length > EKYC_MAX_AUTOSAVE_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  let body: { formData?: unknown; keepSignature?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!body || body.formData === null || typeof body.formData !== 'object' || Array.isArray(body.formData)) {
    return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 });
  }

  // Known fields only, Unicode letters kept (no English-only fold here:
  // German umlauts must survive), hidden answers dropped.
  const formData = clearHiddenFields(ekycSchemaFor(row.type), sanitizeEkycData(row.type, body.formData));

  // The leave-page save (keepalive, body capped at ~64 KB) leaves out an
  // unchanged signature and says so: keep the one on record.
  if (body.keepSignature === true && !formData.declaration.signature) {
    const stored = sanitizeEkycData(row.type, row.form_data ?? {}).declaration.signature;
    if (stored) formData.declaration = { ...formData.declaration, signature: stored };
  }

  const { data, error } = await getSupabaseAdmin()
    .from(EKYC_TABLE)
    .update({ form_data: formData, status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', row.id)
    // Never race a submit or a cancel: a closed row stays closed.
    .in('status', EKYC_OPEN_STATUSES as string[])
    .select('id');

  if (error) {
    console.error('kyc/autosave: save failed');
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
