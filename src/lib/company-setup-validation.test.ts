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
    educationalQualification: "Bachelor's Degree",
    languagesSpoken: 'English, German',
    maritalStatus: 'Single',
    fatherFullName: 'Richard Doe',
    motherFullName: 'Mary Doe',
    email: 'john@example.com',
    mobile: '+971501234567',
    visitedOrResidedUAE: true,
    otherEntityShareholder: false,
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
    businessDescription: 'Management consultancy for small businesses in the UAE.',
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
    expect(result.errors).toContain('John Michael Doe: please select the religion.');
    expect(result.errors).toContain(
      'John Michael Doe: please answer the Emirates ID / UAE visa question.'
    );
  });

  it('treats a religion IFZA does not offer as not answered', () => {
    const result = validatePersons([makeSoloFounder({ religion: 'Atheist/Non-religious' })]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('John Michael Doe: please select the religion.');
  });

  it('requires the background, family, contact and UAE answers for every person', () => {
    const result = validatePersons([
      makeSoloFounder({
        educationalQualification: '',
        languagesSpoken: undefined,
        maritalStatus: undefined,
        fatherFullName: ' ',
        motherFullName: undefined,
        email: undefined,
        mobile: '',
        visitedOrResidedUAE: undefined,
        otherEntityShareholder: undefined,
      }),
    ]);
    expect(result.errors).toEqual([
      'John Michael Doe: please enter the email address.',
      'John Michael Doe: please select the educational qualification.',
      'John Michael Doe: please select the languages spoken.',
      'John Michael Doe: please select the marital status.',
      "John Michael Doe: please enter the father's full name.",
      "John Michael Doe: please enter the mother's full name.",
      'John Michael Doe: please enter the mobile number.',
      'John Michael Doe: please answer whether this person has visited or resided in the UAE.',
      'John Michael Doe: please answer whether this person is a shareholder in any other entity.',
    ]);
  });

  it('accepts "No" answers and leaves the employer details optional', () => {
    const result = validatePersons([
      makeSoloFounder({
        visitedOrResidedUAE: false,
        otherEntityShareholder: false,
        previousEmployer: undefined,
      }),
    ]);
    expect(result.valid).toBe(true);
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

  it('rejects the same company name on two options, whatever the casing', () => {
    const result = validateCompanyData(
      makeCompany({
        nameOptions: [
          { name: 'Horizon Trade' },
          { name: 'Northstone Group' },
          { name: '  horizon trade  ' },
        ],
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Name option 3: this is the same name as option 1. Please give 3 different names.'
    );
  });

  it('no longer requires the business description or the license type', () => {
    expect(validateCompanyData(makeCompany({ businessDescription: '  ' })).valid).toBe(true);
    expect(validateCompanyData(makeCompany({ businessDescription: undefined })).valid).toBe(true);
    expect(validateCompanyData(makeCompany({ licenseType: undefined })).valid).toBe(true);
  });

  it('enforces the IFZA minimums when the share capital fields are filled in', () => {
    expect(validateCompanyData(makeCompany({ shareCapitalAED: 9_999 })).errors).toContain(
      'IFZA requires a minimum share capital of AED 10,000.'
    );
    expect(validateCompanyData(makeCompany({ valuePerShareAED: 5 })).errors).toContain(
      'The minimum value of each share is AED 10.'
    );
    expect(
      validateCompanyData(
        makeCompany({ shareCapitalAED: 10_000, valuePerShareAED: 10, numberOfShares: 1_000 })
      ).valid
    ).toBe(true);
    // Still optional: blank fields pass.
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

describe('validatePersons role limits', () => {
  const partner = (i: number, pct: number, extra: Partial<CompanySetupPersonRoles> = {}) =>
    makeSoloFounder({
      fullName: `Partner ${i}`,
      roles: makeRoles({ shareholder: true, ...extra }),
      shareholdingPct: pct,
    });
  const officer = (name: string, roles: Partial<CompanySetupPersonRoles>) =>
    makeSoloFounder({ fullName: name, roles: makeRoles(roles), shareholdingPct: undefined });

  it('allows no General Manager and no Secretary', () => {
    const result = validatePersons([partner(1, 100, { director: true })]);
    expect(result.errors).toEqual([]);
  });

  it('rejects a 2nd General Manager and a 2nd Secretary', () => {
    const result = validatePersons([
      makeSoloFounder({ shareholdingPct: 50 }),
      partner(2, 50, { generalManager: true, secretary: true }),
    ]);
    expect(result.errors).toContain('Only one person can be the General Manager.');
    expect(result.errors).toContain('Only one person can be the Secretary.');
  });

  it('allows 6 shareholders plus a separate GM, Secretary and Director (9 persons)', () => {
    const result = validatePersons([
      partner(1, 50),
      ...[2, 3, 4, 5, 6].map((i) => partner(i, 10)),
      officer('Gina Manager', { generalManager: true }),
      officer('Sam Secretary', { secretary: true }),
      officer('Dan Director', { director: true }),
    ]);
    expect(result.errors).toEqual([]);
  });

  it('rejects a 7th shareholder and a missing shareholder', () => {
    const seven = validatePersons([
      partner(1, 40, { director: true }),
      ...[2, 3, 4, 5, 6, 7].map((i) => partner(i, 10)),
    ]);
    expect(seven.errors).toContain('A company can have up to 6 shareholders.');
    const none = validatePersons([officer('Dan Director', { director: true })]);
    expect(none.errors).toContain('Please assign at least one person as Shareholder.');
  });

  it('rejects more than 9 persons', () => {
    const result = validatePersons([
      partner(1, 100, { director: true }),
      ...Array.from({ length: 9 }, (_, i) => officer(`Director ${i + 1}`, { director: true })),
    ]);
    expect(result.errors).toContain('Please add no more than 9 persons.');
  });
});
