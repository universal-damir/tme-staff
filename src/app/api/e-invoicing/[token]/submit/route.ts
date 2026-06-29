import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  verifyGapIntakeAccess,
  isAllowedAccountingSoftware,
} from '@/lib/gap-intake-token';

export const runtime = 'nodejs';

// POST /api/e-invoicing/[token]/submit  (json: { accounting_software, accounting_software_other? })
// Records the client's accounting system and flips the submission to
// 'submitted' so the portal's sync-gap-intake cron picks it up.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const access = await verifyGapIntakeAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }
  const row = access.row;

  let body: {
    accounting_software?: unknown;
    accounting_software_other?: unknown;
    price_agreed?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const software = typeof body.accounting_software === 'string' ? body.accounting_software.trim() : '';
  if (!software || !isAllowedAccountingSoftware(software)) {
    return NextResponse.json({ error: 'invalid_accounting_software' }, { status: 400 });
  }
  const otherRaw =
    typeof body.accounting_software_other === 'string'
      ? body.accounting_software_other.trim().slice(0, 200)
      : '';
  if (software === 'Other' && !otherRaw) {
    return NextResponse.json({ error: 'accounting_software_other_required' }, { status: 400 });
  }

  // Require at least one uploaded invoice — that's the whole point of the intake.
  if (!row.invoice_files || row.invoice_files.length === 0) {
    return NextResponse.json({ error: 'no_invoices_uploaded' }, { status: 400 });
  }

  // If a pre-assessment fee was quoted, the client must tick "I agree" first.
  const priceAgreed = body.price_agreed === true;
  if (row.price_aed != null && !priceAgreed) {
    return NextResponse.json({ error: 'price_not_agreed' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('gap_intake_submissions')
    .update({
      accounting_software: software,
      accounting_software_other: software === 'Other' ? otherRaw : null,
      status: 'submitted',
      synced_to_tme: false,
      submitted_at: new Date().toISOString(),
      price_agreed: priceAgreed,
      agreed_at: priceAgreed ? new Date().toISOString() : null,
    })
    .eq('id', row.id)
    // Guard against double-submit racing the row to 'submitted' twice.
    .eq('status', 'invited');

  if (error) {
    console.error('e-invoicing/submit: failed to submit');
    return NextResponse.json({ error: 'submit_failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
