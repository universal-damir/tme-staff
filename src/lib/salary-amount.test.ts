import { describe, it, expect } from 'vitest';
import {
  formatSalaryAmount,
  parseSalaryAmount,
  formatSalaryAmountInput,
  applySalaryInput,
  roundSalaryAmount,
} from './salary-amount';

describe('formatSalaryAmount (display)', () => {
  it('formats whole numbers with thousand separators', () => {
    expect(formatSalaryAmount(4250)).toBe('4,250');
    expect(formatSalaryAmount(1000000)).toBe('1,000,000');
  });

  it('keeps up to 2 decimals without forcing trailing zeros', () => {
    expect(formatSalaryAmount(4250.75)).toBe('4,250.75');
    expect(formatSalaryAmount(4250.5)).toBe('4,250.5');
    expect(formatSalaryAmount(100.1)).toBe('100.1');
  });

  it('returns empty string for nullish / NaN', () => {
    expect(formatSalaryAmount(undefined)).toBe('');
    expect(formatSalaryAmount(null)).toBe('');
    expect(formatSalaryAmount(NaN)).toBe('');
  });
});

describe('parseSalaryAmount', () => {
  it('parses decimals via parseFloat (not parseInt)', () => {
    expect(parseSalaryAmount('100.75')).toBe(100.75);
    expect(parseSalaryAmount('100.5')).toBe(100.5);
  });

  it('strips commas', () => {
    expect(parseSalaryAmount('1,234.56')).toBe(1234.56);
  });

  it('treats a trailing dot as the integer value', () => {
    expect(parseSalaryAmount('100.')).toBe(100);
  });

  it('returns undefined for empty / dot-only input', () => {
    expect(parseSalaryAmount('')).toBeUndefined();
    expect(parseSalaryAmount('   ')).toBeUndefined();
    expect(parseSalaryAmount('.')).toBeUndefined();
  });
});

describe('formatSalaryAmountInput (live typing)', () => {
  it('preserves a trailing decimal point so it can be typed', () => {
    expect(formatSalaryAmountInput('100.')).toBe('100.');
  });

  it('preserves a trailing zero in the decimals', () => {
    expect(formatSalaryAmountInput('100.50')).toBe('100.50');
    expect(formatSalaryAmountInput('100.0')).toBe('100.0');
  });

  it('caps decimals at two digits', () => {
    expect(formatSalaryAmountInput('100.555')).toBe('100.55');
  });

  it('adds thousand separators to the integer part', () => {
    expect(formatSalaryAmountInput('1234')).toBe('1,234');
    expect(formatSalaryAmountInput('1234.5')).toBe('1,234.5');
  });

  it('collapses extra decimal points to the first one', () => {
    expect(formatSalaryAmountInput('1.2.3')).toBe('1.23');
  });

  it('drops non-numeric characters', () => {
    expect(formatSalaryAmountInput('abc100.5x')).toBe('100.5');
  });

  it('returns empty string for empty input', () => {
    expect(formatSalaryAmountInput('')).toBe('');
  });
});

describe('applySalaryInput', () => {
  it('keeps display and emitted value in agreement when capping decimals', () => {
    const { display, value } = applySalaryInput('100.555');
    expect(display).toBe('100.55');
    expect(value).toBe(100.55);
  });

  it('emits the integer value while preserving the trailing dot in display', () => {
    const { display, value } = applySalaryInput('100.');
    expect(display).toBe('100.');
    expect(value).toBe(100);
  });

  it('handles thousand-separated decimal input', () => {
    const { display, value } = applySalaryInput('1,234.56');
    expect(display).toBe('1,234.56');
    expect(value).toBe(1234.56);
  });

  it('returns undefined value for empty input', () => {
    expect(applySalaryInput('').value).toBeUndefined();
  });
});

describe('roundSalaryAmount', () => {
  it('rounds float-sum artifacts to 2 decimals', () => {
    expect(roundSalaryAmount(0.1 + 0.2)).toBe(0.3);
    expect(roundSalaryAmount(4250.755)).toBe(4250.76);
    expect(roundSalaryAmount(100)).toBe(100);
  });
});
