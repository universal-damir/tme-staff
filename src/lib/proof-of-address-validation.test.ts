import { describe, it, expect } from 'vitest';
import {
  ageInDays,
  judgeProofOfAddress,
  normaliseForCompare,
  tokenOverlap,
  type ProofOfAddressObservations,
} from './proof-of-address-validation';

const NOW = new Date('2026-08-31T12:00:00.000Z');

function observations(
  overrides: Partial<ProofOfAddressObservations> = {}
): ProofOfAddressObservations {
  return {
    is_bank_statement: true,
    bank_name: 'Deutsche Bank',
    statement_date: '2026-08-01',
    account_holder_name: 'John Michael Doe',
    address_on_document: 'Hauptstrasse 12, 80331 Munich, Germany',
    observation: 'A bank statement with transactions and a closing balance.',
    ...overrides,
  };
}

describe('normaliseForCompare', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normaliseForCompare('  Haupt-Strasse 12,   MÜNCHEN! ')).toBe('haupt strasse 12 münchen');
  });
});

describe('tokenOverlap', () => {
  it('measures the share of expected tokens present', () => {
    expect(tokenOverlap('John Michael Doe', 'MR JOHN M DOE')).toBeCloseTo(2 / 3);
    expect(tokenOverlap('John Doe', 'John Doe')).toBe(1);
    expect(tokenOverlap('John Doe', 'Aisha Khan')).toBe(0);
  });

  it('returns null when there is nothing to compare', () => {
    expect(tokenOverlap('', 'John Doe')).toBeNull();
    expect(tokenOverlap('John Doe', '')).toBeNull();
  });
});

describe('ageInDays', () => {
  it('counts whole days back from today', () => {
    expect(ageInDays('2026-08-01', NOW)).toBe(30);
    expect(ageInDays('2026-08-31', NOW)).toBe(0);
  });

  it('rejects anything that is not a real ISO date', () => {
    expect(ageInDays('', NOW)).toBeNull();
    expect(ageInDays('01.08.2026', NOW)).toBeNull();
    expect(ageInDays('2026-02-30', NOW)).toBeNull();
  });
});

describe('judgeProofOfAddress', () => {
  const expected = {
    name: 'John Michael Doe',
    address: 'Hauptstrasse 12, 80331 Munich, Germany',
  };

  it('accepts a recent statement matching the name and address', () => {
    const result = judgeProofOfAddress(observations(), expected, NOW);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('rejects anything that is not a bank statement', () => {
    const result = judgeProofOfAddress(
      observations({ is_bank_statement: false }),
      expected,
      NOW
    );
    expect(result.valid).toBe(false);
    expect(result.warnings[0]).toMatch(/not look like a bank statement/);
  });

  it('warns about a statement older than three months', () => {
    const result = judgeProofOfAddress(
      observations({ statement_date: '2026-01-15' }),
      expected,
      NOW
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('more than 3 months old'))).toBe(true);
  });

  it('warns when no statement date could be read', () => {
    const result = judgeProofOfAddress(observations({ statement_date: '' }), expected, NOW);
    expect(result.warnings.some((w) => w.includes('could not read a statement date'))).toBe(true);
  });

  it('warns when the account holder is somebody else', () => {
    const result = judgeProofOfAddress(
      observations({ account_holder_name: 'Aisha Fatima Khan' }),
      expected,
      NOW
    );
    expect(result.warnings.some((w) => w.includes('does not clearly match the name'))).toBe(true);
  });

  it('warns when the address is a different one', () => {
    const result = judgeProofOfAddress(
      observations({ address_on_document: 'Flat 9, Marina Walk, Dubai, United Arab Emirates' }),
      expected,
      NOW
    );
    expect(result.warnings.some((w) => w.includes('address on this statement'))).toBe(true);
  });

  it('does not compare what the client never entered', () => {
    const result = judgeProofOfAddress(
      observations({ account_holder_name: '', address_on_document: '' }),
      {},
      NOW
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
