import { describe, it, expect } from 'vitest';
import {
  missingRequiredDocuments,
  missingRequestedDocuments,
  missingDependentRequirements,
  missingDependentRenewalRequirements,
} from './submit-validation';

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

  /**
   * Dependent document requests ('dependent_document_request') reuse this gate
   * unchanged; they only add four generic keys to the vocabulary.
   */
  it('accepts the dependent-only generic keys via extra_documents', () => {
    const genericRef = (key: string) => ({
      path: `p/${key}/a.pdf`,
      filename: 'a.pdf',
      needsReview: true as const,
    });
    expect(
      missingRequestedDocuments({
        requested_documents: [
          'relationship_certificate',
          'previous_visa',
          'previous_eid_front',
          'previous_eid_back',
          'visa',
        ],
        documents: {
          extra_documents: {
            relationship_certificate: genericRef('relationship_certificate'),
            previous_visa: genericRef('previous_visa'),
            previous_eid_front: genericRef('previous_eid_front'),
            previous_eid_back: genericRef('previous_eid_back'),
            visa: genericRef('visa'),
          },
        },
      })
    ).toEqual([]);
  });

  it('flags dependent generic keys with no extra_documents entry', () => {
    expect(
      missingRequestedDocuments({
        requested_documents: [
          'relationship_certificate',
          'previous_visa',
          'previous_eid_front',
          'previous_eid_back',
        ],
        documents: {
          extra_documents: {
            previous_visa: { path: 'p/previous_visa/a.pdf', filename: 'a.pdf', needsReview: true },
          },
        },
      })
    ).toEqual(['relationship_certificate', 'previous_eid_front', 'previous_eid_back']);
  });

  it('a dependent-onboarding flat ref does NOT satisfy a re-request for the same document', () => {
    // The dependent onboarding flow writes these as flat refs; a re-request
    // wants a FRESH upload, so only extra_documents counts.
    expect(
      missingRequestedDocuments({
        requested_documents: ['relationship_certificate', 'previous_eid_front'],
        documents: {
          relationship_certificate: { path: 'd/cert.pdf', filename: 'cert.pdf' },
          previous_eid_front: { path: 'd/eid.jpg', filename: 'eid.jpg' },
        },
      })
    ).toEqual(['relationship_certificate', 'previous_eid_front']);
  });
});

/**
 * Server-side completeness gates for /api/submit-dependent.
 *
 * `missingDependentRequirements`        — first registration ('dependent')
 * `missingDependentRenewalRequirements` — visa renewal ('dependent_renewal')
 *
 * Both are the server-side authority: the sponsor-facing DependentForm gates
 * every step, but only in browser JavaScript.
 */
// Spouse + a nationality with no extra document requirements (no
// additional passport page, no Pakistan National ID) — the matrix cases add
// their own overrides. The IBAN deliberately carries spaces: the gate must
// normalize before validating.
const completeDependentData = {
  first_name: 'Aisha',
  last_name: 'Khan',
  nationality: 'Egyptian',
  date_of_birth: '1990-04-11',
  gender: 'female',
  passport_no: 'AB1234567',
  passport_expiry: '2031-04-10',
  mother_full_name: 'Fatima Khan',
  father_full_name: 'Ahmed Khan',
  religion: 'Islam',
  marital_status: 'Married',
  home_street_address: '12 Corniche Road',
  home_city: 'Cairo',
  home_country: 'Egypt',
  uae_presence: 'outside',
  mobile_uae: '+971501234567',
  email: 'aisha@example.com',
  previously_held_uae_visa: false,
  certificate_attestation_confirmed: true,
  dependent_type: 'Spouse',
  sponsor_iban: 'AE07 0331 2345 6789 0123 456',
};

// Renewal payloads additionally carry the mandatory on-file confirmation.
const completeDependentRenewalData = {
  ...completeDependentData,
  details_confirmed_up_to_date: true,
};

const dependentDocs = {
  photo: validPhoto,
  passportPages,
  relationship_certificate: { path: 'd/cert.pdf', filename: 'cert.pdf' },
};

const existingPassportOnFile = {
  passport_cover: { path: 'e/cover.pdf' },
  passport_inside: { path: 'e/inside.pdf' },
};

describe('missingDependentRequirements', () => {
  it('passes a complete first registration', () => {
    expect(
      missingDependentRequirements({ documents: dependentDocs }, completeDependentData)
    ).toEqual([]);
  });

  it('requires the identity, address and contact fields', () => {
    const missing = missingDependentRequirements({ documents: dependentDocs }, {
      ...completeDependentData,
      first_name: '   ',
      religion: '',
      home_city: undefined,
      mobile_uae: '',
      email: '',
    });
    expect(missing).toContain('First name');
    expect(missing).toContain('Religion');
    expect(missing).toContain('Home country city');
    expect(missing).toContain('UAE mobile number');
    expect(missing).toContain('Email address');
  });

  it('requires the UAE address only when the dependent is inside the UAE', () => {
    const missing = missingDependentRequirements(
      { documents: dependentDocs },
      { ...completeDependentData, uae_presence: 'inside' }
    );
    expect(missing).toEqual(['UAE street address', 'UAE area', 'Emirate']);
  });

  it('requires the attestation, the visa-history answer and the certificate', () => {
    const missing = missingDependentRequirements(
      { documents: { photo: validPhoto, passportPages } },
      {
        ...completeDependentData,
        previously_held_uae_visa: undefined,
        certificate_attestation_confirmed: false,
      }
    );
    expect(missing).toEqual([
      'Whether the dependent previously held a UAE visa',
      'Confirmation that the certificate is attested',
      // Spouse: the primary slot IS the marriage certificate.
      'Marriage certificate',
    ]);
  });

  it('requires the previous visa + both Emirates ID sides when one was held', () => {
    const missing = missingDependentRequirements(
      { documents: dependentDocs },
      { ...completeDependentData, previously_held_uae_visa: true }
    );
    expect(missing).toEqual([
      'Previous UAE residence visa',
      'Previous Emirates ID (front)',
      'Previous Emirates ID (back)',
    ]);
  });

  it('never allows a passport skip on a first registration', () => {
    const missing = missingDependentRequirements(
      {
        documents: {
          photo: validPhoto,
          passport_unchanged: true,
          relationship_certificate: { path: 'd/cert.pdf', filename: 'cert.pdf' },
        },
      },
      completeDependentData
    );
    expect(missing).toContain('Passport cover page');
    expect(missing).toContain('Passport data page');
  });

  it('requires the sponsor UAE IBAN and rejects a malformed one', () => {
    expect(
      missingDependentRequirements(
        { documents: dependentDocs },
        { ...completeDependentData, sponsor_iban: '' }
      )
    ).toContain("Sponsor's UAE bank IBAN");
    // Wrong country prefix and wrong length both fail the AE + 21 digits rule.
    for (const bad of ['DE07033123456789012345', 'AE0703312345678901234', 'AE07X331234567890123456']) {
      expect(
        missingDependentRequirements(
          { documents: dependentDocs },
          { ...completeDependentData, sponsor_iban: bad }
        )
      ).toContain("Sponsor's UAE bank IBAN (must be AE followed by 21 digits)");
    }
    // Spaces are tolerated (normalized before validation) — fixture has them.
    expect(
      missingDependentRequirements({ documents: dependentDocs }, completeDependentData)
    ).toEqual([]);
  });

  it('Son/Daughter: additionally requires the parents\' marriage certificate', () => {
    const sonData = { ...completeDependentData, dependent_type: 'Son' };
    expect(missingDependentRequirements({ documents: dependentDocs }, sonData)).toEqual([
      'Marriage certificate',
    ]);
    expect(
      missingDependentRequirements(
        {
          documents: {
            ...dependentDocs,
            marriage_certificate: { path: 'd/marriage.pdf', filename: 'marriage.pdf' },
          },
        },
        sonData
      )
    ).toEqual([]);
  });

  it('Father/Mother and in-laws: require the parents\' marital status select', () => {
    const docsWithMarriage = {
      ...dependentDocs,
      marriage_certificate: { path: 'd/marriage.pdf', filename: 'marriage.pdf' },
    };
    for (const relationship of ['Father', 'Mother', 'Father-in-Law', 'Mother-in-Law']) {
      expect(
        missingDependentRequirements(
          { documents: docsWithMarriage },
          { ...completeDependentData, dependent_type: relationship }
        )
      ).toEqual(['Marital status of the parents']);
      expect(
        missingDependentRequirements(
          { documents: docsWithMarriage },
          { ...completeDependentData, dependent_type: relationship, parents_marital_status: 'Married' }
        )
      ).toEqual([]);
    }
  });

  it('Divorced/Deceased parents add the divorce/death certificate (marriage cert stays required)', () => {
    const docsWithMarriage = {
      ...dependentDocs,
      marriage_certificate: { path: 'd/marriage.pdf', filename: 'marriage.pdf' },
    };
    const fatherData = { ...completeDependentData, dependent_type: 'Father' };
    expect(
      missingDependentRequirements(
        { documents: docsWithMarriage },
        { ...fatherData, parents_marital_status: 'Divorced' }
      )
    ).toEqual(['Divorce certificate']);
    expect(
      missingDependentRequirements(
        { documents: docsWithMarriage },
        { ...fatherData, parents_marital_status: 'Deceased' }
      )
    ).toEqual(['Death certificate']);
    // Marriage certificate is required in ALL three marital-status cases.
    expect(
      missingDependentRequirements(
        { documents: dependentDocs },
        { ...fatherData, parents_marital_status: 'Deceased' }
      )
    ).toEqual(['Marriage certificate', 'Death certificate']);
    expect(
      missingDependentRequirements(
        {
          documents: {
            ...docsWithMarriage,
            death_certificate: { path: 'd/death.pdf', filename: 'death.pdf' },
          },
        },
        { ...fatherData, parents_marital_status: 'Deceased' }
      )
    ).toEqual([]);
  });

  it('an unknown or absent relationship (legacy Maid) falls back to the primary certificate only', () => {
    for (const relationship of ['Maid', undefined]) {
      expect(
        missingDependentRequirements(
          { documents: dependentDocs },
          { ...completeDependentData, dependent_type: relationship }
        )
      ).toEqual([]);
    }
  });

  it('requires the Pakistan National ID (front + back) for a Pakistani dependent', () => {
    const pakistaniData = {
      ...completeDependentData,
      nationality: 'Pakistani',
      home_country: 'Pakistan',
    };
    const missing = missingDependentRequirements({ documents: dependentDocs }, pakistaniData);
    expect(missing).toEqual(['Pakistan National ID (front)', 'Pakistan National ID (back)']);
    expect(
      missingDependentRequirements(
        {
          documents: {
            ...dependentDocs,
            pakistan_id_front: { path: 'd/pk-front.jpg', filename: 'pk-front.jpg', validated: true },
            pakistan_id_back: { path: 'd/pk-back.jpg', filename: 'pk-back.jpg', validated: true },
          },
        },
        pakistaniData
      )
    ).toEqual([]);
  });

  it('copies on file never satisfy the Pakistan ID on a FIRST registration', () => {
    const missing = missingDependentRequirements(
      {
        documents: dependentDocs,
        existing_documents: {
          pakistan_id_front: { path: 'e/pk-front.jpg' },
          pakistan_id_back: { path: 'e/pk-back.jpg' },
        },
      } as Parameters<typeof missingDependentRequirements>[0],
      { ...completeDependentData, nationality: 'Pakistani' }
    );
    expect(missing).toEqual(['Pakistan National ID (front)', 'Pakistan National ID (back)']);
  });
});

describe('missingDependentRenewalRequirements', () => {
  it('passes a renewal with freshly uploaded passport pages', () => {
    expect(
      missingDependentRenewalRequirements(
        { documents: { photo: validPhoto, passportPages } },
        completeDependentRenewalData
      )
    ).toEqual([]);
  });

  it('does not re-ask the attestation or the visa-history answer', () => {
    const { certificate_attestation_confirmed, previously_held_uae_visa, ...withoutRenewalSkipped } =
      completeDependentRenewalData;
    expect(certificate_attestation_confirmed).toBe(true); // fixture sanity
    expect(previously_held_uae_visa).toBe(false);
    expect(
      missingDependentRenewalRequirements(
        { documents: { photo: validPhoto, passportPages } },
        withoutRenewalSkipped
      )
    ).toEqual([]);
  });

  it('never requires the relationship certificate or the previous visa/EID set', () => {
    expect(
      missingDependentRenewalRequirements(
        { documents: { photo: validPhoto, passportPages } },
        { ...completeDependentRenewalData, previously_held_uae_visa: true }
      )
    ).toEqual([]);
  });

  it('still requires every identity, address and contact field', () => {
    const missing = missingDependentRenewalRequirements(
      { documents: { photo: validPhoto, passportPages } },
      { ...completeDependentRenewalData, passport_no: '', uae_presence: 'inside' }
    );
    expect(missing).toEqual([
      'Passport number',
      'UAE street address',
      'UAE area',
      'Emirate',
    ]);
  });

  it('allows the passport skip with BOTH pages on file AND the persisted attestation', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        completeDependentRenewalData
      )
    ).toEqual([]);
  });

  it('rejects the skip without the persisted attestation (stricter than the staff gate)', () => {
    const missing = missingDependentRenewalRequirements(
      { documents: { photo: validPhoto }, existing_documents: existingPassportOnFile },
      completeDependentRenewalData
    );
    expect(missing).toEqual(['Passport cover page', 'Passport data page']);
  });

  it('rejects the skip when only one page is on file (10920/LLC062 rationale)', () => {
    const missing = missingDependentRenewalRequirements(
      {
        documents: { photo: validPhoto, passport_unchanged: true },
        existing_documents: { passport_inside: { path: 'e/inside.pdf' } },
      },
      completeDependentRenewalData
    );
    expect(missing).toEqual(['Passport cover page', 'Passport data page']);
  });

  it('rejects the skip when existing_documents is absent entirely', () => {
    const missing = missingDependentRenewalRequirements(
      { documents: { photo: validPhoto, passport_unchanged: true } },
      completeDependentRenewalData
    );
    expect(missing).toEqual(['Passport cover page', 'Passport data page']);
  });

  it('the passport skip also skips the Indian/Syrian additional page', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        { ...completeDependentRenewalData, nationality: 'Indian' }
      )
    ).toEqual([]);
  });

  it('freshly re-uploaded pages require the additional page again', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passportPages, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        { ...completeDependentRenewalData, nationality: 'Syrian' }
      )
    ).toEqual(['Passport additional page']);
  });

  it('always requires the photo — there is no "photo unchanged" escape hatch', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { passport_unchanged: true },
          existing_documents: { ...existingPassportOnFile, photo: { path: 'e/photo.jpg' } },
        },
        completeDependentRenewalData
      )
    ).toEqual(['ID photo']);
  });

  it('flags a photo that is uploaded but neither validated nor needsReview', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: failedPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        completeDependentRenewalData
      )
    ).toEqual(['ID photo (must pass validation or be submitted for manual review)']);
  });

  it('accepts a photo submitted via the manual-review fallback', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: manualReviewPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        completeDependentRenewalData
      )
    ).toEqual([]);
  });

  it('requires the "details on file are still up to date" confirmation', () => {
    const { details_confirmed_up_to_date, ...withoutConfirmation } = completeDependentRenewalData;
    expect(details_confirmed_up_to_date).toBe(true); // fixture sanity
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        withoutConfirmation
      )
    ).toEqual(['Confirmation that the details on file are still up to date']);
  });

  it('still requires the sponsor IBAN on a renewal', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        { ...completeDependentRenewalData, sponsor_iban: undefined }
      )
    ).toEqual(["Sponsor's UAE bank IBAN"]);
  });

  it('Pakistan ID: copies on file satisfy a renewal; absent both, uploads are required', () => {
    const pakistaniRenewal = {
      ...completeDependentRenewalData,
      nationality: 'Pakistani',
      home_country: 'Pakistan',
    };
    // On file from the portal prefill — satisfied.
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passport_unchanged: true },
          existing_documents: {
            ...existingPassportOnFile,
            pakistan_id_front: { path: 'e/pk-front.jpg' },
            pakistan_id_back: { path: 'e/pk-back.jpg' },
          },
        },
        pakistaniRenewal
      )
    ).toEqual([]);
    // Nothing on file and nothing uploaded — fail closed, per side.
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        pakistaniRenewal
      )
    ).toEqual(['Pakistan National ID (front)', 'Pakistan National ID (back)']);
    // A fresh upload replaces a missing side.
    expect(
      missingDependentRenewalRequirements(
        {
          documents: {
            photo: validPhoto,
            passport_unchanged: true,
            pakistan_id_front: { path: 'd/pk-front.jpg', filename: 'pk-front.jpg', validated: true },
          },
          existing_documents: {
            ...existingPassportOnFile,
            pakistan_id_back: { path: 'e/pk-back.jpg' },
          },
        },
        pakistaniRenewal
      )
    ).toEqual([]);
  });

  it('never asks for the certificate matrix on a renewal (parent relationship)', () => {
    expect(
      missingDependentRenewalRequirements(
        {
          documents: { photo: validPhoto, passport_unchanged: true },
          existing_documents: existingPassportOnFile,
        },
        { ...completeDependentRenewalData, dependent_type: 'Father', parents_marital_status: undefined }
      )
    ).toEqual([]);
  });
});
