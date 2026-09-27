import { describe, it, expect } from 'vitest';
import {
  validateCompanyName,
  COMPANY_NAME_RULES,
  NAME_ACTIVITY_RULE,
  activityKeywords,
  checkNameActivityFit,
  exampleNameFromActivities,
} from './company-setup-name-validation';
describe('checkNameActivityFit', () => {
  // Tester case: plant / agriculture activities.
  const PLANT_ACTIVITIES = [
    'Agricultural Research & Consultancy',
    'Flowers & Ornamental Plants Trading',
    'Artificial Flowers & Plants Trading',
  ];

  it.each([
    'Tina Agricultural Research & Consultancy',
    'Tinas Plants Trading',
    'Tinas Premium Plants Trading',
    'Tina Plants Trading and Consultants',
    'GreenThumb Trading',
    'Bloomfield Flowers',
  ])('keeps "%s"', (name) => {
    const fit = checkNameActivityFit(name, PLANT_ACTIVITIES);
    expect(fit.fits).toBe(true);
    expect(fit.unrelatedWords).toEqual([]);
    // Still passes the IFZA rules.
    expect(validateCompanyName(name).valid).toBe(true);
  });

  it('rejects "Tina Design Studio" (no activity word, unrelated business words)', () => {
    const fit = checkNameActivityFit('Tina Design Studio', PLANT_ACTIVITIES);
    expect(fit.fits).toBe(false);
    expect(fit.hasActivityWord).toBe(false);
    expect(fit.unrelatedWords).toEqual(['Design', 'Studio']);
  });

  it('rejects an activity name that adds an unrelated word ("Advisory")', () => {
    const fit = checkNameActivityFit('Verdant Plants Advisory', PLANT_ACTIVITIES);
    expect(fit.hasActivityWord).toBe(true);
    expect(fit.fits).toBe(false);
    expect(fit.unrelatedWords).toEqual(['Advisory']);
  });

  it('rejects a name with only brand and neutral words', () => {
    expect(checkNameActivityFit('Tina Global Group', PLANT_ACTIVITIES).fits).toBe(false);
  });

  it('does not allow "Trading" when no activity is trading', () => {
    const fit = checkNameActivityFit('Fermion Trading', ['Management Consultancy']);
    expect(fit.fits).toBe(false);
    expect(fit.unrelatedWords).toEqual(['Trading']);
    expect(checkNameActivityFit('Fermion Consulting', ['Management Consultancy']).fits).toBe(true);
  });

  it('fits anything when there is no activity text', () => {
    expect(checkNameActivityFit('Tina Design Studio', []).fits).toBe(true);
  });

  it('exposes the keywords of the activity wording', () => {
    expect(activityKeywords(['Flowers & Ornamental Plants Trading'])).toEqual([
      'flowers',
      'ornamental',
      'plants',
      'trading',
    ]);
  });

  it('the rule text is part of the visible checklist', () => {
    expect(COMPANY_NAME_RULES).toContain(NAME_ACTIVITY_RULE);
  });
});

describe('exampleNameFromActivities', () => {
  it('builds a short example from the first activity', () => {
    expect(exampleNameFromActivities(['Agricultural Research & Consultancy'])).toBe(
      'Horizon Agricultural Research & Consultancy'
    );
    expect(
      exampleNameFromActivities(['Management Consultancy Services, Business Advisory'])
    ).toBe('Horizon Management Consultancy Services');
  });

  it('returns null when there is no activity', () => {
    expect(exampleNameFromActivities(['', '  '])).toBeNull();
  });
});
