import { describe, it, expect } from 'vitest';
import { missingRequiredDocuments } from './submit-validation';

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
