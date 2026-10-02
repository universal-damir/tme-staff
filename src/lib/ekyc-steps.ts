/**
 * The eKYC client form as a series of steps (one topic per step).
 *
 * The contract (src/types/ekyc.ts) keeps its paper-form sections for the PDF;
 * the client form groups the same fields into steps here. No new data: every
 * schema field and group sits in exactly one step (a test checks it), so the
 * per-step validation is the contract's validator filtered to the step.
 *
 * Pure: no React.
 */

import {
  EKYC_CORPORATE_QUESTION_IDS,
  EKYC_DOCUMENT_SLOTS,
  EKYC_DECLARATION_TEXT,
  EKYC_PEP_DEFINITION,
  EKYC_RCA_DEFINITION,
  type EkycText,
  type EkycType,
  type EkycValidationError,
} from '@/types/ekyc';

const t = (en: string, de: string): EkycText => ({ en, de, deReviewed: false });

export interface EkycStepDef {
  id: string;
  title: EkycText;
  /** Short line under the step title. */
  intro?: EkycText;
  /** Longer background text, shown folded ("More information"). */
  details?: EkycText[];
  /**
   * The step's layout: rows of field / group ids. Fields in one row sit side
   * by side on a wide screen (their inputs line up); a row of one is a field
   * (or a group, or a Yes / No question) on its own line.
   */
  rows: readonly (readonly string[])[];
  /** Field ids and group ids from the schema, in display order (the rows, flat). */
  items: readonly string[];
  /** Individual uploads (EKYC_DOCUMENT_SLOTS) render on this step. */
  documents?: boolean;
  /** The privacy disclaimer renders on this step. */
  privacy?: boolean;
  /** The step's own lead text (the declaration wording). */
  lead?: EkycText;
}

type StepInput = Omit<EkycStepDef, 'items'>;

/** A step with its items taken from its rows (one list, no drift). */
function step(def: StepInput): EkycStepDef {
  return { ...def, items: def.rows.flat() };
}

/** Each id on its own row. */
const single = (...ids: string[]): string[][] => ids.map((id) => [id]);

const DECLARATION_ROWS: readonly (readonly string[])[] = [
  ['declaration.authorizedPersonName', 'declaration.date'],
  ['declaration.signature'],
];

/**
 * Rows inside one entry of a repeating group (a license, a shareholder, a
 * UBO), by the group's field ids. The contract owns the group fields; the
 * layout lives here. A test checks every group field sits here exactly once.
 */
export const EKYC_GROUP_ROWS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  licenses: [['licenseNumber', 'issueDate', 'expiryDate'], ['issuingAuthority', 'issuingAuthorityUnit'], ['mainActivities']],
  shareholders: [['type'], ['fullLegalName', 'email'], ['nationalityOrCountry', 'percent']],
  ubos: [['fullLegalName'], ['nationality', 'countryOfResidence'], ['percent', 'natureOfControl'], ['natureOfControlOther']],
};

export const CORPORATE_STEPS: readonly EkycStepDef[] = [
  step({
    id: 'company',
    title: t('Company', 'Unternehmen'),
    intro: t('Basic details about the company.', 'Grundlegende Angaben zum Unternehmen.'),
    rows: [
      ['companyName'],
      ['entityType', 'entityZone'],
      ['countryOfIncorporation', 'incorporationDate'],
      ['countriesOfOperation'],
      ['isBranchOrSubsidiary'],
      ['modeOfPayment'],
    ],
  }),
  step({
    id: 'licenses',
    title: t('Licenses', 'Lizenzen'),
    intro: t('The details as they appear on the trade license.', 'Die Angaben so, wie sie auf der Handelslizenz stehen.'),
    rows: [['licenses']],
  }),
  step({
    id: 'contact',
    title: t('Contact and addresses', 'Kontakt und Adressen'),
    intro: t('Who we contact, and where the company is based.', 'Wen wir kontaktieren und wo das Unternehmen ansässig ist.'),
    rows: [
      ['primaryContactName'],
      ['primaryContactJobTitle', 'primaryContactEmail'],
      ['telephone'],
      ['headOfficeAddress', 'serviceOfficeAddress'],
      ['website', 'poBox'],
    ],
  }),
  step({
    id: 'shareholders',
    title: t('Shareholders', 'Gesellschafter'),
    intro: t('Everyone who owns shares in the company.', 'Alle, die Anteile an dem Unternehmen halten.'),
    rows: [['shareholders']],
  }),
  step({
    id: 'ubos',
    title: t('UBOs', 'Wirtschaftlich Berechtigte (UBO)'),
    intro: t(
      'The people who in the end own or control the company (Ultimate Beneficial Owners).',
      'Die Personen, denen das Unternehmen letztlich gehört oder die es kontrollieren (Ultimate Beneficial Owners).'
    ),
    rows: [['ubos']],
  }),
  step({
    id: 'questionnaire',
    title: t('Questionnaire', 'Fragebogen'),
    intro: t('Share capital and a few compliance questions.', 'Stammkapital und einige Fragen zur Compliance.'),
    rows: [['authorizedShareCapital', 'issuedShareCapital'], ...single(...EKYC_CORPORATE_QUESTION_IDS.map((q) => `questionnaire.${q}`))],
  }),
  step({
    id: 'declaration',
    title: t('Declaration', 'Erklärung'),
    intro: t('Read the privacy notice, then confirm and sign.', 'Lesen Sie den Datenschutzhinweis, bestätigen und unterschreiben Sie dann.'),
    privacy: true,
    lead: EKYC_DECLARATION_TEXT,
    rows: DECLARATION_ROWS,
  }),
];

export const INDIVIDUAL_STEPS: readonly EkycStepDef[] = [
  step({
    id: 'about',
    title: t('About you', 'Über Sie'),
    intro: t('Your name and nationality, as in your passport.', 'Ihr Name und Ihre Staatsangehörigkeit, wie im Reisepass.'),
    rows: [['fullName', 'nationality'], ['dualNationality'], ['dualNationalityCountries'], ['gccNational']],
  }),
  step({
    id: 'address',
    title: t('Address and contact', 'Adresse und Kontakt'),
    intro: t('Where you live and how we can reach you.', 'Wo Sie wohnen und wie wir Sie erreichen.'),
    rows: [
      ['uaeResident'],
      ['uaeAddress.buildingName', 'uaeAddress.apartmentNo'],
      ['uaeAddress.street', 'uaeAddress.city'],
      ['uaeAddress.emirate', 'uaeAddress.postalCode'],
      ['uaePhone'],
      ['homeAddress.street', 'homeAddress.city'],
      ['homeAddress.postalCode', 'homeAddress.country'],
      ['homePhone'],
    ],
  }),
  step({
    id: 'income',
    title: t('Income and payment', 'Einkünfte und Zahlung'),
    intro: t('Where your money comes from, and how you pay us.', 'Woher Ihr Geld stammt und wie Sie an uns zahlen.'),
    rows: [
      ['incomeSources'],
      ['employer.companyName', 'employer.city'],
      ['employer.postalCode', 'employer.country'],
      ['businessCountries'],
      ['incomeOthers'],
      ['modesOfPayment'],
    ],
  }),
  step({
    id: 'pep',
    title: t('PEP and sanctions', 'PEP und Sanktionen'),
    intro: t(
      'Questions about public office, sanctions and high-risk countries.',
      'Fragen zu öffentlichen Ämtern, Sanktionen und Hochrisikoländern.'
    ),
    details: [EKYC_PEP_DEFINITION, EKYC_RCA_DEFINITION],
    rows: [
      ['isPep'],
      ['pepCountry'],
      ['rcaIsPep'],
      ['rcaName', 'rcaRelationship'],
      ['rcaCountry'],
      ['sanctioned'],
      ['sanctionDetails'],
      ['highRisk'],
      ['highRiskCountry'],
      ['trustCharity'],
      ['trustCharityNames'],
    ],
  }),
  step({
    id: 'documents',
    title: t('Documents', 'Dokumente'),
    intro: t('Upload a copy of each document below.', 'Laden Sie bitte eine Kopie jedes der folgenden Dokumente hoch.'),
    documents: true,
    rows: [],
  }),
  step({
    id: 'declaration',
    title: t('Declaration', 'Erklärung'),
    intro: t('Read the privacy notice, then confirm and sign.', 'Lesen Sie den Datenschutzhinweis, bestätigen und unterschreiben Sie dann.'),
    privacy: true,
    lead: EKYC_DECLARATION_TEXT,
    rows: DECLARATION_ROWS,
  }),
];

export function ekycStepsFor(type: EkycType): readonly EkycStepDef[] {
  return type === 'corporate' ? CORPORATE_STEPS : INDIVIDUAL_STEPS;
}

/**
 * Index of the step that holds an error / field path: a top-level field id
 * ('uaeAddress.street'), a group or a row path ('shareholders.1.percent'),
 * or an upload ('documents.passport'). -1 when no step holds it.
 */
export function ekycStepIndexOfPath(steps: readonly EkycStepDef[], path: string): number {
  if (path.startsWith('documents.') || path === 'documents') {
    return steps.findIndex((s) => s.documents);
  }
  // Exact field id first (top-level ids may contain dots).
  const exact = steps.findIndex((s) => s.items.includes(path));
  if (exact >= 0) return exact;
  const root = path.split('.')[0];
  return steps.findIndex((s) => s.items.includes(root));
}

/** The contract's errors that belong to one step. */
export function ekycErrorsForStep(
  steps: readonly EkycStepDef[],
  stepIndex: number,
  errors: readonly EkycValidationError[]
): EkycValidationError[] {
  return errors.filter((e) => ekycStepIndexOfPath(steps, e.fieldId) === stepIndex);
}

/** First step with a missing or wrong answer; steps.length (Check your answers) when none. */
export function ekycFirstIncompleteStep(steps: readonly EkycStepDef[], errors: readonly EkycValidationError[]): number {
  let first = steps.length;
  for (const e of errors) {
    const i = ekycStepIndexOfPath(steps, e.fieldId);
    if (i >= 0 && i < first) first = i;
  }
  return first;
}

/**
 * Errors in the order the client meets them: by step, then by the field's
 * place in the step (a group's own error first, then its rows top down, each
 * row in layout order), uploads in slot order. Unknown paths go last.
 */
export function ekycSortErrors(
  steps: readonly EkycStepDef[],
  errors: readonly EkycValidationError[]
): EkycValidationError[] {
  const BIG = Number.MAX_SAFE_INTEGER;
  const key = (path: string): number[] => {
    const stepIndex = ekycStepIndexOfPath(steps, path);
    if (stepIndex < 0) return [BIG];
    if (path.startsWith('documents.')) {
      const slot = EKYC_DOCUMENT_SLOTS.findIndex((d) => `documents.${d.slot}` === path);
      return [stepIndex, -1, slot < 0 ? BIG : slot];
    }
    const items = steps[stepIndex].items;
    const exact = items.indexOf(path);
    if (exact >= 0) return [stepIndex, exact];
    const parts = path.split('.');
    const itemIndex = items.indexOf(parts[0]);
    if (parts.length === 1) return [stepIndex, itemIndex, -1];
    const rowNo = Number(parts[1]);
    const fieldOrder = (EKYC_GROUP_ROWS[parts[0]] ?? []).flat();
    const fieldIndex = fieldOrder.indexOf(parts.slice(2).join('.'));
    return [stepIndex, itemIndex, Number.isFinite(rowNo) ? rowNo : BIG, fieldIndex < 0 ? BIG : fieldIndex];
  };
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? -1) - (b[i] ?? -1);
      if (d !== 0) return d;
    }
    return 0;
  };
  return errors
    .map((e, i) => ({ e, i, k: key(e.fieldId) }))
    .sort((x, y) => compare(x.k, y.k) || x.i - y.i)
    .map((x) => x.e);
}
