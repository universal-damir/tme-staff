/**
 * Supplier Verification Policy - the three roles and the answer checks.
 *
 * MIRROR of the portal repo's src/lib/supplier-checks/role-variant.ts: the
 * same rules run on this form, on the submit route and on the portal review.
 * Change both or neither.
 *
 * The role variant (3 / 2 / 1 person) is DERIVED from the names, never asked:
 * a switch could contradict the names.
 *
 * Pure.
 */

import { hasNonEnglish } from '@/lib/english-only';
import {
  SVP_LIMITS,
  SVP_ROLE_KEYS,
  type SvpPerson,
  type SvpPolicyAnswers,
  type SvpRoleKey,
  type SvpRoleVariant,
} from '@/types/supplier-policy';

export const SVP_ROLE_LABELS: Record<SvpRoleKey, string> = {
  implementer: 'Implementer',
  reviewer: 'Reviewer',
  supervisor: 'Supervisor',
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The name as a comparison key: case, extra spaces and dots or commas do not
 * make a different person ("Ali  Khan", "ali khan", "Ali Khan." are one).
 */
export function normaliseName(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 'three' = three different people, 'two' = one person holds two roles,
 * 'one' = one person holds all three. An empty name counts as its own person
 * (validation reports it), so it never merges two roles by accident.
 */
export function roleVariant(answers: Pick<SvpPolicyAnswers, SvpRoleKey>): SvpRoleVariant {
  const keys = SVP_ROLE_KEYS.map((role, i) => normaliseName(answers[role]?.name) || `__empty_${i}`);
  const distinct = new Set(keys).size;
  if (distinct === 1) return 'one';
  if (distinct === 2) return 'two';
  return 'three';
}

/** The roles one person holds together, e.g. ['reviewer', 'supervisor']; empty for 'three'. */
export function sharedRoles(answers: Pick<SvpPolicyAnswers, SvpRoleKey>): SvpRoleKey[] {
  const keys = SVP_ROLE_KEYS.map((role) => normaliseName(answers[role]?.name));
  return SVP_ROLE_KEYS.filter(
    (_, i) => keys[i] !== '' && keys.some((other, j) => j !== i && other === keys[i])
  );
}

/** The variant in words. */
export function describeRoleVariant(variant: SvpRoleVariant): string {
  if (variant === 'one') return 'One person holds all three roles';
  if (variant === 'two') return 'One person holds two roles';
  return 'Three different people';
}

function checkPerson(role: SvpRoleKey, person: Partial<SvpPerson> | undefined, errors: string[]): void {
  const label = SVP_ROLE_LABELS[role];
  const name = (person?.name || '').trim();
  const position = (person?.position || '').trim();
  const email = (person?.email || '').trim();

  if (!name) errors.push(`${label}: the name is missing.`);
  else if (name.length > SVP_LIMITS.name) errors.push(`${label}: the name is longer than ${SVP_LIMITS.name} characters.`);
  else if (hasNonEnglish(name)) errors.push(`${label}: the name must use English letters only (A to Z).`);

  if (!position) errors.push(`${label}: the position is missing.`);
  else if (position.length > SVP_LIMITS.position) errors.push(`${label}: the position is longer than ${SVP_LIMITS.position} characters.`);
  else if (hasNonEnglish(position)) errors.push(`${label}: the position must use English letters only (A to Z).`);

  if (!email) {
    // The Supervisor signs the policy, so the signing email needs an address.
    if (role === 'supervisor') errors.push(`${label}: the email is missing. The Supervisor signs the policy.`);
  } else if (email.length > SVP_LIMITS.email || !EMAIL_RE.test(email)) {
    errors.push(`${label}: the email address is not valid.`);
  }
}

export interface ValidateAnswersOptions {
  /** The client form refuses to submit without the price box ticked. The portal review does not ask. */
  requirePriceAgreed?: boolean;
}

/**
 * Every problem with a set of answers, in plain English, or an empty list.
 * Accepts a partial / untrusted object: a missing block is reported, never thrown.
 */
export function validateAnswers(
  answers: Partial<SvpPolicyAnswers> | null | undefined,
  options: ValidateAnswersOptions = {}
): string[] {
  const errors: string[] = [];
  const a = answers || {};

  for (const role of SVP_ROLE_KEYS) checkPerson(role, a[role], errors);

  if (!a.recordsLocationIsRegisteredOffice) {
    const location = (a.recordsLocation || '').trim();
    if (!location) errors.push('Records location: say where the supplier records are kept.');
    else if (location.length > SVP_LIMITS.recordsLocation) {
      errors.push(`Records location: longer than ${SVP_LIMITS.recordsLocation} characters.`);
    }
  }

  if ((a.note || '').trim().length > SVP_LIMITS.note) {
    errors.push(`Note: longer than ${SVP_LIMITS.note} characters.`);
  }

  if (options.requirePriceAgreed && a.priceAgreed !== true) {
    errors.push('Price: please tick the box to agree to the price.');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Server side: turn an untrusted POST body into answers (tme-staff only)
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function person(value: unknown): SvpPerson {
  const p = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { name: str(p.name), position: str(p.position), email: str(p.email) };
}

/**
 * Picks ONLY the known fields out of a submit body (unknown keys are dropped,
 * so nothing else can reach submitted_data) and trims every string. The
 * caller runs sanitizeFreeText + foldPayloadToEnglish on the result, then
 * validateAnswers.
 *
 * `priceAgreed` and `dutyAcknowledged` are copied as the literal the client
 * sent; the route refuses anything but `true` before it stores the answers.
 */
export function pickSubmittedAnswers(
  body: unknown
): Omit<SvpPolicyAnswers, 'priceAgreed' | 'dutyAcknowledged'> & {
  priceAgreed: boolean;
  dutyAcknowledged: boolean;
} {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const note = str(b.note);
  const isOffice = b.recordsLocationIsRegisteredOffice === true;
  return {
    implementer: person(b.implementer),
    reviewer: person(b.reviewer),
    supervisor: person(b.supervisor),
    recordsLocationIsRegisteredOffice: isOffice,
    // The office text is set by the portal; a free text sent alongside is dropped.
    recordsLocation: isOffice ? '' : str(b.recordsLocation),
    priceAgreed: b.priceAgreed === true,
    dutyAcknowledged: b.dutyAcknowledged === true,
    ...(note ? { note } : {}),
  };
}
