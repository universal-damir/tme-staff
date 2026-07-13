/**
 * Submit Employee Form API
 *
 * POST: Saves employee data to Supabase AND notifies TME Portal in one server-side call.
 * Handles both regular flow and same-person flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { signWebhookBody } from '@/lib/webhook-signature';
import {
  assertSubmittable,
  getSignerIp,
  missingRequiredDocuments,
  sanitizeFreeText,
} from '@/lib/submit-validation';
import { resolveSubmissionIdByLinkToken } from '@/lib/onboarding-token';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id: linkToken, employeeData, signature, isSamePerson, employerData, employerSignature } = body;

    if (!linkToken || !employeeData || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The body's "id" is the URL link_token (rotatable). Resolve to the
    // stable Supabase row id for downstream queries + webhook payloads.
    const id = await resolveSubmissionIdByLinkToken(linkToken);
    if (!id) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    // P2-4: refuse to overwrite a row that's already complete or cancelled.
    // The extra columns feed the required-documents gate below.
    const { data: existing, error: lookupError } = await supabase
      .from('staff_onboarding_submissions')
      .select('status, onboarding_type, sponsorship_type, employer_data, documents, existing_documents, sponsor_noc_signature_data')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error('[submit-employee] Status lookup failed:', lookupError);
      return NextResponse.json({ error: 'Failed to load submission' }, { status: 500 });
    }

    const guard = assertSubmittable(existing);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    // Required-documents gate: the client form enforces this too, but only in
    // browser JavaScript — the server is the authority. Without this, a
    // submission with a missing passport cover or an unvalidated photo would
    // reach status='complete' and fire the confirmation emails (seen live).
    const missingDocs = missingRequiredDocuments(
      existing!,
      employeeData && typeof employeeData === 'object'
        ? (employeeData as Record<string, unknown>).sponsor_noc_signature
        : undefined,
    );
    if (missingDocs.length > 0) {
      console.warn(`[submit-employee] Blocked incomplete submission ${id}: missing ${missingDocs.join(', ')}`);
      return NextResponse.json(
        {
          error: `Cannot submit yet — missing: ${missingDocs.join(', ')}. Please complete the highlighted steps and try again.`,
          missing: missingDocs,
        },
        { status: 422 }
      );
    }

    // P2-3: derive signer IP from request headers, never from body.
    const signerIp = getSignerIp(req);

    // Sponsor NOC signature (family-sponsored flow): the base64 PNG travels
    // inside employeeData. Extract it BEFORE sanitizeFreeText runs so the
    // large base64 isn't truncated by the 2000-char cap, write it to the
    // top-level Supabase column (signed_at + signer_ip set server-side, like
    // the employee signature), then delete it (and any client-sent timestamp)
    // from employeeData so it isn't duplicated inside the employee_data jsonb.
    const sponsorNocSignature =
      employeeData && typeof employeeData === 'object'
        ? (employeeData as Record<string, unknown>).sponsor_noc_signature
        : undefined;
    if (employeeData && typeof employeeData === 'object') {
      delete (employeeData as Record<string, unknown>).sponsor_noc_signature;
      delete (employeeData as Record<string, unknown>).sponsor_noc_signed_at;
    }

    // P2-13: strip control chars / angle brackets / cap string lengths.
    const cleanEmployeeData = sanitizeFreeText(employeeData) as Record<string, unknown>;
    const cleanEmployerData = isSamePerson && employerData
      ? sanitizeFreeText(employerData) as Record<string, unknown>
      : null;

    const now = new Date().toISOString();

    // Top-level sponsor NOC columns, written only when a signature was
    // captured. signed_at / signer_ip are server-derived (never from body).
    const sponsorNocFields: Record<string, unknown> =
      typeof sponsorNocSignature === 'string' && sponsorNocSignature.length > 0
        ? {
            sponsor_noc_signature_data: sponsorNocSignature,
            sponsor_noc_signed_at: now,
            sponsor_noc_signer_ip: signerIp,
          }
        : {};

    // 1. Save to Supabase
    let updateData: Record<string, unknown>;

    if (isSamePerson && cleanEmployerData) {
      // Same-person mode — save both sections
      updateData = {
        employer_data: cleanEmployerData,
        employer_signature_data: employerSignature || signature,
        employer_signed_at: now,
        employer_signer_ip: signerIp,
        employee_data: cleanEmployeeData,
        employee_signature_data: signature,
        employee_signed_at: now,
        employee_signer_ip: signerIp,
        ...sponsorNocFields,
        current_step: 'complete',
        status: 'complete',
        updated_at: now,
      };
    } else {
      // Regular flow — just employee data
      updateData = {
        employee_data: cleanEmployeeData,
        employee_signature_data: signature,
        employee_signed_at: now,
        employee_signer_ip: signerIp,
        ...sponsorNocFields,
        current_step: 'complete',
        status: 'complete',
        updated_at: now,
      };
    }

    // Service-role client (P0-3): writes go through the admin client so
    // anon RLS update policies can be dropped.
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
      const apiSecret = process.env.STAFF_PORTAL_API_SECRET;
      if (!apiSecret) {
        throw new Error('STAFF_PORTAL_API_SECRET is not configured');
      }
      const notifyBody = JSON.stringify({ supabaseId: id });
      const sigHeaders = signWebhookBody(apiSecret, notifyBody);
      const notifyResponse = await fetch(
        `${TME_PORTAL_URL}/api/clients-v2/staff/onboarding/employee-complete`,
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
