/**
 * Onboarding employee-data autosave (server-side).
 *
 * Replaces the old `autoSaveEmployeeData` direct anon-Supabase call. Routes
 * the partial save through the service-role client so the anon_update RLS
 * policy can be dropped (P0-3 hardening). Token + status checks are shared
 * with the seven AI extract/validate routes via `verifyOnboardingAccess`.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOnboardingAccess,
  ONBOARDING_UUID_REGEX,
} from '@/lib/onboarding-token';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const MAX_AUTOSAVE_BYTES = 256 * 1024; // 256 KB — generous for a long form

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ONBOARDING_UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Read raw body first so we can size-cap before parsing. JSON.parse on a
  // multi-MB string is expensive; reject early.
  const raw = await req.text();
  if (raw.length > MAX_AUTOSAVE_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: { token?: string; employeeData?: Record<string, unknown> };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const access = await verifyOnboardingAccess(id, body.token ?? null, {
    expectedStep: 'employee',
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

  if (!body.employeeData || typeof body.employeeData !== 'object') {
    return NextResponse.json({ error: 'employeeData is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Use the row's actual Supabase id from the verifier, not the URL token —
  // the URL is now the link_token and rotates on reissue.
  const rowId = access.row?.id;
  if (!rowId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { error } = await supabase
    .from('staff_onboarding_submissions')
    .update({
      employee_data: body.employeeData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  if (error) {
    console.error('[onboarding/autosave] update error:', error);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
