/**
 * Onboarding document-references update (server-side).
 *
 * Replaces the old `updateDocumentReferences` direct anon-Supabase call.
 * Each storage upload is gated by `/api/storage/upload` (service-role +
 * magic-byte validated, from P0-2). Once the upload returns a `path`, the
 * client patches the row's `documents` jsonb column via this route — which
 * also goes through service role so the anon_update policy can be dropped.
 *
 * This route is reachable from BOTH the employer step (job offer letter
 * upload) and the employee step (every other document). The token check
 * follows the row's actual `current_step`: required when employee, not
 * required when employer (employer URL UUID is the secret today; tightening
 * that would need an `employer_access_token` column — separate finding).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOnboardingAccess,
  ONBOARDING_UUID_REGEX,
} from '@/lib/onboarding-token';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const MAX_DOCS_BYTES = 64 * 1024; // 64 KB — paths + filenames only

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ONBOARDING_UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = await req.text();
  if (raw.length > MAX_DOCS_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: { token?: string; documents?: Record<string, unknown> };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // expectedStep: 'auto' lets the helper follow the row's current_step. The
  // employer step skips token enforcement; the employee step requires it.
  const access = await verifyOnboardingAccess(id, body.token ?? null, {
    expectedStep: 'auto',
    blockIfComplete: true,
  });

  if (!access.ok) {
    if (access.reason === 'token_required' || access.reason === 'token_invalid') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    if (access.reason === 'cancelled' || access.reason === 'expired' || access.reason === 'already_complete') {
      return NextResponse.json({ error: `Submission ${access.reason}` }, { status: 410 });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!body.documents || typeof body.documents !== 'object') {
    return NextResponse.json({ error: 'documents is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // URL `id` is the link_token; use the verifier's resolved row id.
  const rowId = access.row?.id;
  if (!rowId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { error } = await supabase
    .from('staff_onboarding_submissions')
    .update({
      documents: body.documents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  if (error) {
    console.error('[onboarding/documents] update error:', error);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
