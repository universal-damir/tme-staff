import { describe, it, expect } from 'vitest';
import {
  applyPassportExtraction,
  buildDraft,
  clearAppliedExtraction,
  deriveNumberOfShares,
  emptyPerson,
  extractedDataOf,
  rekeyDocumentsAfterRemove,
  type PassportExtractionData,
} from './draft';
import type { CompanySetupDocRef, CompanySetupPerson } from '@/types/company-setup';

const NATIONALITIES = ['Germany', 'Pakistan', 'United Kingdom', 'Syria'] as const;

const FULL_EXTRACTION: PassportExtractionData = {
  first_name: 'Thomas',
  middle_name: 'Michael',
  family_name: 'Mueller',
  passport_no: 'C01X00T47',
  passport_issue_date: '01.05.2020',
  passport_expiry_date: '01.05.2030',
  nationality: 'GERMAN',
  date_of_birth: '12.12.1985',
  gender: 'Male',
  place_of_birth: 'Munich',
};

describe('applyPassportExtraction', () => {
  it('fills every empty field, converting dates to ISO and gender to lowercase', () => {
    const { person, applied } = applyPassportExtraction(
      emptyPerson(),
      FULL_EXTRACTION,
      NATIONALITIES
    );
    expect(person.fullName).toBe('Thomas Michael Mueller');
    expect(person.nationality).toBe('Germany'); // demonym resolved
    expect(person.dateOfBirth).toBe('1985-12-12');
    expect(person.gender).toBe('male');
    expect(person.placeOfBirth).toBe('Munich');
    expect(person.passportNumber).toBe('C01X00T47');
    expect(person.passportIssueDate).toBe('2020-05-01');
    expect(person.passportExpiryDate).toBe('2030-05-01');
    expect(applied).toEqual({
      fullName: 'Thomas Michael Mueller',
      nationality: 'Germany',
      dateOfBirth: '1985-12-12',
      gender: 'male',
      placeOfBirth: 'Munich',
      passportNumber: 'C01X00T47',
      passportIssueDate: '2020-05-01',
      passportExpiryDate: '2030-05-01',
    });
  });

  it('never overwrites a field the client typed or staff pre-filled', () => {
    const prefilled: CompanySetupPerson = {
      ...emptyPerson(),
      fullName: 'HANS PETER SCHMIDT',
      nationality: 'United Kingdom',
      passportNumber: 'X9999999',
    };
    const { person, applied } = applyPassportExtraction(
      prefilled,
      FULL_EXTRACTION,
      NATIONALITIES
    );
    expect(person.fullName).toBe('HANS PETER SCHMIDT');
    expect(person.nationality).toBe('United Kingdom');
    expect(person.passportNumber).toBe('X9999999');
    // Empty fields still fill.
    expect(person.dateOfBirth).toBe('1985-12-12');
    expect(applied.fullName).toBeUndefined();
    expect(applied.nationality).toBeUndefined();
    expect(applied.passportNumber).toBeUndefined();
    expect(applied.dateOfBirth).toBe('1985-12-12');
  });

  it('skips values it cannot use instead of inventing them', () => {
    const { person, applied } = applyPassportExtraction(
      emptyPerson(),
      {
        nationality: 'KLINGON EMPIRE',
        date_of_birth: 'not-a-date',
        gender: 'unknown',
      },
      NATIONALITIES
    );
    expect(person.nationality).toBeUndefined();
    expect(person.dateOfBirth).toBeUndefined();
    expect(person.gender).toBeUndefined();
    expect(applied).toEqual({});
  });

  it('joins only the name parts that are present', () => {
    const { person } = applyPassportExtraction(
      emptyPerson(),
      { first_name: 'Aisha', family_name: 'Khan' },
      NATIONALITIES
    );
    expect(person.fullName).toBe('Aisha Khan');
  });
});

describe('clearAppliedExtraction', () => {
  const applied = {
    fullName: 'Thomas Michael Mueller',
    nationality: 'Germany',
    passportNumber: 'C01X00T47',
  };

  it('clears fields still holding the auto-filled value', () => {
    const person: CompanySetupPerson = {
      ...emptyPerson(),
      fullName: 'Thomas Michael Mueller',
      nationality: 'Germany',
      passportNumber: 'C01X00T47',
    };
    const cleared = clearAppliedExtraction(person, applied);
    expect(cleared.fullName).toBe('');
    expect(cleared.nationality).toBeUndefined();
    expect(cleared.passportNumber).toBeUndefined();
  });

  it('keeps fields the client edited after the auto-fill', () => {
    const person: CompanySetupPerson = {
      ...emptyPerson(),
      fullName: 'Thomas M. Mueller', // edited by the client
      nationality: 'Germany', // untouched auto-fill
      passportNumber: 'C01X00T47',
    };
    const cleared = clearAppliedExtraction(person, applied);
    expect(cleared.fullName).toBe('Thomas M. Mueller');
    expect(cleared.nationality).toBeUndefined();
    expect(cleared.passportNumber).toBeUndefined();
  });

  it('is a no-op without stored extraction data', () => {
    const person: CompanySetupPerson = { ...emptyPerson(), fullName: 'Someone' };
    expect(clearAppliedExtraction(person, undefined)).toEqual(person);
  });
});

describe('extractedDataOf', () => {
  it('reads extractedData riding on a doc ref and tolerates plain refs', () => {
    const ref: CompanySetupDocRef = {
      path: 'p/passport.pdf',
      filename: 'passport.pdf',
      uploadedAt: '2026-08-22T10:00:00.000Z',
      extractedData: { fullName: 'Thomas Michael Mueller' },
    };
    expect(extractedDataOf(ref)).toEqual({ fullName: 'Thomas Michael Mueller' });
    expect(
      extractedDataOf({ path: 'p', filename: 'f', uploadedAt: ref.uploadedAt })
    ).toBeUndefined();
    expect(extractedDataOf(undefined)).toBeUndefined();
  });
});

describe('buildDraft company normalization', () => {
  it('coerces legacy plain-string activities and keeps optional codes', () => {
    const draft = buildDraft(
      {
        contact: { name: 'A', email: 'a@b.com' },
        company: {
          // Legacy entry (string) next to the current object shape.
          activities: [
            'Management consultancy' as never,
            { code: '7020.00', description: 'Business advisory' },
          ],
        },
      },
      null
    );
    expect(draft.company.activities).toEqual([
      { description: 'Management consultancy' },
      { code: '7020.00', description: 'Business advisory' },
    ]);
  });

  it('always derives numberOfShares from capital and value per share', () => {
    const draft = buildDraft(
      {
        contact: { name: 'A', email: 'a@b.com' },
        company: {
          shareCapitalAED: 10000,
          valuePerShareAED: 100,
          numberOfShares: 7, // stale override — must not survive
        },
      },
      null
    );
    expect(draft.company.numberOfShares).toBe(100);
  });

  it('keeps a legacy shares-only value when capital/per-share are missing', () => {
    const draft = buildDraft(
      {
        contact: { name: 'A', email: 'a@b.com' },
        company: { numberOfShares: 500 },
      },
      null
    );
    expect(draft.company.numberOfShares).toBe(500);
  });
});

describe('deriveNumberOfShares', () => {
  it('divides capital by value per share', () => {
    expect(deriveNumberOfShares(10000, 1)).toBe(10000);
    expect(deriveNumberOfShares(10000, 3)).toBe(3333.33);
  });

  it('returns undefined when either side is missing or non-positive', () => {
    expect(deriveNumberOfShares(undefined, 1)).toBeUndefined();
    expect(deriveNumberOfShares(10000, undefined)).toBeUndefined();
    expect(deriveNumberOfShares(0, 1)).toBeUndefined();
    expect(deriveNumberOfShares(10000, 0)).toBeUndefined();
  });
});

describe('rekeyDocumentsAfterRemove keeps extraction data attached', () => {
  it('shifts refs (with extractedData) down past the removed person', () => {
    const refFor = (name: string): CompanySetupDocRef => ({
      path: `p/${name}`,
      filename: name,
      uploadedAt: '2026-08-22T10:00:00.000Z',
      extractedData: { fullName: name },
    });
    const rekeyed = rekeyDocumentsAfterRemove(
      {
        '0': { passport: refFor('a.pdf') },
        '1': { passport: refFor('b.pdf') },
        '2': { passport: refFor('c.pdf') },
      },
      1
    );
    expect(Object.keys(rekeyed).sort()).toEqual(['0', '1']);
    expect(extractedDataOf(rekeyed['1'].passport)).toEqual({ fullName: 'c.pdf' });
  });
});
