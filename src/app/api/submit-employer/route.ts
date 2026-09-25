/**
 * Submit Employer Form API
 *
 * POST: Saves employer data to Supabase AND notifies TME Portal in one server-side call.
 * This ensures the notification always fires (not dependent on browser staying alive).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { signWebhookBody } from '@/lib/webhook-signature';
import {
  assertSubmittable,
  getSignerIp,
  sanitizeFreeText,
} from '@/lib/submit-validation';
import { foldPayloadToEnglish } from '@/lib/english-only';
import {
  resolveSubmissionIdByLinkToken,
  employerTokenMatches,
} from '@/lib/onboarding-token';

const ALREADY_SIGNED_MESSAGE = 'The employer part of this form has already been signed.';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id: linkToken, employerData, signature, employerToken } = body;

    if (!linkToken || !employerData || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The body's "id" is the URL link_token (rotatable). Resolve it to the
    // Supabase row's actual id so downstream `.eq('id', ...)` lookups and the
    // portal webhook payload both use the stable supabase row id.
    const id = await resolveSubmissionIdByLinkToken(linkToken);
    if (!id) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    // P2-4: refuse to overwrite a row that's already complete or cancelled.
    // Look up the current status before issuing the UPDATE.
    const { data: existing, error: lookupError } = await supabase
      .from('staff_onboarding_submissions')
      .select('status, current_step, employer_access_token, employer_recall_count')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error('[submit-employer] Status lookup failed:', lookupError);
      return NextResponse.json({ error: 'Failed to load submission' }, { status: 500 });
    }

    const guard = assertSubmittable(existing);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    // Signed = final. Only a row on the employer step may take an employer
    // submit; a re-POST after signing (current_step 'employee') used to
    // overwrite the signed employer data + signature. To change a signed
    // form the employer uses "Recall and correct", which moves the row back.
    // Same-person rows submit here at current_step 'employer' too, so they
    // still pass; Partner/Investor rows (born on the employee step) have no
    // employer stage and are refused.
    const row = existing as {
      status: string;
      current_step: string | null;
      employer_access_token: string | null;
      employer_recall_count: number | null;
    };
    if (row.current_step !== 'employer') {
      return NextResponse.json({ error: ALREADY_SIGNED_MESSAGE }, { status: 409 });
    }

    // After a recall the employer re-signs from their own email link. The
    // employee's (dead) link carries the same link_token, so the employer
    // token must match here.
    if (
      (row.employer_recall_count ?? 0) > 0 &&
      row.employer_access_token &&
      !employerTokenMatches(row, typeof employerToken === 'string' ? employerToken : null)
    ) {
      return NextResponse.json(
        { error: 'Please use the link from your latest email from TME Services.' },
        { status: 403 },
      );
    }

    // P2-3: derive signer IP from request headers, never from body.
    const signerIp = getSignerIp(req);

    // P2-13: strip control chars / angle brackets / cap string lengths.
    // English letters only. The form folds as the person types, but this is
    // the gate that counts: a submission can also arrive from a passport
    // scan's autofill or a replayed request, and every field here is copied
    // onto an ICP or MoHRE form that takes A-Z and nothing else.
    // NOT applied to `documents` — those carry real storage filenames, and
    // renaming one here would break the download that follows.
    const cleanEmployerData = foldPayloadToEnglish(
      sanitizeFreeText(employerData)
    ) as Record<string, unknown>;

    // 1. Save employer data to Supabase via the service-role client. Anon
    // RLS used to permit this update (anon_update policy); after the P0-3
    // hardening we route every write through service-role server endpoints
    // and drop that policy.
    // Conditional on the employer step so two racing submits (or a submit
    // racing anything else that moves the step) cannot both land.
    const { data: updatedRows, error } = await supabase
      .from('staff_onboarding_submissions')
      .update({
        employer_data: cleanEmployerData,
        employer_signature_data: signature,
        employer_signed_at: new Date().toISOString(),
        employer_signer_ip: signerIp,
        current_step: 'employee',
        status: 'employer_completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('current_step', 'employer')
      .select('id');

    if (error) {
      console.error('[submit-employer] Supabase update failed:', error);
      return NextResponse.json({ error: 'Failed to save form' }, { status: 500 });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: ALREADY_SIGNED_MESSAGE }, { status: 409 });
    }

    // 2. Notify TME Portal (server-side — guaranteed to complete)
    const jobTitle = cleanEmployerData.job_title_visa === 'Other'
      ? cleanEmployerData.job_title_visa_custom
      : cleanEmployerData.job_title_visa;

    try {
      const apiSecret = process.env.STAFF_PORTAL_API_SECRET;
      if (!apiSecret) {
        // Fail-closed: refuse to call the portal with an empty secret. The
        // Supabase row is still saved, so the portal cron-side fallback will
        // pick this up.
        throw new Error('STAFF_PORTAL_API_SECRET is not configured');
      }
      const notifyBody = JSON.stringify({ supabaseId: id, jobTitle });
      const sigHeaders = signWebhookBody(apiSecret, notifyBody);
      const notifyResponse = await fetch(
        `${TME_PORTAL_URL}/api/clients-v2/staff/onboarding/employer-complete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...sigHeaders,
          },
          body: notifyBody,
        }
      );

      const notifyResult = await notifyResponse.json();
      console.log('[submit-employer] Portal notification result:', notifyResult);
    } catch (notifyError) {
      console.error('[submit-employer] Portal notification failed:', notifyError);
      // Don't fail — the data is saved, cron will pick it up as fallback
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[submit-employer] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
