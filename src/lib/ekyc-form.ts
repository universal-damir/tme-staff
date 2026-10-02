/**
 * eKYC form logic shared by the browser form and the server routes.
 *
 * Pure: no React, no Supabase. The schema, the validators and the data types
 * all come from the contract (src/types/ekyc.ts, a verbatim mirror of the
 * portal's src/lib/ekyc/types.ts). This file only adds what the client form
 * on tme-staff needs around it:
 *   - sanitize: keep every known field, drop everything else, strip control
 *     characters and HTML brackets. Unicode letters STAY (German umlauts in
 *     addresses and company names): this form never runs foldPayloadToEnglish.
 *     The one exception is a PERSON name (D8, `latinName` fields): it is
 *     written in Latin letters the passport MRZ way (ekycToLatinName, Müller
 *     = Mueller) and trimmed, so the stored value is always converted.
 *   - clearHiddenFields: a field hidden by `visibleWhen` loses its value.
 *   - path helpers and the labels the error summary uses.
 */

import {
  CORPORATE_KYC_SCHEMA,
  EKYC_CORPORATE_QUESTION_IDS,
  EKYC_DOCUMENT_SLOTS,
  EKYC_MAX_LICENSES,
  INDIVIDUAL_KYC_SCHEMA,
  ekycToLatinName,
  emptyCorporateKyc,
  emptyIndividualKyc,
  getEkycValue,
  isEkycFieldVisible,
  isEkycLatinNameField,
  validateCorporateKyc,
  validateIndividualKyc,
  type CorporateKycData,
  type EkycDeclaration,
  type EkycDocumentSlot,
  type EkycDocuments,
  type EkycFieldDef,
  type EkycFieldKind,
  type EkycFormSchema,
  type EkycLicenseBlock,
  type EkycPrefillData,
  type EkycShareholder,
  type EkycText,
  type EkycType,
  type EkycUbo,
  type EkycValidationError,
  type EkycYesNo,
  type IndividualKycData,
} from '@/types/ekyc';

export type EkycFormData = CorporateKycData | IndividualKycData;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Longest text a single answer may hold (addresses, activity lists). */
export const EKYC_MAX_TEXT = 4000;
/** Most entries in a country list. There are ~250 countries. */
export const EKYC_MAX_LIST = 300;
/** Shareholder / UBO rows. The paper form had 5; no maximum was asked. */
export const EKYC_MAX_PEOPLE_ROWS = 50;
/** A drawn signature PNG is ~10 to 40 KB; anything far above is not one. */
export const EKYC_MAX_SIGNATURE_CHARS = 200_000;

/**
 * Largest upload (browser and server). Netlify cuts request bodies at about
 * 6 MB before the route runs, so the cap sits well under it, multipart
 * overhead included. The browser shrinks large photos to fit first
 * (shrinkImageToBudget, the same helper the onboarding uploads use); a PDF
 * cannot be shrunk and is refused above the cap with a clear message.
 */
export const EKYC_MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

const SIGNATURE_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

// ---------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------

/**
 * Clean one typed string. Keeps every Unicode letter (umlauts, accents,
 * other scripts). Removes C0 controls except tab / newline / carriage return,
 * DEL and C1 controls, bidi override characters, and `<` `>`.
 */
export function cleanEkycString(raw: unknown, max: number = EKYC_MAX_TEXT): string {
  if (typeof raw !== 'string') return '';
  const normalized = raw.normalize('NFC');
  let out = '';
  for (const ch of normalized) {
    if (out.length >= max) break;
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code >= 0x7f && code <= 0x9f) continue;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
    if (ch === '<' || ch === '>') continue;
    out += ch;
  }
  return out;
}

function obj(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function arr(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

const s = (raw: unknown) => cleanEkycString(raw);

function yn(raw: unknown): EkycYesNo {
  return raw === 'yes' || raw === 'no' ? raw : '';
}

function strList(raw: unknown): string[] {
  const out: string[] = [];
  for (const v of arr(raw).slice(0, EKYC_MAX_LIST)) {
    const c = cleanEkycString(v, 200);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function percent(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function signature(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (raw.length > EKYC_MAX_SIGNATURE_CHARS) return '';
  return SIGNATURE_RE.test(raw) ? raw : '';
}

function declaration(raw: unknown): EkycDeclaration {
  const r = obj(raw);
  return {
    authorizedPersonName: s(r.authorizedPersonName),
    signature: signature(r.signature),
    date: cleanEkycString(r.date, 10),
  };
}

function license(raw: unknown): EkycLicenseBlock {
  const r = obj(raw);
  return {
    licenseNumber: s(r.licenseNumber),
    issueDate: cleanEkycString(r.issueDate, 10),
    expiryDate: cleanEkycString(r.expiryDate, 10),
    issuingAuthority: s(r.issuingAuthority),
    issuingAuthorityUnit: s(r.issuingAuthorityUnit),
    mainActivities: s(r.mainActivities),
  };
}

function shareholder(raw: unknown): EkycShareholder {
  const r = obj(raw);
  const type = r.type === 'corporate' || r.type === 'individual' ? r.type : '';
  return {
    type,
    fullLegalName: s(r.fullLegalName),
    email: s(r.email),
    nationalityOrCountry: s(r.nationalityOrCountry),
    percent: percent(r.percent),
  };
}

function ubo(raw: unknown): EkycUbo {
  const r = obj(raw);
  return {
    fullLegalName: s(r.fullLegalName),
    nationality: s(r.nationality),
    countryOfResidence: s(r.countryOfResidence),
    percent: percent(r.percent),
    natureOfControl: s(r.natureOfControl) as EkycUbo['natureOfControl'],
    natureOfControlOther: s(r.natureOfControlOther),
  };
}

/**
 * Corporate answers reduced to the known shape. Unknown keys are dropped;
 * option values are kept as typed (the validator rejects an unknown one at
 * submit, with a message by the field).
 */
export function sanitizeCorporateKyc(raw: unknown): CorporateKycData {
  return applyEkycLatinNames(CORPORATE_KYC_SCHEMA, sanitizeCorporateShape(raw), { trim: true });
}

function sanitizeCorporateShape(raw: unknown): CorporateKycData {
  const r = obj(raw);
  const q = obj(r.questionnaire);
  const questionnaire = {} as CorporateKycData['questionnaire'];
  for (const id of EKYC_CORPORATE_QUESTION_IDS) questionnaire[id] = yn(q[id]);
  return {
    companyName: s(r.companyName),
    licenses: arr(r.licenses).slice(0, EKYC_MAX_LICENSES).map(license),
    entityType: s(r.entityType) as CorporateKycData['entityType'],
    entityZone: s(r.entityZone) as CorporateKycData['entityZone'],
    countryOfIncorporation: s(r.countryOfIncorporation),
    incorporationDate: cleanEkycString(r.incorporationDate, 10),
    modeOfPayment: s(r.modeOfPayment),
    countriesOfOperation: strList(r.countriesOfOperation),
    primaryContactName: s(r.primaryContactName),
    primaryContactJobTitle: s(r.primaryContactJobTitle),
    primaryContactEmail: s(r.primaryContactEmail),
    isBranchOrSubsidiary: yn(r.isBranchOrSubsidiary),
    headOfficeAddress: s(r.headOfficeAddress),
    serviceOfficeAddress: s(r.serviceOfficeAddress),
    website: s(r.website),
    poBox: s(r.poBox),
    telephone: s(r.telephone),
    shareholders: arr(r.shareholders).slice(0, EKYC_MAX_PEOPLE_ROWS).map(shareholder),
    ubos: arr(r.ubos).slice(0, EKYC_MAX_PEOPLE_ROWS).map(ubo),
    authorizedShareCapital: s(r.authorizedShareCapital),
    issuedShareCapital: s(r.issuedShareCapital),
    questionnaire,
    declaration: declaration(r.declaration),
  };
}

/** Individual answers reduced to the known shape, person names in Latin letters (D8). */
export function sanitizeIndividualKyc(raw: unknown): IndividualKycData {
  return applyEkycLatinNames(INDIVIDUAL_KYC_SCHEMA, sanitizeIndividualShape(raw), { trim: true });
}

function sanitizeIndividualShape(raw: unknown): IndividualKycData {
  const r = obj(raw);
  const uae = obj(r.uaeAddress);
  const home = obj(r.homeAddress);
  const emp = obj(r.employer);
  return {
    fullName: s(r.fullName),
    nationality: s(r.nationality),
    dualNationality: yn(r.dualNationality),
    dualNationalityCountries: strList(r.dualNationalityCountries),
    uaeResident: yn(r.uaeResident),
    uaeAddress: {
      buildingName: s(uae.buildingName),
      apartmentNo: s(uae.apartmentNo),
      street: s(uae.street),
      city: s(uae.city),
      emirate: s(uae.emirate),
      postalCode: s(uae.postalCode),
    },
    uaePhone: s(r.uaePhone),
    homeAddress: {
      street: s(home.street),
      city: s(home.city),
      postalCode: s(home.postalCode),
      country: s(home.country),
    },
    homePhone: s(r.homePhone),
    gccNational: yn(r.gccNational),
    incomeSources: strList(r.incomeSources) as IndividualKycData['incomeSources'],
    employer: {
      companyName: s(emp.companyName),
      city: s(emp.city),
      postalCode: s(emp.postalCode),
      country: s(emp.country),
    },
    businessCountries: strList(r.businessCountries),
    incomeOthers: s(r.incomeOthers),
    isPep: yn(r.isPep),
    pepCountry: s(r.pepCountry),
    rcaIsPep: yn(r.rcaIsPep),
    rcaName: s(r.rcaName),
    rcaRelationship: s(r.rcaRelationship),
    rcaCountry: s(r.rcaCountry),
    sanctioned: yn(r.sanctioned),
    sanctionDetails: s(r.sanctionDetails),
    highRisk: yn(r.highRisk),
    highRiskCountry: s(r.highRiskCountry),
    trustCharity: yn(r.trustCharity),
    trustCharityNames: s(r.trustCharityNames),
    modesOfPayment: strList(r.modesOfPayment),
    declaration: declaration(r.declaration),
  };
}

export function sanitizeEkycData(type: EkycType, raw: unknown): EkycFormData {
  return type === 'corporate' ? sanitizeCorporateKyc(raw) : sanitizeIndividualKyc(raw);
}

// ---------------------------------------------------------------------------
// D8: person names in Latin letters (passport MRZ style)
// ---------------------------------------------------------------------------

/**
 * Every field where the Latin-name rule applies (isEkycLatinNameField, so a
 * corporate shareholder's company name stays as typed) gets ekycToLatinName,
 * and with `trim` its ends trimmed. Letters it cannot map (Cyrillic, Arabic)
 * stay, so the validator still rejects them with a message by the field.
 * The browser runs it without trim on every change (the client may still be
 * typing a space); the server runs it with trim on autosave and submit.
 */
export function applyEkycLatinNames<D extends object>(
  schema: EkycFormSchema<D>,
  data: D,
  opts: { trim?: boolean } = {}
): D {
  let next = data;
  const convert = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const out = ekycToLatinName(value);
    return opts.trim ? out.trim() : out;
  };
  for (const field of schema.fields) {
    if (!isEkycLatinNameField(field, next, next)) continue;
    const value = getEkycValue(next, field.id);
    const out = convert(value);
    if (out !== value) next = setEkycValue(next, field.id, out);
  }
  for (const group of schema.groups) {
    const rows = getEkycValue(next, group.id);
    if (!Array.isArray(rows)) continue;
    rows.forEach((_, index) => {
      const row = getEkycValue(next, `${group.id}.${index}`);
      for (const field of group.fields) {
        if (!isEkycLatinNameField(field, next, row)) continue;
        const value = getEkycValue(row, field.id);
        const out = convert(value);
        if (out !== value) next = setEkycValue(next, `${group.id}.${index}.${field.id}`, out);
      }
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Immutable set by dot path ('uaeAddress.street', 'licenses.0.issueDate'). */
export function setEkycValue<T>(data: T, path: string, value: unknown): T {
  const parts = path.split('.');
  const setIn = (current: unknown, index: number): unknown => {
    const key = parts[index];
    const isLast = index === parts.length - 1;
    if (Array.isArray(current)) {
      const i = Number(key);
      const copy = current.slice();
      copy[i] = isLast ? value : setIn(copy[i], index + 1);
      return copy;
    }
    const base = obj(current);
    return { ...base, [key]: isLast ? value : setIn(base[key], index + 1) };
  };
  return setIn(data, 0) as T;
}

export function emptyValueForKind(kind: EkycFieldKind): unknown {
  if (kind === 'countries' || kind === 'multiselect') return [];
  if (kind === 'percent') return null;
  return '';
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * Hidden fields lose their value (a "No" after a "Yes" drops the follow-up
 * answers), and a dependent dropdown whose options changed drops a value that
 * is no longer one of them (DIEZA unit after the authority switched to DDA).
 * Runs until nothing changes, so a chain of conditions settles.
 */
export function clearHiddenFields<D extends object>(schema: EkycFormSchema<D>, data: D): D {
  let next = data;
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    const clearOne = <R>(field: EkycFieldDef<D, R>, row: R, path: string, value: unknown) => {
      const visible = isEkycFieldVisible(field, next, row);
      if (!visible) {
        if (!isEmptyValue(value)) {
          next = setEkycValue(next, path, emptyValueForKind(field.kind));
          changed = true;
        }
        return;
      }
      if (field.optionsFor && typeof value === 'string' && value !== '') {
        const options = field.optionsFor(next, row);
        if (!options.some((o) => o.value === value)) {
          next = setEkycValue(next, path, '');
          changed = true;
        }
      }
    };
    for (const field of schema.fields) {
      clearOne(field, next, field.id, getEkycValue(next, field.id));
    }
    for (const group of schema.groups) {
      const rows = getEkycValue(next, group.id);
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, index) => {
        for (const field of group.fields) {
          const current = getEkycValue(next, `${group.id}.${index}`);
          clearOne(field, current, `${group.id}.${index}.${field.id}`, getEkycValue(current, field.id));
        }
      });
    }
    if (!changed) break;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Initial data
// ---------------------------------------------------------------------------

export function ekycSchemaFor(type: EkycType): EkycFormSchema<EkycFormData> {
  return (type === 'corporate' ? CORPORATE_KYC_SCHEMA : INDIVIDUAL_KYC_SCHEMA) as unknown as EkycFormSchema<EkycFormData>;
}

/** Groups always show at least one row (each has min 1). */
function withMinimumRows(data: CorporateKycData): CorporateKycData {
  const empty = emptyCorporateKyc();
  return {
    ...data,
    licenses: data.licenses.length ? data.licenses : empty.licenses,
    shareholders: data.shareholders.length ? data.shareholders : empty.shareholders,
    ubos: data.ubos.length ? data.ubos : empty.ubos,
  };
}

/**
 * The data the form opens with. A saved draft wins. Without one: corporate
 * starts from the portal's pre-fill (R7), individual starts empty (R6).
 */
export function buildInitialEkycData(
  type: EkycType,
  prefill: EkycPrefillData | null,
  formData: unknown
): EkycFormData {
  if (type === 'individual') {
    const base = formData ? sanitizeIndividualKyc(formData) : emptyIndividualKyc();
    return clearHiddenFields(INDIVIDUAL_KYC_SCHEMA, base);
  }
  let base: CorporateKycData;
  if (formData) {
    base = sanitizeCorporateKyc(formData);
  } else {
    const values: Record<string, unknown> = { ...obj(prefill) };
    delete values.prefilledFieldIds;
    base = sanitizeCorporateKyc({ ...emptyCorporateKyc(), ...values });
  }
  return clearHiddenFields(CORPORATE_KYC_SCHEMA, withMinimumRows(base));
}

// ---------------------------------------------------------------------------
// Validation + labels
// ---------------------------------------------------------------------------

/** Keep only the uploads this person still needs (others are left out of the record). */
export function requiredEkycDocuments(
  data: IndividualKycData,
  documents: EkycDocuments | null | undefined
): EkycDocuments {
  const out: EkycDocuments = {};
  for (const def of EKYC_DOCUMENT_SLOTS) {
    const ref = documents?.[def.slot];
    if (def.requiredWhen(data) && ref) out[def.slot] = ref;
  }
  return out;
}

/** The one validator call both the browser and the submit route make. */
export function validateEkycData(
  type: EkycType,
  data: EkycFormData,
  documents: Partial<Record<EkycDocumentSlot, { path?: string } | undefined>>
): EkycValidationError[] {
  if (type === 'corporate') return validateCorporateKyc(data as CorporateKycData);
  return validateIndividualKyc(data as IndividualKycData, documents as EkycDocuments);
}

/** Heading of one row of a group: 'Shareholder 2' / 'Gesellschafter 2' (rowNo counts from 1). */
export function ekycRowHeading(rowLabel: EkycText, rowNo: number): EkycText {
  return { en: `${rowLabel.en} ${rowNo}`, de: `${rowLabel.de || rowLabel.en} ${rowNo}` };
}

/**
 * The name of the field behind an error, in both languages, so the error
 * summary can say WHAT is missing: 'Type of Entity/ Legal Status',
 * 'License 2: Trade License Expiry Date', 'Passport Copy'. No question
 * numbers: they come from the paper form and only the PDF prints them.
 */
export function ekycErrorLabel(type: EkycType, fieldId: string): EkycText {
  const schema = ekycSchemaFor(type);
  if (fieldId.startsWith('documents.')) {
    const slot = fieldId.slice('documents.'.length);
    const def = EKYC_DOCUMENT_SLOTS.find((d) => d.slot === slot);
    if (def) return def.label;
  }
  const top = schema.fields.find((f) => f.id === fieldId);
  if (top) return top.label;
  const parts = fieldId.split('.');
  const group = schema.groups.find((g) => g.id === parts[0]);
  if (group) {
    if (parts.length === 1) return group.label;
    const rowNo = Number(parts[1]) + 1;
    const field = group.fields.find((f) => f.id === parts.slice(2).join('.'));
    const rowLabel = ekycRowHeading(group.rowLabel, rowNo);
    if (!field) return rowLabel;
    const fl = { en: field.label.en, de: field.label.de || field.label.en };
    return { en: `${rowLabel.en}: ${fl.en}`, de: `${rowLabel.de}: ${fl.de}` };
  }
  return { en: fieldId, de: fieldId };
}

// ---------------------------------------------------------------------------
// Dates (stored ISO, the date picker works in dd.mm.yyyy)
// ---------------------------------------------------------------------------

export function isoToPickerDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

export function pickerDateToIso(display: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(display || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
