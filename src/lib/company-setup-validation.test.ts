import { describe, it, expect } from 'vitest';
import {
  COMPANY_SETUP_MAX_MONTHLY_SALARY_AED,
  COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT,
  COMPANY_SETUP_MAX_SHARE_CAPITAL_AED,
  COMPANY_SETUP_MAX_VALUE_PER_SHARE_AED,
  COMPANY_SETUP_MAX_VISA_COUNT,
  validateCompanyData,
  validateContact,
  validatePersons,
} from './company-setup-validation';
import type {
  CompanySetupCompanyData,
  CompanySetupPerson,
  CompanySetupPersonRoles,
} from '@/types/company-setup';

function makeRoles(overrides: Partial<CompanySetupPersonRoles> = {}): CompanySetupPersonRoles {
  return {
    shareholder: false,
    generalManager: false,
    director: false,
    secretary: false,
    ...overrides,
  };
}

/**
 * One person holding every required role and 100% of the shares. Carries the
 * fields the submit gate requires: nationality, date of birth, religion and
 * the EID/visa answer are all mandatory on the authority application.
 */
function makeSoloFounder(overrides: Partial<CompanySetupPerson> = {}): CompanySetupPerson {
  return {
    fullName: 'John Michael Doe',
    roles: makeRoles({ shareholder: true, generalManager: true, director: true, secretary: true }),
    shareholdingPct: 100,
    nationality: 'Germany',
    dateOfBirth: '1985-12-12',
    religion: 'Christian',
    currentOrPastEidVisa: 'none',
    visa: { visaRequired: false },
    ...overrides,
  };
}

function makeCompany(overrides: Partial<CompanySetupCompanyData> = {}): CompanySetupCompanyData {
  return {
    nameOptions: [
      { name: 'Horizon Trade' },
      { name: 'Bluepeak Ventures' },
      { name: 'Northstone Group' },
    ],
    activities: [{ description: 'Management consultancy' }],
    licenseType: 'Commercial',
    ...overrides,
  };
}

// Passport fields (optional, auto-extracted) — the full validator suite lives
// in the portal repo next to the source-of-truth mirror; this covers the
// passport rules enforced server-side by /api/company-setup/[token]/submit.
describe('validatePersons passport fields', () => {
  it('accepts a person with valid passport details', () => {
    const result = validatePersons([
      makeSoloFounder({
        passportNumber: 'P1234567',
        passportIssueDate: '2020-05-01',
        passportExpiryDate: '2090-05-01',
        gender: 'male',
        placeOfBirth: 'Munich',
      }),
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a person with no passport details (extraction can fail)', () => {
    const result = validatePersons([makeSoloFounder()]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects malformed passport dates when present', () => {
    const result = validatePersons([
      makeSoloFounder({
        passportIssueDate: '01.05.2020',
        passportExpiryDate: '2090-02-30',
      }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'John Michael Doe: the passport issue date is not a valid date.'
    );
    expect(result.errors).toContain(
      'John Michael Doe: the passport expiry date is not a valid date.'
    );
  });

  it('rejects a passport that is already expired', () => {
    const result = validatePersons([
      makeSoloFounder({ passportExpiryDate: '2020-01-01' }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'John Michael Doe: the passport has expired. Please check the expiry date.'
    );
  });

  it('accepts a passport expiring today (not in the past)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = validatePersons([makeSoloFounder({ passportExpiryDate: today })]);
    expect(result.valid).toBe(true);
  });
});

// The fields the authority application cannot go in without. The form gates
// them too; these are the server backstop.
describe('validatePersons mandatory fields', () => {
  it('requires nationality', () => {
    const result = validatePersons([makeSoloFounder({ nationality: '  ' })]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('John Michael Doe: please select the nationality.');
  });

  it('requires a date of birth, and it must be a real past date', () => {
    expect(validatePersons([makeSoloFounder({ dateOfBirth: undefined })]).errors).toContain(
      'John Michael Doe: please enter the date of birth.'
    );
    expect(validatePersons([makeSoloFounder({ dateOfBirth: '2085-01-01' })]).errors).toContain(
      'John Michael Doe: the date of birth is not a valid date.'
    );
  });

  it('requires religion and the EID/visa answer', () => {
    const result = validatePersons([
      makeSoloFounder({ religion: '', currentOrPastEidVisa: undefined }),
    ]);
    expect(result.errors).toContain('John Michael Doe: please enter the religion.');
    expect(result.errors).toContain(
      'John Michael Doe: please answer the Emirates ID / UAE visa question.'
    );
  });

  it('rejects a shareholding above 100%', () => {
    const result = validatePersons([makeSoloFounder({ shareholdingPct: 140 })]);
    expect(result.errors).toContain(
      'John Michael Doe: the shareholding percentage cannot exceed 100%.'
    );
  });
});

describe('validatePersons bounded numbers', () => {
  it('requires job title and salary when a visa is requested', () => {
    const result = validatePersons([makeSoloFounder({ visa: { visaRequired: true } })]);
    expect(result.errors).toContain(
      'John Michael Doe: please enter the job title for the employment visa.'
    );
    expect(result.errors).toContain(
      'John Michael Doe: please enter the basic monthly salary for the employment visa.'
    );
  });

  it('caps the monthly salary', () => {
    const result = validatePersons([
      makeSoloFounder({
        visa: {
          visaRequired: true,
          jobTitle: 'General Manager',
          basicMonthlySalaryAED: COMPANY_SETUP_MAX_MONTHLY_SALARY_AED + 1,
        },
      }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('basic monthly salary cannot exceed'))).toBe(true);
  });

  it('bounds the number of other entities to 1..50', () => {
    expect(validatePersons([makeSoloFounder({ otherEntityCount: 0 })]).valid).toBe(false);
    expect(
      validatePersons([
        makeSoloFounder({ otherEntityCount: COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT + 1 }),
      ]).valid
    ).toBe(false);
    expect(
      validatePersons([
        makeSoloFounder({ otherEntityCount: COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT }),
      ]).valid
    ).toBe(true);
  });
});

describe('validateCompanyData bounded numbers', () => {
  it('accepts a well-formed company block', () => {
    expect(validateCompanyData(makeCompany()).valid).toBe(true);
  });

  it('bounds the visa count to 0..100 whole numbers', () => {
    expect(validateCompanyData(makeCompany({ visaCount: 0 })).valid).toBe(true);
    expect(
      validateCompanyData(makeCompany({ visaCount: COMPANY_SETUP_MAX_VISA_COUNT + 1 })).valid
    ).toBe(false);
    expect(validateCompanyData(makeCompany({ visaCount: 2.5 })).valid).toBe(false);
    expect(validateCompanyData(makeCompany({ visaCount: -1 })).valid).toBe(false);
  });

  it('caps the share capital and the value per share', () => {
    expect(
      validateCompanyData(
        makeCompany({ shareCapitalAED: COMPANY_SETUP_MAX_SHARE_CAPITAL_AED + 1 })
      ).valid
    ).toBe(false);
    expect(
      validateCompanyData(
        makeCompany({ valuePerShareAED: COMPANY_SETUP_MAX_VALUE_PER_SHARE_AED + 1 })
      ).valid
    ).toBe(false);
  });
});

describe('validateContact', () => {
  it('passes when the client did not touch the contact block', () => {
    expect(validateContact(undefined).valid).toBe(true);
  });

  it('requires a name and a valid email once a contact is submitted', () => {
    expect(validateContact({ name: '', email: 'a@b.com' }).valid).toBe(false);
    expect(validateContact({ name: 'Anna Klein', email: 'not-an-email' }).valid).toBe(false);
    expect(
      validateContact({ name: 'Anna Klein', email: 'anna@example.com', mobile: '+971501234567' })
        .valid
    ).toBe(true);
  });
});
