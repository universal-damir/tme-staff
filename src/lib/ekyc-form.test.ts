import { describe, it, expect } from 'vitest';
import {
  CORPORATE_KYC_SCHEMA,
  EKYC_AUTHORITY_DDA,
  EKYC_AUTHORITY_DIEZA,
  INDIVIDUAL_KYC_SCHEMA,
  emptyCorporateKyc,
  getEkycValue,
  type CorporateKycData,
  type IndividualKycData,
} from '@/types/ekyc';
import {
  buildInitialEkycData,
  cleanEkycString,
  clearHiddenFields,
  ekycErrorLabel,
  isoToPickerDate,
  pickerDateToIso,
  requiredEkycDocuments,
  sanitizeCorporateKyc,
  sanitizeIndividualKyc,
  setEkycValue,
  validateEkycData,
} from './ekyc-form';

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function completeIndividual(): IndividualKycData {
  return {
    ...sanitizeIndividualKyc({}),
    fullName: 'Jürgen Müller',
    nationality: 'Germany',
    dualNationality: 'no',
    uaeResident: 'no',
    homeAddress: { street: 'Hauptstraße 5', city: 'München', postalCode: '80331', country: 'Germany' },
    homePhone: '+49 89 1234567',
    gccNational: 'no',
    incomeSources: ['employment'],
    employer: { companyName: 'Größe GmbH', city: 'Köln', postalCode: '50667', country: 'Germany' },
    isPep: 'no',
    rcaIsPep: 'no',
    sanctioned: 'no',
    highRisk: 'no',
    trustCharity: 'no',
    modesOfPayment: ['bank_transfer'],
    declaration: { authorizedPersonName: 'Jürgen Müller', signature: SIGNATURE, date: '2026-10-02' },
  };
}

describe('cleanEkycString', () => {
  it('keeps German umlauts and other letters', () => {
    expect(cleanEkycString('Jürgen Müller, Größe Straße')).toBe('Jürgen Müller, Größe Straße');
    expect(cleanEkycString('Çağrı Øster')).toBe('Çağrı Øster');
  });

  it('strips control characters, bidi overrides and HTML brackets', () => {
    expect(cleanEkycString('a\u0000b\u0007c‮d<script>e')).toBe('abcdscripte');
    expect(cleanEkycString('line1\nline2\tx')).toBe('line1\nline2\tx');
  });

  it('caps the length and refuses non-strings', () => {
    expect(cleanEkycString('x'.repeat(5000)).length).toBe(4000);
    expect(cleanEkycString(42)).toBe('');
  });
});

describe('sanitize', () => {
  it('drops unknown keys and caps licenses at 3', () => {
    const out = sanitizeCorporateKyc({
      companyName: 'Bäckerei FZCO',
      evil: 'x',
      licenses: [{}, {}, {}, {}, {}],
      questionnaire: { q23: 'yes', q99: 'yes', q24: 'maybe' },
    }) as CorporateKycData & { evil?: unknown };
    expect(out.companyName).toBe('Bäckerei FZCO');
    expect(out.evil).toBeUndefined();
    expect(out.licenses).toHaveLength(3);
    expect(out.questionnaire.q23).toBe('yes');
    expect(out.questionnaire.q24).toBe('');
    expect((out.questionnaire as Record<string, unknown>).q99).toBeUndefined();
  });

  it('keeps only a real PNG data URL as the signature', () => {
    expect(sanitizeIndividualKyc({ declaration: { signature: SIGNATURE } }).declaration.signature).toBe(SIGNATURE);
    expect(sanitizeIndividualKyc({ declaration: { signature: 'javascript:alert(1)' } }).declaration.signature).toBe('');
    expect(
      sanitizeIndividualKyc({ declaration: { signature: `data:image/png;base64,${'A'.repeat(300_000)}` } }).declaration.signature
    ).toBe('');
  });

  it('reads a percent typed as text', () => {
    const out = sanitizeCorporateKyc({ shareholders: [{ percent: '33,5' }, { percent: 'abc' }] });
    expect(out.shareholders[0].percent).toBe(33.5);
    expect(out.shareholders[1].percent).toBeNull();
  });
});

describe('clearHiddenFields', () => {
  it('clears follow-up answers when the condition goes away', () => {
    let data = completeIndividual();
    data = { ...data, isPep: 'yes', pepCountry: 'Germany' };
    expect(clearHiddenFields(INDIVIDUAL_KYC_SCHEMA, data).pepCountry).toBe('Germany');
    const cleared = clearHiddenFields(INDIVIDUAL_KYC_SCHEMA, { ...data, isPep: 'no' });
    expect(cleared.pepCountry).toBe('');
  });

  it('clears the UAE address when the person is not a UAE resident', () => {
    const data = setEkycValue(completeIndividual(), 'uaeAddress.city', 'Dubai');
    expect(clearHiddenFields(INDIVIDUAL_KYC_SCHEMA, data).uaeAddress.city).toBe('');
  });

  it('clears the entity zone and a business unit that no longer fits the authority', () => {
    const base = emptyCorporateKyc();
    let data: CorporateKycData = { ...base, entityType: 'public_listed', entityZone: 'freezone' };
    data = setEkycValue(data, 'licenses.0.issuingAuthority', EKYC_AUTHORITY_DIEZA);
    data = setEkycValue(data, 'licenses.0.issuingAuthorityUnit', 'IFZA (International Free Zone Authority)');
    let out = clearHiddenFields(CORPORATE_KYC_SCHEMA, data);
    expect(out.entityZone).toBe('');
    expect(out.licenses[0].issuingAuthorityUnit).toBe('IFZA (International Free Zone Authority)');
    out = clearHiddenFields(CORPORATE_KYC_SCHEMA, setEkycValue(out, 'licenses.0.issuingAuthority', EKYC_AUTHORITY_DDA));
    expect(out.licenses[0].issuingAuthorityUnit).toBe('');
  });
});

describe('buildInitialEkycData', () => {
  it('individual: never pre-filled (R6)', () => {
    const data = buildInitialEkycData('individual', { prefilledFieldIds: ['fullName'] } as never, null) as IndividualKycData;
    expect(data.fullName).toBe('');
  });

  it('corporate: starts from the pre-fill, a saved draft wins', () => {
    const prefill = {
      prefilledFieldIds: ['companyName', 'licenses.0.licenseNumber'],
      companyName: 'Prefilled LLC',
      licenses: [{ licenseNumber: '12345' }],
      shareholders: [],
    };
    const fresh = buildInitialEkycData('corporate', prefill as never, null) as CorporateKycData;
    expect(fresh.companyName).toBe('Prefilled LLC');
    expect(fresh.licenses[0].licenseNumber).toBe('12345');
    expect(fresh.shareholders).toHaveLength(1); // at least one row to fill
    const draft = buildInitialEkycData('corporate', prefill as never, { companyName: 'Edited LLC' }) as CorporateKycData;
    expect(draft.companyName).toBe('Edited LLC');
  });
});

describe('D8: person names in Latin letters', () => {
  it('Müller typed is stored as Mueller, trimmed; addresses keep their umlauts', () => {
    const data = sanitizeIndividualKyc({
      ...completeIndividual(),
      fullName: '  Jürgen   Müller ',
      declaration: { authorizedPersonName: 'Jürgen Müller', signature: SIGNATURE, date: '2026-10-02' },
    });
    expect(data.fullName).toBe('Juergen Mueller');
    expect(data.declaration.authorizedPersonName).toBe('Juergen Mueller');
    expect(data.homeAddress.city).toBe('München');
    expect(data.employer.companyName).toBe('Größe GmbH');
  });

  it('corporate: an individual shareholder name is converted, a company shareholder name is not', () => {
    const data = sanitizeCorporateKyc({
      ...emptyCorporateKyc(),
      companyName: 'Bäckerei FZCO',
      primaryContactName: 'Zoë Ødegaard',
      shareholders: [
        { type: 'individual', fullLegalName: 'Jürgen Müller', email: '', nationalityOrCountry: '', percent: 50 },
        { type: 'corporate', fullLegalName: 'Größe GmbH', email: '', nationalityOrCountry: '', percent: 50 },
      ],
      ubos: [{ fullLegalName: 'Ana Núñez', nationality: '', countryOfResidence: '', percent: 50, natureOfControl: '', natureOfControlOther: '' }],
    });
    expect(data.companyName).toBe('Bäckerei FZCO');
    expect(data.primaryContactName).toBe('Zoe Oedegaard');
    expect(data.shareholders[0].fullLegalName).toBe('Juergen Mueller');
    expect(data.shareholders[1].fullLegalName).toBe('Größe GmbH');
    expect(data.ubos[0].fullLegalName).toBe('Ana Nunez');
  });

  it('a Cyrillic name stays as typed and submit names the error by the field', () => {
    const data = sanitizeIndividualKyc({ ...completeIndividual(), fullName: 'Иван Петров' });
    expect(data.fullName).toBe('Иван Петров');
    const docs = { passport: { path: 'x' }, photo: { path: 'x' }, proof_of_address: { path: 'x' } };
    const errors = validateEkycData('individual', data, docs);
    expect(errors.map((e) => e.fieldId)).toEqual(['fullName']);
    expect(errors[0].message.en).toMatch(/Latin letters/);
  });
});

describe('validation and labels', () => {
  it('a complete individual form with its files passes', () => {
    // Sanitized like the routes do: the person names become Latin (D8).
    const data = sanitizeIndividualKyc(completeIndividual());
    const docs = { passport: { path: 'x' }, photo: { path: 'x' }, proof_of_address: { path: 'x' } };
    expect(validateEkycData('individual', data, docs)).toEqual([]);
    const missing = validateEkycData('individual', data, { passport: { path: 'x' } }).map((e) => e.fieldId);
    expect(missing).toEqual(['documents.photo', 'documents.proof_of_address']);
  });

  it('keeps only the files this person still needs', () => {
    const data = completeIndividual();
    const ref = { path: 'r/x.pdf', filename: 'x.pdf', mimeType: 'application/pdf', size: 1, uploadedAt: '' };
    const out = requiredEkycDocuments(data, { passport: ref, second_passport: ref, eid_front: ref });
    expect(Object.keys(out)).toEqual(['passport']);
  });

  it('names what is missing, with numbers and rows, in both languages', () => {
    expect(ekycErrorLabel('corporate', 'entityType').en).toBe('Type of Entity / Legal Status');
    expect(ekycErrorLabel('corporate', 'licenses.1.expiryDate')).toEqual({
      en: 'License 2: Trade License Expiry Date',
      de: 'Lizenz 2: Ablaufdatum der Handelslizenz',
    });
    expect(ekycErrorLabel('corporate', 'shareholders.1.fullLegalName').en).toBe('Shareholder 2: Full legal name');
    expect(ekycErrorLabel('individual', 'documents.passport').en).toBe('Passport Copy');
    expect(ekycErrorLabel('corporate', 'ubos').en).toBe('UBO details');
  });

  it('converts between the stored ISO date and the picker', () => {
    expect(isoToPickerDate('2026-10-02')).toBe('02.10.2026');
    expect(pickerDateToIso('02.10.2026')).toBe('2026-10-02');
    expect(pickerDateToIso('2/10/26')).toBe('');
  });

  it('no date field opens with a date (nothing defaults to today)', () => {
    for (const [type, schema] of [
      ['corporate', CORPORATE_KYC_SCHEMA],
      ['individual', INDIVIDUAL_KYC_SCHEMA],
    ] as const) {
      const data = buildInitialEkycData(type, type === 'corporate' ? { prefilledFieldIds: [] } : null, null);
      for (const f of schema.fields.filter((x) => x.kind === 'date')) {
        expect(getEkycValue(data, f.id), f.id).toBe('');
      }
      for (const g of schema.groups) {
        const rows = getEkycValue(data, g.id) as Record<string, unknown>[];
        for (const f of g.fields.filter((x) => x.kind === 'date')) {
          for (const row of rows) expect(row[f.id], `${g.id}.${f.id}`).toBe('');
        }
      }
    }
  });
});

