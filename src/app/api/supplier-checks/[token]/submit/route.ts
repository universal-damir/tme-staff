import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { verifySvpIntakeAccess, svpRowPrice, SVP_INTAKE_TABLE } from '@/lib/supplier-policy-token';
import { pickSubmittedAnswers, validateAnswers } from '@/lib/supplier-policy-validation';
import { sanitizeFreeText } from '@/lib/submit-validation';
import { foldPayloadToEnglish } from '@/lib/english-only';
import type { SvpPolicyAnswers } from '@/types/supplier-policy';

export const runtime = 'nodejs';

// Three people, a location and a note: a real body is well under 8 KB.
const MAX_SUBMIT_BYTES = 32 * 1024;

// POST /api/supplier-checks/[token]/submit  (json: SvpPolicyAnswers)
// Stores the client's answers in submitted_data and flips the row to
// 'submitted' so the portal's sync-svp-intake cron picks it up.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const access = await verifySvpIntakeAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }
  const row = access.row;

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_SUBMIT_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Known fields only, control characters out, English letters only (the
  // policy is printed and signed; an authority reads it).
  const picked = foldPayloadToEnglish(sanitizeFreeText(pickSubmittedAnswers(body)));

  // The client agrees to the price the form SHOWED. If TME changed the price
  // while the form was open, ask the client to reload instead of storing an
  // agreement to a price they never saw.
  const shown = (body as { shownPriceAed?: unknown } | null)?.shownPriceAed;
  const rowPrice = svpRowPrice(row);
  if (typeof shown === 'number' && rowPrice !== null && Math.abs(shown - rowPrice) > 0.005) {
    return NextResponse.json({ error: 'price_changed' }, { status: 409 });
  }

  if (picked.priceAgreed !== true) {
    return NextResponse.json({ error: 'price_not_agreed' }, { status: 400 });
  }

  const answers: SvpPolicyAnswers = { ...picked, priceAgreed: true };
  const messages = validateAnswers(answers, { requirePriceAgreed: true });
  if (messages.length > 0) {
    return NextResponse.json({ error: 'invalid_answers', messages }, { status: 400 });
  }

  const now = new Date().toISOString();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(SVP_INTAKE_TABLE)
    .update({
      submitted_data: answers,
      price_agreed: true,
      agreed_at: now,
      submitted_at: now,
      status: 'submitted',
      synced_to_tme: false,
      updated_at: now,
    })
    .eq('id', row.id)
    // Guard against a double submit racing the row to 'submitted' twice:
    // the second update matches no row.
    .eq('status', 'invited')
    .select('id');

  if (error) {
    console.error('supplier-checks/submit: failed to submit');
    return NextResponse.json({ error: 'submit_failed' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
