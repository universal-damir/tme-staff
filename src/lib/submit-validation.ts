/**
 * Server-side guards shared by `/api/submit-employer` and `/api/submit-employee`.
 *
 * - `getSignerIp(req)` reads the client IP from headers Netlify controls,
 *   never from the request body. The previous implementation accepted an
 *   attacker-supplied `ip` field (P2-3) which was then stored verbatim into
 *   `employer_signer_ip` / `employee_signer_ip` and surfaced in audit trails.
 *
 * - `assertSubmittable(row)` rejects updates against rows that are already
 *   complete or cancelled (P2-4). Without this, anyone holding the submission
 *   UUID could re-POST and overwrite a finalized signature trail with new
 *   data, including a different signature image and IP.
 *
 * - `sanitizeFreeText(value)` walks an arbitrary JSON-shaped object and
 *   strips control characters + caps string length (P2-13). The form already
 *   restricts most fields client-side; this is server-side defense-in-depth
 *   against stored payloads being rendered into the PDF / email later.
 */

import { NextRequest } from 'next/server';
import type { StaffDocumentReferences } from '@/types';
import { sponsorshipTypeFromSponsor, sponsorDocsRequired, passportAdditionalPageVariant } from '@/lib/staff-form-logic';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^([0-9a-fA-F:]+)$/;

function isPlausibleIp(value: string): boolean {
  return IPV4.test(value) || (value.includes(':') && IPV6.test(value));
}

/**
 * Read the signer IP from request headers, never from the body.
 *
 * Order of preference matches Netlify's documented behaviour:
 *   1. `x-nf-client-connection-ip` — Netlify's authoritative client IP
 *   2. `x-forwarded-for` first hop — standard proxy header
 *   3. `x-real-ip` — fallback
 *
 * Returns `null` if no plausible IP can be derived. Callers persist `null`
 * rather than a guess.
 */
export function getSignerIp(req: NextRequest): string | null {
  const netlify = req.headers.get('x-nf-client-connection-ip');
  if (netlify && isPlausibleIp(netlify.trim())) return netlify.trim();

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (isPlausibleIp(first)) return first;
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && isPlausibleIp(realIp.trim())) return realIp.trim();

  return null;
}

export interface SubmittabilityCheck {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Reject submits against rows that are already finalized.
 *
 * `complete` — fully signed both sides. Re-submitting would overwrite the
 *   stored signature image / IP / timestamp.
 * `cancelled` — the portal explicitly killed this onboarding. The candidate
 *   should see the cancelled UI and not be able to push more data.
 */
export function assertSubmittable(row: { status: string | null } | null): SubmittabilityCheck {
  if (!row) return { ok: false, status: 404, error: 'Onboarding submission not found' };
  if (row.status === 'complete') return { ok: false, status: 410, error: 'Onboarding already complete' };
  if (row.status === 'cancelled') return { ok: false, status: 410, error: 'Onboarding cancelled' };
  return { ok: true };
}

/**
 * Server-side required-documents gate for `/api/submit-employee`.
 *
 * Until 2026-07 the ONLY completeness check lived in client-side JavaScript
 * (EmployeeForm.handleFormSubmit), so a renewal could reach status='complete'
 * — and trigger the Staff Renewal Confirmation — with no passport cover page
 * anywhere and an unvalidated photo (seen live: 10920/LLC062). This mirrors
 * the client gate on the server, where it can't be bypassed by stale client
 * state or a hand-crafted POST.
 *
 * Returns humanized names of missing requirements; empty array = submittable.
 *
 * Rules (deliberately the MINIMUM the client gate also enforces — the portal
 * sync additionally soft-flags anything unusual for human review):
 *  - Photo present AND (AI-validated OR explicitly submitted for manual
 *    review via the 2-strike fallback).
 *  - Passport cover + inside pages uploaded, UNLESS this is a renewal and
 *    BOTH pages are already on file from the previous application (the
 *    "passport unchanged" skip). The persisted `passport_unchanged` flag is
 *    the explicit attestation, but the skip is accepted whenever both pages
 *    exist on file so in-flight sessions from before this deploy don't
 *    strand; a skip with only ONE page on file is never legitimate.
 *  - Passport additional page for Indian/Syrian passports, but ONLY when a
 *    fresh data page was uploaded this session (mirrors the client gate,
 *    which reveals the additional-page step off the uploaded data page).
 *    The renewal "passport unchanged" skip therefore skips this too.
 *  - Family sponsorship: all four sponsor documents + the sponsor NOC
 *    signature (either already on the row or arriving with this request).
 */
export function missingRequiredDocuments(row: {
  onboarding_type?: string | null;
  sponsorship_type?: string | null;
  employer_data?: Record<string, unknown> | null;
  documents?: StaffDocumentReferences | null;
  existing_documents?: Record<string, { path?: string }> | null;
  sponsor_noc_signature_data?: string | null;
}, incomingSponsorNoc?: unknown, nationality?: string | null): string[] {
  const missing: string[] = [];
  const docs = row.documents ?? {};

  const photo = docs.photo;
  if (!photo?.path) {
    missing.push('ID photo');
  } else if (!photo.validated && !photo.needsReview) {
    missing.push('ID photo (must pass validation or be submitted for manual review)');
  }

  const pages = docs.passportPages ?? {};
  const pagesUploaded = !!(pages.cover?.path && pages.insidePages?.path);
  const existingCover = row.existing_documents?.passport_cover?.path;
  const existingInside = row.existing_documents?.passport_inside?.path;
  const renewalSkipAllowed =
    row.onboarding_type === 'renewal' && !!existingCover && !!existingInside;
  if (!pagesUploaded && !renewalSkipAllowed) {
    if (!pages.cover?.path) missing.push('Passport cover page');
    if (!pages.insidePages?.path) missing.push('Passport data page');
  }

  // Additional page (Indian address page / Syrian issue-details page).
  // Keyed off a freshly uploaded data page — exactly the client condition
  // (requiresAdditionalPage) — so the renewal "passport unchanged" skip,
  // where no pages are uploaded, skips this too.
  if (
    passportAdditionalPageVariant(nationality) &&
    pages.insidePages?.path &&
    !pages.additionalPage?.path
  ) {
    missing.push('Passport additional page');
  }

  const effectiveSponsor = row.employer_data?.sponsor as string | undefined;
  const sponsorshipType = effectiveSponsor
    ? sponsorshipTypeFromSponsor(effectiveSponsor)
    : ((row.sponsorship_type as 'company' | 'family' | 'self_gcc' | undefined) ?? 'company');
  if (sponsorDocsRequired(sponsorshipType)) {
    if (!docs.sponsor_passport?.path) missing.push('Sponsor passport');
    if (!docs.sponsor_visa?.path) missing.push('Sponsor visa');
    if (!docs.sponsor_eid_front?.path) missing.push('Sponsor Emirates ID (front)');
    if (!docs.sponsor_eid_back?.path) missing.push('Sponsor Emirates ID (back)');
    const hasNoc =
      (typeof incomingSponsorNoc === 'string' && incomingSponsorNoc.length > 0) ||
      (typeof row.sponsor_noc_signature_data === 'string' && row.sponsor_noc_signature_data.length > 0);
    if (!hasNoc) missing.push('Sponsor NOC signature');
  }

  return missing;
}

/**
 * Server-side completeness gate for `/api/submit-document-request`.
 *
 * A document-request row (onboarding_type === 'document_request') carries a
 * `requested_documents` array of type keys the employee must re-upload. This
 * checks each requested key against the row's `documents` jsonb and returns
 * the keys that are still missing or not accepted; empty array = submittable.
 *
 * "Present and accepted" per key:
 *  - `photo` / `eid_front` / `eid_back` — flat ref with a `path` AND either
 *    AI-validated or explicitly submitted via the 2-strike manual-review
 *    fallback (`needsReview`).
 *  - `passport_cover` / `passport_inside` / `passport_additional` — the
 *    corresponding NESTED `passportPages.*` ref, same validated-or-needsReview
 *    rule.
 *  - `degree_attested` / `transcript_of_records` — `path` only (these have
 *    no AI validation anywhere in the app).
 *  - Generic requestable types (GENERIC_REQUESTED_KEYS below) — satisfied by
 *    a `documents.extra_documents[<key>].path`. These slots have no AI
 *    validation; the form stamps `needsReview: true` on every entry so the
 *    portal flags them for human review on sync.
 *
 * Unknown requested keys are reported missing (fail-closed): the portal only
 * writes allow-listed keys, and a typo must block submission rather than
 * silently pass.
 *
 * NOTE: the generic `missingRequiredDocuments` gate above (photo + passport
 * for everyone) applies ONLY to `/api/submit-employee` — document requests
 * must satisfy exactly what was requested, nothing more.
 */
/**
 * Requestable portal `document_type` keys with NO dedicated AI-validated slot.
 * Uploads land in `documents.extra_documents[<key>]` (always with
 * `needsReview: true`); presence of a `path` satisfies the gate. Must stay in
 * sync with GENERIC_REQUESTABLE_LABELS in DocumentRequestForm.tsx and the
 * portal's request-documents allow-list.
 */
export const GENERIC_REQUESTED_KEYS: ReadonlySet<string> = new Set([
  'visa',
  'visa_document',
  'employment_contract',
  'work_permit',
  'health_insurance',
  'iloe_insurance',
  'driving_license',
  'job_offer_letter',
  'pakistan_id_front',
  'pakistan_id_back',
  'education_additional',
  'sponsor_passport',
  'sponsor_visa',
  'sponsor_eid_front',
  'sponsor_eid_back',
]);

/**
 * Custom-named document requests travel as `custom:<display name>` keys.
 * They behave exactly like generic requestable types: a plain upload slot,
 * satisfied by `documents.extra_documents[<full key>].path`. The name after
 * the prefix must be non-empty — a bare `custom:` key stays fail-closed.
 */
export const CUSTOM_REQUESTED_KEY_PREFIX = 'custom:';

export function isCustomRequestedKey(key: string): boolean {
  return (
    key.startsWith(CUSTOM_REQUESTED_KEY_PREFIX) &&
    key.slice(CUSTOM_REQUESTED_KEY_PREFIX.length).trim().length > 0
  );
}

/**
 * Subcategorized visa-status requests (`visa_document:<slug>`) — same generic
 * upload behavior as the plain `visa_document` key; the slug only refines the
 * slot label (and the portal's sync target). The portal validates slugs; here
 * any non-empty suffix renders/satisfies so a slug added portal-side later
 * doesn't strand the client.
 */
export const VISA_STATUS_REQUESTED_KEY_PREFIX = 'visa_document:';

export function isVisaStatusRequestedKey(key: string): boolean {
  return (
    key.startsWith(VISA_STATUS_REQUESTED_KEY_PREFIX) &&
    key.slice(VISA_STATUS_REQUESTED_KEY_PREFIX.length).trim().length > 0
  );
}

export function missingRequestedDocuments(row: {
  requested_documents?: string[] | null;
  documents?: StaffDocumentReferences | null;
}): string[] {
  const requested = row.requested_documents ?? [];
  const docs = row.documents ?? {};
  const pages = docs.passportPages ?? {};

  const accepted = (
    doc: { path?: string; validated?: boolean; needsReview?: boolean } | undefined
  ): boolean => !!doc?.path && (doc.validated === true || doc.needsReview === true);

  const missing: string[] = [];
  for (const key of requested) {
    if (GENERIC_REQUESTED_KEYS.has(key) || isCustomRequestedKey(key) || isVisaStatusRequestedKey(key)) {
      // Generic slots: no AI validation exists, so a stored upload is enough.
      // Only extra_documents counts — a flat ref written by the main
      // onboarding flow does not satisfy a re-request for a fresh copy.
      if (!docs.extra_documents?.[key]?.path) missing.push(key);
      continue;
    }
    switch (key) {
      case 'photo':
        if (!accepted(docs.photo)) missing.push(key);
        break;
      case 'passport_cover':
        if (!accepted(pages.cover)) missing.push(key);
        break;
      case 'passport_inside':
        if (!accepted(pages.insidePages)) missing.push(key);
        break;
      case 'passport_additional':
        if (!accepted(pages.additionalPage)) missing.push(key);
        break;
      case 'eid_front':
        if (!accepted(docs.eid_front)) missing.push(key);
        break;
      case 'eid_back':
        if (!accepted(docs.eid_back)) missing.push(key);
        break;
      case 'degree_attested':
        if (!docs.degree_attested?.path) missing.push(key);
        break;
      case 'transcript_of_records':
        if (!docs.transcript_of_records?.path) missing.push(key);
        break;
      default:
        // Fail closed on unknown keys — see docblock.
        missing.push(key);
    }
  }
  return missing;
}

const MAX_STRING_LENGTH = 2000;
const MAX_KEYS = 200;

/**
 * Recursively strip control characters and cap string lengths in submitted
 * form data. Non-strings pass through untouched. Removes:
 *   - C0 controls (0x00–0x1F) except \t \n \r
 *   - DEL (0x7F) and C1 controls (0x80–0x9F)
 *   - Stray angle brackets that would let stored input poke at HTML rendering
 *
 * Caps each string at 2000 chars — well above any legitimate field width
 * (names ≤60, addresses ≤200, free-text ≤1000) so legitimate content is
 * never truncated. Caps object key count to 200 to bound denial-of-service
 * via deeply-nested attacker payloads.
 */
export function sanitizeFreeText<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === 'string') return cleanString(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeFreeText(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, MAX_KEYS);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = sanitizeFreeText(obj[key]);
    }
    return out as unknown as T;
  }
  return value;
}

function cleanString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length && out.length < MAX_STRING_LENGTH; i++) {
    const code = raw.charCodeAt(i);
    // Drop C0 controls except \t (0x09), \n (0x0A), \r (0x0D)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    // Drop DEL + C1 controls
    if (code >= 0x7f && code <= 0x9f) continue;
    const ch = raw[i];
    if (ch === '<' || ch === '>') continue;
    out += ch;
  }
  return out;
}
