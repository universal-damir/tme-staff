/**
 * Shared guard for the seven AI extraction / validation routes.
 *
 * Before this guard, those routes accepted arbitrary base64 from anyone with
 * the URL — no auth, no submission scoping, no rate limit. That made them a
 * free Claude vision proxy and a way to drain the Anthropic bill. This
 * helper enforces:
 *
 *   1. Body must include `submissionId` (UUID) and `token` (the candidate's
 *      employee_access_token from the invitation email).
 *   2. The submission must exist, not be cancelled / expired / completed,
 *      and the token must match (constant-time compare via
 *      verifyOnboardingAccess).
 *   3. The base64 image payload must be under MAX_AI_IMAGE_BYTES (12 MB
 *      base64, ≈ 9 MB raw — generous for a phone photo, rejects attempts
 *      to make us pay for huge images).
 *   4. Per-IP best-effort rate limit (30 calls / 60s). In-memory only —
 *      Netlify Lambdas share state within a warm instance but not across
 *      cold starts. Combined with token gating this is plenty for a low-
 *      volume internal site.
 */

import { NextRequest } from 'next/server';
import { verifyOnboardingAccess, type OnboardingRow } from './onboarding-token';
import {
  verifyCompanySetupAccess,
  type CompanySetupSubmissionRow,
} from './company-setup-token';
import { countPdfPagesServer } from './pdf-page-count-server';

export const MAX_AI_IMAGE_BYTES = 12 * 1024 * 1024;

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

interface RateBucket {
  count: number;
  resetAt: number;
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateState = new Map<string, RateBucket>();

/** Best-effort client IP from the proxy headers (exported for the non-AI
 *  company-setup upload route, which reuses the same per-IP budget). */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (IP_REGEX.test(first)) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real && IP_REGEX.test(real)) return real;
  return 'unknown';
}

/** Per-IP sliding budget (30 calls / 60s), shared by the AI routes and the
 *  company-setup upload route. In-memory: warm instance only, best effort. */
export function rateLimitCheck(ip: string): { blocked: boolean } {
  const now = Date.now();
  const bucket = rateState.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateState.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { blocked: false };
  }
  bucket.count++;
  if (bucket.count > RATE_MAX) {
    return { blocked: true };
  }
  return { blocked: false };
}

export interface AiGuardSuccess {
  ok: true;
  body: Record<string, unknown>;
  submissionId: string;
  /**
   * The submission row verifyOnboardingAccess already fetched — exposed so
   * routes that need row data (e.g. compare-photo reads
   * existing_documents.photo.path) don't re-query Supabase.
   */
  row: OnboardingRow;
}

export interface AiGuardFailure {
  ok: false;
  status: number;
  error: string;
}

export type AiGuardResult = AiGuardSuccess | AiGuardFailure;

/**
 * Parse + authorize the body of an AI extract/validate route. Callers
 * should `return NextResponse.json({ error }, { status })` on failure.
 *
 * The guard always treats the call as belonging to the *employee* step —
 * candidates uploading documents from the second-stage form. The
 * onboarding row's actual current_step is not checked beyond not being
 * `complete` (post-submission) or `cancelled`/`expired` — earlier steps
 * may legitimately call validate-* routes during autosave.
 */
export async function guardAiRoute(req: NextRequest): Promise<AiGuardResult> {
  const ip = getClientIp(req);
  if (rateLimitCheck(ip).blocked) {
    return { ok: false, status: 429, error: 'Rate limit exceeded' };
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }

  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : '';
  const token = typeof body.token === 'string' ? body.token : null;

  if (!submissionId) {
    return { ok: false, status: 400, error: 'submissionId is required' };
  }

  // Cap base64 image size before doing any work. The image field is named
  // `image` in every route we guard.
  const image = body.image;
  if (typeof image === 'string' && image.length > MAX_AI_IMAGE_BYTES) {
    return { ok: false, status: 413, error: 'Image too large' };
  }

  // Identity documents must be a SINGLE page — one passport / ID page per file.
  // A multi-page PDF is how a wrong page slips past the vision model: it passes
  // a file as long as ONE page looks right, so an extra page (e.g. the address
  // page bundled behind the data page) rides along unchecked. Reject multi-page
  // PDFs before any model call. Best-effort + fail-open (see countPdfPagesServer):
  // the client-side check in single-page-pdf.ts is the strict gate; this backs
  // it up for direct API calls that skip the browser.
  if (
    typeof image === 'string' &&
    (image.startsWith('data:application/pdf') || image.includes('application/pdf'))
  ) {
    const base64 = image.replace(/^data:[^;]+;base64,/, '');
    const pages = countPdfPagesServer(base64);
    if (pages !== null && pages > 1) {
      return {
        ok: false,
        status: 422,
        error: `This file has ${pages} pages. Please upload only a single page — one page per file.`,
      };
    }
  }

  const access = await verifyOnboardingAccess(submissionId, token, {
    expectedStep: 'employee',
    blockIfComplete: true,
  });

  if (!access.ok) {
    if (access.reason === 'token_required' || access.reason === 'token_invalid') {
      return { ok: false, status: 403, error: 'Unauthorized' };
    }
    if (access.reason === 'cancelled' || access.reason === 'expired' || access.reason === 'already_complete') {
      return { ok: false, status: 410, error: `Submission ${access.reason}` };
    }
    return { ok: false, status: 404, error: 'Submission not found' };
  }

  return { ok: true, body, submissionId, row: access.row! };
}

// ---------------------------------------------------------------------------
// Company Setup Intake variant (ADDITIVE — the staff guard above is untouched).
//
// The company-setup AI routes live under /api/company-setup/[token]/..., so
// authorization comes from the URL token resolving to a live
// `company_setup_intake_submissions` row — not from a submissionId/token pair
// in the body. Everything else (rate limit, JSON parse, image size cap,
// single-page-PDF rule) is shared with the staff guard.
// ---------------------------------------------------------------------------

export interface CompanySetupAiGuardSuccess {
  ok: true;
  body: Record<string, unknown>;
  row: CompanySetupSubmissionRow;
}

export type CompanySetupAiGuardResult = CompanySetupAiGuardSuccess | AiGuardFailure;

/**
 * Parse + authorize the body of a company-setup AI route (validate-names,
 * suggest-names, validate-photo, validate-passport). `token` is the URL
 * link token. Callers `return NextResponse.json({ error }, { status })` on
 * failure. Writes are only meaningful before submission, so an already
 * submitted row is rejected (410-shaped 409 handled by the access check).
 */
export interface CompanySetupAiGuardOptions {
  /**
   * Skip the single-page-PDF rejection. Opt-in, for routes whose document is
   * legitimately multi-page: a bank statement (proof of address) is routinely
   * 3-8 pages, and the client renders page 1 for the vision check anyway.
   * Identity-document routes leave this off — a multi-page PDF is exactly how
   * a wrong passport page slips past the model.
   */
  allowMultiPagePdf?: boolean;
}

export async function guardCompanySetupAiRoute(
  req: NextRequest,
  token: string,
  opts: CompanySetupAiGuardOptions = {}
): Promise<CompanySetupAiGuardResult> {
  const ip = getClientIp(req);
  if (rateLimitCheck(ip).blocked) {
    return { ok: false, status: 429, error: 'Rate limit exceeded' };
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }

  // Same base64 size cap as the staff routes (field is named `image` in every
  // guarded vision route; the name/text routes simply have no image field).
  const image = body.image;
  if (typeof image === 'string' && image.length > MAX_AI_IMAGE_BYTES) {
    return { ok: false, status: 413, error: 'Image too large' };
  }

  // Identity documents must be a SINGLE page — same rationale as the staff
  // guard: a multi-page PDF is how a wrong page slips past the vision model.
  if (
    !opts.allowMultiPagePdf &&
    typeof image === 'string' &&
    (image.startsWith('data:application/pdf') || image.includes('application/pdf'))
  ) {
    const base64 = image.replace(/^data:[^;]+;base64,/, '');
    const pages = countPdfPagesServer(base64);
    if (pages !== null && pages > 1) {
      return {
        ok: false,
        status: 422,
        error: `This file has ${pages} pages. Please upload only a single page — one page per file.`,
      };
    }
  }

  const access = await verifyCompanySetupAccess(token, { allowSubmitted: false });
  if (!access.ok || !access.row) {
    if (access.reason === 'cancelled' || access.reason === 'expired') {
      return { ok: false, status: 410, error: `Submission ${access.reason}` };
    }
    if (access.reason === 'already_submitted') {
      return { ok: false, status: 409, error: 'Submission already submitted' };
    }
    return { ok: false, status: 404, error: 'Submission not found' };
  }

  return { ok: true, body, row: access.row };
}
