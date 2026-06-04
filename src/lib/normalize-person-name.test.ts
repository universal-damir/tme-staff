import { describe, it, expect } from 'vitest';
import { normalizePersonName, calculateFullName } from './utils';

describe('normalizePersonName', () => {
  it('re-cases ALL-CAPS and all-lowercase names to Title Case', () => {
    expect(normalizePersonName('ANITTA DAVIS')).toBe('Anitta Davis');
    expect(normalizePersonName('anitta davis')).toBe('Anitta Davis');
    expect(normalizePersonName('SHAKKIL IJAZ SYED MOHAMMED')).toBe('Shakkil Ijaz Syed Mohammed');
  });

  it('collapses accidental whitespace', () => {
    expect(normalizePersonName('ANITTA  DAVIS')).toBe('Anitta Davis');
    expect(normalizePersonName('  ANITTA   DAVIS  ')).toBe('Anitta Davis');
  });

  it('preserves within-word mixed case', () => {
    expect(normalizePersonName('McDonald')).toBe('McDonald');
    expect(normalizePersonName('al-Rashid')).toBe('al-Rashid');
    expect(normalizePersonName('John McDonald')).toBe('John McDonald');
  });

  it('Title-Cases space-separated particles (UAE/Arabic rendering)', () => {
    expect(normalizePersonName('AHMED AL FALASI')).toBe('Ahmed Al Falasi');
  });

  it('capitalizes after hyphen / apostrophe / dot', () => {
    expect(normalizePersonName("o'brien")).toBe("O'Brien");
    expect(normalizePersonName('ABDUL-RAHMAN')).toBe('Abdul-Rahman');
  });

  it('handles empty / nullish input', () => {
    expect(normalizePersonName('')).toBe('');
    expect(normalizePersonName(undefined)).toBe('');
    expect(normalizePersonName(null)).toBe('');
  });
});

describe('calculateFullName', () => {
  it('collapses the double space caused by a trailing space in the first name', () => {
    // This is what produced the real "ANITTA  DAVIS" full name.
    expect(calculateFullName('ANITTA ', '', 'DAVIS')).toBe('ANITTA DAVIS');
  });

  it('joins first/middle/last and drops an empty middle name', () => {
    expect(calculateFullName('Anitta', '', 'Davis')).toBe('Anitta Davis');
    expect(calculateFullName('Anitta', 'Mary', 'Davis')).toBe('Anitta Mary Davis');
  });
});
