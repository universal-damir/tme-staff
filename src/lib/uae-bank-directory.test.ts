import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  UAE_BANK_DIRECTORY,
  bankCodeFromRouting,
  ibanBankCode,
  routingIbanBankMismatch,
  getBankNameOptions,
  findBanksByName,
  INTERNATIONAL_BANK_LABEL,
} from './uae-bank-directory';

/**
 * Cross-repo dedup tripwire.
 *
 * This bank map is duplicated, byte-for-byte in its data rows, in tme-portal at
 * `src/lib/clients-v2/uae-bank-directory.ts`. There is no shared package (the
 * portal is air-gapped from Netlify), so the only guard against the two copies
 * silently drifting is this hash lock — the identical test lives in tme-portal.
 *
 * If this test fails you changed the bank directory. To re-sync:
 *   1. Make the SAME edit in tme-portal's copy.
 *   2. Run this test in both repos to get the new hash.
 *   3. Update EXPECTED_DIRECTORY_SHA256 in BOTH repos to the new value.
 */
const EXPECTED_DIRECTORY_SHA256 =
  '9b330a5938eb1bdbbc930aa1079c28a71ab85ae245e7c689540e5f2f878c28eb';
const EXPECTED_DIRECTORY_SIZE = 107;

describe('UAE_BANK_DIRECTORY cross-repo sync tripwire', () => {
  it('matches the canonical map shared with tme-portal', () => {
    const serialized = JSON.stringify([...UAE_BANK_DIRECTORY.entries()]);
    const hash = createHash('sha256').update(serialized).digest('hex');
    expect(UAE_BANK_DIRECTORY.size).toBe(EXPECTED_DIRECTORY_SIZE);
    expect(hash).toBe(EXPECTED_DIRECTORY_SHA256);
  });
});

describe('bankCodeFromRouting', () => {
  it('returns the bank digits (positions 2-4) of a 9-digit routing code', () => {
    // Abu Dhabi Commercial Bank routing 600310101 -> bank code 003
    expect(bankCodeFromRouting('600310101')).toBe('003');
    // Emirates NBD routing 202620103 -> 026
    expect(bankCodeFromRouting('202620103')).toBe('026');
  });

  it('ignores non-digits and rejects wrong-length codes', () => {
    expect(bankCodeFromRouting('600-310-101')).toBe('003');
    expect(bankCodeFromRouting('12345')).toBeNull();
    expect(bankCodeFromRouting('')).toBeNull();
    expect(bankCodeFromRouting(null)).toBeNull();
    expect(bankCodeFromRouting(undefined)).toBeNull();
  });
});

describe('ibanBankCode', () => {
  it('extracts the 3-digit bank code from a UAE IBAN', () => {
    // AE + 2 check + 003 (ADCB) + 16 account
    expect(ibanBankCode('AE07 0331 2345 6789 0123 456')).toBe('033');
    expect(ibanBankCode('AE070030001234567890123')).toBe('003');
  });

  it('returns null for non-UAE / invalid IBANs', () => {
    expect(ibanBankCode('DE89370400440532013000')).toBeNull();
    expect(ibanBankCode('')).toBeNull();
    expect(ibanBankCode(null)).toBeNull();
  });
});

describe('routingIbanBankMismatch', () => {
  it('flags a routing code whose bank differs from the IBAN bank', () => {
    // routing for ADCB (003) against an Emirates NBD IBAN (026)
    expect(routingIbanBankMismatch('600310101', 'AE070260001234567890123')).toBe(true);
  });

  it('passes when routing and IBAN are the same bank (branch-tolerant)', () => {
    // Same bank (003), different branch digit in routing -> still a match
    expect(routingIbanBankMismatch('600310101', 'AE070030001234567890123')).toBe(false);
    expect(routingIbanBankMismatch('900310999', 'AE070030001234567890123')).toBe(false);
  });

  it('does not flag when either side is missing or non-UAE', () => {
    expect(routingIbanBankMismatch('', 'AE070030001234567890123')).toBe(false);
    expect(routingIbanBankMismatch('600310101', '')).toBe(false);
    // International IBAN -> ibanBankCode null -> never a "mismatch" here
    expect(routingIbanBankMismatch('600310101', 'DE89370400440532013000')).toBe(false);
  });
});

describe('getBankNameOptions', () => {
  const options = getBankNameOptions();

  it('lists the international fallback exactly once, as the last option', () => {
    const intl = options.filter((o) => o.value === INTERNATIONAL_BANK_LABEL);
    expect(intl).toHaveLength(1);
    expect(options[options.length - 1].value).toBe(INTERNATIONAL_BANK_LABEL);
  });

  it('de-duplicates bank names that span multiple entity codes', () => {
    const names = options.map((o) => o.value);
    expect(new Set(names).size).toBe(names.length);
  });

  it('sorts banks alphabetically before exchange houses', () => {
    const withoutIntl = options.filter((o) => o.value !== INTERNATIONAL_BANK_LABEL);
    expect(withoutIntl.length).toBeGreaterThan(0);
  });
});

describe('findBanksByName', () => {
  it('returns the matching directory entries for a bank name', () => {
    const adcb = findBanksByName('Abu Dhabi Commercial Bank');
    expect(adcb.length).toBeGreaterThanOrEqual(1);
    expect(adcb[0].routingCode).toBe('600310101');
  });

  it('returns an empty array for an unknown name', () => {
    expect(findBanksByName('Not A Real Bank')).toEqual([]);
  });
});
