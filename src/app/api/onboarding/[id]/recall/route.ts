/**
 * Employer "Recall and correct" (staff onboarding + staff renewal, two-person
 * flow only).
 *
 * POST /api/onboarding/<link_token>/recall   body: { employerToken: "<uuid>" }
 *
 * After the employer signed, and while the employee has not submitted yet,
 * the employer may take the form back to fix a mistake:
 *   - the row goes back to current_step 'employer' / status 'pending'
 *   - the employee's link dies at once (employee_access_token rotated, never
 *     nulled, so the employee gate stays on)
 *   - the employer signature is cleared; employer_data, employee_data and
 *     documents are kept, so both sides find their answers again
 *   - the portal is told (signed webhook); if that fails, the portal's
 *     every-minute sync cron reconciles from Supabase
 *
 * Authorisation is the EMPLOYER access token from the employer's email link
 * (`?e=`), never the link_token alone: the employee's URL contains the
 * link_token too.
 *
 * The UPDATE is conditional (current_step 'employee', status
 * 'employer_completed', unchanged recall count) so a recall racing the
 * employee's submit (which is conditional on current_step 'employee') has
 * exactly one winner.
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { signWebhookBody } from '@/lib/webhook-signature';
import {
  ONBOARDING_UUID_REGEX,
  canEmployerRecall,
  employerTokenMatches,
} from '@/lib/onboarding-token';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

interface RecallRow {
  id: string;
  status: string;
  current_step: string;
  is_same_person: boolean;
  onboarding_type: string | null;
  prefill_employer_data: Record<string, unknown> | null;
  employer_access_token: string | null;
  employer_recall_count: number | null;
}

const RECALL_COLUMNS =
  'id, status, current_step, is_same_person, onboarding_type, prefill_employer_data, employer_access_token, employer_recall_count';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: linkToken } = await ctx.params;
  if (!ONBOARDING_UUID_REGEX.test(linkToken)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let employerToken: unknown;
  try {
    const body = (await req.json()) as { employerToken?: unknown } | null;
    employerToken = body?.employerToken;
  } catch {
    employerToken = undefined;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error: lookupError } = await supabase
      .from('staff_onboarding_submissions')
      .select(RECALL_COLUMNS)
      .eq('link_token', linkToken)
      .maybeSingle();

    if (lookupError) {
      console.error('[onboarding/recall] lookup failed:', lookupError);
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const row = data as unknown as RecallRow;

    if (!employerTokenMatches(row, typeof employerToken === 'string' ? employerToken : null)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 });
    }

    if (row.status === 'cancelled') {
      return NextResponse.json({ error: 'cancelled' }, { status: 410 });
    }
    if (row.status === 'expired') {
      return NextResponse.json({ error: 'expired' }, { status: 410 });
    }
    if (row.status === 'complete' || row.current_step === 'complete') {
      return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
    }

    const recallCount = row.employer_recall_count ?? 0;

    // Double click / second tab: already back on the employer step.
    if (row.current_step === 'employer' && recallCount > 0) {
      return NextResponse.json({ success: true, alreadyRecalled: true });
    }

    if (!canEmployerRecall(row)) {
      return NextResponse.json({ error: 'not_recallable' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('staff_onboarding_submissions')
      .update({
        current_step: 'employer',
        status: 'pending',
        employee_access_token: crypto.randomUUID(),
        employer_signature_data: null,
        employer_signed_at: null,
        employer_signer_ip: null,
        employer_recalled_at: nowIso,
        employer_recall_count: recallCount + 1,
        updated_at: nowIso,
      })
      .eq('id', row.id)
      .eq('current_step', 'employee')
      .eq('status', 'employer_completed')
      .eq('employer_recall_count', recallCount)
      .select('id');

    if (updateError) {
      console.error('[onboarding/recall] update failed:', updateError);
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }

    if (!updated || updated.length === 0) {
      // Lost a race (employee submitted, or another recall landed first).
      const { data: fresh } = await supabase
        .from('staff_onboarding_submissions')
        .select('status, current_step')
        .eq('id', row.id)
        .maybeSingle();
      const f = fresh as { status?: string; current_step?: string } | null;
      if (f && (f.status === 'complete' || f.current_step === 'complete')) {
        return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
      }
      return NextResponse.json({ error: 'conflict' }, { status: 409 });
    }

    // Tell the portal (best effort). The portal's sync cron reconciles from
    // Supabase when this call is lost, so a failure never fails the recall.
    try {
      const apiSecret = process.env.STAFF_PORTAL_API_SECRET;
      if (!apiSecret) {
        throw new Error('STAFF_PORTAL_API_SECRET is not configured');
      }
      const rawBody = JSON.stringify({ supabaseId: row.id });
      const res = await fetch(
        `${TME_PORTAL_URL}/api/clients-v2/staff/onboarding/employer-recalled`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...signWebhookBody(apiSecret, rawBody),
          },
          body: rawBody,
        },
      );
      if (!res.ok) {
        console.error('[onboarding/recall] portal notification returned', res.status);
      }
    } catch (notifyError) {
      console.error('[onboarding/recall] portal notification failed:', notifyError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[onboarding/recall] error:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
