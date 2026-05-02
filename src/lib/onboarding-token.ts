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

// Onboarding requests expire 14 days after creation in tme-portal. We mirror
// that here against `created_at` since the Supabase row has no expiry column.
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
  prefill_employer_data: Record<string, unknown> | null;
  prefill_employee_data: Record<string, unknown> | null;
  documents: Record<string, unknown> | null;
  existing_documents: Record<string, unknown> | null;
  staff_name: string | null;
  staff_email: string | null;
  onboarding_type: string | null;
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
  'prefill_employer_data',
  'prefill_employee_data',
  'documents',
  'existing_documents',
  'staff_name',
  'staff_email',
  'onboarding_type',
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
  const { data, error } = await supabase
    .from('staff_onboarding_submissions')
    .select(SAFE_COLUMNS)
    .eq('id', id)
    .single();

  if (error || !data) {
    return { ok: false, reason: 'not_found', status: 404 };
  }

  const row = data as unknown as OnboardingRow;

  if (row.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', status: 410, row };
  }

  // 14-day expiry from created_at (tme-portal mirrors this in its
  // staff_onboarding_requests.token_expires_at column).
  if (row.created_at) {
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (Number.isFinite(ageMs) && ageMs > ONBOARDING_TTL_MS) {
      return { ok: false, reason: 'expired', status: 410, row };
    }
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
 */
export function scrubOnboardingForBrowser(row: OnboardingRow) {
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step,
    is_same_person: row.is_same_person,
    employer_data: row.employer_data,
    employee_data: row.employee_data,
    prefill_employer_data: row.prefill_employer_data,
    prefill_employee_data: row.prefill_employee_data,
    documents: row.documents,
    existing_documents: row.existing_documents,
    staff_name: row.staff_name,
    staff_email: row.staff_email,
    onboarding_type: row.onboarding_type,
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
