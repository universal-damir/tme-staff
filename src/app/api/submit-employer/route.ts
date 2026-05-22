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
import { resolveSubmissionIdByLinkToken } from '@/lib/onboarding-token';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id: linkToken, employerData, signature } = body;

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
      .select('status')
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

    // P2-3: derive signer IP from request headers, never from body.
    const signerIp = getSignerIp(req);

    // P2-13: strip control chars / angle brackets / cap string lengths.
    const cleanEmployerData = sanitizeFreeText(employerData) as Record<string, unknown>;

    // 1. Save employer data to Supabase via the service-role client. Anon
    // RLS used to permit this update (anon_update policy); after the P0-3
    // hardening we route every write through service-role server endpoints
    // and drop that policy.
    const { error } = await supabase
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
      .eq('id', id);

    if (error) {
      console.error('[submit-employer] Supabase update failed:', error);
      return NextResponse.json({ error: 'Failed to save form' }, { status: 500 });
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
