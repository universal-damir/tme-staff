import { describe, it, expect } from 'vitest';
import {
  describeRoleVariant,
  normaliseName,
  pickSubmittedAnswers,
  roleVariant,
  sharedRoles,
  validateAnswers,
} from './supplier-policy-validation';
import type { SvpPolicyAnswers } from '@/types/supplier-policy';

const ali = { name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' };
const sara = { name: 'Sara Lee', position: 'Accountant', email: '' };
const omar = { name: 'Omar Said', position: 'Director', email: 'omar@example.com' };

function answers(over: Partial<SvpPolicyAnswers> = {}): SvpPolicyAnswers {
  return {
    implementer: sara,
    reviewer: ali,
    supervisor: omar,
    recordsLocation: '',
    recordsLocationIsRegisteredOffice: true,
    priceAgreed: true,
    ...over,
  };
}

describe('role variant (mirror of the portal role-variant.ts)', () => {
  it('three different people', () => {
    expect(roleVariant(answers())).toBe('three');
    expect(sharedRoles(answers())).toEqual([]);
  });

  it('one person in two roles, ignoring case, spaces and dots', () => {
    const a = answers({ supervisor: { ...ali, name: '  ali   KHAN. ' } });
    expect(roleVariant(a)).toBe('two');
    expect(sharedRoles(a)).toEqual(['reviewer', 'supervisor']);
    expect(describeRoleVariant('two')).toBe('One person holds two roles');
  });

  it('one person in all three roles', () => {
    expect(roleVariant(answers({ implementer: ali, reviewer: ali, supervisor: ali }))).toBe('one');
  });

  it('empty names never merge two roles', () => {
    const empty = { name: '', position: '', email: '' };
    expect(roleVariant(answers({ implementer: empty, reviewer: empty }))).toBe('three');
  });

  it('normaliseName', () => {
    expect(normaliseName(' Ali,  Khan ')).toBe('ali khan');
    expect(normaliseName(null)).toBe('');
  });
});

describe('validateAnswers', () => {
  it('accepts a complete set', () => {
    expect(validateAnswers(answers(), { requirePriceAgreed: true })).toEqual([]);
  });

  it('reports missing names, positions and the Supervisor email', () => {
    const errors = validateAnswers({
      implementer: { name: '', position: '', email: '' },
      reviewer: ali,
      supervisor: { name: 'Omar', position: 'Director', email: '' },
      recordsLocationIsRegisteredOffice: true,
    });
    expect(errors).toContain('Implementer: the name is missing.');
    expect(errors).toContain('Implementer: the position is missing.');
    expect(errors).toContain('Supervisor: the email is missing. The Supervisor signs the policy.');
  });

  it('rejects a bad email and non-English letters', () => {
    const errors = validateAnswers(
      answers({ reviewer: { name: 'Müller', position: 'Manager', email: 'not-an-email' } })
    );
    expect(errors).toContain('Reviewer: the name must use English letters only (A to Z).');
    expect(errors).toContain('Reviewer: the email address is not valid.');
  });

  it('needs a records location when not at the registered office', () => {
    expect(validateAnswers(answers({ recordsLocationIsRegisteredOffice: false }))).toContain(
      'Records location: say where the supplier records are kept.'
    );
    expect(
      validateAnswers(answers({ recordsLocationIsRegisteredOffice: false, recordsLocation: 'Warehouse, Al Quoz' }))
    ).toEqual([]);
  });

  it('enforces the length limits', () => {
    expect(validateAnswers(answers({ note: 'x'.repeat(1001) }))).toContain('Note: longer than 1000 characters.');
  });

  it('asks for the price box only when required', () => {
    const a = { ...answers(), priceAgreed: false } as unknown as SvpPolicyAnswers;
    expect(validateAnswers(a)).toEqual([]);
    expect(validateAnswers(a, { requirePriceAgreed: true })).toEqual([
      'Price: please tick the box to agree to the price.',
    ]);
  });

  it('never throws on junk', () => {
    expect(validateAnswers(null).length).toBeGreaterThan(0);
    expect(validateAnswers({} as Partial<SvpPolicyAnswers>).length).toBeGreaterThan(0);
  });
});

describe('pickSubmittedAnswers', () => {
  it('keeps only known fields and trims them', () => {
    const picked = pickSubmittedAnswers({
      implementer: { name: ' Sara Lee ', position: 'Accountant', email: '', extra: 'x' },
      reviewer: ali,
      supervisor: omar,
      recordsLocationIsRegisteredOffice: false,
      recordsLocation: '  Warehouse ',
      priceAgreed: true,
      note: '  ',
      client_id: 999,
      status: 'synced',
    });
    expect(picked).toEqual({
      implementer: { name: 'Sara Lee', position: 'Accountant', email: '' },
      reviewer: ali,
      supervisor: omar,
      recordsLocationIsRegisteredOffice: false,
      recordsLocation: 'Warehouse',
      priceAgreed: true,
      dutyAcknowledged: false,
    });
  });

  it('drops the free text when the records are at the registered office', () => {
    const picked = pickSubmittedAnswers({ recordsLocationIsRegisteredOffice: true, recordsLocation: 'x' });
    expect(picked.recordsLocation).toBe('');
  });

  it('treats anything but literal true as not agreed', () => {
    expect(pickSubmittedAnswers({ priceAgreed: 'true' }).priceAgreed).toBe(false);
    expect(pickSubmittedAnswers(null).priceAgreed).toBe(false);
    expect(pickSubmittedAnswers({ dutyAcknowledged: 'true' }).dutyAcknowledged).toBe(false);
    expect(pickSubmittedAnswers({ dutyAcknowledged: true }).dutyAcknowledged).toBe(true);
  });
});
