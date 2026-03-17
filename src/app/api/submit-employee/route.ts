/**
 * Submit Employee Form API
 *
 * POST: Saves employee data to Supabase AND notifies TME Portal in one server-side call.
 * Handles both regular flow and same-person flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, employeeData, signature, ip, isSamePerson, employerData, employerSignature } = body;

    if (!id || !employeeData || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 1. Save to Supabase
    let updateData: Record<string, unknown>;

    if (isSamePerson && employerData) {
      // Same-person mode — save both sections
      updateData = {
        employer_data: employerData,
        employer_signature_data: employerSignature || signature,
        employer_signed_at: now,
        employer_signer_ip: ip || null,
        employee_data: employeeData,
        employee_signature_data: signature,
        employee_signed_at: now,
        employee_signer_ip: ip || null,
        current_step: 'complete',
        status: 'complete',
        updated_at: now,
      };
    } else {
      // Regular flow — just employee data
      updateData = {
        employee_data: employeeData,
        employee_signature_data: signature,
        employee_signed_at: now,
        employee_signer_ip: ip || null,
        current_step: 'complete',
        status: 'complete',
        updated_at: now,
      };
    }

    const { error } = await supabase
      .from('staff_onboarding_submissions')
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.error('[submit-employee] Supabase update failed:', error);
      return NextResponse.json({ error: 'Failed to save form' }, { status: 500 });
    }

    // 2. Notify TME Portal to trigger sync (server-side — guaranteed to complete)
    try {
      const notifyResponse = await fetch(
        `${TME_PORTAL_URL}/api/clients-v2/staff/onboarding/employee-complete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': process.env.STAFF_PORTAL_API_SECRET || '',
          },
          body: JSON.stringify({ supabaseId: id }),
        }
      );

      const notifyResult = await notifyResponse.json();
      console.log('[submit-employee] Portal sync result:', notifyResult);
    } catch (notifyError) {
      console.error('[submit-employee] Portal notification failed:', notifyError);
      // Don't fail — cron will pick it up as fallback
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[submit-employee] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
