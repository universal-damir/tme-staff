import { describe, it, expect } from 'vitest';
import { missingRequiredDocuments, missingRequestedDocuments } from './submit-validation';

/**
 * Server-side required-documents gate for /api/submit-employee.
 *
 * Regression anchor: renewal 10920/LLC062 (2026-07-12) completed with no
 * passport cover page anywhere and still fired the Staff Renewal
 * Confirmation, because the only gate was client-side JavaScript.
 */

const validPhoto = { path: 'p/photo.jpg', filename: 'photo.jpg', validated: true };
const manualReviewPhoto = { path: 'p/photo.jpg', filename: 'photo.jpg', validated: true, needsReview: true };
const failedPhoto = { path: 'p/photo.jpg', filename: 'photo.jpg', validated: false };
const passportPages = {
  cover: { path: 'p/cover.pdf', filename: 'cover.pdf', validated: true },
  insidePages: { path: 'p/inside.pdf', filename: 'inside.pdf', validated: true },
};

describe('missingRequiredDocuments', () => {
  it('passes a complete new-hire submission', () => {
    expect(
      missingRequiredDocuments({ documents: { photo: validPhoto, passportPages } })
    ).toEqual([]);
  });

  it('flags a missing photo', () => {
    expect(missingRequiredDocuments({ documents: { passportPages } })).toContain('ID photo');
  });

  it('flags an uploaded-but-unvalidated photo (existence is not enough)', () => {
    const missing = missingRequiredDocuments({ documents: { photo: failedPhoto, passportPages } });
    expect(missing).toEqual(['ID photo (must pass validation or be submitted for manual review)']);
  });

  it('accepts a photo submitted via the manual-review fallback', () => {
    expect(
      missingRequiredDocuments({ documents: { photo: manualReviewPhoto, passportPages } })
    ).toEqual([]);
  });

  it('flags missing passport pages on a new hire', () => {
    const missing = missingRequiredDocuments({ documents: { photo: validPhoto } });
    expect(missing).toContain('Passport cover page');
    expect(missing).toContain('Passport data page');
  });

  it('allows the renewal skip only when BOTH pages are on file', () => {
    const renewalBothOnFile = {
      onboarding_type: 'renewal',
      documents: { photo: validPhoto, passport_unchanged: true },
      existing_documents: {
        passport_cover: { path: 'e/cover.pdf' },
        passport_inside: { path: 'e/inside.pdf' },
      },
    };
    expect(missingRequiredDocuments(renewalBothOnFile)).toEqual([]);
  });

  it('rejects the renewal skip when the cover page was never on file (10920/LLC062 case)', () => {
    const missing = missingRequiredDocuments({
      onboarding_type: 'renewal',
      documents: { photo: validPhoto, passport_unchanged: true },
      existing_documents: { passport_inside: { path: 'e/inside.pdf' } },
    });
    expect(missing).toContain('Passport cover page');
  });

  it('metadata-only photo entry in existing_documents does not enable the skip', () => {
    const missing = missingRequiredDocuments({
      onboarding_type: 'renewal',
      documents: { photo: validPhoto },
      existing_documents: { photo: { path: undefined } },
    });
    expect(missing).toContain('Passport cover page');
    expect(missing).toContain('Passport data page');
  });

  it('never allows the skip outside renewals', () => {
    const missing = missingRequiredDocuments({
      onboarding_type: null,
      documents: { photo: validPhoto, passport_unchanged: true },
      existing_documents: {
        passport_cover: { path: 'e/cover.pdf' },
        passport_inside: { path: 'e/inside.pdf' },
      },
    });
    expect(missing).toContain('Passport cover page');
  });

  it('requires the additional page for Indian and Syrian passports when pages are freshly uploaded', () => {
    for (const nationality of ['Indian', 'India', 'Syrian', 'Syria', 'SYRIAN ARAB REPUBLIC']) {
      const missing = missingRequiredDocuments(
        { documents: { photo: validPhoto, passportPages } },
        undefined,
        nationality
      );
      expect(missing).toEqual(['Passport additional page']);
    }
  });

  it('accepts an uploaded additional page for Indian/Syrian passports', () => {
    const withAdditional = {
      ...passportPages,
      additionalPage: { path: 'p/additional.pdf', filename: 'additional.pdf', validated: true },
    };
    expect(
      missingRequiredDocuments(
        { documents: { photo: validPhoto, passportPages: withAdditional } },
        undefined,
        'Syrian'
      )
    ).toEqual([]);
  });

  it('does not require the additional page for other nationalities', () => {
    expect(
      missingRequiredDocuments({ documents: { photo: validPhoto, passportPages } }, undefined, 'German')
    ).toEqual([]);
  });

  it('renewal "passport unchanged" skip also skips the additional page (no fresh data page)', () => {
    const renewalUnchanged = {
      onboarding_type: 'renewal',
      documents: { photo: validPhoto, passport_unchanged: true },
      existing_documents: {
        passport_cover: { path: 'e/cover.pdf' },
        passport_inside: { path: 'e/inside.pdf' },
      },
    };
    expect(missingRequiredDocuments(renewalUnchanged, undefined, 'Syrian')).toEqual([]);
  });

  it('renewal with freshly re-uploaded pages requires the additional page again', () => {
    const renewalReuploaded = {
      onboarding_type: 'renewal',
      documents: { photo: validPhoto, passportPages },
      existing_documents: {
        passport_cover: { path: 'e/cover.pdf' },
        passport_inside: { path: 'e/inside.pdf' },
      },
    };
    expect(missingRequiredDocuments(renewalReuploaded, undefined, 'Indian')).toEqual([
      'Passport additional page',
    ]);
  });

  it('requires sponsor docs + NOC for family sponsorship (employer_data.sponsor wins)', () => {
    const missing = missingRequiredDocuments({
      employer_data: { sponsor: 'Spouse' },
      sponsorship_type: 'company', // stale column — employer pick must win
      documents: { photo: validPhoto, passportPages },
    });
    expect(missing).toEqual([
      'Sponsor passport',
      'Sponsor visa',
      'Sponsor Emirates ID (front)',
      'Sponsor Emirates ID (back)',
      'Sponsor NOC signature',
    ]);
  });

  it('accepts the sponsor NOC arriving with the request body', () => {
    const missing = missingRequiredDocuments(
      {
        sponsorship_type: 'family',
        documents: {
          photo: validPhoto,
          passportPages,
          sponsor_passport: { path: 's/p.pdf', filename: 'p.pdf' },
          sponsor_visa: { path: 's/v.pdf', filename: 'v.pdf' },
          sponsor_eid_front: { path: 's/f.jpg', filename: 'f.jpg' },
          sponsor_eid_back: { path: 's/b.jpg', filename: 'b.jpg' },
        },
      },
      'data:image/png;base64,iVBOR'
    );
    expect(missing).toEqual([]);
  });

  it('does not require sponsor docs for company sponsorship', () => {
    expect(
      missingRequiredDocuments({
        sponsorship_type: 'company',
        documents: { photo: validPhoto, passportPages },
      })
    ).toEqual([]);
  });
});

/**
 * Server-side completeness gate for /api/submit-document-request
 * (onboarding_type === 'document_request'): every requested type key must be
 * uploaded and, where AI validation exists, validated or explicitly submitted
 * for manual review. The generic missingRequiredDocuments gate above does NOT
 * apply to document requests.
 */
describe('missingRequestedDocuments', () => {
  const acceptedRef = { path: 'p/doc.pdf', filename: 'doc.pdf', validated: true };
  const needsReviewRef = { path: 'p/doc.pdf', filename: 'doc.pdf', validated: true, needsReview: true };

  it('passes when every requested document is present and validated', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: [
          'photo',
          'passport_cover',
          'passport_inside',
          'passport_additional',
          'eid_front',
          'eid_back',
          'degree_attested',
          'transcript_of_records',
        ],
        documents: {
          photo: validPhoto,
          passportPages: {
            cover: acceptedRef,
            insidePages: acceptedRef,
            additionalPage: acceptedRef,
          },
          eid_front: acceptedRef,
          eid_back: acceptedRef,
          degree_attested: { path: 'p/degree.pdf', filename: 'degree.pdf' },
          transcript_of_records: { path: 'p/transcript.pdf', filename: 'transcript.pdf' },
        },
      })
    ).toEqual([]);
  });

  it('flags a photo that is uploaded but neither validated nor needsReview', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['photo'],
        documents: { photo: failedPhoto },
      })
    ).toEqual(['photo']);
  });

  it('accepts needsReview (manual-review fallback) as validated', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['photo', 'passport_cover', 'eid_front'],
        documents: {
          photo: manualReviewPhoto,
          passportPages: { cover: needsReviewRef },
          eid_front: { path: 'p/eid.jpg', filename: 'eid.jpg', validated: false, needsReview: true },
        },
      })
    ).toEqual([]);
  });

  it('checks passport keys under the nested passportPages structure', () => {
    // Flat refs (or the legacy `passport` key) must NOT satisfy passport keys.
    expect(
      missingRequestedDocuments({
        requested_documents: ['passport_cover', 'passport_inside', 'passport_additional'],
        documents: {
          passport: { path: 'p/legacy.pdf', filename: 'legacy.pdf' },
          passportPages: { insidePages: acceptedRef },
        },
      })
    ).toEqual(['passport_cover', 'passport_additional']);
  });

  it('passport page with path but no validation flags is not accepted', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['passport_inside'],
        documents: {
          passportPages: { insidePages: { path: 'p/inside.pdf', filename: 'inside.pdf', validated: false } },
        },
      })
    ).toEqual(['passport_inside']);
  });

  it('degree and transcript need a path only (no validation exists for them)', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['degree_attested', 'transcript_of_records'],
        documents: {
          degree_attested: { path: 'p/degree.pdf', filename: 'degree.pdf' },
          transcript_of_records: { path: 'p/transcript.pdf', filename: 'transcript.pdf' },
        },
      })
    ).toEqual([]);
  });

  it('empty or null requested_documents yields no missing keys', () => {
    expect(missingRequestedDocuments({ requested_documents: [], documents: {} })).toEqual([]);
    expect(missingRequestedDocuments({ requested_documents: null, documents: null })).toEqual([]);
    expect(missingRequestedDocuments({})).toEqual([]);
  });

  it('lists a requested type that is completely absent', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['eid_front', 'eid_back'],
        documents: { photo: validPhoto },
      })
    ).toEqual(['eid_front', 'eid_back']);
  });

  it('fails closed on unknown requested keys', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['photo', 'not_a_real_type'],
        documents: { photo: validPhoto },
      })
    ).toEqual(['not_a_real_type']);
  });

  it('accepts a generic requested type via extra_documents (path is enough)', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['visa', 'driving_license', 'sponsor_eid_front'],
        documents: {
          extra_documents: {
            visa: { path: 'p/visa/a.pdf', filename: 'visa.pdf', needsReview: true },
            driving_license: { path: 'p/driving_license/b.jpg', filename: 'dl.jpg', needsReview: true },
            sponsor_eid_front: { path: 'p/sponsor_eid_front/c.jpg', filename: 'eid.jpg', needsReview: true },
          },
        },
      })
    ).toEqual([]);
  });

  it('flags a generic requested type with no extra_documents entry', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['employment_contract', 'health_insurance'],
        documents: {
          extra_documents: {
            employment_contract: { path: 'p/employment_contract/a.pdf', filename: 'c.pdf', needsReview: true },
          },
        },
      })
    ).toEqual(['health_insurance']);
  });

  it('generic types are satisfied ONLY by extra_documents — a flat ref does not count', () => {
    // sponsor_passport / education_additional exist as flat refs written by
    // the main onboarding flow; a re-request wants a FRESH upload.
    expect(
      missingRequestedDocuments({
        requested_documents: ['sponsor_passport', 'education_additional'],
        documents: {
          sponsor_passport: { path: 's/p.pdf', filename: 'p.pdf', validated: true },
          education_additional: { path: 'e/a.pdf', filename: 'a.pdf' },
        },
      })
    ).toEqual(['sponsor_passport', 'education_additional']);
  });

  it('unknown keys still fail closed alongside generic keys', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: ['visa', 'not_a_real_type'],
        documents: {
          extra_documents: {
            visa: { path: 'p/visa/a.pdf', filename: 'visa.pdf', needsReview: true },
          },
        },
      })
    ).toEqual(['not_a_real_type']);
  });
});
