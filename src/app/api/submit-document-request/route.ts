/**
 * Submit Document Re-Request API
 *
 * POST: finalizes a document re-upload request (onboarding_type ===
 * 'document_request') created by the TME Portal. The employee has already
 * uploaded the requested documents via the same storage/AI-validation routes
 * the main employee form uses; this route only verifies completeness, marks
 * the row complete, and webhooks the portal — no signature, no personal-data
 * payload (mirrors submit-employee, minus everything document requests
 * don't carry).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { signWebhookBody } from '@/lib/webhook-signature';
import { assertSubmittable, missingRequestedDocuments } from '@/lib/submit-validation';
import { resolveSubmissionIdByLinkToken } from '@/lib/onboarding-token';
import type { StaffDocumentReferences } from '@/types';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id: linkToken } = body;

    if (!linkToken) {
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
      .select('status, onboarding_type, requested_documents, documents')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error('[submit-document-request] Status lookup failed:', lookupError);
      return NextResponse.json({ error: 'Failed to load submission' }, { status: 500 });
    }

    // This route finalizes document requests ONLY — regular onboardings must
    // go through submit-employee (signature + full required-documents gate).
    if (existing && existing.onboarding_type !== 'document_request') {
      return NextResponse.json({ error: 'Not a document request' }, { status: 400 });
    }

    const guard = assertSubmittable(existing);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    // Requested-documents gate: every requested type must be uploaded and
    // (where AI validation exists) validated or explicitly submitted for
    // manual review. Server-side authority — the client form enforces the
    // same rule but only in browser JavaScript.
    const missing = missingRequestedDocuments({
      requested_documents: existing!.requested_documents as string[] | null,
      documents: existing!.documents as StaffDocumentReferences | null,
    });
    if (missing.length > 0) {
      console.warn(`[submit-document-request] Blocked incomplete submission ${id}: missing ${missing.join(', ')}`);
      return NextResponse.json(
        {
          error: `Cannot submit yet — some requested documents are still missing or not validated. Please complete the highlighted uploads and try again.`,
          missing,
        },
        { status: 422 }
      );
    }

    const now = new Date().toISOString();

    // Mark the request complete. No signature fields — document requests
    // carry uploads only.
    const { error } = await supabase
      .from('staff_onboarding_submissions')
      .update({
        current_step: 'complete',
        status: 'complete',
        updated_at: now,
      })
      .eq('id', id);

    if (error) {
      console.error('[submit-document-request] Supabase update failed:', error);
      return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 });
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
      console.log('[submit-document-request] Portal sync result:', notifyResult);
    } catch (notifyError) {
      console.error('[submit-document-request] Portal notification failed:', notifyError);
      // Don't fail — cron will pick it up as fallback
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[submit-document-request] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
