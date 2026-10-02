import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  EKYC_OPEN_STATUSES,
  EKYC_TABLE,
  ekycAccessErrorBody,
  verifyEkycAccess,
} from '@/lib/ekyc-token';
import {
  clearHiddenFields,
  ekycSchemaFor,
  requiredEkycDocuments,
  sanitizeEkycData,
  validateEkycData,
} from '@/lib/ekyc-form';
import type { IndividualKycData } from '@/types/ekyc';

export const runtime = 'nodejs';

const MAX_SUBMIT_BYTES = 256 * 1024;

// POST /api/kyc/[token]/submit   body: { formData }
// Final submit (R13). Runs the SAME validator as the browser
// (validateCorporateKyc / validateIndividualKyc from the contract) on the
// sanitized answers and, for an individual, on the files stored on the row.
// Any problem = 400 with the list. Clean = form_data stored, row locked as
// 'submitted'. After that every write route answers 409.
// The update only lands when updated_at is still the value read at the start
// (compare-and-set): an upload or draft save that landed in between means the
// files checked here may be stale, so the client gets 409 'changed' and is
// asked to press Submit again.
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
  if (raw.length > MAX_SUBMIT_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  let body: { formData?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!body || body.formData === null || typeof body.formData !== 'object' || Array.isArray(body.formData)) {
    return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 });
  }

  const formData = clearHiddenFields(ekycSchemaFor(row.type), sanitizeEkycData(row.type, body.formData));

  // Files: only the ones this person still needs go with the record (a
  // second passport uploaded before "dual nationality" was changed to No is
  // left out, like any other hidden answer).
  const documents =
    row.type === 'individual' ? requiredEkycDocuments(formData as IndividualKycData, row.documents) : {};

  const errors = validateEkycData(row.type, formData, documents);
  if (errors.length > 0) {
    return NextResponse.json({ error: 'invalid', errors }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    form_data: formData,
    status: 'submitted',
    submitted_at: now,
    synced_to_tme: false,
    updated_at: now,
  };
  if (row.type === 'individual') patch.documents = documents;

  let update = getSupabaseAdmin()
    .from(EKYC_TABLE)
    .update(patch)
    .eq('id', row.id)
    // A double submit (two tabs, double tap) matches no row the second time.
    .in('status', EKYC_OPEN_STATUSES as string[]);
  if (row.updated_at) update = update.eq('updated_at', row.updated_at);
  const { data, error } = await update.select('id');

  if (error) {
    console.error('kyc/submit: submit failed');
    return NextResponse.json({ error: 'submit_failed' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // Either it was submitted meanwhile (the client reloads the locked form),
    // or another write moved the row (the client asks to press Submit again).
    const again = await verifyEkycAccess(token, { allowSubmitted: false });
    if (again.ok) return NextResponse.json({ error: 'changed' }, { status: 409 });
    return NextResponse.json(ekycAccessErrorBody(again), { status: again.status ?? 409 });
  }
  return NextResponse.json({ ok: true });
}
