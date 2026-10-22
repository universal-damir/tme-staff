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
 * follows the row's actual `current_step`: required when employee. On the
 * employer step the URL is the secret, except after an employer recall, when
 * the employer access token (`employerToken`, from the `?e=` link) must match.
 *
 * STAFF-001: the browser's `validated` / `needsReview` / `server_checks` are
 * not trusted. The photo / passport (and, on a document request, Emirates
 * ID) slots get their flags from the AI verdicts the server recorded for the
 * stored file (lib/document-checks.ts), and a new path must lie in this
 * row's own storage folder.
 *
 * A hand-check request (`needsReview`) for a kind the AI never looked at
 * (the person's strikes happened in the browser only) first runs the server
 * check on that stored file, then is honoured whatever the verdict. The
 * answer carries the stored map (without `server_checks`) so the form shows
 * what was really saved.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOnboardingAccess,
  isTwoPersonEmployerStep,
  EMPLOYER_DOCUMENT_KEYS,
  ONBOARDING_UUID_REGEX,
} from '@/lib/onboarding-token';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { finalizeDocumentsPatch, pendingHandChecks, SERVER_CHECKS_KEY } from '@/lib/document-checks';
import { runServerCheckForHandCheck } from '@/lib/document-checks-server';

const MAX_DOCS_BYTES = 64 * 1024; // 64 KB — paths + filenames only
const MAX_WRITE_ATTEMPTS = 5;
/** Row states in which the documents can no longer change. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['complete', 'cancelled', 'expired']);

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

  let body: { token?: string; employerToken?: string; documents?: Record<string, unknown> };
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
    // After a recall the employer step needs the employer token from the
    // employer's email link (the employee URL shares the link_token).
    employerToken: typeof body.employerToken === 'string' ? body.employerToken : null,
  });

  if (!access.ok) {
    if (
      access.reason === 'token_required' ||
      access.reason === 'token_invalid' ||
      access.reason === 'recalled'
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    if (access.reason === 'cancelled' || access.reason === 'expired' || access.reason === 'already_complete') {
      return NextResponse.json({ error: `Submission ${access.reason}` }, { status: 410 });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!body.documents || typeof body.documents !== 'object' || Array.isArray(body.documents)) {
    return NextResponse.json({ error: 'documents is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // URL `id` is the link_token; use the verifier's resolved row id.
  const rowId = access.row?.id;
  if (!rowId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Read-modify-write with a compare-and-set on updated_at: an AI route may
  // be recording a verdict into documents.server_checks at the same moment
  // (lib/document-checks-server.ts), and neither write may drop the other.
  let handChecksRun = false;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data: fresh, error: readErr } = await supabase
      .from('staff_onboarding_submissions')
      .select('documents, onboarding_type, status, current_step, is_same_person, updated_at')
      .eq('id', rowId)
      .maybeSingle();
    if (readErr || !fresh) {
      console.error('[onboarding/documents] read error');
      return NextResponse.json({ error: 'Save failed' }, { status: 500 });
    }
    const row = fresh as {
      documents: Record<string, unknown> | null;
      onboarding_type: string | null;
      status: string | null;
      current_step: string | null;
      is_same_person: boolean | null;
      updated_at: string | null;
    };
    // The form may have been submitted (or cancelled) since the access check
    // or since the last attempt: a closed row is never written (STAFF-001
    // save-after-submit race). Same answer as the access check gives.
    if (row.current_step === 'complete' || (row.status !== null && CLOSED_STATUSES.has(row.status))) {
      const reason =
        row.status === 'cancelled' || row.status === 'expired' ? row.status : 'already_complete';
      return NextResponse.json({ error: `Submission ${reason}` }, { status: 410 });
    }
    const stored = (row.documents ?? {}) as Record<string, unknown>;

    // Employer step of a two-person form: the employer owns only the job
    // offer letter. Merge just that key into the stored map so the employee's
    // uploads (kept on the row after a recall) can never be dropped or
    // replaced from the employer's page. A missing key in the body = removed.
    let merged: Record<string, unknown> = body.documents;
    if (isTwoPersonEmployerStep(row as Parameters<typeof isTwoPersonEmployerStep>[0])) {
      merged = { ...stored };
      for (const key of EMPLOYER_DOCUMENT_KEYS) {
        if (body.documents[key] !== undefined && body.documents[key] !== null) {
          merged[key] = body.documents[key];
        } else {
          delete merged[key];
        }
      }
    }

    // A hand check for a kind the AI never ran on: run the server check on
    // the stored file first (once per request; in parallel, so one AI call's
    // time), then read the row again with the new record.
    if (!handChecksRun) {
      const pending = pendingHandChecks({ rowId, incoming: merged, stored, onboardingType: row.onboarding_type });
      if (pending.length > 0) {
        handChecksRun = true;
        await Promise.all(pending.map((p) => runServerCheckForHandCheck(rowId, p.kind, p.path)));
        attempt -= 1;
        continue;
      }
    }

    // The browser's validated / needsReview / server_checks are not trusted:
    // the checked slots get their flags from the server verdicts, and every
    // new path must be in this row's own folder (STAFF-001).
    const finalized = finalizeDocumentsPatch({
      rowId,
      incoming: merged,
      stored,
      onboardingType: row.onboarding_type,
    });
    if (!finalized.ok) {
      return NextResponse.json({ error: finalized.error }, { status: 400 });
    }

    let q = supabase
      .from('staff_onboarding_submissions')
      .update({
        documents: finalized.documents,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rowId);
    q = row.updated_at === null ? q.is('updated_at', null) : q.eq('updated_at', row.updated_at);
    // Only while the row is still in the open state just read: a submit
    // landing in between moves status/current_step to complete, and this
    // write then misses the row (and the next attempt answers 410).
    q = row.status === null ? q.is('status', null) : q.eq('status', row.status);
    q = row.current_step === null ? q.is('current_step', null) : q.eq('current_step', row.current_step);
    const { data: written, error } = await q.select('id');

    if (error) {
      console.error('[onboarding/documents] update error:', error.message);
      return NextResponse.json({ error: 'Save failed' }, { status: 500 });
    }
    if (written && written.length > 0) {
      const saved: Record<string, unknown> = { ...finalized.documents };
      delete saved[SERVER_CHECKS_KEY];
      return NextResponse.json({ success: true, documents: saved });
    }
    // Another write landed in between (autosave, an AI verdict): read again.
  }

  console.error('[onboarding/documents] row busy, gave up');
  return NextResponse.json({ error: 'Save failed' }, { status: 503 });
}
