import { describe, it, expect } from 'vitest';
import { validatePersons } from './company-setup-validation';
import type {
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

/** One person holding every required role and 100% of the shares. */
function makeSoloFounder(overrides: Partial<CompanySetupPerson> = {}): CompanySetupPerson {
  return {
    fullName: 'John Michael Doe',
    roles: makeRoles({ shareholder: true, generalManager: true, director: true, secretary: true }),
    shareholdingPct: 100,
    visa: { visaRequired: false },
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
