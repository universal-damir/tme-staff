/**
 * Draft-state helpers for the Company Setup Intake form.
 *
 * The in-form draft keeps the EXACT contract shape (CompanySetupSubmittedData
 * minus confirmedAt, with licenseType still unset while the client works), so
 * autosave/submit payloads are a straight pass-through and the portal reads a
 * consistent shape at every stage.
 */

import {
  COMPANY_SETUP_NAME_OPTIONS_REQUIRED,
  type CompanySetupActivity,
  type CompanySetupCompanyData,
  type CompanySetupDocRef,
  type CompanySetupDocuments,
  type CompanySetupLicenseType,
  type CompanySetupPerson,
  type CompanySetupPrefillData,
  type CompanySetupSubmittedData,
} from '@/types/company-setup';
import { resolveExtractedNationality } from '@/lib/country-utils';

export interface DraftCompany extends Omit<CompanySetupCompanyData, 'licenseType'> {
  licenseType?: CompanySetupLicenseType;
}

export interface CompanySetupDraft {
  company: DraftCompany;
  persons: CompanySetupPerson[];
}

export function emptyPerson(): CompanySetupPerson {
  return {
    fullName: '',
    roles: { shareholder: false, generalManager: false, director: false, secretary: false },
    visa: { visaRequired: false },
  };
}

function normalizePerson(partial: Partial<CompanySetupPerson> | undefined): CompanySetupPerson {
  const base = emptyPerson();
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    roles: { ...base.roles, ...(partial.roles ?? {}) },
    visa: { ...base.visa, ...(partial.visa ?? {}) },
    previousEmployer: partial.previousEmployer ? { ...partial.previousEmployer } : undefined,
  };
}

/** numberOfShares is ALWAYS derived: shareCapitalAED / valuePerShareAED. */
export function deriveNumberOfShares(
  capital: number | undefined,
  perShare: number | undefined
): number | undefined {
  if (!(typeof capital === 'number' && Number.isFinite(capital) && capital > 0)) return undefined;
  if (!(typeof perShare === 'number' && Number.isFinite(perShare) && perShare > 0)) return undefined;
  const shares = capital / perShare;
  if (!Number.isFinite(shares) || shares <= 0) return undefined;
  return Number.isInteger(shares) ? shares : Number(shares.toFixed(2));
}

function normalizeCompany(partial: Partial<CompanySetupCompanyData> | undefined): DraftCompany {
  const nameOptions = (partial?.nameOptions ?? []).map((o) => ({ name: o?.name ?? '' }));
  while (nameOptions.length < COMPANY_SETUP_NAME_OPTIONS_REQUIRED) nameOptions.push({ name: '' });
  nameOptions.length = COMPANY_SETUP_NAME_OPTIONS_REQUIRED;

  // Coerce legacy plain-string entries to { description } (pre-code contract);
  // an optional IFZA code rides along when present.
  const activities = ((partial?.activities ?? []) as Array<
    Partial<CompanySetupActivity> | string
  >)
    .map((a) => {
      if (typeof a === 'string') return { description: a };
      const code = typeof a?.code === 'string' ? a.code.trim() : '';
      return {
        ...(code ? { code } : {}),
        description: a?.description ?? '',
      };
    })
    .filter((a, i) => i === 0 || a.description.trim().length > 0 || !!a.code);
  if (activities.length === 0) activities.push({ description: '' });

  return {
    nameOptions,
    activities,
    licenseType: partial?.licenseType,
    businessDescription: partial?.businessDescription ?? '',
    shareCapitalAED: partial?.shareCapitalAED,
    valuePerShareAED: partial?.valuePerShareAED,
    // Always re-derived when both inputs exist — an override never survives a
    // resume; a legacy shares-only entry (no capital/per-share) passes through.
    numberOfShares:
      deriveNumberOfShares(partial?.shareCapitalAED, partial?.valuePerShareAED) ??
      partial?.numberOfShares,
    visaCount: partial?.visaCount,
    facilityType: partial?.facilityType,
    facilitySize: partial?.facilitySize ?? '',
  };
}

/**
 * Build the working draft: resume from the autosaved submitted_data when the
 * client saved before, otherwise seed from the staff prefill. Prefilled
 * fields arrive fully editable — they are ordinary draft values.
 */
export function buildDraft(
  prefill: CompanySetupPrefillData | null,
  saved: Partial<CompanySetupSubmittedData> | null
): CompanySetupDraft {
  const sourceCompany = saved?.company ?? prefill?.company;
  const sourcePersons =
    saved?.persons && saved.persons.length > 0 ? saved.persons : prefill?.persons;

  const persons = (sourcePersons ?? []).map((p) => normalizePerson(p));
  if (persons.length === 0) persons.push(emptyPerson());

  return { company: normalizeCompany(sourceCompany ?? undefined), persons };
}

export interface RoleTotals {
  shareholdingSum: number;
  shareholderCount: number;
  gmCount: number;
  directorCount: number;
  secretaryCount: number;
}

export function roleTotals(persons: CompanySetupPerson[]): RoleTotals {
  let shareholdingSum = 0;
  let shareholderCount = 0;
  let gmCount = 0;
  let directorCount = 0;
  let secretaryCount = 0;
  for (const p of persons) {
    if (p.roles.shareholder) {
      shareholderCount += 1;
      if (typeof p.shareholdingPct === 'number' && Number.isFinite(p.shareholdingPct)) {
        shareholdingSum += p.shareholdingPct;
      }
    }
    if (p.roles.generalManager) gmCount += 1;
    if (p.roles.director) directorCount += 1;
    if (p.roles.secretary) secretaryCount += 1;
  }
  // Round away float noise (33.33 * 3 style sums).
  shareholdingSum = Math.round(shareholdingSum * 100) / 100;
  return { shareholdingSum, shareholderCount, gmCount, directorCount, secretaryCount };
}

/** ISO YYYY-MM-DD -> dd.mm.yyyy (CustomDatePicker's display format). */
export function isoToDisplayDate(iso: string | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** dd.mm.yyyy -> ISO YYYY-MM-DD (stored format per the contract). */
export function displayToIsoDate(display: string): string | undefined {
  if (!display) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(display)) return display;
  const match = display.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return undefined;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Documents re-key after a person is removed: person N's documents become
 * person N-1's for every N above the removed index.
 */
export function rekeyDocumentsAfterRemove(
  documents: CompanySetupDocuments,
  removedIndex: number
): CompanySetupDocuments {
  const next: CompanySetupDocuments = {};
  for (const [key, value] of Object.entries(documents)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx === removedIndex) continue;
    next[String(idx > removedIndex ? idx - 1 : idx)] = value;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Passport extraction -> person prefill
// ---------------------------------------------------------------------------

/**
 * Person fields the passport extraction can auto-fill, with the values that
 * were actually applied. Stored on the passport doc ref's `extractedData`
 * (part of the CompanySetupDocRef contract) so a resumed draft knows what was
 * auto-filled and a passport removal can undo exactly those fields.
 */
export type PassportExtractedFields = Partial<
  Record<
    | 'fullName'
    | 'nationality'
    | 'dateOfBirth'
    | 'gender'
    | 'placeOfBirth'
    | 'passportNumber'
    | 'passportIssueDate'
    | 'passportExpiryDate',
    string
  >
>;

/** The narrowed view of a doc ref's extractedData (contract: Record<string, string>). */
export function extractedDataOf(
  ref: CompanySetupDocRef | undefined
): PassportExtractedFields | undefined {
  return ref?.extractedData as PassportExtractedFields | undefined;
}

/** The `data` shape of the extract-passport API response (see passport-extraction.ts). */
export interface PassportExtractionData {
  first_name?: string;
  middle_name?: string;
  family_name?: string;
  passport_no?: string;
  passport_issue_date?: string;
  passport_expiry_date?: string;
  nationality?: string;
  date_of_birth?: string;
  gender?: string;
  place_of_birth?: string;
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Apply extracted passport data to a person — FILL-ONLY: a field the client
 * already typed, or that arrived pre-filled from TME staff, is never
 * overwritten. Returns the updated person plus the exact fields/values that
 * were applied (for the doc ref's extractedData).
 */
export function applyPassportExtraction(
  person: CompanySetupPerson,
  data: PassportExtractionData,
  nationalities: readonly string[]
): { person: CompanySetupPerson; applied: PassportExtractedFields } {
  const applied: PassportExtractedFields = {};
  const next: CompanySetupPerson = { ...person };

  const fullName = [data.first_name, data.middle_name, data.family_name]
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean)
    .join(' ');
  if (fullName && isBlank(person.fullName)) {
    next.fullName = fullName;
    applied.fullName = fullName;
  }

  const nationality = resolveExtractedNationality(data.nationality, nationalities);
  if (nationality && isBlank(person.nationality)) {
    next.nationality = nationality;
    applied.nationality = nationality;
  }

  const dob = data.date_of_birth ? displayToIsoDate(data.date_of_birth) : undefined;
  if (dob && isBlank(person.dateOfBirth)) {
    next.dateOfBirth = dob;
    applied.dateOfBirth = dob;
  }

  const gender = typeof data.gender === 'string' ? data.gender.trim().toLowerCase() : '';
  if ((gender === 'male' || gender === 'female') && isBlank(person.gender)) {
    next.gender = gender;
    applied.gender = gender;
  }

  const placeOfBirth =
    typeof data.place_of_birth === 'string' ? data.place_of_birth.trim() : '';
  if (placeOfBirth && isBlank(person.placeOfBirth)) {
    next.placeOfBirth = placeOfBirth;
    applied.placeOfBirth = placeOfBirth;
  }

  const passportNo = typeof data.passport_no === 'string' ? data.passport_no.trim() : '';
  if (passportNo && isBlank(person.passportNumber)) {
    next.passportNumber = passportNo;
    applied.passportNumber = passportNo;
  }

  const issue = data.passport_issue_date
    ? displayToIsoDate(data.passport_issue_date)
    : undefined;
  if (issue && isBlank(person.passportIssueDate)) {
    next.passportIssueDate = issue;
    applied.passportIssueDate = issue;
  }

  const expiry = data.passport_expiry_date
    ? displayToIsoDate(data.passport_expiry_date)
    : undefined;
  if (expiry && isBlank(person.passportExpiryDate)) {
    next.passportExpiryDate = expiry;
    applied.passportExpiryDate = expiry;
  }

  return { person: next, applied };
}

/**
 * Undo a previous extraction prefill (passport removed or replaced): clear
 * only the fields whose CURRENT value still equals the auto-filled one —
 * anything the client has since edited stays untouched.
 */
export function clearAppliedExtraction(
  person: CompanySetupPerson,
  applied: PassportExtractedFields | undefined
): CompanySetupPerson {
  if (!applied) return person;
  const next: CompanySetupPerson = { ...person };
  for (const [key, value] of Object.entries(applied)) {
    const field = key as keyof PassportExtractedFields;
    if (next[field] === value) {
      if (field === 'fullName') next.fullName = '';
      else next[field] = undefined;
    }
  }
  return next;
}

/** Parse a positive number out of an input string; undefined when blank/invalid. */
export function parsePositiveNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
