import { describe, it, expect } from 'vitest';
import {
  mergeStaffDocRefs,
  isPakistaniNationality,
  isDmccAuthority,
  isDetAuthority,
  visaDocumentRequirement,
  requiresArrivalDate,
  pluralizePeriod,
  normalizeProvidedFlag,
  MANUAL_REVIEW_THRESHOLD,
  shouldOfferManualReview,
  buildManualReviewPageRef,
  sponsorDocsRequired,
  requiresSponsorNoc,
  employeeVisaMandatoryOverride,
  sponsorshipTypeFromSponsor,
  relationshipOptionsForSponsor,
  initialIsInUae,
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

  it('preserves a needsReview flag on passportPages when employee saves unrelated keys', () => {
    // Regression for the manual-review fallback: when the employee submits a
    // cover via the manual-review path (needsReview=true) and then later saves
    // other fields without re-passing passportPages, the flag must survive
    // through merge so the portal sync still sees it.
    const existing: StaffDocumentReferences = {
      passportPages: {
        cover: { path: 'cover.jpg', filename: 'cover.jpg', validated: true, needsReview: true },
      },
    };
    const merged = mergeStaffDocRefs(existing, {
      eid_front: { path: 'eid.jpg', filename: 'eid.jpg' },
    });
    expect(merged.passportPages?.cover?.needsReview).toBe(true);
  });

  it('preserves a needsReview flag on the side not being overwritten', () => {
    // Employee submits cover via manual-review (needsReview=true), then later
    // saves only insidePages — passportPages gets shallow-replaced, so this
    // documents the boundary: callers that touch passportPages must spread
    // the existing dict if they want the cover flag to survive.
    const existing: StaffDocumentReferences = {
      passportPages: {
        cover: { path: 'cover.jpg', filename: 'cover.jpg', validated: true, needsReview: true },
      },
    };
    const merged = mergeStaffDocRefs(existing, {
      passportPages: {
        ...existing.passportPages,
        insidePages: { path: 'inside.jpg', filename: 'inside.jpg', validated: true },
      },
    });
    expect(merged.passportPages?.cover?.needsReview).toBe(true);
    expect(merged.passportPages?.insidePages?.validated).toBe(true);
  });
});

describe('shouldOfferManualReview', () => {
  it('threshold is 2 — fewer rejections must hide the affordance', () => {
    expect(MANUAL_REVIEW_THRESHOLD).toBe(2);
    expect(shouldOfferManualReview(0)).toBe(false);
    expect(shouldOfferManualReview(1)).toBe(false);
  });

  it('shows the affordance once the rejection count hits the threshold', () => {
    expect(shouldOfferManualReview(2)).toBe(true);
    expect(shouldOfferManualReview(3)).toBe(true);
    expect(shouldOfferManualReview(99)).toBe(true);
  });
});

describe('buildManualReviewPageRef', () => {
  it('always stamps validated=true and needsReview=true', () => {
    const ref = buildManualReviewPageRef({ path: 'p/x.jpg', filename: 'x.jpg' });
    expect(ref.validated).toBe(true);
    expect(ref.needsReview).toBe(true);
  });

  it('passes path and filename through unchanged', () => {
    const ref = buildManualReviewPageRef({ path: 'staff/123/cover.jpg', filename: 'cover.jpg' });
    expect(ref.path).toBe('staff/123/cover.jpg');
    expect(ref.filename).toBe('cover.jpg');
  });

  it('does not include extracted_data — manual-review path means user types passport details by hand', () => {
    const ref = buildManualReviewPageRef({ path: 'p', filename: 'f' });
    expect(ref.extracted_data).toBeUndefined();
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

describe('isDetAuthority', () => {
  it('matches plain "DET"', () => {
    expect(isDetAuthority('DET')).toBe(true);
  });

  it('matches the short form passed by the portal (getShortAuthorityName)', () => {
    // Portal sends e.g. "DET" from "DXB DET (Dubai Economy & Tourism)".
    expect(isDetAuthority('DET')).toBe(true);
  });

  it('matches full authority name with parens', () => {
    expect(isDetAuthority('DET (Dubai Economy & Tourism)')).toBe(true);
    expect(isDetAuthority('Department of Economy and Tourism (DET)')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDetAuthority('det')).toBe(true);
    expect(isDetAuthority('Det')).toBe(true);
  });

  it('does not match substrings inside unrelated words', () => {
    // Regression: substring match would falsely flag "DETAILED" / "Cadet" / "DETROIT".
    expect(isDetAuthority('DETAILED AUTHORITY')).toBe(false);
    expect(isDetAuthority('Cadet Free Zone')).toBe(false);
  });

  it('returns false for other authorities', () => {
    expect(isDetAuthority('DMCC')).toBe(false);
    expect(isDetAuthority('IFZA')).toBe(false);
    expect(isDetAuthority('DIFC')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(isDetAuthority(null)).toBe(false);
    expect(isDetAuthority(undefined)).toBe(false);
    expect(isDetAuthority('')).toBe(false);
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

describe('sponsorDocsRequired', () => {
  it('is true only for family-sponsored staff', () => {
    expect(sponsorDocsRequired('family')).toBe(true);
  });

  it('is false for company- and self/GCC-sponsored staff', () => {
    expect(sponsorDocsRequired('company')).toBe(false);
    expect(sponsorDocsRequired('self_gcc')).toBe(false);
  });

  it('is false for undefined / null (defaults to no sponsor step)', () => {
    expect(sponsorDocsRequired(undefined)).toBe(false);
    expect(sponsorDocsRequired(null)).toBe(false);
  });
});

describe('requiresSponsorNoc', () => {
  it('requires the NOC for family-sponsored on BOTH new_hire and renewal', () => {
    expect(requiresSponsorNoc('family', 'new_hire')).toBe(true);
    expect(requiresSponsorNoc('family', 'renewal')).toBe(true);
  });

  it('is true for family even when the onboarding type is omitted', () => {
    expect(requiresSponsorNoc('family')).toBe(true);
  });

  it('does not require the NOC for company on either onboarding type', () => {
    expect(requiresSponsorNoc('company', 'new_hire')).toBe(false);
    expect(requiresSponsorNoc('company', 'renewal')).toBe(false);
  });

  it('does not require the NOC for self/GCC on either onboarding type', () => {
    expect(requiresSponsorNoc('self_gcc', 'new_hire')).toBe(false);
    expect(requiresSponsorNoc('self_gcc', 'renewal')).toBe(false);
  });

  it('is false for undefined / null', () => {
    expect(requiresSponsorNoc(undefined, 'new_hire')).toBe(false);
    expect(requiresSponsorNoc(null, 'renewal')).toBe(false);
  });
});

describe('employeeVisaMandatoryOverride', () => {
  it('forces the applicant Visa + EID mandatory only for family-sponsored staff', () => {
    expect(employeeVisaMandatoryOverride('family')).toBe(true);
  });

  it('does not override for company- or self/GCC-sponsored staff', () => {
    expect(employeeVisaMandatoryOverride('company')).toBe(false);
    expect(employeeVisaMandatoryOverride('self_gcc')).toBe(false);
  });

  it('does not override for undefined / null', () => {
    expect(employeeVisaMandatoryOverride(undefined)).toBe(false);
    expect(employeeVisaMandatoryOverride(null)).toBe(false);
  });
});

describe('sponsorshipTypeFromSponsor', () => {
  it('maps Company to company', () => {
    expect(sponsorshipTypeFromSponsor('Company')).toBe('company');
  });

  it('maps Self-sponsored, GCC National and legacy NA to self_gcc', () => {
    expect(sponsorshipTypeFromSponsor('Self-sponsored')).toBe('self_gcc');
    expect(sponsorshipTypeFromSponsor('GCC National')).toBe('self_gcc');
    expect(sponsorshipTypeFromSponsor('NA')).toBe('self_gcc'); // legacy data
  });

  it('maps Spouse, Parent and Child to family', () => {
    expect(sponsorshipTypeFromSponsor('Spouse')).toBe('family');
    expect(sponsorshipTypeFromSponsor('Parent')).toBe('family');
    expect(sponsorshipTypeFromSponsor('Child')).toBe('family');
  });

  it('falls back to company for unknown / undefined / null', () => {
    expect(sponsorshipTypeFromSponsor('Something Else')).toBe('company');
    expect(sponsorshipTypeFromSponsor('')).toBe('company');
    expect(sponsorshipTypeFromSponsor(undefined)).toBe('company');
    expect(sponsorshipTypeFromSponsor(null)).toBe('company');
  });
});

describe('relationshipOptionsForSponsor', () => {
  it('narrows Spouse to husband / wife', () => {
    expect(relationshipOptionsForSponsor('Spouse')).toEqual(['husband', 'wife']);
  });

  it('narrows Parent to father / mother', () => {
    expect(relationshipOptionsForSponsor('Parent')).toEqual(['father', 'mother']);
  });

  it('narrows Child to son / daughter', () => {
    expect(relationshipOptionsForSponsor('Child')).toEqual(['son', 'daughter']);
  });

  it('returns all six options for non-family / unknown / undefined / null', () => {
    const all = ['husband', 'wife', 'father', 'mother', 'son', 'daughter'];
    expect(relationshipOptionsForSponsor('Company')).toEqual(all);
    expect(relationshipOptionsForSponsor('NA')).toEqual(all);
    expect(relationshipOptionsForSponsor('Self-sponsored')).toEqual(all);
    expect(relationshipOptionsForSponsor('weird')).toEqual(all);
    expect(relationshipOptionsForSponsor(undefined)).toEqual(all);
    expect(relationshipOptionsForSponsor(null)).toEqual(all);
  });
});

describe('initialIsInUae', () => {
  // Regression: employer answered "No", employee never touched the checkbox.
  // The form used to submit uae_presence 'inside' anyway (stale form default)
  // — BPR 10344 / Hansaconsult 12129 reports, 2026-07.
  it('is outside when the employer said the applicant is NOT in the UAE', () => {
    expect(
      initialIsInUae({ employee_data: null, employer_data: { applicant_in_uae: false } }, false)
    ).toBe(false);
  });

  it('is outside when there is no signal at all', () => {
    expect(initialIsInUae({}, false)).toBe(false);
    expect(initialIsInUae({ employee_data: null, employer_data: null }, false)).toBe(false);
  });

  it('is inside when the employer said the applicant IS in the UAE', () => {
    expect(initialIsInUae({ employer_data: { applicant_in_uae: true } }, false)).toBe(true);
  });

  it("prefers the employee's saved answer over the employer's", () => {
    expect(
      initialIsInUae(
        { employee_data: { uae_presence: 'outside' }, employer_data: { applicant_in_uae: true } },
        false
      )
    ).toBe(false);
    expect(
      initialIsInUae(
        { employee_data: { uae_presence: 'inside' }, employer_data: { applicant_in_uae: false } },
        false
      )
    ).toBe(true);
  });

  it('treats saved UAE address fields as inside (legacy drafts without uae_presence)', () => {
    expect(initialIsInUae({ employee_data: { uae_street_address: 'JLT Cluster F' } }, false)).toBe(true);
    expect(initialIsInUae({ employee_data: { uae_building_name: 'Marina Tower' } }, false)).toBe(true);
  });

  it('is always inside on renewals regardless of other data', () => {
    expect(
      initialIsInUae(
        { employee_data: { uae_presence: 'outside' }, employer_data: { applicant_in_uae: false } },
        true
      )
    ).toBe(true);
  });
});
