import { describe, it, expect } from 'vitest';
import { CORPORATE_KYC_SCHEMA, INDIVIDUAL_KYC_SCHEMA, emptyCorporateKyc, emptyIndividualKyc } from '@/types/ekyc';
import { validateEkycData } from './ekyc-form';
import {
  CORPORATE_STEPS,
  INDIVIDUAL_STEPS,
  EKYC_GROUP_ROWS,
  ekycErrorsForStep,
  ekycFirstIncompleteStep,
  ekycSortErrors,
  ekycStepIndexOfPath,
  ekycStepsFor,
} from './ekyc-steps';

describe('eKYC steps', () => {
  for (const [name, schema, steps] of [
    ['corporate', CORPORATE_KYC_SCHEMA, CORPORATE_STEPS],
    ['individual', INDIVIDUAL_KYC_SCHEMA, INDIVIDUAL_STEPS],
  ] as const) {
    it(`${name}: every schema field and group sits in exactly one step, and steps name nothing else`, () => {
      const known = [...schema.fields.map((f) => f.id), ...schema.groups.map((g) => g.id)];
      const placed = steps.flatMap((s) => s.items);
      for (const id of known) {
        expect(placed.filter((p) => p === id), id).toHaveLength(1);
      }
      for (const id of placed) expect(known, id).toContain(id);
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    });
  }

  it('the uploads have a step on the individual form only', () => {
    expect(INDIVIDUAL_STEPS.filter((s) => s.documents)).toHaveLength(1);
    expect(CORPORATE_STEPS.some((s) => s.documents)).toBe(false);
    expect(ekycStepsFor('corporate')).toBe(CORPORATE_STEPS);
  });

  it('maps a field, row or upload path to its step', () => {
    const idx = (id: string) => CORPORATE_STEPS.findIndex((s) => s.id === id);
    expect(ekycStepIndexOfPath(CORPORATE_STEPS, 'entityType')).toBe(idx('company'));
    expect(ekycStepIndexOfPath(CORPORATE_STEPS, 'licenses.2.expiryDate')).toBe(idx('licenses'));
    expect(ekycStepIndexOfPath(CORPORATE_STEPS, 'ubos')).toBe(idx('ubos'));
    expect(ekycStepIndexOfPath(CORPORATE_STEPS, 'questionnaire.q23')).toBe(idx('questionnaire'));
    expect(ekycStepIndexOfPath(CORPORATE_STEPS, 'declaration.signature')).toBe(idx('declaration'));
    expect(ekycStepIndexOfPath(INDIVIDUAL_STEPS, 'uaeAddress.street')).toBe(INDIVIDUAL_STEPS.findIndex((s) => s.id === 'address'));
    expect(ekycStepIndexOfPath(INDIVIDUAL_STEPS, 'documents.passport')).toBe(INDIVIDUAL_STEPS.findIndex((s) => s.documents));
    expect(ekycStepIndexOfPath(CORPORATE_STEPS, 'nothing')).toBe(-1);
  });

  it('step validation is the contract validator filtered to the step', () => {
    const errors = validateEkycData('corporate', emptyCorporateKyc(), {});
    const company = ekycErrorsForStep(CORPORATE_STEPS, 0, errors).map((e) => e.fieldId);
    expect(company).toContain('entityType');
    expect(company).not.toContain('licenses.0.licenseNumber');
    expect(company.every((id) => CORPORATE_STEPS[0].items.includes(id))).toBe(true);
    // Every error lands in some step.
    const total = CORPORATE_STEPS.reduce((n, _, i) => n + ekycErrorsForStep(CORPORATE_STEPS, i, errors).length, 0);
    expect(total).toBe(errors.length);

    const indErrors = validateEkycData('individual', emptyIndividualKyc(), {});
    const indTotal = INDIVIDUAL_STEPS.reduce((n, _, i) => n + ekycErrorsForStep(INDIVIDUAL_STEPS, i, indErrors).length, 0);
    expect(indTotal).toBe(indErrors.length);
    expect(indErrors.some((e) => e.fieldId === 'documents.passport')).toBe(true);
  });

  it('first incomplete step: the earliest step with a problem, or Check your answers', () => {
    const errors = validateEkycData('corporate', emptyCorporateKyc(), {});
    expect(ekycFirstIncompleteStep(CORPORATE_STEPS, errors)).toBe(0);
    expect(ekycFirstIncompleteStep(CORPORATE_STEPS, errors.filter((e) => e.fieldId.startsWith('ubos')))).toBe(
      CORPORATE_STEPS.findIndex((s) => s.id === 'ubos')
    );
    expect(ekycFirstIncompleteStep(CORPORATE_STEPS, [])).toBe(CORPORATE_STEPS.length);
  });

  for (const [name, schema, steps] of [
    ['corporate', CORPORATE_KYC_SCHEMA, CORPORATE_STEPS],
    ['individual', INDIVIDUAL_KYC_SCHEMA, INDIVIDUAL_STEPS],
  ] as const) {
    it(`${name}: the rows hold every field once, a row has at most 3, and items are the rows flat`, () => {
      for (const s of steps) {
        expect(s.items).toEqual(s.rows.flat());
        for (const row of s.rows) {
          expect(row.length, `${s.id}: ${row.join(',')}`).toBeGreaterThan(0);
          expect(row.length).toBeLessThanOrEqual(3);
          // A group or a Yes / No question always has the row to itself.
          if (row.length > 1) {
            for (const id of row) {
              expect(schema.groups.some((g) => g.id === id), id).toBe(false);
              expect(schema.fields.find((f) => f.id === id)?.kind, id).not.toBe('yesno');
            }
          }
        }
      }
      for (const group of schema.groups) {
        const rows = EKYC_GROUP_ROWS[group.id];
        expect(rows, group.id).toBeDefined();
        const placed = rows.flat();
        for (const f of group.fields) expect(placed.filter((p) => p === f.id), `${group.id}.${f.id}`).toHaveLength(1);
        expect(placed).toHaveLength(group.fields.length);
      }
    });
  }

  it('company step: Type of Entity sits beside Mainland or Freezone; Mode of payment comes last', () => {
    const company = CORPORATE_STEPS[0];
    expect(company.rows).toContainEqual(['entityType', 'entityZone']);
    expect(company.rows).toContainEqual(['countryOfIncorporation', 'incorporationDate']);
    expect(company.items[company.items.length - 1]).toBe('modeOfPayment');
    expect(EKYC_GROUP_ROWS.licenses[0]).toEqual(['licenseNumber', 'issueDate', 'expiryDate']);
  });

  it('sorts errors in the order the client meets them', () => {
    const e = (fieldId: string) => ({ fieldId, message: { en: 'x', de: 'x' } });
    const sorted = ekycSortErrors(CORPORATE_STEPS, [
      e('declaration.signature'),
      e('ubos.0.nationality'),
      e('licenses.1.licenseNumber'),
      e('ubos'),
      e('licenses.0.expiryDate'),
      e('modeOfPayment'),
      e('licenses.0.issueDate'),
      e('entityZone'),
      e('companyName'),
      e('nothing'),
    ]).map((x) => x.fieldId);
    expect(sorted).toEqual([
      'companyName',
      'entityZone',
      'modeOfPayment',
      'licenses.0.issueDate',
      'licenses.0.expiryDate',
      'licenses.1.licenseNumber',
      'ubos',
      'ubos.0.nationality',
      'declaration.signature',
      'nothing',
    ]);
    // The contract validator's own list comes out in step order.
    const all = ekycSortErrors(CORPORATE_STEPS, validateEkycData('corporate', emptyCorporateKyc(), {}));
    const stepOf = all.map((x) => ekycStepIndexOfPath(CORPORATE_STEPS, x.fieldId));
    expect([...stepOf].sort((a, b) => a - b)).toEqual(stepOf);
    const ind = ekycSortErrors(INDIVIDUAL_STEPS, validateEkycData('individual', emptyIndividualKyc(), {})).map((x) => x.fieldId);
    expect(ind.indexOf('documents.passport')).toBeGreaterThan(ind.indexOf('fullName'));
  });
});
