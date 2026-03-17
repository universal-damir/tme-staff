/**
 * Submit Employer Form API
 *
 * POST: Saves employer data to Supabase AND notifies TME Portal in one server-side call.
 * This ensures the notification always fires (not dependent on browser staying alive).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, employerData, signature, ip } = body;

    if (!id || !employerData || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Save employer data to Supabase
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
      const notifyResponse = await fetch(
        `${TME_PORTAL_URL}/api/clients-v2/staff/onboarding/employer-complete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': process.env.STAFF_PORTAL_API_SECRET || '',
          },
          body: JSON.stringify({ supabaseId: id, jobTitle }),
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
