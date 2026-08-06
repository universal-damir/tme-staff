/**
 * Submit Dependent Form API
 *
 * POST: finalizes a dependent onboarding (onboarding_type === 'dependent') or
 * a dependent visa renewal ('dependent_renewal') created by the TME Portal.
 * The SPONSOR — an existing staff member — filled the single-stage
 * DependentForm for their dependent and signed it; this route verifies
 * completeness server-side, writes the payload + signature, marks the row
 * complete, and webhooks the portal (mirrors submit-employee; the portal cron
 * is the production fallback when the webhook can't reach the air-gapped
 * server).
 *
 * Both flavours write the SAME `employee_data` shape — the renewal simply
 * arrives with most values prefilled and omits `certificate_attestation_
 * confirmed` (never re-asked on a renewal).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { signWebhookBody } from '@/lib/webhook-signature';
import {
  assertSubmittable,
  getSignerIp,
  missingDependentRequirements,
  missingDependentRenewalRequirements,
  sanitizeFreeText,
} from '@/lib/submit-validation';
import { resolveSubmissionIdByLinkToken } from '@/lib/onboarding-token';
import type { StaffDocumentReferences } from '@/types';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id: linkToken, dependentData, signature } = body;

    if (!linkToken || !dependentData || typeof dependentData !== 'object' || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The body's "id" is the URL link_token (rotatable). Resolve to the
    // stable Supabase row id for downstream queries + webhook payloads.
    const id = await resolveSubmissionIdByLinkToken(linkToken);
    if (!id) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    const { data: existing, error: lookupError } = await supabase
      .from('staff_onboarding_submissions')
      .select('status, onboarding_type, documents, existing_documents, prefill_employee_data')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error('[submit-dependent] Status lookup failed:', lookupError);
      return NextResponse.json({ error: 'Failed to load submission' }, { status: 500 });
    }

    // This route finalizes dependent registrations and dependent renewals
    // ONLY — regular onboardings must go through submit-employee
    // (employer/employee stages + its own gate).
    const isDependentRenewal = existing?.onboarding_type === 'dependent_renewal';
    if (existing && existing.onboarding_type !== 'dependent' && !isDependentRenewal) {
      return NextResponse.json({ error: 'Not a dependent onboarding' }, { status: 400 });
    }

    // Refuse to overwrite a row that's already complete or cancelled.
    const guard = assertSubmittable(existing);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    // Required fields + documents gate. The client form enforces the same
    // rules, but only in browser JavaScript — the server is the authority.
    // A renewal drops the certificate/visa-history requirements and may skip
    // the passport pages (both pages on file + the persisted attestation).
    const missing = isDependentRenewal
      ? missingDependentRenewalRequirements(
          {
            documents: existing!.documents as StaffDocumentReferences | null,
            existing_documents: existing!.existing_documents as Record<
              string,
              { path?: string }
            > | null,
          },
          dependentData as Record<string, unknown>,
        )
      : missingDependentRequirements(
          { documents: existing!.documents as StaffDocumentReferences | null },
          dependentData as Record<string, unknown>,
        );
    if (missing.length > 0) {
      console.warn(`[submit-dependent] Blocked incomplete submission ${id}: missing ${missing.join(', ')}`);
      return NextResponse.json(
        {
          error: `Cannot submit yet — missing: ${missing.join(', ')}. Please complete the highlighted steps and try again.`,
          missing,
        },
        { status: 422 }
      );
    }

    // Strip control chars / angle brackets / cap string lengths.
    const cleanDependentData = sanitizeFreeText(dependentData) as Record<string, unknown>;

    // dependent_type is read-only in the form — take the portal's value so a
    // hand-crafted POST can't register a different relationship than the one
    // CS approved when sending the link.
    const prefillDependentType = (existing!.prefill_employee_data as Record<string, unknown> | null)
      ?.dependent_type;
    if (typeof prefillDependentType === 'string' && prefillDependentType) {
      cleanDependentData.dependent_type = prefillDependentType;
    }

    // Submission telemetry: user agent is server-derived (never from body);
    // submission_device is the client's touch heuristic — keep it only if it's
    // one of the two expected values.
    cleanDependentData.submission_user_agent =
      (req.headers.get('user-agent') ?? '').slice(0, 255) || undefined;
    if (
      cleanDependentData.submission_device !== 'phone' &&
      cleanDependentData.submission_device !== 'desktop'
    ) {
      delete cleanDependentData.submission_device;
    }

    // Signer IP is derived from request headers, never from the body.
    const signerIp = getSignerIp(req);
    const now = new Date().toISOString();

    // The sponsor's signature lands in the employee_signature_* columns —
    // the dependent row has no separate signer.
    const { error } = await supabase
      .from('staff_onboarding_submissions')
      .update({
        employee_data: cleanDependentData,
        employee_signature_data: signature,
        employee_signed_at: now,
        employee_signer_ip: signerIp,
        current_step: 'complete',
        status: 'complete',
        updated_at: now,
      })
      .eq('id', id);

    if (error) {
      console.error('[submit-dependent] Supabase update failed:', error);
      return NextResponse.json({ error: 'Failed to save form' }, { status: 500 });
    }

    // Notify TME Portal to trigger sync (server-side — guaranteed to complete)
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
      console.log('[submit-dependent] Portal sync result:', notifyResult);
    } catch (notifyError) {
      console.error('[submit-dependent] Portal notification failed:', notifyError);
      // Don't fail — cron will pick it up as fallback
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[submit-dependent] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
