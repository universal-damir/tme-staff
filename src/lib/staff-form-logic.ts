/**
 * Pure helpers shared between EmployerForm and EmployeeForm.
 * Factored out so they can be unit-tested without mounting the components.
 */

import type { PassportPageReference, StaffDocumentReferences, VisaCategory } from '@/types';

/**
 * Merge existing submission documents with employee-side uploaded docs.
 * The existing docs spread FIRST so that employer-uploaded documents
 * (e.g. job_offer_letter) survive when the employee form saves its own docs.
 */
export function mergeStaffDocRefs(
  existing: StaffDocumentReferences | null | undefined,
  employeeDocs: Partial<StaffDocumentReferences>
): StaffDocumentReferences {
  return { ...(existing ?? {}), ...employeeDocs };
}

/**
 * Detect whether the visa applicant is a Pakistani national. Accepts either
 * the demonym ("Pakistani") or the country name ("Pakistan"), case-insensitive.
 */
export function isPakistaniNationality(nationality: string | null | undefined): boolean {
  if (!nationality) return false;
  const n = nationality.trim().toLowerCase();
  return n === 'pakistani' || n === 'pakistan';
}

/**
 * Detect whether the registered authority (from the portal's prefill data) is
 * DMCC. The portal may pass either short-form "DMCC" or the full name
 * "DMCC Free Zone Authority", so we match on substring, case-insensitive.
 */
export function isDmccAuthority(registeredAuthority: string | null | undefined): boolean {
  if (!registeredAuthority) return false;
  return registeredAuthority.toUpperCase().includes('DMCC');
}

/**
 * Detect whether the registered authority is DET (Department of Economy &
 * Tourism, Dubai mainland). Used to gate the extended education-details
 * block on the employee form (university name, faculty, study majors,
 * degree type/dates/years) required for DET work-permit applications.
 */
export function isDetAuthority(registeredAuthority: string | null | undefined): boolean {
  if (!registeredAuthority) return false;
  const upper = registeredAuthority.toUpperCase();
  // Word-boundary-ish match: standalone "DET" or "DET " or "(DET)" etc.
  // Avoid matching substrings inside unrelated words.
  return /\bDET\b/.test(upper);
}

/**
 * Upload rules for each visa category. `visa_on_arrival` asks for an arrival
 * date instead of a document, `other` makes the upload optional, and the rest
 * require a supporting document.
 */
export function visaDocumentRequirement(
  visaCategory: VisaCategory | undefined | null
): 'mandatory' | 'optional' | 'none' {
  switch (visaCategory) {
    case 'tourist_visa':
    case 'employment_visa':
    case 'immigration_cancellation':
    case 'golden_visa':
    case 'dependent_visa':
      return 'mandatory';
    case 'other':
      return 'optional';
    case 'visa_on_arrival':
    default:
      return 'none';
  }
}

/**
 * Whether the selected visa category requires capturing the applicant's
 * arrival date in the UAE.
 */
export function requiresArrivalDate(
  visaCategory: VisaCategory | undefined | null
): boolean {
  return visaCategory === 'visa_on_arrival';
}

export type TimePeriodUnit = 'days' | 'weeks' | 'months';

/**
 * Pluralize a numeric period using the stored unit. Renders the unit name in
 * lowercase singular/plural form so the UI can show "(1 day)", "(30 days)",
 * "(2 months)", etc. Defaults to "month(s)" when the unit is missing.
 */
export function pluralizePeriod(
  value: number | undefined | null,
  unit: TimePeriodUnit | string | undefined | null,
): string {
  const singular = unit === 'days' ? 'day' : unit === 'weeks' ? 'week' : 'month';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n === 1) {
    // singular for "1", plural fallback for missing/invalid values.
    return n === 1 ? singular : singular + 's';
  }
  return singular + 's';
}

/**
 * Number of consecutive AI-validation rejections after which the employee
 * is offered the manual-review fallback for passport cover / inside-pages.
 * Two rejections is enough to suggest the photo is fine and the AI is
 * the problem; the user then confirms + submits, an HR reviewer verifies
 * later on the portal side. (Was 3; reduced to 2 because three rounds of
 * "click X, re-upload, get rejected again" is too much friction.)
 */
export const MANUAL_REVIEW_THRESHOLD = 2;

/**
 * Whether the manual-review affordance should be shown for the current
 * passport-page step. Counter is per-step (cover / inside) and resets on
 * successful upload, on remove, or after the manual-review submit.
 */
export function shouldOfferManualReview(rejectionCount: number): boolean {
  return rejectionCount >= MANUAL_REVIEW_THRESHOLD;
}

/**
 * Build the passport page reference saved when the user submits via the
 * manual-review fallback. AI gate was bypassed, so `validated: true`
 * unblocks the form, and `needsReview: true` flags the upload for human
 * verification on the portal side. No extracted_data — the user fills
 * passport details manually for the inside-pages step.
 */
export function buildManualReviewPageRef(
  result: { path: string; filename: string },
): PassportPageReference {
  return {
    path: result.path,
    filename: result.filename,
    validated: true,
    needsReview: true,
  };
}

export type ProvidedFlag = 'yes' | 'no' | 'allowance';

/**
 * Normalize an incoming "provided" flag (from AI extraction, prefill data, or
 * a saved form) to the strict 'yes' | 'no' | 'allowance' tri-state. Anything
 * unrecognized — including null, undefined, empty string, or a misspelling —
 * collapses to 'no', which is the safe default per the product spec ("if the
 * contract is silent or AI cannot determine, leave it No").
 */
export function normalizeProvidedFlag(value: unknown): ProvidedFlag {
  if (typeof value !== 'string') return 'no';
  const v = value.trim().toLowerCase();
  if (v === 'yes' || v === 'allowance') return v;
  return 'no';
}
