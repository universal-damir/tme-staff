import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  verifyCompanySetupAccess,
  documentsErrorForRow,
} from '@/lib/company-setup-token';
import { sanitizeFreeText } from '@/lib/submit-validation';

export const runtime = 'nodejs';

// Generous for the full multi-person draft; rejects abuse-sized payloads
// before JSON.parse (same convention as the onboarding autosave route).
const MAX_AUTOSAVE_BYTES = 256 * 1024;

// POST /api/company-setup/[token]/autosave
// Body: { submittedData?: Partial<CompanySetupSubmittedData>, documents?: CompanySetupDocuments }
// Partial draft save: each provided field replaces the stored column wholesale
// (the form always sends its full current state for that field). Rejected once
// the row is submitted / cancelled / expired.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const access = await verifyCompanySetupAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }
  const row = access.row;

  const raw = await req.text();
  if (raw.length > MAX_AUTOSAVE_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let body: { submittedData?: unknown; documents?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.submittedData !== undefined) {
    if (
      body.submittedData === null ||
      typeof body.submittedData !== 'object' ||
      Array.isArray(body.submittedData)
    ) {
      return NextResponse.json({ error: 'invalid_submitted_data' }, { status: 400 });
    }
    patch.submitted_data = sanitizeFreeText(body.submittedData);
  }

  if (body.documents !== undefined) {
    const docsError = documentsErrorForRow(body.documents, row.id);
    if (docsError) {
      return NextResponse.json({ error: 'invalid_documents', detail: docsError }, { status: 400 });
    }
    patch.documents = sanitizeFreeText(body.documents);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_save' }, { status: 400 });
  }

  // A saving client is by definition working on the form.
  if (row.status === 'invited') patch.status = 'in_progress';

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('company_setup_intake_submissions')
    .update(patch)
    .eq('id', row.id)
    // Never race a concurrent submit — a closed row stays closed.
    .in('status', ['invited', 'in_progress']);

  if (error) {
    console.error('company-setup/autosave: save failed');
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
