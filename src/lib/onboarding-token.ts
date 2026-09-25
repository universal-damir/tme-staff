/**
 * Server-side authorization helper for the staff onboarding flow.
 *
 * Used by:
 *   - `/api/onboarding/[id]` to gate page loads on /onboard/[id]
 *   - the seven `extract-*` and `validate-*` AI routes to gate writes
 *
 * The submission row is the only thing tying browser sessions to a candidate.
 * For the employee step we additionally require the `employee_access_token`
 * sent in their invitation email — the URL alone is not enough.
 *
 * Employer step: the portal mints an `employer_access_token` for two-person
 * staff onboardings / renewals and puts it in the EMPLOYER's email link as
 * `?e=<token>`. The employee's link carries the same link_token, so the URL
 * alone must never authorise an employer-only action. The employer token is
 * what authorises "Recall and correct" (see `/api/onboarding/[id]/recall`)
 * and, once a form was recalled, every employer-step read/write. Rows created
 * before the token existed (NULL) keep the old behaviour: the URL is the
 * secret, no status page, no recall.
 *
 * Recall rotates `employee_access_token`, so the employee's old link fails
 * with reason 'recalled' (clear "withdrawn by your employer" message).
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
  | 'token_invalid'
  | 'recalled';

export interface OnboardingRow {
  id: string;
  status: string;
  current_step: string;
  is_same_person: boolean;
  employer_data: Record<string, unknown> | null;
  employee_data: Record<string, unknown> | null;
  employer_signature_data: string | null;
  employer_signed_at: string | null;
  employer_access_token: string | null;
  employer_recall_count: number | null;
  employer_recalled_at: string | null;
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
  'employer_signed_at',
  'employer_access_token',
  'employer_recall_count',
  'employer_recalled_at',
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

export interface VerifyOptions {
  // Stage of the flow that's about to happen. Used to decide whether the
  // employee_access_token must match. Reads pass the row's actual
  // `current_step`; writes from extract/validate routes pass the step they
  // *intend* to operate on (typically 'employee').
  expectedStep?: 'employer' | 'employee' | 'auto';
  // When true, treat status === 'complete' as access denied (writes shouldn't
  // be possible after a submission is locked). Reads pass `false` so they
  // can render a "Already Completed" page.
  blockIfComplete?: boolean;
  // Employer access token from the employer's email link (`?e=`). Required
  // on the employer step only after the form was recalled (and only when the
  // row carries a token).
  employerToken?: string | null;
}

/**
 * True when `candidate` is this row's employer access token. False when the
 * row has no token (legacy / no employer stage) or the candidate is not a
 * UUID. Constant-time on the lowercased strings.
 */
export function employerTokenMatches(
  row: Pick<OnboardingRow, 'employer_access_token'> | null | undefined,
  candidate: string | null | undefined,
): boolean {
  if (!row || !row.employer_access_token) return false;
  if (typeof candidate !== 'string' || !ONBOARDING_TOKEN_REGEX.test(candidate)) return false;
  return constantTimeStringEqual(
    candidate.toLowerCase(),
    row.employer_access_token.toLowerCase(),
  );
}

/**
 * May the employer take this form back? Only two-person staff onboardings /
 * renewals that carry an employer token, after the employer signed and
 * before the employee submitted.
 */
export function canEmployerRecall(
  row: Pick<
    OnboardingRow,
    | 'employer_access_token'
    | 'is_same_person'
    | 'onboarding_type'
    | 'prefill_employer_data'
    | 'status'
    | 'current_step'
  >,
): boolean {
  if (!row.employer_access_token) return false;
  if (row.is_same_person) return false;
  const type = row.onboarding_type;
  if (type !== null && type !== undefined && type !== 'new_hire' && type !== 'renewal') return false;
  if ((row.prefill_employer_data as { visa_track?: unknown } | null)?.visa_track === 'partner_investor') {
    return false;
  }
  return row.status === 'employer_completed' && row.current_step === 'employee';
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

  return decideOnboardingAccess(data as unknown as OnboardingRow, token, options);
}

/**
 * Pure access decision for a fetched row (exported for tests). Order:
 *   1. cancelled / expired / complete
 *   2. effective step = explicit expectedStep, else the row's current_step
 *   3. employer step on a recalled row with a token -> the employer token
 *      from the email link must match, else 'recalled'
 *   4. employee step with an employee token -> it must match; a mismatch on
 *      a row that was ever recalled reads as 'recalled' (the old link died)
 */
export function decideOnboardingAccess(
  row: OnboardingRow,
  token: string | null | undefined,
  options: VerifyOptions = {},
): OnboardingAccessResult {
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

  const recallCount = row.employer_recall_count ?? 0;

  if (step === 'employer' && recallCount > 0 && row.employer_access_token) {
    if (!employerTokenMatches(row, options.employerToken)) {
      return { ok: false, reason: 'recalled', status: 403, row };
    }
  }

  if (step === 'employee' && row.employee_access_token) {
    if (!token) {
      return { ok: false, reason: 'token_required', status: 403, row };
    }
    if (
      !ONBOARDING_TOKEN_REGEX.test(token) ||
      !constantTimeStringEqual(token, row.employee_access_token)
    ) {
      return {
        ok: false,
        reason: recallCount > 0 ? 'recalled' : 'token_invalid',
        status: 403,
        row,
      };
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
/**
 * True when the row is a two-person staff onboarding / renewal sitting on
 * the employer step. The employer owns only `job_offer_letter` in the
 * `documents` map; everything else there, and all of `employee_data`,
 * belongs to the employee. After a recall the row still carries the
 * employee's autosaved answers and uploads (they come back on the new
 * employee link), so the employer's browser must not receive them and the
 * employer's documents writes must not replace them.
 */
export function isTwoPersonEmployerStep(
  row: Pick<OnboardingRow, 'current_step' | 'is_same_person' | 'onboarding_type'>,
): boolean {
  const staffType =
    row.onboarding_type == null ||
    row.onboarding_type === 'new_hire' ||
    row.onboarding_type === 'renewal';
  return staffType && !row.is_same_person && row.current_step === 'employer';
}

/** The `documents` keys the employer step may read and write. */
export const EMPLOYER_DOCUMENT_KEYS = ['job_offer_letter'] as const;

function employerOwnedDocuments(
  documents: OnboardingRow['documents'],
): OnboardingRow['documents'] {
  if (!documents || typeof documents !== 'object') return documents;
  const src = documents as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of EMPLOYER_DOCUMENT_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out as OnboardingRow['documents'];
}

export function scrubOnboardingForBrowser(row: OnboardingRow) {
  // Employer step of a two-person form: hide the employee's own answers and
  // uploads (present after a recall) from the employer's browser.
  const employerView = isTwoPersonEmployerStep(row);
  return {
    id: row.id,
    status: row.status,
    current_step: row.current_step,
    is_same_person: row.is_same_person,
    employer_data: row.employer_data,
    employee_data: employerView ? null : row.employee_data,
    employer_signature_data: row.is_same_person ? row.employer_signature_data : undefined,
    // The employer took the form back to correct it: the page shows a banner
    // above the (prefilled) employer form. Neither access token is returned.
    employer_recalled: (row.employer_recall_count ?? 0) > 0 && row.current_step === 'employer',
    prefill_employer_data: row.prefill_employer_data,
    prefill_employee_data: row.prefill_employee_data,
    documents: employerView ? employerOwnedDocuments(row.documents) : row.documents,
    existing_documents: row.existing_documents,
    staff_name: row.staff_name,
    staff_email: row.staff_email,
    onboarding_type: row.onboarding_type,
    sponsorship_type: row.sponsorship_type,
    requested_documents: row.requested_documents,
  };
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
