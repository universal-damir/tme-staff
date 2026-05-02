/**
 * Submit Employer Form API
 *
 * POST: Saves employer data to Supabase AND notifies TME Portal in one server-side call.
 * This ensures the notification always fires (not dependent on browser staying alive).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { signWebhookBody } from '@/lib/webhook-signature';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, employerData, signature, ip } = body;

    if (!id || !employerData || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Save employer data to Supabase via the service-role client. Anon
    // RLS used to permit this update (anon_update policy); after the P0-3
    // hardening we route every write through service-role server endpoints
    // and drop that policy.
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('staff_onboarding_submissions')
      .update({
        employer_data: employerData,
        employer_signature_data: signature,
        employer_signed_at: new Date().toISOString(),
        employer_signer_ip: ip || null,
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
    const jobTitle = employerData.job_title_visa === 'Other'
      ? employerData.job_title_visa_custom
      : employerData.job_title_visa;

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
