/**
 * Server-side authorization helper for the staff onboarding flow.
 *
 * Used by:
 *   - `/api/onboarding/[id]` to gate page loads on /onboard/[id]
 *   - the seven `extract-*` and `validate-*` AI routes to gate writes
 *
 * The submission row is the only thing tying browser sessions to a candidate.
 * For the employee step we additionally require the `employee_access_token`
 * sent in their invitation email — the URL alone is not enough. For the
 * employer step we accept the URL as the secret (legacy emails already in
 * inboxes); future hardening would add an `employer_access_token` column.
 *
 * All callers use the service-role client so that anon RLS — which today
 * is permissive — does not leak data.
 */

import { getSupabaseAdmin } from './supabase-server';

export const ONBOARDING_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ONBOARDING_TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The portal is now authoritative on expiry — it rotates link_token + extends
// the 14-day window via the reissue endpoint, and flips status to 'expired' or
// 'cancelled' as needed. tme-staff trusts those flags, which lets a reissued
// link work without us having to mirror the portal's timer here.
//
// (Kept exported for any caller still importing the old constant.)
export const ONBOARDING_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type OnboardingAccessFailure =
  | 'invalid_id'
  | 'not_found'
  | 'cancelled'
  | 'expired'
  | 'already_complete'
  | 'token_required'
  | 'token_invalid';

export interface OnboardingRow {
  id: string;
  status: string;
  current_step: string;
  is_same_person: boolean;
  employer_data: Record<string, unknown> | null;
  employee_data: Record<string, unknown> | null;
  employer_signature_data: string | null;
  prefill_employer_data: Record<string, unknown> | null;
  prefill_employee_data: Record<string, unknown> | null;
  documents: Record<string, unknown> | null;
  existing_documents: Record<string, unknown> | null;
  staff_name: string | null;
  staff_email: string | null;
  onboarding_type: string | null;
  sponsorship_type: string | null;
  requested_documents: string[] | null;
  employee_access_token: string | null;
  created_at: string | null;
}

export interface OnboardingAccessResult {
  ok: boolean;
  reason?: OnboardingAccessFailure;
  status?: number; // HTTP status to return to the client
  row?: OnboardingRow;
}

const SAFE_COLUMNS = [
  'id',
  'status',
  'current_step',
  'is_same_person',
  'employer_data',
  'employee_data',
  'employer_signature_data',
  'prefill_employer_data',
  'prefill_employee_data',
  'documents',
  'existing_documents',
  'staff_name',
  'staff_email',
  'onboarding_type',
  'sponsorship_type',
  'requested_documents',
  'employee_access_token',
  'created_at',
].join(', ');

interface VerifyOptions {
  // Stage of the flow that's about to happen. Used to decide whether the
  // employee_access_token must match. Reads pass the row's actual
  // `current_step`; writes from extract/validate routes pass the step they
  // *intend* to operate on (typically 'employee').
  expectedStep?: 'employer' | 'employee' | 'auto';
  // When true, treat status === 'complete' as access denied (writes shouldn't
  // be possible after a submission is locked). Reads pass `false` so they
  // can render a "Already Completed" page.
  blockIfComplete?: boolean;
}

/**
 * Resolve a link_token (from the URL) to the underlying Supabase row id.
 *
 * Used by write endpoints that bypass verifyOnboardingAccess (submit-employer,
 * submit-employee, storage routes). They get the URL token as input but need
 * the row's primary key for downstream `.eq('id', ...)` operations and for
 * webhook payloads to the portal — the portal addresses the row by its
 * Supabase id, never by link_token.
 *
 * Returns null when the token is malformed or no row matches.
 */
export async function resolveSubmissionIdByLinkToken(
  linkToken: string,
): Promise<string | null> {
  if (!ONBOARDING_UUID_REGEX.test(linkToken)) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('staff_onboarding_submissions')
    .select('id')
    .eq('link_token', linkToken)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * Look up a submission and decide whether the caller may access it.
 *
 * Returns `{ ok: true, row }` when access is granted. Otherwise returns a
 * reason and an HTTP status the caller should pass through to the client.
 * The token comparison is constant-time on the UUID byte representation,
 * so timing attacks against the token are not feasible.
 */
export async function verifyOnboardingAccess(
  id: string,
  token: string | null | undefined,
  options: VerifyOptions = {},
): Promise<OnboardingAccessResult> {
  if (!ONBOARDING_UUID_REGEX.test(id)) {
    return { ok: false, reason: 'invalid_id', status: 404 };
  }

  const supabase = getSupabaseAdmin();
  // The URL parameter is the rotatable link_token (not the Supabase row's id).
  // Backfilled rows have link_token = id, so legacy live links keep working;
  // new and reissued links resolve through here too.
  const { data, error } = await supabase
    .from('staff_onboarding_submissions')
    .select(SAFE_COLUMNS)
    .eq('link_token', id)
    .single();

  if (error || !data) {
    return { ok: false, reason: 'not_found', status: 404 };
  }

  const row = data as unknown as OnboardingRow;

  if (row.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', status: 410, row };
  }
  if (row.status === 'expired') {
    return { ok: false, reason: 'expired', status: 410, row };
  }

  if (row.status === 'complete') {
    if (options.blockIfComplete) {
      return { ok: false, reason: 'already_complete', status: 410, row };
    }
    // Reads of completed submissions are allowed so the page can render
    // the "already submitted" view. Return early without token check —
    // there's nothing actionable left.
    return { ok: true, row };
  }

  // Decide the effective step for token gating. `auto` reuses the row's
  // current_step; explicit overrides are used by the AI extract/validate
  // routes which always belong to the employee.
  const step = options.expectedStep && options.expectedStep !== 'auto'
    ? options.expectedStep
    : row.current_step;

  if (step === 'employee' && row.employee_access_token) {
    if (!token) {
      return { ok: false, reason: 'token_required', status: 403, row };
    }
    if (!ONBOARDING_TOKEN_REGEX.test(token)) {
      return { ok: false, reason: 'token_invalid', status: 403, row };
    }
    if (!constantTimeStringEqual(token, row.employee_access_token)) {
      return { ok: false, reason: 'token_invalid', status: 403, row };
    }
  }

  return { ok: true, row };
}

/**
 * Strip fields the browser must never see (signer IPs, signature blobs of
 * the *other* party, and the access token itself). Used by the read route
 * before serializing to the page.
 *
 * Same-person carve-out: when the employer and employee are the same human,
 * there is no "other party" to leak to. The employee step needs the employer
 * signature back so it can re-use it on final submit after a mid-flow refresh
 * — otherwise submit-employee rejects with 400 because the signature it
 * receives is null.
 */
export function scrubOnboardingForBrowser(row: OnboardingRow) {
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step,
    is_same_person: row.is_same_person,
    employer_data: row.employer_data,
    employee_data: row.employee_data,
    employer_signature_data: row.is_same_person ? row.employer_signature_data : undefined,
    prefill_employer_data: row.prefill_employer_data,
    prefill_employee_data: row.prefill_employee_data,
    documents: row.documents,
    existing_documents: row.existing_documents,
    staff_name: row.staff_name,
    staff_email: row.staff_email,
    onboarding_type: row.onboarding_type,
    sponsorship_type: row.sponsorship_type,
    requested_documents: row.requested_documents,
  };
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
