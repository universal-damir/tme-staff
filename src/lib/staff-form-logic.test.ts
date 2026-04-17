import { describe, it, expect } from 'vitest';
import {
  mergeStaffDocRefs,
  isPakistaniNationality,
  isDmccAuthority,
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
