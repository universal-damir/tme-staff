// Company Setup Intake (IFZA v1) — pure submission-level validators.
// MIRROR of the portal repo's src/lib/company-setup/validation.ts (the source
// of truth); keep both copies in sync. Enforced server-side by
// /api/company-setup/[token]/submit before a submission is accepted.

import {
  COMPANY_SETUP_MAX_ACTIVITIES,
  COMPANY_SETUP_MAX_SHAREHOLDERS,
  COMPANY_SETUP_NAME_OPTIONS_REQUIRED,
  type CompanySetupCompanyData,
  type CompanySetupPerson,
  type CompanySetupSubmittedData,
} from '@/types/company-setup';
import { validateCompanyName } from './company-setup-name-validation';

export interface CompanySetupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const SHAREHOLDING_TOLERANCE = 0.01;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Upper bounds — sanity caps, generous vs. anything IFZA actually issues.
// The form inputs clamp to the same values; this is the server backstop.
export const COMPANY_SETUP_MAX_VISA_COUNT = 100;
export const COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT = 50;
export const COMPANY_SETUP_MAX_SHARE_CAPITAL_AED = 100_000_000;
export const COMPANY_SETUP_MAX_VALUE_PER_SHARE_AED = 1_000_000;
export const COMPANY_SETUP_MAX_MONTHLY_SALARY_AED = 1_000_000;

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isBoundedInt(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
  );
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Strict ISO YYYY-MM-DD check (rejects impossible dates like 2026-02-30). */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Today as ISO YYYY-MM-DD (UTC) — used for the passport expiry check. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Company block: 3 rule-valid name options, 1..10 activities, license type, share capital sanity. */
export function validateCompanyData(
  company: CompanySetupCompanyData
): CompanySetupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Exactly 3 name options, each passing the IFZA name rules.
  const nameOptions = company.nameOptions || [];
  if (nameOptions.length !== COMPANY_SETUP_NAME_OPTIONS_REQUIRED) {
    errors.push(
      `Please provide exactly ${COMPANY_SETUP_NAME_OPTIONS_REQUIRED} company name options.`
    );
  }
  nameOptions.forEach((option, index) => {
    const result = validateCompanyName(option?.name ?? '');
    for (const error of result.errors) {
      errors.push(`Name option ${index + 1}: ${error}`);
    }
    for (const warning of result.warnings) {
      warnings.push(`Name option ${index + 1}: ${warning}`);
    }
  });

  // 1..10 activities, each with a non-empty description.
  const activities = company.activities || [];
  if (activities.length < 1) {
    errors.push('Please add at least one business activity.');
  }
  if (activities.length > COMPANY_SETUP_MAX_ACTIVITIES) {
    errors.push(`Please choose no more than ${COMPANY_SETUP_MAX_ACTIVITIES} business activities.`);
  }
  activities.forEach((activity, index) => {
    if (!activity?.description || !activity.description.trim()) {
      errors.push(`Business activity ${index + 1} needs a description.`);
    }
  });

  // License type is mandatory.
  if (!company.licenseType) {
    errors.push('Please choose a license type.');
  }

  // Share capital numbers must be positive when provided.
  if (company.shareCapitalAED !== undefined && !isPositiveNumber(company.shareCapitalAED)) {
    errors.push('The share capital must be a positive amount.');
  }
  if (company.valuePerShareAED !== undefined && !isPositiveNumber(company.valuePerShareAED)) {
    errors.push('The value per share must be a positive amount.');
  }
  if (company.numberOfShares !== undefined && !isPositiveNumber(company.numberOfShares)) {
    errors.push('The number of shares must be a positive number.');
  }
  if (
    company.shareCapitalAED !== undefined &&
    isPositiveNumber(company.shareCapitalAED) &&
    company.shareCapitalAED > COMPANY_SETUP_MAX_SHARE_CAPITAL_AED
  ) {
    errors.push(
      `The share capital cannot exceed AED ${COMPANY_SETUP_MAX_SHARE_CAPITAL_AED.toLocaleString('en-US')}.`
    );
  }
  if (
    company.valuePerShareAED !== undefined &&
    isPositiveNumber(company.valuePerShareAED) &&
    company.valuePerShareAED > COMPANY_SETUP_MAX_VALUE_PER_SHARE_AED
  ) {
    errors.push(
      `The value per share cannot exceed AED ${COMPANY_SETUP_MAX_VALUE_PER_SHARE_AED.toLocaleString('en-US')}.`
    );
  }

  // Employment visas: whole number, 0..100.
  if (
    company.visaCount !== undefined &&
    !isBoundedInt(company.visaCount, 0, COMPANY_SETUP_MAX_VISA_COUNT)
  ) {
    errors.push(
      `The number of employment visas must be a whole number between 0 and ${COMPANY_SETUP_MAX_VISA_COUNT}.`
    );
  }

  // Consistency: shareCapital = valuePerShare * numberOfShares (warning only).
  if (
    isPositiveNumber(company.shareCapitalAED) &&
    isPositiveNumber(company.valuePerShareAED) &&
    isPositiveNumber(company.numberOfShares)
  ) {
    const computed = company.valuePerShareAED * company.numberOfShares;
    if (Math.abs(computed - company.shareCapitalAED) > 0.01) {
      warnings.push(
        `The share capital (AED ${company.shareCapitalAED}) does not match value per share x number of shares (AED ${computed}). Please double-check the numbers.`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Persons block: role rules (1 GM, 1 secretary, >=1 director), shareholding sums to 100. */
export function validatePersons(
  persons: CompanySetupPerson[]
): CompanySetupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const list = persons || [];
  if (list.length < 1) {
    errors.push('Please add at least one person.');
  }
  if (list.length > COMPANY_SETUP_MAX_SHAREHOLDERS) {
    errors.push(`Please add no more than ${COMPANY_SETUP_MAX_SHAREHOLDERS} persons.`);
  }

  list.forEach((person, index) => {
    const label = person?.fullName?.trim() || `Person ${index + 1}`;
    if (!person?.fullName || !person.fullName.trim()) {
      errors.push(`Person ${index + 1} needs a full name (as written in the passport).`);
    }
    if (person?.email && !EMAIL_PATTERN.test(person.email.trim())) {
      errors.push(`${label}: please enter a valid email address.`);
    }
    if (person?.roles?.shareholder && !isPositiveNumber(person.shareholdingPct)) {
      errors.push(`${label}: please enter the shareholding percentage.`);
    }
    if (isPositiveNumber(person?.shareholdingPct) && person.shareholdingPct > 100) {
      errors.push(`${label}: the shareholding percentage cannot exceed 100%.`);
    }
    // Mandatory on the authority application — required at submit even though
    // the fields are optional in the prefill/draft contract.
    if (!person?.nationality || !person.nationality.trim()) {
      errors.push(`${label}: please select the nationality.`);
    }
    if (!person?.dateOfBirth) {
      errors.push(`${label}: please enter the date of birth.`);
    } else if (!isValidIsoDate(person.dateOfBirth) || person.dateOfBirth >= todayIso()) {
      errors.push(`${label}: the date of birth is not a valid date.`);
    }
    if (!person?.religion || !person.religion.trim()) {
      errors.push(`${label}: please enter the religion.`);
    }
    if (!person?.currentOrPastEidVisa) {
      errors.push(`${label}: please answer the Emirates ID / UAE visa question.`);
    }
    if (person?.visa?.visaRequired) {
      if (!person.visa.jobTitle || !person.visa.jobTitle.trim()) {
        errors.push(`${label}: please enter the job title for the employment visa.`);
      }
      if (!isPositiveNumber(person.visa.basicMonthlySalaryAED)) {
        errors.push(`${label}: please enter the basic monthly salary for the employment visa.`);
      } else if (person.visa.basicMonthlySalaryAED > COMPANY_SETUP_MAX_MONTHLY_SALARY_AED) {
        errors.push(
          `${label}: the basic monthly salary cannot exceed AED ${COMPANY_SETUP_MAX_MONTHLY_SALARY_AED.toLocaleString('en-US')}.`
        );
      }
    }
    if (
      person?.otherEntityCount !== undefined &&
      !isBoundedInt(person.otherEntityCount, 1, COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT)
    ) {
      errors.push(
        `${label}: the number of other entities must be a whole number between 1 and ${COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT}.`
      );
    }
    // Passport fields are optional everywhere (auto-extraction can fail; staff
    // can parse them later from the uploaded copy) — but when present, dates
    // must be valid and the passport must not already be expired.
    if (person?.passportIssueDate && !isValidIsoDate(person.passportIssueDate)) {
      errors.push(`${label}: the passport issue date is not a valid date.`);
    }
    if (person?.passportExpiryDate) {
      if (!isValidIsoDate(person.passportExpiryDate)) {
        errors.push(`${label}: the passport expiry date is not a valid date.`);
      } else if (person.passportExpiryDate < todayIso()) {
        errors.push(`${label}: the passport has expired. Please check the expiry date.`);
      }
    }
  });

  const generalManagers = list.filter((p) => p?.roles?.generalManager).length;
  if (generalManagers !== 1) {
    errors.push(
      generalManagers === 0
        ? 'Please assign one person as General Manager.'
        : 'Only one person can be the General Manager.'
    );
  }

  const secretaries = list.filter((p) => p?.roles?.secretary).length;
  if (secretaries !== 1) {
    errors.push(
      secretaries === 0
        ? 'Please assign one person as Secretary.'
        : 'Only one person can be the Secretary.'
    );
  }

  const directors = list.filter((p) => p?.roles?.director).length;
  if (directors < 1) {
    errors.push('Please assign at least one person as Director.');
  }

  // Shareholding of all shareholders must total exactly 100 (tolerance 0.01).
  const shareholders = list.filter((p) => p?.roles?.shareholder);
  if (shareholders.length > 0) {
    const total = shareholders.reduce(
      (sum, p) => sum + (isPositiveNumber(p.shareholdingPct) ? p.shareholdingPct : 0),
      0
    );
    if (Math.abs(total - 100) > SHAREHOLDING_TOLERANCE) {
      errors.push(
        `The shareholding of all shareholders must total exactly 100% (currently ${total}%).`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Client-corrected contact block (optional in the submission): name + valid email. */
export function validateContact(
  contact: CompanySetupSubmittedData['contact']
): CompanySetupValidationResult {
  const errors: string[] = [];
  if (contact) {
    if (!contact.name || !contact.name.trim()) {
      errors.push('Please enter the contact name.');
    }
    if (!contact.email || !EMAIL_PATTERN.test(contact.email.trim())) {
      errors.push('Please enter a valid contact email address.');
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

/** Full submission check: company block + persons block + contact block. */
export function validateSubmission(
  data: CompanySetupSubmittedData
): CompanySetupValidationResult {
  const company = validateCompanyData(data.company);
  const persons = validatePersons(data.persons);
  const contact = validateContact(data.contact);

  const errors = [...company.errors, ...persons.errors, ...contact.errors];
  const warnings = [...company.warnings, ...persons.warnings];

  return { valid: errors.length === 0, errors, warnings };
}
