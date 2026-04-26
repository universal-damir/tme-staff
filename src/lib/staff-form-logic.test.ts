import { describe, it, expect } from 'vitest';
import {
  mergeStaffDocRefs,
  isPakistaniNationality,
  isDmccAuthority,
  visaDocumentRequirement,
  requiresArrivalDate,
  pluralizePeriod,
  normalizeProvidedFlag,
} from './staff-form-logic';
import type { StaffDocumentReferences } from '@/types';

describe('mergeStaffDocRefs', () => {
  it('preserves employer-uploaded job_offer_letter when employee saves', () => {
    const existing: StaffDocumentReferences = {
      job_offer_letter: { path: 'jol/path.pdf', filename: 'offer.pdf' },
    };
    const merged = mergeStaffDocRefs(existing, {
      photo: { path: 'photo/p.jpg', filename: 'p.jpg', validated: true, validation_errors: [] },
    });
    expect(merged.job_offer_letter).toEqual({ path: 'jol/path.pdf', filename: 'offer.pdf' });
    expect(merged.photo?.filename).toBe('p.jpg');
  });

  it('overrides existing keys with employee refs (e.g. re-uploaded photo)', () => {
    const existing: StaffDocumentReferences = {
      photo: { path: 'old/p.jpg', filename: 'old.jpg', validated: false, validation_errors: [] },
    };
    const merged = mergeStaffDocRefs(existing, {
      photo: { path: 'new/p.jpg', filename: 'new.jpg', validated: true, validation_errors: [] },
    });
    expect(merged.photo?.filename).toBe('new.jpg');
  });

  it('treats null existing as empty — only employee refs remain', () => {
    const merged = mergeStaffDocRefs(null, {
      visa_document: { path: 'visa/v.pdf', filename: 'v.pdf' },
    });
    expect(merged.visa_document?.filename).toBe('v.pdf');
    expect(merged.job_offer_letter).toBeUndefined();
  });

  it('treats undefined existing as empty', () => {
    const merged = mergeStaffDocRefs(undefined, {
      pakistan_id_front: { path: 'pk/f.jpg', filename: 'f.jpg' },
    });
    expect(merged.pakistan_id_front?.filename).toBe('f.jpg');
  });

  it('preserves all employer-side docs simultaneously', () => {
    const existing = {
      job_offer_letter: { path: 'jol.pdf', filename: 'jol.pdf' },
      existing_doc_a: { path: 'a', filename: 'a' },
      existing_doc_b: { path: 'b', filename: 'b' },
    } as unknown as StaffDocumentReferences;
    const merged = mergeStaffDocRefs(existing, {
      eid_front: { path: 'eid.jpg', filename: 'eid.jpg' },
    });
    expect(Object.keys(merged).sort()).toEqual(
      ['eid_front', 'existing_doc_a', 'existing_doc_b', 'job_offer_letter'].sort()
    );
  });
});

describe('isPakistaniNationality', () => {
  it('matches "Pakistani" exactly', () => {
    expect(isPakistaniNationality('Pakistani')).toBe(true);
  });

  it('matches "Pakistan" (country name form)', () => {
    expect(isPakistaniNationality('Pakistan')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isPakistaniNationality('pakistani')).toBe(true);
    expect(isPakistaniNationality('PAKISTAN')).toBe(true);
    expect(isPakistaniNationality('PaKiStAnI')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isPakistaniNationality('  Pakistani  ')).toBe(true);
  });

  it('returns false for other nationalities', () => {
    expect(isPakistaniNationality('Indian')).toBe(false);
    expect(isPakistaniNationality('British')).toBe(false);
    expect(isPakistaniNationality('German')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(isPakistaniNationality(null)).toBe(false);
    expect(isPakistaniNationality(undefined)).toBe(false);
    expect(isPakistaniNationality('')).toBe(false);
  });
});

describe('isDmccAuthority', () => {
  it('matches plain "DMCC"', () => {
    expect(isDmccAuthority('DMCC')).toBe(true);
  });

  it('matches full authority name', () => {
    expect(isDmccAuthority('DMCC Free Zone Authority')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDmccAuthority('dmcc')).toBe(true);
    expect(isDmccAuthority('Dubai Multi Commodities Centre (dmcc)')).toBe(true);
  });

  it('returns false for other authorities', () => {
    expect(isDmccAuthority('JAFZA')).toBe(false);
    expect(isDmccAuthority('DIFC')).toBe(false);
    expect(isDmccAuthority('Mainland DED')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(isDmccAuthority(null)).toBe(false);
    expect(isDmccAuthority(undefined)).toBe(false);
    expect(isDmccAuthority('')).toBe(false);
  });
});

describe('visaDocumentRequirement', () => {
  it('requires a document for tourist / employment / immigration / golden / dependent', () => {
    expect(visaDocumentRequirement('tourist_visa')).toBe('mandatory');
    expect(visaDocumentRequirement('employment_visa')).toBe('mandatory');
    expect(visaDocumentRequirement('immigration_cancellation')).toBe('mandatory');
    expect(visaDocumentRequirement('golden_visa')).toBe('mandatory');
    expect(visaDocumentRequirement('dependent_visa')).toBe('mandatory');
  });

  it('makes the document optional for "other"', () => {
    expect(visaDocumentRequirement('other')).toBe('optional');
  });

  it('skips document upload for visa_on_arrival (captured via arrival date)', () => {
    expect(visaDocumentRequirement('visa_on_arrival')).toBe('none');
  });

  it('returns "none" for undefined / null', () => {
    expect(visaDocumentRequirement(undefined)).toBe('none');
    expect(visaDocumentRequirement(null)).toBe('none');
  });
});

describe('requiresArrivalDate', () => {
  it('is true only for visa_on_arrival', () => {
    expect(requiresArrivalDate('visa_on_arrival')).toBe(true);
  });

  it('is false for every other category', () => {
    expect(requiresArrivalDate('tourist_visa')).toBe(false);
    expect(requiresArrivalDate('employment_visa')).toBe(false);
    expect(requiresArrivalDate('immigration_cancellation')).toBe(false);
    expect(requiresArrivalDate('golden_visa')).toBe(false);
    expect(requiresArrivalDate('dependent_visa')).toBe(false);
    expect(requiresArrivalDate('other')).toBe(false);
  });

  it('is false for undefined / null', () => {
    expect(requiresArrivalDate(undefined)).toBe(false);
    expect(requiresArrivalDate(null)).toBe(false);
  });
});

describe('pluralizePeriod', () => {
  it('uses singular for 1 across all units', () => {
    expect(pluralizePeriod(1, 'days')).toBe('day');
    expect(pluralizePeriod(1, 'weeks')).toBe('week');
    expect(pluralizePeriod(1, 'months')).toBe('month');
  });

  it('uses plural for any count != 1', () => {
    expect(pluralizePeriod(0, 'days')).toBe('days');
    expect(pluralizePeriod(2, 'weeks')).toBe('weeks');
    expect(pluralizePeriod(30, 'days')).toBe('days');
    expect(pluralizePeriod(6, 'months')).toBe('months');
  });

  it('defaults to "month(s)" when unit is missing or unknown', () => {
    expect(pluralizePeriod(2, undefined)).toBe('months');
    expect(pluralizePeriod(2, null)).toBe('months');
    expect(pluralizePeriod(2, 'years')).toBe('months');
  });

  it('falls back to plural for invalid values (NaN/missing)', () => {
    expect(pluralizePeriod(undefined, 'days')).toBe('days');
    expect(pluralizePeriod(null, 'months')).toBe('months');
    expect(pluralizePeriod(NaN, 'weeks')).toBe('weeks');
  });

  it('regression: "30 days" stays as "days" (not "months")', () => {
    // The original bug: contracts that say "30 days notice" were being
    // displayed as "30 months". With value=30 + unit='days' the helper must
    // return "days", proving the unit is honored.
    expect(pluralizePeriod(30, 'days')).toBe('days');
  });
});

describe('normalizeProvidedFlag', () => {
  it('passes through valid tri-state values', () => {
    expect(normalizeProvidedFlag('yes')).toBe('yes');
    expect(normalizeProvidedFlag('no')).toBe('no');
    expect(normalizeProvidedFlag('allowance')).toBe('allowance');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeProvidedFlag('YES')).toBe('yes');
    expect(normalizeProvidedFlag(' Allowance ')).toBe('allowance');
    expect(normalizeProvidedFlag('No')).toBe('no');
  });

  it('defaults to "no" for missing / null / undefined / empty', () => {
    // Per product spec: "if AI cannot find or contract is silent, leave No".
    expect(normalizeProvidedFlag(undefined)).toBe('no');
    expect(normalizeProvidedFlag(null)).toBe('no');
    expect(normalizeProvidedFlag('')).toBe('no');
  });

  it('defaults to "no" for unrecognized strings or non-strings', () => {
    expect(normalizeProvidedFlag('maybe')).toBe('no');
    expect(normalizeProvidedFlag('true')).toBe('no');
    expect(normalizeProvidedFlag(1)).toBe('no');
    expect(normalizeProvidedFlag(true)).toBe('no');
    expect(normalizeProvidedFlag({})).toBe('no');
  });
});
