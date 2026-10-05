// MIRRORED with tme-portal src/lib/ekyc/types.ts - change both.
// Copied verbatim; do not edit here alone.
// eKYC (corporate + individual) - the shared data contract.
//
// ONE file for: the portal (send, sync, PDF, tracker), the client form on
// tme-staff (clients.tme-services.com/kyc/<token>) and the reviewers. tme-staff
// keeps a VERBATIM copy at src/types/ekyc.ts - change both.
//
// Rules for this file:
// - Pure TypeScript. No imports at all, so it copies across repos unchanged.
// - Every text a person reads carries English + German ({ en, de }). German
//   for the corporate form is the official translation word for word
//   (ekyc-request/04-corporate-form-de.md). German we wrote ourselves (the
//   whole individual form, new option lists, notices) is marked
//   `deReviewed: false` until Renji / Tina have checked it (decision D2).
// - No em dashes or en dashes in any text. No emojis.
// - Dates are stored as ISO 'YYYY-MM-DD'; the UI shows dd.mm.yy, PDFs dd.mm.yyyy.
// - Request: ekyc-request/01-request.md; plan: HANDOFF-ekyc.md (R1-R17, D1-D4).

// ===========================================================================
// Basics
// ===========================================================================

export type EkycType = 'corporate' | 'individual';

/** Language of the invitation EMAIL (the form itself is English, or English + German). */
export type EkycLanguage = 'en' | 'de_du' | 'de_sie';

export const EKYC_TYPE_LABELS: Record<EkycType, string> = {
  corporate: 'Corp',
  individual: 'Indi',
};

export const EKYC_LANGUAGE_LABELS: Record<EkycLanguage, string> = {
  en: 'English',
  de_du: 'German (Du)',
  de_sie: 'German (Sie)',
};

/** The link in the email works for 14 days (Tina 05.10.2026: MAX 14 days; 60 between 03.10 and 05.10). Resend = new link. */
export const EKYC_LINK_EXPIRES_DAYS = 14;

/** Corporate form: at most 3 licenses (R9). */
export const EKYC_MAX_LICENSES = 3;

/** Text in both languages. `deReviewed: false` = German written by us, not yet checked. */
export interface EkycText {
  en: string;
  de: string;
  deReviewed?: boolean;
}

export interface EkycOption {
  value: string;
  en: string;
  de: string;
  deReviewed?: boolean;
}

/**
 * A short help text under a field ("Good Services": explain anything unusual in
 * plain words). German written by us, so `deReviewed: false` (D2).
 */
function plainHint(en: string, de: string): EkycText {
  return { en, de, deReviewed: false };
}

/** Pick the language of a text. `de` falls back to English when empty. */
export function ekycText(text: EkycText | undefined, lang: 'en' | 'de'): string {
  if (!text) return '';
  return lang === 'de' ? text.de || text.en : text.en;
}

/** The label of an option value, or the raw value when it is not in the list. */
export function ekycOptionLabel(
  options: readonly EkycOption[],
  value: string | null | undefined,
  lang: 'en' | 'de' = 'en'
): string {
  if (!value) return '';
  const option = options.find((o) => o.value === value);
  if (!option) return value;
  return lang === 'de' ? option.de || option.en : option.en;
}

// ===========================================================================
// Status
// ===========================================================================

/** Portal row (ekyc_requests.status). */
export type EkycStatus =
  | 'draft' // created in the portal, nothing sent yet
  | 'sent' // link emailed
  | 'in_progress' // client opened / saved a draft
  | 'received' // client submitted, synced back to the portal
  | 'approved' // AML team approved (leaves the tracker, R17)
  | 'cancelled' // staff withdrew the request
  | 'expired'; // link ran out before submit (still a "KYC sent" row, with Resend)

export const EKYC_STATUSES: readonly EkycStatus[] = [
  'draft',
  'sent',
  'in_progress',
  'received',
  'approved',
  'cancelled',
  'expired',
];

/** The only three status words a person ever sees (R16). */
export type EkycTrackerLabel = 'KYC sent' | 'KYC received' | 'KYC approved';

/** Statuses that show on the eKYC Tracker. Approved rows leave it (R17). */
export type EkycTrackerStatus = 'sent' | 'in_progress' | 'expired' | 'received';
export const EKYC_TRACKER_STATUSES: readonly EkycTrackerStatus[] = [
  'sent',
  'in_progress',
  'expired',
  'received',
];

/**
 * Stored status -> tracker label. Only these three words are ever shown; never
 * show a raw status code. 'draft' and 'cancelled' have no label (not on the
 * tracker). An expired link stays "KYC sent" with a note (EKYC_EXPIRED_NOTE).
 */
export const EKYC_STATUS_LABELS: Record<EkycTrackerStatus | 'approved', EkycTrackerLabel> = {
  sent: 'KYC sent',
  in_progress: 'KYC sent',
  expired: 'KYC sent',
  received: 'KYC received',
  approved: 'KYC approved',
};

/** Tracker label for any status, or null for 'draft' / 'cancelled'. */
export function ekycStatusLabel(status: EkycStatus): EkycTrackerLabel | null {
  return status === 'draft' || status === 'cancelled' ? null : EKYC_STATUS_LABELS[status];
}

/** Note shown on a "KYC sent" row whose link ran out. */
export const EKYC_EXPIRED_NOTE = 'Link expired';

/**
 * "Live" requests block a second request for the same client and type
 * (partial unique index in migration 602). Approved and cancelled are done.
 */
export const EKYC_LIVE_STATUSES: readonly EkycStatus[] = [
  'draft',
  'sent',
  'in_progress',
  'received',
  'expired',
];

/** Supabase row (ekyc_submissions.status). */
export type EkycSubmissionStatus =
  | 'invited' // link minted by the portal
  | 'in_progress' // client saved a draft
  | 'submitted' // client submitted; form locked (R13)
  | 'synced' // pulled back into the portal
  | 'cancelled' // link withdrawn (resend / cancel)
  | 'expired'; // past expires_at

// ===========================================================================
// Shared pieces
// ===========================================================================

/** '' = not answered yet. */
export type EkycYesNo = 'yes' | 'no' | '';

export const EKYC_YES_NO_OPTIONS: readonly EkycOption[] = [
  { value: 'yes', en: 'Yes', de: 'Ja' },
  { value: 'no', en: 'No', de: 'Nein' },
];

export interface EkycDeclaration {
  authorizedPersonName: string;
  /**
   * Drawn signature as a PNG data URL ('data:image/png;base64,...'), the same
   * format tme-staff's SignaturePad (src/components/SignatureCanvas.tsx) gives.
   */
  signature: string;
  /** ISO date 'YYYY-MM-DD'. */
  date: string;
}

export function emptyDeclaration(): EkycDeclaration {
  return { authorizedPersonName: '', signature: '', date: '' };
}

// ===========================================================================
// Option lists
// ===========================================================================

/**
 * 5. Type of Entity / Legal Status (amendment point 7, R11).
 * The client picks ONE type. For the first four (the "LLC / LLP / Sole
 * establishment / Civil Company" group) the form then asks Mainland or
 * Freezone (entityZone). The other four types have no zone question.
 */
export type EkycEntityType =
  | 'llc_llp_sole_civil'
  | 'public_listed'
  | 'government'
  | 'cooperative_association'
  | 'non_profit_foundation';

/** 5. The list from amendment point 7, word for word. The first option also asks Mainland or Freezone. */
export const EKYC_ENTITY_TYPE_OPTIONS: readonly EkycOption[] = [
  {
    value: 'llc_llp_sole_civil',
    en: 'LLC / LLP / Sole establishment / Civil Company',
    de: 'LLC / LLP / Einzelunternehmen (Sole establishment) / Zivilrechtliche Gesellschaft (Civil Company)',
    deReviewed: false,
  },
  { value: 'public_listed', en: 'Public Listed Company', de: 'Börsennotierte Gesellschaft', deReviewed: false },
  { value: 'government', en: 'Govt. Organization / Quasi-GO', de: 'Regierungsorganisation / regierungsnahe Organisation (Quasi-GO)', deReviewed: false },
  { value: 'cooperative_association', en: 'Co-operative Society / Association', de: 'Genossenschaft / Verein', deReviewed: false },
  { value: 'non_profit_foundation', en: 'Non-Profit Organization / Foundation', de: 'Gemeinnützige Organisation / Stiftung', deReviewed: false },
];

/** Entity types that need the Mainland / Freezone answer. */
export const EKYC_ENTITY_TYPES_WITH_ZONE: readonly EkycEntityType[] = ['llc_llp_sole_civil'];

export type EkycEntityZone = 'mainland' | 'freezone';

export const EKYC_ENTITY_ZONE_OPTIONS: readonly EkycOption[] = [
  { value: 'mainland', en: 'Mainland', de: 'Mainland', deReviewed: false },
  { value: 'freezone', en: 'Freezone', de: 'Freizone (Freezone)', deReviewed: false },
];

/**
 * 6. Trade License Issuing Authority (R10): the portal's authority list.
 * value = the portal's stored authority key (clients_v2.registered_authority),
 * en/de = the portal's display label (authorityLabel()). 'X Not registered' is
 * left out (a licensed company always has an authority); 'outside_uae' is
 * added. A portal test (src/lib/ekyc/__tests__/types.test.ts) fails when this
 * literal drifts from REGISTERED_AUTHORITIES / AUTHORITY_DISPLAY_LABELS.
 */
export const EKYC_AUTHORITY_OUTSIDE_UAE = 'outside_uae';

export const EKYC_AUTHORITY_OPTIONS: readonly EkycOption[] = [
  { value: 'AJM Ajman FZ', en: 'Ajman FZ', de: 'Ajman FZ' },
  { value: 'DXB DAC (Dubai Association Centre)', en: 'DAC (Dubai Association Centre)', de: 'DAC (Dubai Association Centre)' },
  { value: 'DXB DACC (Dubai Aviation City Corporation)', en: 'DACC (Dubai Aviation City Corporation)', de: 'DACC (Dubai Aviation City Corporation)' },
  { value: 'DXB DDA (Dubai Development Authority)', en: 'DDA (Dubai Development Authority)', de: 'DDA (Dubai Development Authority)' },
  { value: 'AUH DED (Department of Economic Development)', en: 'DED (Department of Economic Development) Abu Dhabi', de: 'DED (Department of Economic Development) Abu Dhabi' },
  { value: 'DXB DET (Dubai Economy & Tourism)', en: 'DET (Dubai Economy & Tourism)', de: 'DET (Dubai Economy & Tourism)' },
  { value: 'DXB DHCC FZ (Dubai Health Care City)', en: 'DHCC (Dubai Health Care City) FZ', de: 'DHCC (Dubai Health Care City) FZ' },
  { value: 'DXB DIEZA (Dubai Integrated Economic Zones Authority)', en: 'DIEZA (Dubai Integrated Economic Zones Authority)', de: 'DIEZA (Dubai Integrated Economic Zones Authority)' },
  { value: 'DXB DIFC FZ (Dubai International Financial Centre)', en: 'DIFC (Dubai International Financial Centre) FZ', de: 'DIFC (Dubai International Financial Centre) FZ' },
  { value: 'DXB DMCC FZ (Dubai Multi Commodities Centre)', en: 'DMCC (Dubai Multi Commodities Centre) FZ', de: 'DMCC (Dubai Multi Commodities Centre) FZ' },
  { value: 'DXB DWC FZ (Dubai World Central)', en: 'DWC (Dubai World Central) FZ', de: 'DWC (Dubai World Central) FZ' },
  { value: 'DXB DWTC FZ (Dubai World Trade Centre)', en: 'DWTC (Dubai World Trade Centre) FZ', de: 'DWTC (Dubai World Trade Centre) FZ' },
  { value: 'DXB ECDA (Expo City Dubai Authority)', en: 'ECDA (Expo City Dubai Authority)', de: 'ECDA (Expo City Dubai Authority)' },
  { value: 'FUJ FMFZ (Fujairah Culture & Media Authority)', en: 'FCMA (Fujairah Culture & Media Authority)', de: 'FCMA (Fujairah Culture & Media Authority)' },
  { value: 'FUJ Fujairah FZ', en: 'Fujairah FZ', de: 'Fujairah FZ' },
  { value: 'SHJ Hamriyah FZ', en: 'Hamriyah FZ', de: 'Hamriyah FZ' },
  { value: 'DXB JAFZA FZ (Jebel Ali Free Zone Authority)', en: 'JAFZA (Jebel Ali Free Zone Authority)', de: 'JAFZA (Jebel Ali Free Zone Authority)' },
  { value: 'DXB JAFZA Offshore (Jebel Ali Free Zone Authority)', en: 'JAFZA (Jebel Ali Free Zone Authority) IBC', de: 'JAFZA (Jebel Ali Free Zone Authority) IBC' },
  { value: 'AUH Masdar FZ', en: 'Masdar FZ', de: 'Masdar FZ' },
  { value: 'DXB Meydan FZ', en: 'Meydan FZ', de: 'Meydan FZ' },
  { value: 'RAK ICC IBC (International Corporate Centre)', en: 'RAK ICC (International Corporate Centre) IBC', de: 'RAK ICC (International Corporate Centre) IBC' },
  { value: 'RAK RAKEZ FZ (RAK Economic Zone)', en: 'RAKEZ (RAK Economic Zone) FZ', de: 'RAKEZ (RAK Economic Zone) FZ' },
  { value: 'RAK RAKMC FZ (RAK Maritime City)', en: 'RAKMC (RAK Maritime City) FZ', de: 'RAKMC (RAK Maritime City) FZ' },
  { value: 'SHJ SAIF FZ (Sharjah International Free Zone)', en: 'SAIF (Sharjah International Free Zone) FZ', de: 'SAIF (Sharjah International Free Zone) FZ' },
  { value: 'SHJ Shams FZ (Sharjah Media City)', en: 'Shams FZ (Sharjah Media City)', de: 'Shams FZ (Sharjah Media City)' },
  { value: 'SHJ SPC FZ (Sharjah Publishing City)', en: 'SPC (Sharjah Publishing City) FZ', de: 'SPC (Sharjah Publishing City) FZ' },
  { value: 'UMM Umm Al Quwain FZ', en: 'Umm Al Quwain FZ', de: 'Umm Al Quwain FZ' },
  { value: EKYC_AUTHORITY_OUTSIDE_UAE, en: 'Outside UAE', de: 'Außerhalb der VAE', deReviewed: false },
];

/**
 * Business units the portal asks for under two authorities (same as the
 * portal's second dropdown): DIEZA (DIEZA_BUSINESS_UNITS) and DDA
 * (DDA_BUSINESS_UNITS). Value = label = the portal's stored unit string.
 */
export const EKYC_AUTHORITY_DIEZA = 'DXB DIEZA (Dubai Integrated Economic Zones Authority)';
export const EKYC_AUTHORITY_DDA = 'DXB DDA (Dubai Development Authority)';

const unitOption = (unit: string): EkycOption => ({ value: unit, en: unit, de: unit });

export const EKYC_DIEZA_UNIT_OPTIONS: readonly EkycOption[] = [
  'DDC FZ (Dubai CommerCity)',
  'DAFZ (Dubai Airport Free Zone)',
  'DSO FZ (Dubai Silicon Oasis)',
  'IFZA (International Free Zone Authority)',
].map(unitOption);

export const EKYC_DDA_UNIT_OPTIONS: readonly EkycOption[] = [
  'DMC FZ (Dubai Media City)',
  'DIC FZ (Dubai Internet City)',
  'DKP FZ (Dubai Knowledge Park)',
  'DOC FZ (Dubai Outsource City)',
  'DSC FZ (Dubai Sport City)',
  'DSP FZ (Dubai Science Park)',
  'DPC FZ (Dubai Production City)',
  'DIAC FZ (Dubai International Academic City)',
  'ET (Emirates Towers District)',
  'D3 FZ (Dubai Design District)',
].map(unitOption);

/** The business-unit options for an authority, or [] when it has none. */
export function ekycAuthorityUnitOptions(authority: string | null | undefined): readonly EkycOption[] {
  if (authority === EKYC_AUTHORITY_DIEZA) return EKYC_DIEZA_UNIT_OPTIONS;
  if (authority === EKYC_AUTHORITY_DDA) return EKYC_DDA_UNIT_OPTIONS;
  return [];
}

/** 9. Mode of Payment (corporate), from the digiveri5 dropdown. */
export const EKYC_CORPORATE_PAYMENT_OPTIONS: readonly EkycOption[] = [
  {
    value: 'virtual_assets',
    en: 'Non-traditional payment receiving methods such as cryptocurrencies or virtual assets used.',
    de: 'Nicht traditionelle Zahlungsmethoden wie Kryptowährungen oder virtuelle Vermögenswerte werden genutzt.',
    deReviewed: false,
  },
  {
    value: 'bank_cheque_few_cash',
    en: 'Payment received by bank transfer / cheque and some cash',
    de: 'Zahlung per Banküberweisung / Scheck und in geringem Umfang in bar',
    deReviewed: false,
  },
  { value: 'cash', en: 'Payment received by cash', de: 'Zahlung in bar', deReviewed: false },
  { value: 'cheque', en: 'Payment received by cheque', de: 'Zahlung per Scheck', deReviewed: false },
  {
    value: 'mostly_cash',
    en: 'Payment received largely in cash and some cheques / bank transfers',
    de: 'Zahlung überwiegend in bar und in geringem Umfang per Scheck / Banküberweisung',
    deReviewed: false,
  },
];

/** Mode of payment (individual form, tick all that apply). */
export const EKYC_INDIVIDUAL_PAYMENT_OPTIONS: readonly EkycOption[] = [
  { value: 'bank_transfer', en: 'Bank Transfer', de: 'Banküberweisung', deReviewed: false },
  { value: 'cheque', en: 'Cheque', de: 'Scheck', deReviewed: false },
  { value: 'cash', en: 'Cash', de: 'Bargeld', deReviewed: false },
  { value: 'virtual_assets', en: 'Virtual assets', de: 'Virtuelle Vermögenswerte', deReviewed: false },
];

export const EKYC_SHAREHOLDER_TYPE_OPTIONS: readonly EkycOption[] = [
  { value: 'corporate', en: 'Corporate', de: 'Unternehmen', deReviewed: false },
  { value: 'individual', en: 'Individual (Natural Person)', de: 'Einzelperson (natürliche Person)', deReviewed: false },
];

export const EKYC_NATURE_OF_CONTROL_OPTIONS: readonly EkycOption[] = [
  { value: 'shareholding', en: 'Shareholding (Direct / Indirect)', de: 'Beteiligung (direkt / indirekt)', deReviewed: false },
  { value: 'voting_rights', en: 'Voting Rights', de: 'Stimmrechte', deReviewed: false },
  { value: 'appoint_directors', en: 'Right to Appoint Directors', de: 'Recht zur Bestellung von Direktoren', deReviewed: false },
  { value: 'other', en: 'Other (specify)', de: 'Sonstiges (bitte angeben)', deReviewed: false },
];

export const EKYC_EMIRATE_OPTIONS: readonly EkycOption[] = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
].map((e) => ({ value: e, en: e, de: e }));

/** Individual: sources of income (tick all that apply). */
export type EkycIncomeSource =
  | 'employment'
  | 'business'
  | 'investments'
  | 'inheritance'
  | 'sale_of_assets'
  | 'dividends_trust'
  | 'gifts'
  | 'pension'
  | 'crypto'
  | 'legal_settlements'
  | 'others';

export const EKYC_INCOME_SOURCE_OPTIONS: readonly EkycOption[] = [
  { value: 'employment', en: 'Employment Income (Salary, bonuses, etc.)', de: 'Einkünfte aus nichtselbständiger Arbeit (Gehalt, Boni usw.)', deReviewed: false },
  { value: 'business', en: 'Business Ownership (Income from self-owned, family-owned business, etc.)', de: 'Unternehmensbeteiligung (Einkünfte aus eigenem Unternehmen, Familienunternehmen usw.)', deReviewed: false },
  { value: 'investments', en: 'Investments (Returns from stocks, bonds, mutual funds, real estate, trading activity, etc.)', de: 'Kapitalanlagen (Erträge aus Aktien, Anleihen, Investmentfonds, Immobilien, Handelsaktivitäten usw.)', deReviewed: false },
  { value: 'inheritance', en: 'Inheritance (Assets or money inherited from family, relatives, etc.)', de: 'Erbschaft (von Familie, Verwandten usw. geerbtes Vermögen oder Geld)', deReviewed: false },
  { value: 'sale_of_assets', en: 'Sale of Assets (Proceeds from sale of property, business, art, vehicles, etc.)', de: 'Verkauf von Vermögenswerten (Erlöse aus dem Verkauf von Immobilien, Unternehmen, Kunst, Fahrzeugen usw.)', deReviewed: false },
  { value: 'dividends_trust', en: 'Dividends / Trust Income (Earnings from family trusts, funds, private equity, etc.)', de: 'Dividenden / Trust-Einkünfte (Erträge aus Familientrusts, Fonds, Private Equity usw.)', deReviewed: false },
  { value: 'gifts', en: 'Gifts (Large sums received as a gift from a family member, others, etc.)', de: 'Schenkungen (größere Beträge, die Sie von Familienmitgliedern oder anderen als Geschenk erhalten haben)', deReviewed: false },
  { value: 'pension', en: 'Pension / Retirement Income (Income from pension funds, retirement schemes, etc.)', de: 'Rente / Pension (Einkünfte aus Pensionsfonds, Altersvorsorgeplänen usw.)', deReviewed: false },
  { value: 'crypto', en: 'Crypto Assets (Proceeds from cryptocurrency investment, selling, mining, etc.)', de: 'Krypto-Vermögenswerte (Erlöse aus Investitionen in, Verkauf oder Mining von Kryptowährungen usw.)', deReviewed: false },
  { value: 'legal_settlements', en: 'Legal Settlements or Compensation (Settlement payments from lawsuits, insurance claims, etc.)', de: 'Vergleiche oder Entschädigungen (Zahlungen aus Gerichtsverfahren, Versicherungsfällen usw.)', deReviewed: false },
  { value: 'others', en: 'Others', de: 'Sonstige', deReviewed: false },
];

// ===========================================================================
// Countries (portable copy of the portal's COUNTRIES in
// src/lib/clients-v2/constants.ts; a portal test fails when they drift).
// Used for nationality, country of incorporation / residence and country lists.
// ===========================================================================

export const EKYC_UAE = 'United Arab Emirates';

export const EKYC_COUNTRIES: readonly string[] = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Anguilla',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Aruba',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bermuda',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'British Virgin Islands',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Cayman Islands',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Congo (Democratic Republic)',
  'Congo (Republic)',
  'Cook Islands',
  'Costa Rica',
  'Croatia',
  'Cuba',
  'Curacao',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Faroe Islands',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Gibraltar',
  'Greece',
  'Greenland',
  'Grenada',
  'Guatemala',
  'Guernsey',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hong Kong',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Isle of Man',
  'Israel',
  'Italy',
  'Ivory Coast',
  'Jamaica',
  'Japan',
  'Jersey',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Macao',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Montserrat',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Palestine',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Puerto Rico',
  'Qatar',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Sint Maarten',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Turks and Caicos Islands',
  'Tuvalu',
  'U.S. Virgin Islands',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zambia',
  'Zimbabwe',
];

export const EKYC_COUNTRY_OPTIONS: readonly EkycOption[] = EKYC_COUNTRIES.map((c) => ({
  value: c,
  en: c,
  de: c,
}));

// ===========================================================================
// Corporate form data
// ===========================================================================

/** One trade license (R9: up to 3). Holds form items 2, 3, 4, 6 and 15. */
export interface EkycLicenseBlock {
  licenseNumber: string; // 2
  issueDate: string; // 3 (ISO)
  expiryDate: string; // 4 (ISO)
  issuingAuthority: string; // 6 (EKYC_AUTHORITY_OPTIONS value)
  /** 6, second dropdown: only for DIEZA / DDA (ekycAuthorityUnitOptions). */
  issuingAuthorityUnit: string;
  mainActivities: string; // 15 (free text, one activity per line)
}

export type EkycShareholderType = 'corporate' | 'individual';

export interface EkycShareholder {
  type: EkycShareholderType | '';
  fullLegalName: string;
  email: string;
  /** Nationality (person) or country of incorporation (company): an EKYC_COUNTRIES value. */
  nationalityOrCountry: string;
  /** Holding in percent, above 0 and up to 100. */
  percent: number | null;
}

export type EkycNatureOfControl = 'shareholding' | 'voting_rights' | 'appoint_directors' | 'other';

export interface EkycUbo {
  fullLegalName: string;
  nationality: string;
  countryOfResidence: string;
  percent: number | null;
  natureOfControl: EkycNatureOfControl | '';
  /** Only when natureOfControl is 'other'. */
  natureOfControlOther: string;
}

/** Questionnaire items 23 to 36 (all Yes / No). */
export type EkycCorporateQuestionId =
  | 'q23'
  | 'q24'
  | 'q25'
  | 'q26'
  | 'q27'
  | 'q28'
  | 'q29'
  | 'q30'
  | 'q31'
  | 'q32'
  | 'q33'
  | 'q34'
  | 'q35'
  | 'q36';

export const EKYC_CORPORATE_QUESTION_IDS: readonly EkycCorporateQuestionId[] = [
  'q23', 'q24', 'q25', 'q26', 'q27', 'q28', 'q29', 'q30', 'q31', 'q32', 'q33', 'q34', 'q35', 'q36',
];

export interface CorporateKycData {
  companyName: string; // 1
  licenses: EkycLicenseBlock[]; // 2, 3, 4, 6, 15 (1 to 3 blocks)
  entityType: EkycEntityType | ''; // 5
  entityZone: EkycEntityZone | ''; // 5 (only for EKYC_ENTITY_TYPES_WITH_ZONE)
  countryOfIncorporation: string; // 7
  incorporationDate: string; // 8 (ISO)
  modeOfPayment: string; // 9 (EKYC_CORPORATE_PAYMENT_OPTIONS value)
  countriesOfOperation: string[]; // 10 (EKYC_COUNTRIES values)
  primaryContactName: string; // 11
  primaryContactJobTitle: string; // 12
  primaryContactEmail: string; // 13
  isBranchOrSubsidiary: EkycYesNo; // 14
  headOfficeAddress: string; // 16
  serviceOfficeAddress: string; // 17
  website: string; // 18 (optional)
  poBox: string; // 19 (optional)
  telephone: string; // 20 (optional)
  shareholders: EkycShareholder[];
  ubos: EkycUbo[];
  authorizedShareCapital: string; // 21 money, canonical "AED 50,000" (formatEkycMoney)
  issuedShareCapital: string; // 22 money, same form
  questionnaire: Record<EkycCorporateQuestionId, EkycYesNo>; // 23 to 36
  declaration: EkycDeclaration;
}

export function emptyLicenseBlock(): EkycLicenseBlock {
  return {
    licenseNumber: '',
    issueDate: '',
    expiryDate: '',
    issuingAuthority: '',
    issuingAuthorityUnit: '',
    mainActivities: '',
  };
}

export function emptyShareholder(): EkycShareholder {
  return { type: '', fullLegalName: '', email: '', nationalityOrCountry: '', percent: null };
}

export function emptyUbo(): EkycUbo {
  return {
    fullLegalName: '',
    nationality: '',
    countryOfResidence: '',
    percent: null,
    natureOfControl: '',
    natureOfControlOther: '',
  };
}

export function emptyCorporateKyc(): CorporateKycData {
  const questionnaire = {} as Record<EkycCorporateQuestionId, EkycYesNo>;
  for (const id of EKYC_CORPORATE_QUESTION_IDS) questionnaire[id] = '';
  return {
    companyName: '',
    licenses: [emptyLicenseBlock()],
    entityType: '',
    entityZone: '',
    countryOfIncorporation: '',
    incorporationDate: '',
    modeOfPayment: '',
    countriesOfOperation: [],
    primaryContactName: '',
    primaryContactJobTitle: '',
    primaryContactEmail: '',
    isBranchOrSubsidiary: '',
    headOfficeAddress: '',
    serviceOfficeAddress: '',
    website: '',
    poBox: '',
    telephone: '',
    shareholders: [emptyShareholder()],
    ubos: [emptyUbo()],
    authorizedShareCapital: '',
    issuedShareCapital: '',
    questionnaire,
    declaration: emptyDeclaration(),
  };
}

// ===========================================================================
// Individual form data (R6: nothing pre-filled)
// ===========================================================================

export interface EkycUaeAddress {
  buildingName: string;
  apartmentNo: string;
  street: string;
  city: string;
  emirate: string; // EKYC_EMIRATE_OPTIONS value
  postalCode: string;
}

export interface EkycHomeAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string; // EKYC_COUNTRIES value
}

export interface EkycEmployer {
  companyName: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface IndividualKycData {
  fullName: string; // as in the passport
  nationality: string;
  dualNationality: EkycYesNo;
  /** If dual nationality: the countries of the person's nationalities. */
  dualNationalityCountries: string[];
  uaeResident: EkycYesNo;
  /** If UAE resident. */
  uaeAddress: EkycUaeAddress;
  /** If UAE resident, e.g. +971 XX XX XX XXX. */
  uaePhone: string;
  /** If NOT a UAE resident. */
  homeAddress: EkycHomeAddress;
  /** If NOT a UAE resident, with country / area code. */
  homePhone: string;
  gccNational: EkycYesNo;
  incomeSources: EkycIncomeSource[];
  /** If incomeSources has 'employment'. */
  employer: EkycEmployer;
  /** If incomeSources has 'business'. */
  businessCountries: string[];
  /** If incomeSources has 'others'. */
  incomeOthers: string;
  isPep: EkycYesNo;
  pepCountry: string; // if isPep
  rcaIsPep: EkycYesNo;
  rcaName: string; // if rcaIsPep
  rcaRelationship: string; // if rcaIsPep
  rcaCountry: string; // if rcaIsPep
  sanctioned: EkycYesNo;
  sanctionDetails: string; // if sanctioned
  highRisk: EkycYesNo;
  highRiskCountry: string; // if highRisk
  trustCharity: EkycYesNo;
  trustCharityNames: string; // if trustCharity
  /** Tick all that apply (EKYC_INDIVIDUAL_PAYMENT_OPTIONS values). */
  modesOfPayment: string[];
  declaration: EkycDeclaration;
}

export function emptyIndividualKyc(): IndividualKycData {
  return {
    fullName: '',
    nationality: '',
    dualNationality: '',
    dualNationalityCountries: [],
    uaeResident: '',
    uaeAddress: { buildingName: '', apartmentNo: '', street: '', city: '', emirate: '', postalCode: '' },
    uaePhone: '',
    homeAddress: { street: '', city: '', postalCode: '', country: '' },
    homePhone: '',
    gccNational: '',
    incomeSources: [],
    employer: { companyName: '', city: '', postalCode: '', country: '' },
    businessCountries: [],
    incomeOthers: '',
    isPep: '',
    pepCountry: '',
    rcaIsPep: '',
    rcaName: '',
    rcaRelationship: '',
    rcaCountry: '',
    sanctioned: '',
    sanctionDetails: '',
    highRisk: '',
    highRiskCountry: '',
    trustCharity: '',
    trustCharityNames: '',
    modesOfPayment: [],
    declaration: emptyDeclaration(),
  };
}

// ===========================================================================
// Individual document uploads (decision D4)
// ===========================================================================

export type EkycDocumentSlot =
  | 'passport'
  | 'second_passport'
  | 'photo'
  | 'eid_front'
  | 'eid_back'
  | 'proof_of_address'
  | 'gcc_id';

/** One uploaded file, as stored on the Supabase row (bucket `ekyc-documents`). */
export interface EkycDocumentRef {
  /** Path inside the bucket: <submission-id>/<slot>-<uuid>.<ext> */
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string; // ISO timestamp
}

/** Supabase ekyc_submissions.documents. */
export type EkycDocuments = Partial<Record<EkycDocumentSlot, EkycDocumentRef>>;

/** Portal ekyc_requests.documents: the copies filed in the portal. */
export interface EkycPortalDocumentRef {
  clientDocumentId: string | null; // client_documents.id when filed on a client
  filePath: string; // portal storage path
  filename: string;
  mimeType: string;
  size: number;
}
export type EkycPortalDocuments = Partial<Record<EkycDocumentSlot, EkycPortalDocumentRef>>;

export interface EkycDocumentSlotDef {
  slot: EkycDocumentSlot;
  number: string; // as on the paper form
  label: EkycText;
  /** Short help text under the upload slot. */
  hint?: EkycText;
  /** Required (and shown) only when this returns true. */
  requiredWhen: (data: IndividualKycData) => boolean;
}

/** Shown once above the upload slots: what files we accept. */
export const EKYC_DOCUMENT_UPLOAD_HINT: EkycText = plainHint(
  'PDF, JPG or PNG. A clear photo or scan where all four corners can be seen.',
  'PDF, JPG oder PNG. Ein gut lesbares Foto oder ein Scan, auf dem alle vier Ecken zu sehen sind.'
);

export const EKYC_DOCUMENT_SLOTS: readonly EkycDocumentSlotDef[] = [
  {
    slot: 'passport',
    number: '1',
    label: { en: 'Passport Copy', de: 'Kopie des Reisepasses', deReviewed: false },
    hint: plainHint('The page with your photo and personal details.', 'Die Seite mit Ihrem Foto und Ihren persönlichen Daten.'),
    requiredWhen: () => true,
  },
  {
    slot: 'second_passport',
    number: '2',
    label: { en: 'Copy of second passport, in case of dual nationality', de: 'Kopie des zweiten Reisepasses bei doppelter Staatsangehörigkeit', deReviewed: false },
    hint: plainHint('The photo page of your other passport.', 'Die Seite mit Ihrem Foto in Ihrem anderen Reisepass.'),
    requiredWhen: (d) => d.dualNationality === 'yes',
  },
  {
    slot: 'photo',
    number: '3',
    label: { en: 'Latest passport-size photo', de: 'Aktuelles Passfoto', deReviewed: false },
    hint: plainHint(
      'A recent photo of your face on a plain white background, like for a visa.',
      'Ein aktuelles Foto Ihres Gesichts vor einfarbig weißem Hintergrund, wie für ein Visum.'
    ),
    requiredWhen: () => true,
  },
  {
    slot: 'eid_front',
    number: '4',
    label: { en: 'EID Front, in case of a resident of the UAE', de: 'Emirates ID Vorderseite, bei Wohnsitz in den VAE', deReviewed: false },
    hint: plainHint('The side of your Emirates ID with your photo.', 'Die Seite Ihrer Emirates ID mit Ihrem Foto.'),
    requiredWhen: (d) => d.uaeResident === 'yes',
  },
  {
    slot: 'eid_back',
    number: '4',
    label: { en: 'EID Back, in case of a resident of the UAE', de: 'Emirates ID Rückseite, bei Wohnsitz in den VAE', deReviewed: false },
    hint: plainHint('The other side of the same card.', 'Die andere Seite derselben Karte.'),
    requiredWhen: (d) => d.uaeResident === 'yes',
  },
  {
    slot: 'proof_of_address',
    number: '5',
    label: {
      en: 'Proof of residential address: utility bill, government-issued documents, lease agreement, or an account statement issued by a government regulated financial institution',
      de: 'Nachweis der Wohnadresse: Nebenkostenabrechnung, behördlich ausgestellte Dokumente, Mietvertrag oder Kontoauszug eines staatlich regulierten Finanzinstituts',
      deReviewed: false,
    },
    hint: plainHint(
      'Any one of these. It must show your name and your home address.',
      'Eines dieser Dokumente genügt. Es muss Ihren Namen und Ihre Wohnadresse zeigen.'
    ),
    requiredWhen: () => true,
  },
  {
    slot: 'gcc_id',
    number: '6',
    label: { en: 'GCC ID card, if a GCC national', de: 'GCC-Ausweis bei GCC-Staatsangehörigkeit', deReviewed: false },
    hint: plainHint('The national ID card of your GCC country.', 'Der Personalausweis Ihres GCC-Staates.'),
    requiredWhen: (d) => d.gccNational === 'yes',
  },
];

/** The slots this person must upload, in form order. */
export function ekycRequiredDocumentSlots(data: IndividualKycData): EkycDocumentSlot[] {
  return EKYC_DOCUMENT_SLOTS.filter((s) => s.requiredWhen(data)).map((s) => s.slot);
}

// ===========================================================================
// Money (share capital, fields 21 and 22)
// ===========================================================================
//
// The form shows an amount box plus a currency dropdown (Damir 02.10). The
// value is still stored as ONE string in the canonical form
// "<ISO> <amount>": comma thousand separators, up to 2 decimals, for example
// "AED 50,000" or "EUR 1,250.50". Prefill, PDF and portal code read it as text.

export const EKYC_DEFAULT_CURRENCY = 'AED';

// [ISO code, English name, German name]. Source: the ISO codes of the portal's
// CBUAE_NAME_TO_ISO (src/lib/exchange-rates/cbuae.ts) plus AED. A portal test
// fails when this list drifts from that map. Order: the common ones first, then
// the rest alphabetically by code.
const EKYC_CURRENCIES: readonly (readonly [string, string, string])[] = [
  ['AED', 'UAE Dirham', 'VAE-Dirham'],
  ['USD', 'US Dollar', 'US-Dollar'],
  ['EUR', 'Euro', 'Euro'],
  ['GBP', 'British Pound', 'Britisches Pfund'],
  ['CHF', 'Swiss Franc', 'Schweizer Franken'],
  ['SAR', 'Saudi Riyal', 'Saudi-Riyal'],
  ['INR', 'Indian Rupee', 'Indische Rupie'],
  ['ARS', 'Argentine Peso', 'Argentinischer Peso'],
  ['AUD', 'Australian Dollar', 'Australischer Dollar'],
  ['AZN', 'Azerbaijani Manat', 'Aserbaidschan-Manat'],
  ['BDT', 'Bangladeshi Taka', 'Bangladesch-Taka'],
  ['BGN', 'Bulgarian Lev', 'Bulgarischer Lew'],
  ['BHD', 'Bahraini Dinar', 'Bahrain-Dinar'],
  ['BND', 'Brunei Dollar', 'Brunei-Dollar'],
  ['BRL', 'Brazilian Real', 'Brasilianischer Real'],
  ['BWP', 'Botswana Pula', 'Botswanischer Pula'],
  ['BYN', 'Belarusian Ruble', 'Belarussischer Rubel'],
  ['CAD', 'Canadian Dollar', 'Kanadischer Dollar'],
  ['CLP', 'Chilean Peso', 'Chilenischer Peso'],
  ['CNH', 'Chinese Yuan Offshore', 'Chinesischer Yuan Offshore'],
  ['CNY', 'Chinese Yuan', 'Chinesischer Yuan'],
  ['COP', 'Colombian Peso', 'Kolumbianischer Peso'],
  ['CZK', 'Czech Koruna', 'Tschechische Krone'],
  ['DKK', 'Danish Krone', 'Dänische Krone'],
  ['DZD', 'Algerian Dinar', 'Algerischer Dinar'],
  ['EGP', 'Egyptian Pound', 'Ägyptisches Pfund'],
  ['ETB', 'Ethiopian Birr', 'Äthiopischer Birr'],
  ['HKD', 'Hong Kong Dollar', 'Hongkong-Dollar'],
  ['HRK', 'Croatian Kuna', 'Kroatische Kuna'],
  ['HUF', 'Hungarian Forint', 'Ungarischer Forint'],
  ['IDR', 'Indonesian Rupiah', 'Indonesische Rupiah'],
  ['ILS', 'Israeli New Shekel', 'Israelischer Schekel'],
  ['IQD', 'Iraqi Dinar', 'Irakischer Dinar'],
  ['IRR', 'Iranian Rial', 'Iranischer Rial'],
  ['ISK', 'Icelandic Krona', 'Isländische Krone'],
  ['JOD', 'Jordanian Dinar', 'Jordanischer Dinar'],
  ['JPY', 'Japanese Yen', 'Japanischer Yen'],
  ['KES', 'Kenyan Shilling', 'Kenia-Schilling'],
  ['KRW', 'South Korean Won', 'Südkoreanischer Won'],
  ['KWD', 'Kuwaiti Dinar', 'Kuwait-Dinar'],
  ['KZT', 'Kazakhstani Tenge', 'Kasachischer Tenge'],
  ['LBP', 'Lebanese Pound', 'Libanesisches Pfund'],
  ['LKR', 'Sri Lankan Rupee', 'Sri-Lanka-Rupie'],
  ['LYD', 'Libyan Dinar', 'Libyscher Dinar'],
  ['MAD', 'Moroccan Dirham', 'Marokkanischer Dirham'],
  ['MKD', 'Macedonian Denar', 'Mazedonischer Denar'],
  ['MUR', 'Mauritian Rupee', 'Mauritius-Rupie'],
  ['MXN', 'Mexican Peso', 'Mexikanischer Peso'],
  ['MYR', 'Malaysian Ringgit', 'Malaysischer Ringgit'],
  ['NGN', 'Nigerian Naira', 'Nigerianischer Naira'],
  ['NOK', 'Norwegian Krone', 'Norwegische Krone'],
  ['NPR', 'Nepalese Rupee', 'Nepalesische Rupie'],
  ['NZD', 'New Zealand Dollar', 'Neuseeland-Dollar'],
  ['OMR', 'Omani Rial', 'Omanischer Rial'],
  ['PEN', 'Peruvian Sol', 'Peruanischer Sol'],
  ['PHP', 'Philippine Peso', 'Philippinischer Peso'],
  ['PKR', 'Pakistani Rupee', 'Pakistanische Rupie'],
  ['PLN', 'Polish Zloty', 'Polnischer Zloty'],
  ['QAR', 'Qatari Riyal', 'Katar-Riyal'],
  ['RON', 'Romanian Leu', 'Rumänischer Leu'],
  ['RSD', 'Serbian Dinar', 'Serbischer Dinar'],
  ['RUB', 'Russian Ruble', 'Russischer Rubel'],
  ['SDG', 'Sudanese Pound', 'Sudanesisches Pfund'],
  ['SEK', 'Swedish Krona', 'Schwedische Krone'],
  ['SGD', 'Singapore Dollar', 'Singapur-Dollar'],
  ['SYP', 'Syrian Pound', 'Syrisches Pfund'],
  ['THB', 'Thai Baht', 'Thailändischer Baht'],
  ['TMT', 'Turkmen Manat', 'Turkmenistan-Manat'],
  ['TND', 'Tunisian Dinar', 'Tunesischer Dinar'],
  ['TRY', 'Turkish Lira', 'Türkische Lira'],
  ['TTD', 'Trinidad and Tobago Dollar', 'Trinidad-und-Tobago-Dollar'],
  ['TWD', 'Taiwan Dollar', 'Taiwan-Dollar'],
  ['TZS', 'Tanzanian Shilling', 'Tansania-Schilling'],
  ['UGX', 'Ugandan Shilling', 'Uganda-Schilling'],
  ['UZS', 'Uzbekistani Som', 'Usbekistan-Som'],
  ['VND', 'Vietnamese Dong', 'Vietnamesischer Dong'],
  ['YER', 'Yemeni Rial', 'Jemen-Rial'],
  ['ZAR', 'South African Rand', 'Südafrikanischer Rand'],
  ['ZMW', 'Zambian Kwacha', 'Sambischer Kwacha'],
];

/** Currency dropdown: value = ISO code, label "AED (UAE Dirham)". AED first (the default). */
export const EKYC_CURRENCY_OPTIONS: readonly EkycOption[] = EKYC_CURRENCIES.map(([code, en, de]) => ({
  value: code,
  en: `${code} (${en})`,
  de: `${code} (${de})`,
  deReviewed: false,
}));

const EKYC_CURRENCY_CODES: ReadonlySet<string> = new Set(EKYC_CURRENCIES.map(([code]) => code));

/** Group the integer digits with commas: '1250000' -> '1,250,000'. */
function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '007' -> '7', '' -> '0'. */
function stripLeadingZeros(digits: string): string {
  const s = digits.replace(/^0+/, '');
  return s === '' ? '0' : s;
}

/** Thousand groups 'a<sep>bbb<sep>bbb' -> digits, or null when the groups are not 1-3 then 3 digits each. */
function joinThousandGroups(text: string, sep: string): string | null {
  const groups = text.split(sep);
  if (!/^\d{1,3}$/.test(groups[0])) return null;
  for (let i = 1; i < groups.length; i += 1) {
    if (!/^\d{3}$/.test(groups[i])) return null;
  }
  return groups.join('');
}

/**
 * Read the number part of a money text. Returns plain digits with an optional
 * '.dd' (always 2 decimals; '.00' is dropped), or null.
 *
 * Separator rules (spaces and apostrophes are thousand separators and dropped):
 * - Both ',' and '.': the LAST one is the decimal point, the other one groups
 *   thousands ('1,250.50' and '1.250,50' both = 1250.50).
 * - Only ',': several commas = thousands ('1,250,000'). One comma followed by
 *   exactly 3 digits = thousands ('50,000', the canonical form); otherwise a
 *   decimal comma ('12,5' = 12.50).
 * - Only '.': several dots = thousands ('1.250.000'). ONE dot is always the
 *   decimal point, also with 3 digits after it ('50.000' = 50, '50.500' =
 *   50.50). Zeros past the 2nd decimal are dropped; anything else past the 2nd
 *   decimal is rejected (null).
 */
function parseEkycAmount(raw: string): string | null {
  const text = raw.replace(/[\s']/g, '');
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const commas = text.split(',').length - 1;
  const dots = text.split('.').length - 1;

  let intText: string;
  let decText = '';
  let intSep = '';
  if (commas > 0 && dots > 0) {
    const decSep = lastComma > lastDot ? ',' : '.';
    intSep = decSep === ',' ? '.' : ',';
    const at = text.lastIndexOf(decSep);
    intText = text.slice(0, at);
    decText = text.slice(at + 1);
    if (intText.includes(decSep)) return null;
  } else if (commas > 0 || dots > 0) {
    const sep = commas > 0 ? ',' : '.';
    const count = commas > 0 ? commas : dots;
    const parts = text.split(sep);
    const thousands = count > 1 || (sep === ',' && /^\d{3}$/.test(parts[1]));
    if (thousands) {
      intText = text;
      intSep = sep;
    } else {
      intText = parts[0];
      decText = parts[1];
    }
  } else {
    intText = text;
  }

  let intDigits: string | null = intText;
  if (intSep) intDigits = intText.includes(intSep) ? joinThousandGroups(intText, intSep) : intText;
  if (intDigits === null || !/^\d+$/.test(intDigits)) return null;
  if (decText !== '' && !/^\d+$/.test(decText)) return null;
  if (intText === '' && decText === '') return null;

  const dec = decText.replace(/0+$/, '');
  if (dec.length > 2) return null;
  const amount = stripLeadingZeros(intDigits);
  return dec === '' ? amount : `${amount}.${dec.padEnd(2, '0')}`;
}

/**
 * Read a money value: the canonical form ('AED 50,000') and older free text
 * ('AED 100,000', '100000 AED', 'AED100000', 'eur 1.250,50'). The currency is
 * 3 letters before or after the number (upper-cased; it may be a code that is
 * not in the list, isEkycMoney rejects that); no letters = AED. The amount
 * follows the separator rules of parseEkycAmount and comes back as plain
 * digits with an optional '.dd', no commas. Null when it cannot be read.
 */
export function parseEkycMoney(value: unknown): { currency: string; amount: string } | null {
  if (typeof value !== 'string') return null;
  const m = /^([A-Za-z]{3})?\s*([\d.,'\s]*\d[\d.,'\s]*?)\s*([A-Za-z]{3})?$/.exec(value.trim());
  if (!m) return null;
  if (m[1] && m[3]) return null;
  const amount = parseEkycAmount(m[2]);
  if (amount === null) return null;
  return { currency: (m[1] || m[3] || EKYC_DEFAULT_CURRENCY).toUpperCase(), amount };
}

/**
 * The canonical string for a currency + amount ('AED', '50000' -> 'AED 50,000').
 * The amount may be typed with separators (parseEkycMoney rules). Empty amount
 * = ''. An amount that cannot be read is kept as typed after the code, so the
 * validator can point at it. No currency = AED.
 */
export function formatEkycMoney(currency: string, amount: string): string {
  const typed = (amount ?? '').trim();
  if (typed === '') return '';
  const code = (currency ?? '').trim().toUpperCase() || EKYC_DEFAULT_CURRENCY;
  const parsed = parseEkycAmount(typed);
  if (parsed === null) return `${code} ${typed}`;
  const [intDigits, dec] = parsed.split('.');
  return `${code} ${groupThousands(intDigits)}${dec ? `.${dec}` : ''}`;
}

const CANONICAL_MONEY = /^([A-Z]{3}) ((?:0|[1-9]\d{0,2})(?:,\d{3})*)(?:\.(\d{1,2}))?$/;

/** True for the canonical form with a currency from the list and an amount above 0 (max 2 decimals). */
export function isEkycMoney(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = CANONICAL_MONEY.exec(value);
  if (!m || !EKYC_CURRENCY_CODES.has(m[1])) return false;
  if (m[2].startsWith('0') && m[2].length > 1) return false;
  return Number(`${m[2].replace(/,/g, '')}.${m[3] ?? '0'}`) > 0;
}

// ===========================================================================
// Lists (kind 'lines', main activities 15)
// ===========================================================================

/**
 * The lines of a 'lines' value ('Trading\nConsulting' -> ['Trading',
 * 'Consulting']): each line trimmed, empty lines dropped. Not a string = [].
 */
export function ekycSplitLines(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The stored value of a list: lines trimmed, empty ones dropped, joined with '\n'. */
export function ekycJoinLines(lines: readonly string[]): string {
  return ekycSplitLines(lines.join('\n')).join('\n');
}

// ===========================================================================
// Field schema (client form, PDF, reviewers)
// ===========================================================================

/** Help under every phone field: the country code has its own picker (Damir 02.10). */
export const EKYC_PHONE_HINT: EkycText = {
  en: 'Choose the country code, then type the number.',
  de: 'Wählen Sie die Ländervorwahl und geben Sie dann die Nummer ein.',
  deReviewed: false,
};

export type EkycFieldKind =
  | 'text'
  | 'textarea'
  | 'lines' // a list, one input box per line; stored as ONE string joined with '\n' (ekycSplitLines / ekycJoinLines)
  | 'email'
  | 'phone'
  | 'url'
  | 'date' // ISO value, shown dd.mm.yy (PDF dd.mm.yyyy)
  | 'country' // one EKYC_COUNTRIES value
  | 'countries' // several EKYC_COUNTRIES values (string[])
  | 'select' // one of `options`
  | 'multiselect' // several of `options` (string[])
  | 'yesno' // EkycYesNo
  | 'percent' // number above 0 and up to 100
  | 'money' // canonical 'AED 50,000' (amount + currency dropdown, see parseEkycMoney)
  | 'signature'; // PNG data URL

/**
 * One question. `id` is the path inside the data object (dots for nested
 * objects, e.g. 'uaeAddress.street', 'questionnaire.q23'). For a field inside a
 * repeating group the id is the key inside ONE row (e.g. 'licenseNumber'),
 * and its full path is '<group>.<index>.<id>' (ekycRowPath).
 */
export interface EkycFieldDef<D, R = D> {
  id: string;
  /** Number as printed on the form ('6'); undefined where the form has none. */
  number?: string;
  label: EkycText;
  hint?: EkycText;
  /** A web link shown under the hint (Renji 05.10.2026: the FATF list at Q28). */
  hintLink?: EkycHintLink;
  kind: EkycFieldKind;
  options?: readonly EkycOption[];
  /** Required whenever the field is visible. */
  required: boolean;
  /** Hidden fields are not shown, not required and not printed. Default: shown. */
  visibleWhen?: (data: D, row: R) => boolean;
  /** Options that depend on other answers (business units of field 6). */
  optionsFor?: (data: D, row: R) => readonly EkycOption[];
  /** The portal may pre-fill this field (R7). Individual: never (R6). */
  prefillable: boolean;
  /**
   * D8: a PERSON name. Latin letters only, passport MRZ style. The form
   * converts as the client types (ekycToLatinName) and submit rejects anything
   * else (isEkycLatinName). Use isEkycLatinNameField: `latinNameWhen` can
   * limit it (shareholder name only for an individual shareholder).
   */
  latinName?: boolean;
  /** Only with latinName: the Latin rule applies only when this returns true. Default: always. */
  latinNameWhen?: (data: D, row: R) => boolean;
}

/** A repeating block of rows (licenses, shareholders, UBOs). */
export interface EkycGroupDef<D, R> {
  /** Array property on the data object, also the group's path. */
  id: string;
  label: EkycText;
  hint?: EkycText;
  /** Rows the client must have at submit. */
  min: number;
  /** Most rows allowed; undefined = no limit. */
  max?: number;
  /** Text on the add-row button. */
  addLabel: EkycText;
  /** Heading of ONE row, numbered by the form ("Shareholder 2"). */
  rowLabel: EkycText;
  fields: readonly EkycFieldDef<D, R>[];
  /** The whole group may be pre-filled (R7). */
  prefillable: boolean;
}

/** A section on the form. `items` = top-level field ids and group ids, in order. */
export interface EkycSectionDef {
  id: string;
  title: EkycText;
  intro?: EkycText;
  items: readonly string[];
}

export interface EkycFormSchema<D> {
  type: EkycType;
  title: EkycText;
  intro: EkycText;
  sections: readonly EkycSectionDef[];
  fields: readonly EkycFieldDef<D, D>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows differ per group (license / shareholder / UBO)
  groups: readonly EkycGroupDef<D, any>[];
}

/** Full path of a field inside a group row. */
export function ekycRowPath(groupId: string, index: number, fieldId: string): string {
  return `${groupId}.${index}.${fieldId}`;
}

/** Read a value by dot path ('uaeAddress.street', 'licenses.0.issueDate'). */
export function getEkycValue(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Shared texts
// ---------------------------------------------------------------------------

/** R8: shown at the top of a pre-filled corporate form. */
export const EKYC_PREFILL_NOTICE: EkycText = {
  en: 'TME Services has filled in some answers in this form from the information we hold. You are responsible for checking ALL pre-filled information and correcting anything that is wrong before you submit the form.',
  de: 'TME Services hat einige Angaben in diesem Formular aus den uns vorliegenden Informationen vorausgefüllt. Sie sind dafür verantwortlich, ALLE vorausgefüllten Angaben zu prüfen und fehlerhafte Angaben vor dem Absenden zu korrigieren.',
  deReviewed: false,
};

/** Small marker next to a pre-filled field. */
export const EKYC_PREFILLED_FIELD_MARK: EkycText = {
  en: 'Pre-filled by TME Services, please check',
  de: 'Von TME Services vorausgefüllt, bitte prüfen',
  deReviewed: false,
};

/** R13: shown when the client presses Submit / after submit. */
export const EKYC_SUBMIT_WARNING: EkycText = {
  en: 'After you submit the form, you can no longer change it.',
  de: 'Nach dem Absenden können Sie das Formular nicht mehr ändern.',
  deReviewed: false,
};

export const EKYC_SUBMITTED_NOTICE: EkycText = {
  en: 'Thank you. Your KYC form has been submitted and can no longer be changed.',
  de: 'Vielen Dank. Ihr KYC-Formular wurde abgesendet und kann nicht mehr geändert werden.',
  deReviewed: false,
};

export const EKYC_PRIVACY_TITLE: EkycText = {
  en: 'Privacy & Data Protection Disclaimer',
  de: 'Hinweis zu Datenschutz und Datensicherheit',
};

/** Paragraphs of the privacy disclaimer (same on both forms, official German). */
export const EKYC_PRIVACY_PARAGRAPHS: readonly EkycText[] = [
  {
    en: 'TME Services is committed to protecting your personal data in compliance with the UAE Personal Data Protection Law (PDPL). We require explicit consent before collecting or processing personal information. However, in cases where processing is necessary for regulatory compliance, legal obligations, public interest, or to fulfil contractual services, we may proceed without prior consent, as permitted by law.',
    de: 'TME Services verpflichtet sich, Ihre personenbezogenen Daten gemäß dem Datenschutzgesetz der VAE (PDPL) zu schützen. Vor der Erhebung oder Verarbeitung personenbezogener Daten holen wir Ihre ausdrückliche Einwilligung ein. Ist die Verarbeitung jedoch zur Erfüllung regulatorischer Vorgaben, gesetzlicher Pflichten, im öffentlichen Interesse oder zur Erbringung vertraglicher Leistungen erforderlich, können wir die Daten, soweit gesetzlich zulässig, auch ohne vorherige Einwilligung verarbeiten.',
  },
  {
    en: 'As a corporate service provider, we may process personal data for business registrations, legal structuring, and related services. All data processing is conducted securely, transparently, and in alignment with industry best practices.',
    de: 'Als Corporate Service Provider können wir personenbezogene Daten für Unternehmensregistrierungen, rechtliche Strukturierungen und damit verbundene Dienstleistungen verarbeiten. Die gesamte Datenverarbeitung erfolgt sicher, transparent und im Einklang mit den bewährten Verfahren der Branche.',
  },
  {
    en: 'By engaging in our services, you acknowledge and consent to the data processing as outlined in this agreement.',
    de: 'Mit der Inanspruchnahme unserer Dienstleistungen nehmen Sie die in dieser Vereinbarung beschriebene Datenverarbeitung zur Kenntnis und willigen in diese ein.',
  },
  {
    en: 'For more details on how we handle personal data, please contact us at dpo@TME-Services.com.',
    de: 'Weitere Informationen zum Umgang mit personenbezogenen Daten erhalten Sie unter dpo@TME-Services.com.',
  },
];

export const EKYC_DECLARATION_TITLE: EkycText = { en: 'Declaration', de: 'Erklärung' };

export const EKYC_DECLARATION_TEXT: EkycText = {
  en: 'I/We hereby declare that the details provided above are true and correct to the best of my/our knowledge and belief. I/We intend to inform you of any changes therein immediately. If any of the above information is found to be false or untrue or misleading, or misrepresenting, I/We am/are aware that I/we may be held liable for it, which may result in an automatic denial of a relationship with TME.',
  de: 'Ich/Wir erkläre(n) hiermit, dass die oben gemachten Angaben nach bestem Wissen und Gewissen wahr und richtig sind. Ich/Wir verpflichte(n) mich/uns, Sie unverzüglich über etwaige Änderungen zu informieren. Mir/Uns ist bewusst, dass ich/wir haftbar gemacht werden kann/können, falls sich eine der oben genannten Angaben als falsch, unwahr, irreführend oder unzutreffend herausstellt, was zur automatischen Ablehnung einer Geschäftsbeziehung mit TME führen kann.',
};

/** Fields of the privacy + declaration block, same ids on both forms. */
function closingFields<D>(nameHint?: EkycText): EkycFieldDef<D, D>[] {
  return [
    {
      id: 'declaration.authorizedPersonName',
      label: { en: "Authorized Person's name", de: 'Name der bevollmächtigten Person' },
      ...(nameHint ? { hint: nameHint } : {}),
      kind: 'text',
      required: true,
      prefillable: false,
      latinName: true,
    },
    { id: 'declaration.signature', label: { en: 'Signature', de: 'Unterschrift' }, kind: 'signature', required: true, prefillable: false },
    { id: 'declaration.date', label: { en: 'Date', de: 'Datum' }, kind: 'date', required: true, prefillable: false },
  ];
}

const CLOSING_ITEMS = [
  'declaration.authorizedPersonName',
  'declaration.signature',
  'declaration.date',
] as const;

// ---------------------------------------------------------------------------
// Corporate schema
// ---------------------------------------------------------------------------

const PEP_DEFINITION: EkycText = {
  en: "(PEPs are natural persons who are or have been entrusted with prominent public functions in the State or any other foreign country such as heads of state or governments, senior politicians, senior government officials, judicial or military officials, senior executive managers of state-owned corporations, and senior officials of political parties and persons who are, or have previously been, entrusted with the management of an international organization or any prominent function within such an organization.)",
  de: '(PEPs sind natürliche Personen, die im Staat oder in einem anderen Land mit herausragenden öffentlichen Ämtern betraut sind oder waren, z. B. Staats- oder Regierungschefs, hochrangige Politiker, hochrangige Regierungsbeamte, Justiz- oder Militärbeamte, leitende Führungskräfte staatseigener Unternehmen und hochrangige Funktionäre politischer Parteien, sowie Personen, die mit der Leitung einer internationalen Organisation oder einer herausragenden Funktion innerhalb einer solchen Organisation betraut sind oder waren.)',
};

export const CORPORATE_LICENSE_FIELDS: readonly EkycFieldDef<CorporateKycData, EkycLicenseBlock>[] = [
  {
    id: 'licenseNumber',
    number: '2',
    label: { en: 'Registration / Trade License Number', de: 'Registrierungs- / Handelslizenznummer' },
    kind: 'text',
    required: true,
    prefillable: true,
  },
  {
    id: 'issueDate',
    number: '3',
    label: { en: 'Trade License Issue Date', de: 'Ausstellungsdatum der Handelslizenz' },
    kind: 'date',
    required: true,
    prefillable: true,
  },
  {
    id: 'expiryDate',
    number: '4',
    label: { en: 'Trade License Expiry Date', de: 'Ablaufdatum der Handelslizenz' },
    kind: 'date',
    required: true,
    prefillable: true,
  },
  {
    id: 'issuingAuthority',
    number: '6',
    label: { en: 'Trade License Issuing Authority', de: 'Ausstellende Behörde der Handelslizenz' },
    kind: 'select',
    hint: plainHint(
      'The authority named on the license. Choose Outside UAE for a license from another country.',
      'Die Behörde, die auf der Lizenz steht. Wählen Sie „Außerhalb der VAE“ für eine Lizenz aus einem anderen Land.'
    ),
    options: EKYC_AUTHORITY_OPTIONS,
    required: true,
    prefillable: true,
  },
  {
    id: 'issuingAuthorityUnit',
    number: '6',
    label: { en: 'Business unit', de: 'Geschäftseinheit', deReviewed: false },
    hint: plainHint(
      'This authority has several free zones. Choose the one named on your license.',
      'Diese Behörde hat mehrere Freizonen. Wählen Sie die Freizone, die auf Ihrer Lizenz steht.'
    ),
    kind: 'select',
    required: true,
    visibleWhen: (_d, row) => ekycAuthorityUnitOptions(row.issuingAuthority).length > 0,
    optionsFor: (_d, row) => ekycAuthorityUnitOptions(row.issuingAuthority),
    prefillable: true,
  },
  {
    id: 'mainActivities',
    number: '15',
    label: { en: 'Main activities of the reporting entity as per the Trade License', de: 'Haupttätigkeiten des meldenden Unternehmens laut Handelslizenz' },
    hint: plainHint(
      'One activity per box, as written on your trade license.',
      'Eine Tätigkeit pro Feld, wie auf Ihrer Handelslizenz.'
    ),
    kind: 'lines',
    required: true,
    prefillable: true,
  },
];

export const CORPORATE_SHAREHOLDER_FIELDS: readonly EkycFieldDef<CorporateKycData, EkycShareholder>[] = [
  {
    id: 'type',
    label: { en: 'Shareholder Type', de: 'Art des Gesellschafters' },
    hint: plainHint(
      'Individual if the shareholder is a person. Corporate if it is a company.',
      'Einzelperson, wenn der Gesellschafter ein Mensch ist. Unternehmen, wenn er eine Firma ist.'
    ),
    kind: 'select',
    options: EKYC_SHAREHOLDER_TYPE_OPTIONS,
    required: true,
    prefillable: true,
  },
  {
    id: 'fullLegalName',
    label: { en: 'Full legal name', de: 'Vollständiger rechtlicher Name' },
    kind: 'text',
    required: true,
    prefillable: true,
    // A person's name only for an individual shareholder; a company name is free text.
    latinName: true,
    latinNameWhen: (_d, row) => row.type === 'individual',
  },
  { id: 'email', label: { en: 'Email', de: 'E-Mail-Adresse' }, kind: 'email', required: true, prefillable: true },
  {
    id: 'nationalityOrCountry',
    label: { en: 'Nationality / Country of Incorporation', de: 'Staatsangehörigkeit / Gründungsland' },
    hint: plainHint(
      'For a person, the nationality. For a company, the country where it is registered.',
      'Bei einer Person die Staatsangehörigkeit. Bei einer Firma das Land, in dem sie registriert ist.'
    ),
    kind: 'country',
    required: true,
    prefillable: true,
  },
  {
    id: 'percent',
    label: { en: 'Holding %', de: 'Beteiligung in %' },
    hint: plainHint(
      'The share this shareholder owns. All shareholders together should add up to 100%.',
      'Der Anteil dieses Gesellschafters. Alle Gesellschafter zusammen sollten 100 % ergeben.'
    ),
    kind: 'percent',
    required: true,
    prefillable: true,
  },
];

export const CORPORATE_UBO_FIELDS: readonly EkycFieldDef<CorporateKycData, EkycUbo>[] = [
  {
    id: 'fullLegalName',
    label: {
      en: 'Full Legal Name as it appears in the passport / ID document',
      de: 'Vollständiger rechtlicher Name laut Reisepass / Ausweisdokument',
    },
    kind: 'text',
    required: true,
    prefillable: true,
    latinName: true,
  },
  { id: 'nationality', label: { en: 'Nationality', de: 'Staatsangehörigkeit' }, kind: 'country', required: true, prefillable: true },
  {
    id: 'countryOfResidence',
    label: { en: 'Country of Residence', de: 'Wohnsitzland' },
    kind: 'country',
    required: true,
    prefillable: true,
  },
  {
    id: 'percent',
    label: { en: 'Shareholding %', de: 'Beteiligung in %' },
    hint: plainHint(
      'The share this person owns, directly or through other companies.',
      'Der Anteil dieser Person, direkt oder über andere Firmen.'
    ),
    kind: 'percent',
    required: true,
    prefillable: true,
  },
  {
    id: 'natureOfControl',
    label: { en: 'Nature of Control', de: 'Art der Kontrolle' },
    hint: plainHint(
      'How this person controls the company. Most often by owning shares.',
      'Wie diese Person das Unternehmen kontrolliert. Meist über den Besitz von Anteilen.'
    ),
    kind: 'select',
    options: EKYC_NATURE_OF_CONTROL_OPTIONS,
    required: true,
    prefillable: true,
  },
  {
    id: 'natureOfControlOther',
    label: { en: 'Please specify', de: 'Bitte angeben', deReviewed: false },
    hint: plainHint(
      'Explain in a few words how this person controls the company.',
      'Beschreiben Sie kurz, wie diese Person das Unternehmen kontrolliert.'
    ),
    kind: 'text',
    required: true,
    visibleWhen: (_d, row) => row.natureOfControl === 'other',
    prefillable: true,
  },
];

/** A link under a field's hint: opens in a new tab. */
export interface EkycHintLink {
  href: string;
  label: EkycText;
}

/**
 * The questionnaire is section 6 of the KYC record PDF and step 6 of the
 * corporate form. Its questions carry the SAME number on screen and in the
 * PDF (6.1 to 6.14), so a client who asks about "question 6.3" and the team
 * reading the record mean the same one (Tina 05.10.2026).
 */
export const EKYC_QUESTIONNAIRE_SECTION = 6;

/** '6.N' for a questionnaire question ('questionnaire.q23' -> '6.1'), else null. */
export function ekycQuestionnaireNumber(fieldId: string): string | null {
  const m = /^questionnaire\.(q\d+)$/.exec(fieldId);
  if (!m) return null;
  const i = (EKYC_CORPORATE_QUESTION_IDS as readonly string[]).indexOf(m[1]);
  return i < 0 ? null : `${EKYC_QUESTIONNAIRE_SECTION}.${i + 1}`;
}

function question(
  number: string,
  en: string,
  de: string,
  hint?: EkycText,
  hintLink?: EkycHintLink
): EkycFieldDef<CorporateKycData, CorporateKycData> {
  return {
    id: `questionnaire.q${number}`,
    number,
    label: { en, de },
    ...(hint ? { hint } : {}),
    ...(hintLink ? { hintLink } : {}),
    kind: 'yesno',
    options: EKYC_YES_NO_OPTIONS,
    required: true,
    prefillable: false,
  };
}

export const CORPORATE_FIELDS: readonly EkycFieldDef<CorporateKycData, CorporateKycData>[] = [
  {
    id: 'companyName',
    number: '1',
    label: { en: 'Full name of the company as mentioned in the respective trade license', de: 'Vollständiger Name des Unternehmens laut Handelslizenz' },
    kind: 'text',
    required: true,
    prefillable: true,
  },
  {
    id: 'entityType',
    number: '5',
    label: { en: 'Type of Entity / Legal Status', de: 'Art der Gesellschaft / Rechtsform' },
    hint: plainHint(
      'Free zone companies such as FZ-LLC, FZCO and FZE belong to the first option (LLC).',
      'Freizonen-Gesellschaften wie FZ-LLC, FZCO und FZE gehören zur ersten Option (LLC).'
    ),
    kind: 'select',
    options: EKYC_ENTITY_TYPE_OPTIONS,
    required: true,
    prefillable: false,
  },
  {
    id: 'entityZone',
    number: '5',
    label: { en: 'Mainland or Freezone', de: 'Mainland oder Freizone', deReviewed: false },
    hint: plainHint(
      'Freezone if a free zone issued your license (for example IFZA, DMCC, RAKEZ). Mainland if DET or DED issued it.',
      'Freizone, wenn eine Freizone Ihre Lizenz ausgestellt hat (zum Beispiel IFZA, DMCC, RAKEZ). Mainland, wenn DET oder DED sie ausgestellt hat.'
    ),
    kind: 'select',
    options: EKYC_ENTITY_ZONE_OPTIONS,
    required: true,
    visibleWhen: (d) => (EKYC_ENTITY_TYPES_WITH_ZONE as readonly string[]).includes(d.entityType),
    prefillable: false,
  },
  {
    id: 'countryOfIncorporation',
    number: '7',
    label: { en: 'Country of Incorporation / Registration', de: 'Land der Gründung / Registrierung' },
    hint: plainHint(
      'The country where the company is registered. For a UAE license, choose United Arab Emirates.',
      'Das Land, in dem das Unternehmen registriert ist. Bei einer Lizenz aus den VAE wählen Sie United Arab Emirates.'
    ),
    kind: 'country',
    required: true,
    prefillable: true,
  },
  {
    id: 'incorporationDate',
    number: '8',
    label: { en: 'Date of Incorporation', de: 'Gründungsdatum' },
    hint: plainHint(
      'The day the company was set up. You find it on the certificate of incorporation or the first license.',
      'Der Tag, an dem das Unternehmen gegründet wurde. Sie finden ihn auf der Gründungsurkunde oder der ersten Lizenz.'
    ),
    kind: 'date',
    required: true,
    prefillable: true,
  },
  {
    id: 'modeOfPayment',
    number: '9',
    label: { en: 'Mode of Payment', de: 'Zahlungsart' },
    hint: plainHint(
      'How your company receives money from its customers.',
      'Wie Ihr Unternehmen Geld von seinen Kunden erhält.'
    ),
    kind: 'select',
    options: EKYC_CORPORATE_PAYMENT_OPTIONS,
    required: true,
    prefillable: false,
  },
  {
    id: 'countriesOfOperation',
    number: '10',
    label: { en: 'Countries where the company operates', de: 'Länder, in denen das Unternehmen tätig ist' },
    hint: plainHint(
      'Every country where the company has customers, suppliers or an office, the UAE included.',
      'Jedes Land, in dem das Unternehmen Kunden, Lieferanten oder ein Büro hat, auch die VAE.'
    ),
    kind: 'countries',
    required: true,
    prefillable: false,
  },
  {
    id: 'primaryContactName',
    number: '11',
    label: { en: "Primary contact person's full name as it appears in the respective passport", de: 'Vollständiger Name der Hauptkontaktperson laut Reisepass' },
    hint: plainHint(
      'The person we contact if we have questions about this form.',
      'Die Person, an die wir uns wenden, wenn wir Fragen zu diesem Formular haben.'
    ),
    kind: 'text',
    required: true,
    prefillable: true,
    latinName: true,
  },
  {
    id: 'primaryContactJobTitle',
    number: '12',
    label: { en: "Primary contact person's job title", de: 'Berufsbezeichnung der Hauptkontaktperson' },
    kind: 'text',
    required: true,
    prefillable: true,
  },
  {
    id: 'primaryContactEmail',
    number: '13',
    label: { en: "Primary contact person's email address", de: 'E-Mail-Adresse der Hauptkontaktperson' },
    kind: 'email',
    required: true,
    prefillable: true,
  },
  {
    id: 'isBranchOrSubsidiary',
    number: '14',
    label: {
      en: 'Is the reporting entity a branch or subsidiary of another entity located locally or outside of the UAE?',
      de: 'Ist das meldende Unternehmen eine Zweigniederlassung oder Tochtergesellschaft eines anderen Unternehmens mit Sitz in den VAE oder außerhalb der VAE?',
    },
    hint: plainHint(
      'Yes if this company is part of another company, or another company owns most of it.',
      'Ja, wenn dieses Unternehmen Teil eines anderen Unternehmens ist oder einem anderen Unternehmen mehrheitlich gehört.'
    ),
    kind: 'yesno',
    options: EKYC_YES_NO_OPTIONS,
    required: true,
    prefillable: false,
  },
  {
    id: 'headOfficeAddress',
    number: '16',
    label: { en: 'Address of Head Office', de: 'Adresse des Hauptsitzes' },
    hint: plainHint(
      'The main address of the company. If it has only one office, this is the address on the license.',
      'Die Hauptadresse des Unternehmens. Hat es nur ein Büro, ist das die Adresse laut Lizenz.'
    ),
    kind: 'textarea',
    required: true,
    prefillable: true,
  },
  {
    id: 'serviceOfficeAddress',
    number: '17',
    label: { en: 'Address of Office for which service is required', de: 'Adresse des Büros, für das die Dienstleistung benötigt wird' },
    hint: plainHint(
      'The address of the office TME Services works for. Often the same as the head office.',
      'Die Adresse des Büros, für das TME Services tätig ist. Oft dieselbe wie die des Hauptsitzes.'
    ),
    kind: 'textarea',
    required: true,
    prefillable: true,
  },
  {
    id: 'website',
    number: '18',
    label: { en: 'Corporate website', de: 'Website des Unternehmens' },
    kind: 'url',
    required: false,
    prefillable: false,
  },
  { id: 'poBox', number: '19', label: { en: 'P.O. Box', de: 'Postfach' }, kind: 'text', required: false, prefillable: true },
  {
    id: 'telephone',
    number: '20',
    label: { en: 'Telephone number', de: 'Telefonnummer', deReviewed: false },
    hint: EKYC_PHONE_HINT,
    kind: 'phone',
    required: false,
    prefillable: false,
  },
  {
    id: 'authorizedShareCapital',
    number: '21',
    label: { en: 'What is the authorized share capital of your institution?', de: 'Wie hoch ist das genehmigte Stammkapital Ihres Unternehmens?' },
    hint: plainHint(
      'The amount as written in your MoA or license. Choose the currency on the left.',
      'Der Betrag laut Gesellschaftsvertrag (MoA) oder Lizenz. Wählen Sie links die Währung.'
    ),
    kind: 'money',
    required: true,
    prefillable: true,
  },
  {
    id: 'issuedShareCapital',
    number: '22',
    label: { en: 'What is the issued share capital of your institution?', de: 'Wie hoch ist das ausgegebene Stammkapital Ihres Unternehmens?' },
    hint: plainHint(
      'The capital the shareholders actually hold. Often the same as the authorized capital.',
      'Das Kapital, das die Gesellschafter tatsächlich halten. Oft gleich hoch wie das genehmigte Stammkapital.'
    ),
    kind: 'money',
    required: true,
    prefillable: true,
  },
  question(
    '23',
    'Is your institution publicly traded?',
    'Ist Ihr Unternehmen an einer Börse notiert?',
    plainHint(
      "Yes only if the company's shares are bought and sold on a stock exchange.",
      'Ja, nur wenn die Aktien des Unternehmens an einer Börse gehandelt werden.'
    )
  ),
  question(
    '24',
    'Does the company name, or the name of any subsidiary/affiliate entity, feature in any sanctions list?',
    'Erscheint der Name des Unternehmens oder einer Tochter- / verbundenen Gesellschaft auf einer Sanktionsliste?',
    plainHint(
      'Official lists of people and companies nobody may do business with, for example the UAE Local Terrorist List, the UN Consolidated List and major global watchlists like the OFAC SDN List and the EU Consolidated Financial Sanctions List.',
      'Offizielle Listen mit Personen und Firmen, mit denen niemand Geschäfte machen darf, zum Beispiel die UAE Local Terrorist List, die UN Consolidated List und wichtige internationale Listen wie die OFAC SDN List und die EU Consolidated Financial Sanctions List.'
    )
  ),
  question(
    '25',
    'Does the owner/Shareholder/Partner of the company feature in any PEP/HIO/FPEP/Adverse Media/Government Organization or Quasi-GO?',
    'Wird der Eigentümer / Gesellschafter / Partner des Unternehmens als PEP / HIO / FPEP geführt, erscheint er in negativen Medienberichten (Adverse Media) oder steht er in Verbindung mit einer Regierungsorganisation oder einer regierungsnahen Organisation (Quasi-GO)?',
    plainHint(
      'PEP: a person in an important public role. FPEP: a foreign PEP. HIO: head of an international organization. Adverse media: negative news.',
      'PEP: eine Person mit einem wichtigen öffentlichen Amt. FPEP: eine ausländische PEP. HIO: Leitung einer internationalen Organisation. Adverse Media: negative Presse.'
    )
  ),
  question(
    '26',
    'Do any of the board of directors/senior management/owner have relatives/close associates who are PEPs?',
    'Haben Mitglieder des Verwaltungsrats / der Geschäftsleitung oder der Eigentümer Verwandte oder enge Vertraute, die PEPs sind?',
    PEP_DEFINITION
  ),
  question(
    '27',
    'Are any of the board of directors / authorized signatories / partners / shareholders / owner, or the business, subject to financial sanctions or connected with prescribed terrorist organizations?',
    'Unterliegen Mitglieder des Verwaltungsrats / Zeichnungsberechtigte / Partner / Gesellschafter / der Eigentümer oder das Unternehmen finanziellen Sanktionen oder stehen sie in Verbindung mit gelisteten terroristischen Organisationen?',
    plainHint(
      'In short: is any of these people, or the company, under financial sanctions or linked to terrorism?',
      'Kurz gesagt: Steht eine dieser Personen oder das Unternehmen unter finanziellen Sanktionen oder in Verbindung mit Terrorismus?'
    )
  ),
  question(
    '28',
    'Does the company have any subsidiary, affiliate, branch or group/holding company in an FATF-listed high-risk or monitored jurisdiction?',
    'Hat das Unternehmen eine Tochtergesellschaft, verbundene Gesellschaft, Zweigniederlassung oder Konzern- / Holdinggesellschaft in einem von der FATF gelisteten Hochrisikoland unter verstärkter Beobachtung?',
    plainHint(
      'The FATF (Financial Action Task Force) is the global body against money laundering. It keeps a public list of high-risk countries.',
      'Die FATF (Financial Action Task Force) ist die internationale Stelle gegen Geldwäsche. Sie führt eine öffentliche Liste von Hochrisikoländern.'
    ),
    {
      href: 'https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions.html',
      label: {
        en: 'FATF list: High-risk and other monitored jurisdictions',
        de: 'FATF-Liste: Hochrisikoländer und Länder unter verstärkter Beobachtung (Englisch)',
        deReviewed: false,
      },
    }
  ),
  question(
    '29',
    'Do any of the board of directors / authorized signatories / partners / shareholders / owner have dual nationality?',
    'Besitzen Mitglieder des Verwaltungsrats / Zeichnungsberechtigte / Partner / Gesellschafter / der Eigentümer eine doppelte Staatsangehörigkeit?',
    plainHint(
      'Yes if any of these people is a citizen of more than one country.',
      'Ja, wenn eine dieser Personen die Staatsangehörigkeit von mehr als einem Land besitzt.'
    )
  ),
  question(
    '30',
    'Does the company intend to deal with any country listed in any sanctions list?',
    'Beabsichtigt das Unternehmen, Geschäfte mit einem Land zu tätigen, das auf einer Sanktionsliste steht?',
    plainHint(
      'Yes if the company plans to buy from, sell to or work in a country under sanctions.',
      'Ja, wenn das Unternehmen plant, mit einem Land unter Sanktionen zu handeln oder dort tätig zu sein.'
    )
  ),
  question(
    '31',
    'Do the company or its subsidiary/affiliate entities have operations in any high-risk countries?',
    'Ist das Unternehmen oder sind Tochter- / verbundene Gesellschaften in Hochrisikoländern tätig?',
    plainHint(
      'High-risk countries are the countries on the FATF black and grey lists.',
      'Hochrisikoländer sind die Länder auf der schwarzen und der grauen Liste der FATF.'
    )
  ),
  question(
    '32',
    'Has the entity established a compliance program that contains AML/CFT/PF policies and procedures according to internal & international laws, rules and standards?',
    'Hat das Unternehmen ein Compliance-Programm eingerichtet, das AML/CFT/PF-Richtlinien und -Verfahren gemäß internen und internationalen Gesetzen, Vorschriften und Standards enthält?',
    plainHint(
      'Yes if the company has a written policy to prevent money laundering, terrorist financing and proliferation financing (AML/CFT/PF).',
      'Ja, wenn das Unternehmen eine schriftliche Richtlinie gegen Geldwäsche, Terrorismusfinanzierung und Proliferationsfinanzierung (AML/CFT/PF) hat.'
    )
  ),
  question(
    '33',
    'Has the entity documented policies and procedures consistent with applicable regulations and requirements to reasonably prevent, detect and report bribery & corruption?',
    'Hat das Unternehmen Richtlinien und Verfahren dokumentiert, die den geltenden Vorschriften und Anforderungen entsprechen, um Bestechung und Korruption in angemessener Weise zu verhindern, aufzudecken und zu melden?',
    plainHint(
      'Yes if the company has a written policy against bribery and corruption.',
      'Ja, wenn das Unternehmen eine schriftliche Richtlinie gegen Bestechung und Korruption hat.'
    )
  ),
  question(
    '34',
    'Has the entity or the senior management ever been charged anywhere in the world for violation of applicable anti-bribery/AML/CFT/PF laws or regulations?',
    'Wurde das Unternehmen oder die Geschäftsleitung jemals irgendwo auf der Welt wegen eines Verstoßes gegen geltende Antikorruptions- oder AML/CFT/PF-Gesetze oder -Vorschriften angeklagt?',
    plainHint(
      'Charged means formally accused by a court or authority, even without a conviction.',
      'Angeklagt heißt: von einem Gericht oder einer Behörde offiziell beschuldigt, auch ohne Verurteilung.'
    )
  ),
  question(
    '35',
    'Does the entity have a procedure in place to prevent, detect and report suspicious transactions to the relevant authority?',
    'Verfügt das Unternehmen über ein Verfahren, um verdächtige Transaktionen zu verhindern, aufzudecken und der zuständigen Behörde zu melden?',
    plainHint(
      'Yes if the company has a written process to spot suspicious payments and report them.',
      'Ja, wenn das Unternehmen ein schriftliches Verfahren hat, um verdächtige Zahlungen zu erkennen und zu melden.'
    )
  ),
  question(
    '36',
    'Is the entity involved in any offshore business / banking activities?',
    'Ist das Unternehmen an Offshore-Geschäften oder Offshore-Bankaktivitäten beteiligt?',
    plainHint(
      "Financial or commercial transactions conducted in a foreign country outside of the client's home nation or primary place of operations.",
      'Finanz- oder Handelsgeschäfte in einem anderen Land außerhalb des Heimatlandes oder des Hauptgeschäftssitzes des Kunden.'
    )
  ),
  ...closingFields<CorporateKycData>(
    plainHint(
      'The person who signs for the company, for example the manager or a director.',
      'Die Person, die für das Unternehmen unterschreibt, zum Beispiel der Manager oder ein Direktor.'
    )
  ),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows differ per group (license / shareholder / UBO)
export const CORPORATE_GROUPS: readonly EkycGroupDef<CorporateKycData, any>[] = [
  {
    id: 'licenses',
    label: { en: 'Trade License', de: 'Handelslizenz' },
    hint: {
      en: 'If the company holds more than one license (for example a commercial and an industrial license), add each one. Up to 3 licenses.',
      de: 'Wenn das Unternehmen mehrere Lizenzen besitzt (zum Beispiel eine Handels- und eine Industrielizenz), fügen Sie bitte jede einzeln hinzu. Bis zu 3 Lizenzen.',
      deReviewed: false,
    },
    min: 1,
    max: EKYC_MAX_LICENSES,
    addLabel: { en: 'Add another license', de: 'Weitere Lizenz hinzufügen', deReviewed: false },
    rowLabel: { en: 'License', de: 'Lizenz', deReviewed: false },
    fields: CORPORATE_LICENSE_FIELDS,
    prefillable: true,
  } satisfies EkycGroupDef<CorporateKycData, EkycLicenseBlock>,
  {
    id: 'shareholders',
    label: { en: 'Shareholder details', de: 'Angaben zu den Gesellschaftern' },
    hint: {
      en: 'Full legal name: Name of the shareholder as it appears in the respective passport (if a natural person) else name of the company (if a corporate shareholder) as it appears in the respective trade license.',
      de: 'Vollständiger rechtlicher Name: Name des Gesellschafters laut Reisepass (bei einer natürlichen Person) bzw. Name des Unternehmens laut Handelslizenz (bei einem Gesellschafter, der eine juristische Person ist).',
    },
    min: 1,
    addLabel: { en: 'Add another shareholder', de: 'Weiteren Gesellschafter hinzufügen', deReviewed: false },
    rowLabel: { en: 'Shareholder', de: 'Gesellschafter', deReviewed: false },
    fields: CORPORATE_SHAREHOLDER_FIELDS,
    prefillable: true,
  } satisfies EkycGroupDef<CorporateKycData, EkycShareholder>,
  {
    id: 'ubos',
    label: { en: 'UBO details', de: 'Angaben zu den wirtschaftlich Berechtigten (UBO)' },
    hint: plainHint(
      'A UBO is always a person, never a company: anyone who owns or controls 25% or more, directly or through other companies, or controls the company in another way.',
      'Ein UBO ist immer ein Mensch, nie eine Firma: jede Person, die direkt oder über andere Firmen 25 % oder mehr besitzt oder kontrolliert oder das Unternehmen auf andere Weise kontrolliert.'
    ),
    min: 1,
    addLabel: { en: 'Add another UBO', de: 'Weiteren wirtschaftlich Berechtigten (UBO) hinzufügen', deReviewed: false },
    rowLabel: { en: 'UBO', de: 'Wirtschaftlich Berechtigter (UBO)', deReviewed: false },
    fields: CORPORATE_UBO_FIELDS,
    prefillable: true,
  } satisfies EkycGroupDef<CorporateKycData, EkycUbo>,
];

export const CORPORATE_SECTIONS: readonly EkycSectionDef[] = [
  {
    id: 'company',
    title: { en: 'Company Details', de: 'Angaben zum Unternehmen', deReviewed: false },
    items: [
      'companyName',
      'licenses',
      'entityType',
      'entityZone',
      'countryOfIncorporation',
      'incorporationDate',
      'modeOfPayment',
    ],
  },
  {
    id: 'address',
    title: { en: 'Company Address', de: 'Firmenadresse' },
    items: [
      'countriesOfOperation',
      'primaryContactName',
      'primaryContactJobTitle',
      'primaryContactEmail',
      'isBranchOrSubsidiary',
      'headOfficeAddress',
      'serviceOfficeAddress',
      'website',
      'poBox',
      'telephone',
    ],
  },
  { id: 'shareholders', title: { en: 'Shareholder details', de: 'Angaben zu den Gesellschaftern' }, items: ['shareholders'] },
  { id: 'ubos', title: { en: 'UBO details', de: 'Angaben zu den wirtschaftlich Berechtigten (UBO)' }, items: ['ubos'] },
  {
    id: 'questionnaire',
    title: { en: 'Questionnaire', de: 'Fragebogen' },
    items: ['authorizedShareCapital', 'issuedShareCapital', ...EKYC_CORPORATE_QUESTION_IDS.map((q) => `questionnaire.${q}`)],
  },
  { id: 'privacy', title: EKYC_PRIVACY_TITLE, items: [] },
  {
    id: 'declaration',
    title: EKYC_DECLARATION_TITLE,
    intro: EKYC_DECLARATION_TEXT,
    items: [...CLOSING_ITEMS],
  },
];

export const CORPORATE_KYC_SCHEMA: EkycFormSchema<CorporateKycData> = {
  type: 'corporate',
  title: { en: 'KYC form for Corporate Clients', de: 'KYC-Formular für Firmenkunden' },
  intro: { en: 'Please make sure all the details are valid.', de: 'Bitte stellen Sie sicher, dass alle Angaben gültig sind.' },
  sections: CORPORATE_SECTIONS,
  fields: CORPORATE_FIELDS,
  groups: CORPORATE_GROUPS,
};

// ---------------------------------------------------------------------------
// Individual schema (all German written by us: deReviewed false, decision D2)
// ---------------------------------------------------------------------------

const yes = (v: EkycYesNo) => v === 'yes';
const no = (v: EkycYesNo) => v === 'no';
const ind = (en: string, de: string): EkycText => ({ en, de, deReviewed: false });

type IndField = EkycFieldDef<IndividualKycData, IndividualKycData>;

function indField(
  id: string,
  label: EkycText,
  kind: EkycFieldKind,
  extra: Partial<IndField> = {}
): IndField {
  return { id, label, kind, required: true, prefillable: false, ...extra };
}

const isUaeResident = (d: IndividualKycData) => yes(d.uaeResident);
const isNonResident = (d: IndividualKycData) => no(d.uaeResident);
const hasIncome = (source: EkycIncomeSource) => (d: IndividualKycData) => d.incomeSources.includes(source);

export const INDIVIDUAL_FIELDS: readonly IndField[] = [
  // General Information
  indField('fullName', ind('Name as it appears in the passport', 'Name laut Reisepass'), 'text', {
    latinName: true,
    hint: ind(
      'All your names, including middle names, exactly as in the passport.',
      'Alle Ihre Namen, auch weitere Vornamen, genau wie im Reisepass.'
    ),
  }),
  indField('nationality', ind('Please mention your nationality', 'Bitte geben Sie Ihre Staatsangehörigkeit an'), 'country'),
  indField('dualNationality', ind('Do you have dual nationality?', 'Besitzen Sie eine doppelte Staatsangehörigkeit?'), 'yesno', {
    options: EKYC_YES_NO_OPTIONS,
    hint: ind(
      'Yes if you are a citizen of more than one country.',
      'Ja, wenn Sie die Staatsangehörigkeit von mehr als einem Land besitzen.'
    ),
  }),
  indField(
    'dualNationalityCountries',
    ind(
      'If yes, then mention the countries of which you are a national.',
      'Wenn ja, geben Sie bitte die Länder an, deren Staatsangehörigkeit Sie besitzen.'
    ),
    'countries',
    {
      visibleWhen: (d) => yes(d.dualNationality),
      hint: ind(
        'Choose all your nationalities, also the one above.',
        'Wählen Sie alle Ihre Staatsangehörigkeiten, auch die oben genannte.'
      ),
    }
  ),
  indField('uaeResident', ind('Are you a UAE resident?', 'Haben Sie Ihren Wohnsitz in den VAE?'), 'yesno', {
    options: EKYC_YES_NO_OPTIONS,
    hint: ind(
      'Yes if you hold a UAE residence visa and an Emirates ID.',
      'Ja, wenn Sie ein Aufenthaltsvisum der VAE und eine Emirates ID besitzen.'
    ),
  }),
  indField('uaeAddress.buildingName', ind('Building Name', 'Gebäudename'), 'text', { visibleWhen: isUaeResident }),
  indField('uaeAddress.apartmentNo', ind('Apartment No.', 'Wohnungsnummer'), 'text', { visibleWhen: isUaeResident }),
  indField('uaeAddress.street', ind('Street', 'Straße'), 'text', { visibleWhen: isUaeResident }),
  indField('uaeAddress.city', ind('City', 'Stadt'), 'text', { visibleWhen: isUaeResident }),
  indField('uaeAddress.emirate', ind('Emirate', 'Emirat'), 'select', {
    options: EKYC_EMIRATE_OPTIONS,
    visibleWhen: isUaeResident,
  }),
  // Optional: most UAE addresses have no postal code (Damir 02.10).
  indField('uaeAddress.postalCode', ind('Postal Code', 'Postleitzahl'), 'text', { visibleWhen: isUaeResident, required: false }),
  indField(
    'uaePhone',
    ind('Contact number in the UAE', 'Kontaktnummer in den VAE'),
    'phone',
    { visibleWhen: isUaeResident, hint: EKYC_PHONE_HINT }
  ),
  indField('homeAddress.street', ind('Street', 'Straße'), 'text', { visibleWhen: isNonResident }),
  indField('homeAddress.city', ind('City', 'Stadt'), 'text', { visibleWhen: isNonResident }),
  indField('homeAddress.postalCode', ind('Postal Code', 'Postleitzahl'), 'text', { visibleWhen: isNonResident }),
  indField('homeAddress.country', ind('Country', 'Land'), 'country', { visibleWhen: isNonResident }),
  indField(
    'homePhone',
    ind('Contact number in home country', 'Kontaktnummer im Heimatland'),
    'phone',
    { visibleWhen: isNonResident, hint: EKYC_PHONE_HINT }
  ),
  indField(
    'gccNational',
    ind('Are you a GCC (Gulf Cooperation Council) national?', 'Sind Sie Staatsangehörige(r) eines GCC-Staates (Golf-Kooperationsrat)?'),
    'yesno',
    {
      options: EKYC_YES_NO_OPTIONS,
      hint: ind(
        '(Someone who holds citizenship in one of the six member countries of the GCC: Bahrain, Kuwait, Oman, Qatar, Saudi Arabia, and the UAE)',
        '(Personen mit der Staatsangehörigkeit eines der sechs Mitgliedstaaten des GCC: Bahrain, Kuwait, Oman, Katar, Saudi-Arabien und VAE)'
      ),
    }
  ),

  // Client income details
  indField(
    'incomeSources',
    ind('Please select the options that apply to you', 'Bitte wählen Sie alle Optionen aus, die auf Sie zutreffen'),
    'multiselect',
    {
      options: EKYC_INCOME_SOURCE_OPTIONS,
      hint: ind(
        'Where your money comes from. Tick every source that applies, not only the main one.',
        'Woher Ihr Geld stammt. Wählen Sie jede zutreffende Quelle, nicht nur die wichtigste.'
      ),
    }
  ),
  indField('employer.companyName', ind('Name of Company', 'Name des Unternehmens'), 'text', { visibleWhen: hasIncome('employment') }),
  indField('employer.city', ind('City', 'Stadt'), 'text', { visibleWhen: hasIncome('employment') }),
  // Optional: many UAE employers have no postal code (Damir 02.10).
  indField('employer.postalCode', ind('Postal Code', 'Postleitzahl'), 'text', { visibleWhen: hasIncome('employment'), required: false }),
  indField('employer.country', ind('Country', 'Land'), 'country', { visibleWhen: hasIncome('employment') }),
  indField(
    'businessCountries',
    ind('If yes, then list the countries where you do business.', 'Wenn ja, nennen Sie bitte die Länder, in denen Sie geschäftlich tätig sind.'),
    'countries',
    { visibleWhen: hasIncome('business') }
  ),
  indField('incomeOthers', ind('If others, then please specify:', 'Bei „Sonstige“ bitte angeben:'), 'textarea', {
    visibleWhen: hasIncome('others'),
  }),

  // PEP / RCA
  indField('isPep', ind('Are you a PEP?', 'Sind Sie eine PEP?'), 'yesno', {
    options: EKYC_YES_NO_OPTIONS,
    hint: ind(
      'A PEP is a person with an important public role, for example a minister, judge or senior officer.',
      'Eine PEP ist eine Person mit einem wichtigen öffentlichen Amt, zum Beispiel Minister, Richter oder hoher Offizier.'
    ),
  }),
  indField(
    'pepCountry',
    ind(
      'If YES, then mention the Country / Jurisdiction where you are a PEP.',
      'Wenn ja, nennen Sie bitte das Land / die Rechtsordnung, in dem / der Sie eine PEP sind.'
    ),
    'text',
    { visibleWhen: (d) => yes(d.isPep) }
  ),
  indField('rcaIsPep', ind('Are any of your relatives or close associates PEPs?', 'Sind Verwandte oder enge Vertraute von Ihnen PEPs?'), 'yesno', {
    options: EKYC_YES_NO_OPTIONS,
    hint: ind(
      'Yes if a family member or close business partner of yours is a PEP.',
      'Ja, wenn ein Familienmitglied oder ein enger Geschäftspartner von Ihnen eine PEP ist.'
    ),
  }),
  indField(
    'rcaName',
    ind('If YES, then mention the name of the RCA who is a PEP', 'Wenn ja, nennen Sie bitte den Namen der verwandten oder nahestehenden Person, die eine PEP ist'),
    'text',
    { visibleWhen: (d) => yes(d.rcaIsPep), latinName: true }
  ),
  indField('rcaRelationship', ind('Mention your relationship with the RCA', 'Nennen Sie bitte Ihre Beziehung zu dieser Person'), 'text', {
    visibleWhen: (d) => yes(d.rcaIsPep),
    hint: ind(
      'For example spouse, parent, child or business partner.',
      'Zum Beispiel Ehepartner, Elternteil, Kind oder Geschäftspartner.'
    ),
  }),
  indField(
    'rcaCountry',
    ind(
      'Mention the Country / Jurisdiction where they are a PEP.',
      'Nennen Sie bitte das Land / die Rechtsordnung, in dem / der diese Person eine PEP ist.'
    ),
    'text',
    { visibleWhen: (d) => yes(d.rcaIsPep) }
  ),

  // Sanctions, high risk, trust
  indField(
    'sanctioned',
    ind(
      'Are you subject to financial sanctions and/or connected with proscribed terrorist organizations?',
      'Unterliegen Sie finanziellen Sanktionen und / oder stehen Sie in Verbindung mit gelisteten terroristischen Organisationen?'
    ),
    'yesno',
    {
      options: EKYC_YES_NO_OPTIONS,
      hint: ind(
        'Financial sanctions mean both asset freezing and prohibitions to prevent funds or other assets from being made available, directly or indirectly, for the benefit of designated persons and entities.',
        'Finanzielle Sanktionen umfassen sowohl das Einfrieren von Vermögenswerten als auch Verbote, die verhindern, dass benannten Personen und Organisationen direkt oder indirekt Gelder oder andere Vermögenswerte zur Verfügung gestellt werden.'
      ),
    }
  ),
  indField(
    'sanctionDetails',
    ind(
      'If yes, then mention the sanction / organization that is imposed on you / you belong to.',
      'Wenn ja, nennen Sie bitte die Sanktion, die gegen Sie verhängt wurde, bzw. die Organisation, der Sie angehören.'
    ),
    'textarea',
    { visibleWhen: (d) => yes(d.sanctioned) }
  ),
  indField(
    'highRisk',
    ind(
      'Are you based in and/or associated with any High-Risk jurisdictions? This could be checked using the link https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html',
      'Haben Sie Ihren Wohnsitz in einem Hochrisikoland oder Verbindungen zu einem solchen Land? Dies können Sie unter folgendem Link prüfen: https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html'
    ),
    'yesno',
    {
      options: EKYC_YES_NO_OPTIONS,
      hint: ind(
        'Yes if you live in, or have close ties to, a country on the FATF black or grey list.',
        'Ja, wenn Sie in einem Land auf der schwarzen oder grauen Liste der FATF leben oder enge Verbindungen dorthin haben.'
      ),
    }
  ),
  indField(
    'highRiskCountry',
    ind('If yes, then mention the name of the country / jurisdiction.', 'Wenn ja, nennen Sie bitte das Land / die Rechtsordnung.'),
    'text',
    { visibleWhen: (d) => yes(d.highRisk) }
  ),
  indField(
    'trustCharity',
    ind(
      'Are you involved in, or do you control, any trusts / charities?',
      'Sind Sie an einem Trust oder einer gemeinnützigen Organisation beteiligt oder kontrollieren Sie eine solche?'
    ),
    'yesno',
    {
      options: EKYC_YES_NO_OPTIONS,
      hint: ind(
        'A trust holds money or property for other people. A charity is an organization that does not work for profit.',
        'Ein Trust verwaltet Geld oder Vermögen für andere Personen. Eine gemeinnützige Organisation arbeitet ohne Gewinnabsicht.'
      ),
    }
  ),
  indField(
    'trustCharityNames',
    ind(
      'If yes, then mention the name of the trust / charity.',
      'Wenn ja, nennen Sie bitte den Namen des Trusts / der gemeinnützigen Organisation.'
    ),
    'text',
    { visibleWhen: (d) => yes(d.trustCharity) }
  ),
  indField(
    'modesOfPayment',
    ind('Please mention the mode of payment to TME Services', 'Bitte geben Sie an, wie Sie an TME Services zahlen'),
    'multiselect',
    {
      options: EKYC_INDIVIDUAL_PAYMENT_OPTIONS,
      hint: ind(
        'How you will pay TME Services for this service. Tick all that apply.',
        'Wie Sie TME Services für diese Leistung bezahlen. Wählen Sie alle zutreffenden Optionen.'
      ),
    }
  ),
  ...closingFields<IndividualKycData>(),
];

/** Group-level captions inside the individual sections (the paper's sub-questions). */
export const INDIVIDUAL_FIELD_CAPTIONS: Record<string, EkycText> = {
  'uaeAddress.buildingName': ind('If yes, please mention your residential address in UAE', 'Wenn ja, geben Sie bitte Ihre Wohnadresse in den VAE an'),
  'homeAddress.street': ind(
    'If not a UAE resident, then mention your address in your home country',
    'Wenn Sie keinen Wohnsitz in den VAE haben, geben Sie bitte Ihre Adresse in Ihrem Heimatland an'
  ),
  'employer.companyName': ind(
    'If you are a salaried person, then mention the name and address of the company you work for.',
    'Wenn Sie angestellt sind, geben Sie bitte Name und Adresse des Unternehmens an, für das Sie arbeiten.'
  ),
};

export const EKYC_PEP_DEFINITION: EkycText = ind(
  "PEPs (Politically Exposed Persons) are natural persons who are or have been entrusted with prominent public functions in the State or any other foreign country such as heads of state or governments, senior politicians, senior government officials, judicial or military officials, senior executive managers of state-owned corporations, and senior officials of political parties and persons who are, or have previously been, entrusted with the management of an international organization or any prominent function within such an organization.",
  'PEPs (politisch exponierte Personen) sind natürliche Personen, die im Staat oder in einem anderen Land mit herausragenden öffentlichen Ämtern betraut sind oder waren, z. B. Staats- oder Regierungschefs, hochrangige Politiker, hochrangige Regierungsbeamte, Justiz- oder Militärbeamte, leitende Führungskräfte staatseigener Unternehmen und hochrangige Funktionäre politischer Parteien, sowie Personen, die mit der Leitung einer internationalen Organisation oder einer herausragenden Funktion innerhalb einer solchen Organisation betraut sind oder waren.'
);

export const EKYC_RCA_DEFINITION: EkycText = ind(
  'RCAs (Relatives or Close Associates) include spouses, children, spouses of children, parents, individuals having joint ownership rights in a legal person or arrangement or any other close business relationship with the PEP or individuals having individual ownership rights in a legal person or arrangement established in favor of the PEP.',
  'RCAs (Verwandte oder enge Vertraute) sind Ehepartner, Kinder, Ehepartner von Kindern, Eltern, Personen, die gemeinsam mit der PEP Eigentumsrechte an einer juristischen Person oder Rechtsgestaltung halten oder in einer anderen engen Geschäftsbeziehung zu der PEP stehen, sowie Personen, die allein Eigentumsrechte an einer juristischen Person oder Rechtsgestaltung halten, die zugunsten der PEP errichtet wurde.'
);

export const INDIVIDUAL_SECTIONS: readonly EkycSectionDef[] = [
  {
    id: 'general',
    title: ind('General Information', 'Allgemeine Angaben'),
    items: [
      'fullName',
      'nationality',
      'dualNationality',
      'dualNationalityCountries',
      'uaeResident',
      'uaeAddress.buildingName',
      'uaeAddress.apartmentNo',
      'uaeAddress.street',
      'uaeAddress.city',
      'uaeAddress.emirate',
      'uaeAddress.postalCode',
      'uaePhone',
      'homeAddress.street',
      'homeAddress.city',
      'homeAddress.postalCode',
      'homeAddress.country',
      'homePhone',
      'gccNational',
    ],
  },
  {
    id: 'income',
    title: ind(
      'Client income details (Please select the options that apply to you)',
      'Angaben zu Ihren Einkünften (Bitte wählen Sie alle Optionen aus, die auf Sie zutreffen)'
    ),
    items: [
      'incomeSources',
      'employer.companyName',
      'employer.city',
      'employer.postalCode',
      'employer.country',
      'businessCountries',
      'incomeOthers',
    ],
  },
  {
    id: 'pep',
    title: ind('PEP and RCA', 'PEP und RCA'),
    intro: {
      en: `${EKYC_PEP_DEFINITION.en}\n\n${EKYC_RCA_DEFINITION.en}`,
      de: `${EKYC_PEP_DEFINITION.de}\n\n${EKYC_RCA_DEFINITION.de}`,
      deReviewed: false,
    },
    items: ['isPep', 'pepCountry', 'rcaIsPep', 'rcaName', 'rcaRelationship', 'rcaCountry'],
  },
  {
    id: 'risk',
    title: ind('Sanctions, high-risk jurisdictions and trusts', 'Sanktionen, Hochrisiko-Rechtsordnungen und Trusts'),
    items: [
      'sanctioned',
      'sanctionDetails',
      'highRisk',
      'highRiskCountry',
      'trustCharity',
      'trustCharityNames',
      'modesOfPayment',
    ],
  },
  {
    id: 'documents',
    title: ind('Please attach the following documents along with this form:', 'Bitte laden Sie die folgenden Dokumente zusammen mit diesem Formular hoch:'),
    intro: ind('Natural / Legal Person', 'Natürliche / juristische Person'),
    items: [], // rendered from EKYC_DOCUMENT_SLOTS
  },
  { id: 'privacy', title: EKYC_PRIVACY_TITLE, items: [] },
  {
    id: 'declaration',
    title: EKYC_DECLARATION_TITLE,
    intro: EKYC_DECLARATION_TEXT,
    items: [...CLOSING_ITEMS],
  },
];

export const INDIVIDUAL_KYC_SCHEMA: EkycFormSchema<IndividualKycData> = {
  type: 'individual',
  title: ind('AML KYC Questionnaire for INDIVIDUAL Client', 'AML-KYC-Fragebogen für PRIVATKUNDEN'),
  intro: ind(
    "The following questions are required by TME Services for the due diligence of all clients, as they are mandatory under the 'Ministry of Economy & Tourism'.",
    'Die folgenden Fragen benötigt TME Services für die Sorgfaltsprüfung aller Kunden, da sie vom „Ministry of Economy & Tourism“ (Wirtschafts- und Tourismusministerium) vorgeschrieben sind.'
  ),
  sections: INDIVIDUAL_SECTIONS,
  fields: INDIVIDUAL_FIELDS,
  groups: [],
};

/** Corporate field ids (top level + groups) the portal may pre-fill (R7). */
export const CORPORATE_PREFILLABLE_IDS: readonly string[] = [
  ...CORPORATE_FIELDS.filter((f) => f.prefillable).map((f) => f.id),
  ...CORPORATE_GROUPS.filter((g) => g.prefillable).map((g) => g.id),
];

// ===========================================================================
// Validation (submit). Pure; the same rules run in the browser and on the
// tme-staff server before the row is locked.
// ===========================================================================

export interface EkycValidationError {
  /** Path of the field: 'companyName', 'licenses.0.issueDate', 'documents.passport', or a group id. */
  fieldId: string;
  message: EkycText;
}

const MSG = {
  required: { en: 'Please fill in this field.', de: 'Bitte füllen Sie dieses Feld aus.', deReviewed: false },
  choose: { en: 'Please choose an answer.', de: 'Bitte wählen Sie eine Antwort aus.', deReviewed: false },
  chooseFromList: { en: 'Please choose an option from the list.', de: 'Bitte wählen Sie eine Option aus der Liste aus.', deReviewed: false },
  chooseOne: { en: 'Please choose at least one option.', de: 'Bitte wählen Sie mindestens eine Option aus.', deReviewed: false },
  email: { en: 'Please enter a valid email address.', de: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.', deReviewed: false },
  phone: { en: 'Please enter a valid telephone number with country code.', de: 'Bitte geben Sie eine gültige Telefonnummer mit Ländervorwahl ein.', deReviewed: false },
  url: { en: 'Please enter a valid website address.', de: 'Bitte geben Sie eine gültige Website-Adresse ein.', deReviewed: false },
  date: { en: 'Please enter a valid date.', de: 'Bitte geben Sie ein gültiges Datum ein.', deReviewed: false },
  percent: { en: 'Please enter a percentage above 0 and up to 100.', de: 'Bitte geben Sie einen Prozentsatz größer als 0 und höchstens 100 ein.', deReviewed: false },
  signature: { en: 'Please sign the form.', de: 'Bitte unterschreiben Sie das Formular.', deReviewed: false },
  document: { en: 'Please upload this document.', de: 'Bitte laden Sie dieses Dokument hoch.', deReviewed: false },
  money: {
    en: 'Please enter the amount in numbers and choose the currency.',
    de: 'Bitte geben Sie den Betrag in Ziffern ein und wählen Sie die Währung.',
    deReviewed: false,
  },
  latinName: {
    en: 'Please use Latin letters only, exactly as in the passport (for example Müller = Mueller).',
    de: 'Bitte nur lateinische Buchstaben verwenden, genau wie im Reisepass (zum Beispiel Müller = Mueller).',
    deReviewed: false,
  },
} satisfies Record<string, EkycText>;

const GROUP_MSG: Record<string, { min: EkycText; max?: EkycText }> = {
  licenses: {
    min: { en: 'Please add at least one license.', de: 'Bitte fügen Sie mindestens eine Lizenz hinzu.', deReviewed: false },
    max: { en: 'You can add up to 3 licenses.', de: 'Sie können bis zu 3 Lizenzen hinzufügen.', deReviewed: false },
  },
  shareholders: {
    min: { en: 'Please add at least one shareholder.', de: 'Bitte fügen Sie mindestens einen Gesellschafter hinzu.', deReviewed: false },
  },
  ubos: {
    min: { en: 'Please add at least one UBO.', de: 'Bitte fügen Sie mindestens einen wirtschaftlich Berechtigten (UBO) hinzu.', deReviewed: false },
  },
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in 'YYYY-MM-DD'. */
export function isEkycIsoDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900;
}

export function isEkycEmail(value: unknown): boolean {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * Phone check. The form uses tme-staff's PhoneInput, which stores E.164
 * ('+971581234567'). Older drafts hold free text, so this stays loose:
 * optional +, then digits / spaces / brackets / dots / hyphens, 7 to 15 digits.
 */
export function isEkycPhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

export function isEkycUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return /^(https?:\/\/)?[^\s.]+(\.[^\s.]+)+(\/\S*)?$/i.test(v);
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// ---------------------------------------------------------------------------
// D8: person names in Latin letters, passport MRZ style (ICAO 9303)
// ---------------------------------------------------------------------------

/** Hint under a person-name field. */
export const EKYC_LATIN_NAME_HINT: EkycText = {
  en: 'Latin letters as in the passport (Müller = Mueller)',
  de: 'Lateinische Buchstaben wie im Reisepass (Müller = Mueller)',
  deReviewed: false,
};

/** ICAO 9303 letters that do not simply lose an accent. Upper-case keys only; lower case is derived. */
const ICAO_UPPER: Record<string, string> = {
  Ä: 'AE',
  Ö: 'OE',
  Ü: 'UE',
  Å: 'AA',
  Æ: 'AE',
  Ø: 'OE',
  Œ: 'OE',
  Þ: 'TH',
  Ð: 'D',
  Ĳ: 'IJ',
  Ł: 'L',
  Đ: 'D',
  Ħ: 'H',
  ẞ: 'SS',
};
const ICAO_LOWER: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  å: 'aa',
  æ: 'ae',
  ø: 'oe',
  œ: 'oe',
  þ: 'th',
  ð: 'd',
  ĳ: 'ij',
  ł: 'l',
  đ: 'd',
  ħ: 'h',
  ı: 'i',
  ß: 'ss',
};

const isUpperLatin = (c: string | undefined) => c !== undefined && c >= 'A' && c <= 'Z';
const isLowerLetter = (c: string | undefined) => c !== undefined && c !== c.toUpperCase() && c === c.toLowerCase();

/**
 * D8: turn a typed name into Latin letters the way a passport MRZ writes it
 * (ICAO 9303): Ä/ä = AE/ae, Ö = OE, Ü = UE, ß = ss, Å = AA, Æ = AE, Ø = OE,
 * Œ = OE, Þ = TH, Ð/Đ = D, Ĳ = IJ, Ł = L; any other accent on a Latin letter
 * is dropped (Ş = S, é = e). Case stays as typed. A two-letter result of an
 * upper-case letter is "Oe" when the next letter is lower case (Ødegaard =
 * Oedegaard, Ärzte = Aerzte) and "OE" otherwise (ØDEGAARD = OEDEGAARD); ß
 * becomes "SS" between capitals (STRAßE = STRASSE). Runs of spaces become one
 * space; the ends are NOT trimmed (the client may still be typing). Letters
 * it cannot map (Arabic, Cyrillic, Chinese ...) stay, so isEkycLatinName
 * rejects them. Pure.
 */
export function ekycToLatinName(input: string): string {
  const chars = Array.from((input ?? '').normalize('NFC'));
  let out = '';
  chars.forEach((ch, i) => {
    const next = chars[i + 1];
    const prev = chars[i - 1];
    const upper = ICAO_UPPER[ch];
    if (upper !== undefined) {
      out += upper.length > 1 && isLowerLetter(next) ? upper[0] + upper.slice(1).toLowerCase() : upper;
      return;
    }
    const lower = ICAO_LOWER[ch];
    if (lower !== undefined) {
      out += ch === 'ß' && isUpperLatin(prev) && (next === undefined || !isLowerLetter(next)) ? 'SS' : lower;
      return;
    }
    if (ch === '\u2019' || ch === '\u2018' || ch === '`' || ch === '\u00b4') {
      out += "'"; // typographic apostrophe (O’Brien) = plain apostrophe
      return;
    }
    const decomposed = ch.normalize('NFD');
    const base = decomposed[0];
    if (decomposed.length > 1 && /^[A-Za-z]$/.test(base) && /^\p{M}+$/u.test(decomposed.slice(1))) {
      out += base; // accented Latin letter: keep the letter, drop the accent
      return;
    }
    out += ch; // anything else stays as typed
  });
  return out.replace(/\s+/g, ' ');
}

/** D8: true when a name is Latin letters only (A-Z, a-z, space, hyphen, apostrophe, dot), with at least one letter. */
export function isEkycLatinName(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z .'-]+$/.test(value) && /[A-Za-z]/.test(value);
}

/** D8: does the Latin-name rule apply to this field for this data / row? */
export function isEkycLatinNameField<D, R>(field: EkycFieldDef<D, R>, data: D, row: R): boolean {
  if (!field.latinName) return false;
  return field.latinNameWhen ? field.latinNameWhen(data, row) : true;
}

/** Check one visible field. Returns an error message or null. */
function checkField<D, R>(field: EkycFieldDef<D, R>, value: unknown, data: D, row: R): EkycText | null {
  const options = field.optionsFor ? field.optionsFor(data, row) : field.options;
  if (field.kind === 'signature') {
    if (typeof value === 'string' && value.startsWith('data:image/')) return null;
    return field.required || !isBlank(value) ? MSG.signature : null;
  }
  if (isBlank(value)) {
    if (!field.required) return null;
    if (field.kind === 'yesno' || field.kind === 'select' || field.kind === 'country') return MSG.choose;
    if (field.kind === 'multiselect' || field.kind === 'countries') return MSG.chooseOne;
    return MSG.required;
  }
  if (isEkycLatinNameField(field, data, row) && !isEkycLatinName(String(value).trim())) return MSG.latinName;
  switch (field.kind) {
    case 'lines':
      // At least one non-empty line (a value of only line breaks is blank).
      if (ekycSplitLines(value).length > 0) return null;
      return field.required ? MSG.required : null;
    case 'email':
      return isEkycEmail(value) ? null : MSG.email;
    case 'phone':
      return isEkycPhone(value) ? null : MSG.phone;
    case 'url':
      return isEkycUrl(value) ? null : MSG.url;
    case 'money':
      return isEkycMoney(value) ? null : MSG.money;
    case 'date':
      return isEkycIsoDate(value) ? null : MSG.date;
    case 'percent': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) && n > 0 && n <= 100 ? null : MSG.percent;
    }
    case 'yesno':
      return value === 'yes' || value === 'no' ? null : MSG.choose;
    case 'select':
      return options && !options.some((o) => o.value === value) ? MSG.chooseFromList : null;
    case 'country':
      return EKYC_COUNTRIES.includes(String(value)) ? null : MSG.chooseFromList;
    case 'multiselect': {
      const list = value as unknown[];
      return options && list.some((v) => !options.some((o) => o.value === v)) ? MSG.chooseFromList : null;
    }
    case 'countries': {
      const list = value as unknown[];
      return list.some((v) => !EKYC_COUNTRIES.includes(String(v))) ? MSG.chooseFromList : null;
    }
    default:
      return null;
  }
}

/** Is the field shown for this data / row? */
export function isEkycFieldVisible<D, R>(field: EkycFieldDef<D, R>, data: D, row: R): boolean {
  return field.visibleWhen ? field.visibleWhen(data, row) : true;
}

function validateBySchema<D>(schema: EkycFormSchema<D>, data: D): EkycValidationError[] {
  const errors: EkycValidationError[] = [];
  for (const field of schema.fields) {
    if (!isEkycFieldVisible(field, data, data)) continue;
    const message = checkField(field, getEkycValue(data, field.id), data, data);
    if (message) errors.push({ fieldId: field.id, message });
  }
  for (const group of schema.groups) {
    const rows = getEkycValue(data, group.id);
    const list: unknown[] = Array.isArray(rows) ? rows : [];
    const msgs = GROUP_MSG[group.id];
    if (list.length < group.min) {
      errors.push({ fieldId: group.id, message: msgs?.min ?? MSG.required });
    }
    if (group.max !== undefined && list.length > group.max) {
      errors.push({ fieldId: group.id, message: msgs?.max ?? MSG.required });
    }
    list.forEach((row, index) => {
      for (const field of group.fields) {
        if (!isEkycFieldVisible(field, data, row)) continue;
        const message = checkField(field, getEkycValue(row, field.id), data, row);
        if (message) errors.push({ fieldId: ekycRowPath(group.id, index, field.id), message });
      }
    });
  }
  return errors;
}

/** All problems that block submitting a corporate form. Empty = OK. */
export function validateCorporateKyc(data: CorporateKycData): EkycValidationError[] {
  return validateBySchema(CORPORATE_KYC_SCHEMA, data);
}

/**
 * All problems that block submitting an individual form, including the
 * uploads (decision D4). Pass the submission's documents; omit them only for
 * a check of the answers alone.
 */
export function validateIndividualKyc(
  data: IndividualKycData,
  documents?: EkycDocuments
): EkycValidationError[] {
  const errors = validateBySchema(INDIVIDUAL_KYC_SCHEMA, data);
  if (documents !== undefined) {
    for (const slot of ekycRequiredDocumentSlots(data)) {
      if (!documents[slot]?.path) errors.push({ fieldId: `documents.${slot}`, message: MSG.document });
    }
  }
  return errors;
}

// ===========================================================================
// Pre-fill (corporate only, R7) and row shapes
// ===========================================================================

/**
 * ekyc_requests.prefill_data / ekyc_submissions.prefill_data.
 * Corporate: the values the portal really holds. Individual: always
 * { prefilledFieldIds: [] } (R6).
 * `prefilledFieldIds` lists every path that was pre-filled, so the form can
 * mark it (EKYC_PREFILLED_FIELD_MARK): top-level ids ('companyName'), row
 * paths ('licenses.0.issueDate', 'shareholders.1.percent').
 */
export type EkycPrefillData = Partial<CorporateKycData> & {
  prefilledFieldIds: string[];
};

export interface EkycRecipient {
  name: string;
  email: string;
  source: 'manager' | 'manual';
}

/** Portal table ekyc_requests (migration 602). Timestamps as ISO strings. */
export interface EkycRequestRow {
  id: string;
  type: EkycType;
  /** null for an individual without a portal client (decision D1). */
  client_id: number | null;
  /** The person's name for an individual without a client (D1). */
  person_name: string | null;
  /** Snapshots taken at send, so the tracker still reads right if the client changes. */
  client_code: string | null;
  client_name: string | null;
  recipients: EkycRecipient[];
  email_language: EkycLanguage;
  bilingual: boolean;
  /** Individual email: "your XXXX service (for example your Golden Visa)". */
  service_name: string | null;
  prefill_data: EkycPrefillData;
  submitted_data: CorporateKycData | IndividualKycData | null;
  documents: EkycPortalDocuments;
  status: EkycStatus;
  link_token: string | null;
  supabase_id: string | null;
  expires_at: string | null;
  sent_at: string | null;
  sent_by: number | null;
  reissue_count: number;
  received_at: string | null;
  /** client_documents.id of the filed PDF. */
  pdf_document_id: string | null;
  /** When the submitted PDF was emailed to AML@ (R14); null = still to send. */
  aml_email_sent_at: string | null;
  approved_at: string | null;
  approved_by: number | null;
  setup_comment: string | null;
  aml_comment: string | null;
  setup_comment_updated_by: number | null;
  setup_comment_updated_at: string | null;
  aml_comment_updated_by: number | null;
  aml_comment_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Supabase table ekyc_submissions (database/supabase/ekyc_submissions.sql). */
export interface EkycSubmissionRow {
  id: string;
  link_token: string;
  /** Which portal environment minted the row; each cron reads only its own. */
  origin_env: string;
  /** ekyc_requests.id in the portal that minted it. */
  portal_request_id: string;
  type: EkycType;
  status: EkycSubmissionStatus;
  /** Heading on the form: company name (corporate) or person name (individual). */
  display_name: string;
  client_code: string | null;
  bilingual: boolean;
  prefill_data: EkycPrefillData;
  /** Draft while in_progress, final once submitted. */
  form_data: CorporateKycData | IndividualKycData | null;
  /** Individual uploads (bucket `ekyc-documents`). */
  documents: EkycDocuments;
  expires_at: string;
  submitted_at: string | null;
  synced_to_tme: boolean;
  created_at: string;
  updated_at: string;
}

/** True when the link date has passed (status may still say sent / in_progress). */
export function isEkycLinkExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t < now.getTime();
}
