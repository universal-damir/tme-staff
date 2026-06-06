/**
 * Server-side onboarding read route.
 *
 * Replaces the previous direct anon-key call from `/onboard/[id]/page.tsx`,
 * which bypassed any token check and exposed every column to anyone holding
 * the publishable key. This route uses the service role client (so anon
 * RLS — which is currently permissive — does not leak data), enforces the
 * 14-day expiry, and gates the employee step on the `employee_access_token`
 * sent in the candidate's invitation email.
 *
 * Returns:
 *   200 — `{ status: '...', current_step: '...', ... }` (scrubbed payload)
 *   404 — invalid UUID or row not found
 *   403 — employee step accessed without a valid token
 *   410 — submission cancelled or past 14-day expiry
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOnboardingAccess,
  scrubOnboardingForBrowser,
} from '@/lib/onboarding-token';
import { getSupabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-server';

/**
 * `existing_documents` (passports + the renewal Job Offer Letter, uploaded by
 * TME Portal) stores a signed URL captured at upload time. Those URLs expire
 * while the renewal link (14 days) is still live, so the client would see
 * broken images if they open the form after the URL lapsed. Re-sign each entry
 * from its stored `path` on every read so the URL is always fresh. Files live
 * in STORAGE_BUCKET ('staff-documents') — the same bucket TME Portal uploads to.
 *
 * `documents.*` don't need this: they're rendered via `/api/storage/file`,
 * which re-signs on demand. Only `existing_documents` bakes the URL in.
 */
async function refreshExistingDocumentUrls(
  docs: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!docs || typeof docs !== 'object') return;
  const supabase = getSupabaseAdmin();
  const TTL_SECONDS = 60 * 60; // re-signed on every load — only needs to outlast one viewing session
  await Promise.all(
    Object.values(docs).map(async (entry) => {
      const doc = entry as { path?: string; publicUrl?: string } | null;
      if (!doc || typeof doc !== 'object' || !doc.path) return;
      try {
        const { data } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(doc.path, TTL_SECONDS);
        if (data?.signedUrl) doc.publicUrl = data.signedUrl;
      } catch {
        // Keep the stored URL as a fallback; never block the form load on signing.
      }
    }),
  );
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  const result = await verifyOnboardingAccess(id, token, { expectedStep: 'auto' });

  if (!result.ok) {
    const body: { status: string; reason?: string } = { status: 'denied' };
    if (result.reason === 'cancelled') body.status = 'cancelled';
    else if (result.reason === 'expired') body.status = 'expired';
    else if (result.reason === 'already_complete') body.status = 'complete';
    else if (result.reason === 'token_required') body.status = 'token_required';
    else if (result.reason === 'token_invalid') body.status = 'token_required';
    else if (result.reason === 'invalid_id') body.status = 'not_found';
    else if (result.reason === 'not_found') body.status = 'not_found';
    return NextResponse.json(body, { status: result.status ?? 404 });
  }

  // The page + forms use `submission.id` to address subsequent API calls.
  // After link-rotation hardening, the URL identifier is `link_token` (not
  // the Supabase row id), so we surface the URL token in the response's
  // `id` field. The server keeps the actual `row.id` internal — it's only
  // used for storage paths and the portal webhook payload.
  if (result.row?.status === 'complete') {
    return NextResponse.json({
      id,
      status: 'complete',
      current_step: result.row.current_step,
    });
  }

  const scrubbed = scrubOnboardingForBrowser(result.row!);
  await refreshExistingDocumentUrls(scrubbed.existing_documents as Record<string, unknown> | null);
  return NextResponse.json({ ...scrubbed, id });
}
