// Company Setup Intake (IFZA v1) — shared data contract.
// MIRROR of the portal repo's src/lib/company-setup/types.ts (the single
// source of truth) — keep both copies in sync. See the portal's
// PLAN-company-setup-intake.md.

export type CompanySetupIntakeStatus =
  | 'draft'        // staff pre-filling, nothing sent
  | 'invited'      // link sent to client
  | 'in_progress'  // client opened/saved the form
  | 'submitted'    // client submitted on tme-staff (Supabase row final)
  | 'synced'       // pulled back into the portal, awaiting review/conversion
  | 'converted'    // clients_v2 record created (in_formation)
  | 'cancelled'
  | 'expired';

export type CompanySetupLicenseType = 'Commercial' | 'Professional' | 'Both';

// Excel: "Type of facility required (office or warehouse)"; default Virtual Office
export type CompanySetupFacilityType = 'virtual_office' | 'office' | 'warehouse';

export interface CompanySetupNameOption {
  name: string;
}

export interface CompanySetupActivity {
  code?: string;       // IFZA activity code (optional; from the IFZA activity search)
  description: string; // free text; client picks from the IFZA site (link shown in form)
}

export interface CompanySetupCompanyData {
  nameOptions: CompanySetupNameOption[]; // exactly 3, all rule-valid
  activities: CompanySetupActivity[];    // 1..10; 3 included in package, AED 2,000/yr per extra
  // No longer asked in the client form (tester feedback 27.09.26): staff may
  // still set it in the portal editor. Optional so a submission without it
  // passes validation and conversion.
  licenseType?: CompanySetupLicenseType; // 'Both' adds AED 2,000/yr
  businessDescription?: string;          // brief description of intended business (optional)
  shareCapitalAED?: number;
  valuePerShareAED?: number;
  numberOfShares?: number;
  visaCount?: number;                    // employment visas required
  facilityType?: CompanySetupFacilityType;
  facilitySize?: string;                 // approx size, free text; 'n/a' for virtual office
}

export interface CompanySetupPersonRoles {
  shareholder: boolean;
  generalManager: boolean; // at most 1 across all persons (0 allowed)
  director: boolean;       // at least 1 across all persons
  secretary: boolean;      // at most 1 across all persons (0 allowed)
}

export interface CompanySetupPreviousEmployer {
  name?: string;
  address?: string;
  position?: string;
}

export interface CompanySetupVisaInfo {
  visaRequired: boolean;
  jobTitle?: string;        // e.g. General Manager
  basicMonthlySalaryAED?: number;
  vipStamping?: boolean;    // express stamping, AED 1,500
}

// Fields mirror the "Natural Person" sheet of the setup Excel.
export interface CompanySetupPerson {
  /**
   * The person's name as one string, ALWAYS equal to the three parts below
   * joined by single spaces. It stays the required name field because it is
   * what the invite email, the validation messages, the proof-of-address name
   * check and the tracker read — and rows created before the split carry only
   * this. Use composeFullName() whenever a part changes.
   */
  fullName: string;              // as per passport
  /**
   * The name in the three parts the passport prints and clients_v2 stores
   * (client_shareholders.first_name / middle_name / family_name). Carrying
   * them through means conversion no longer has to GUESS the split back out
   * of a joined string — the old heuristic put "Novalic Junior" in the wrong
   * columns for anyone with two given names. Optional: a legacy row, or a
   * name typed as one string, has fullName only and still converts via the
   * fallback split.
   */
  firstName?: string;
  middleName?: string;
  lastName?: string;             // family name
  roles: CompanySetupPersonRoles;
  shareholdingPct?: number;      // all persons must total 100
  nationality?: string;
  otherNationality?: string;
  dateOfBirth?: string;          // ISO YYYY-MM-DD
  // Passport details — auto-extracted from the uploaded passport copy where
  // possible; optional everywhere (extraction can fail, staff can parse later).
  passportNumber?: string;
  passportIssueDate?: string;    // ISO YYYY-MM-DD
  passportExpiryDate?: string;   // ISO YYYY-MM-DD
  /**
   * Syria only: this person's passport has no additional page. The NEW Syrian
   * booklet (renewals from 2026) prints date/place of issue, expiry and the
   * national number on the data page and carries no second page, so asking for
   * one leaves the client unable to submit the form at all — and unlike a
   * staff record, nobody at TME can upload it on their behalf. Set by the tick
   * in the documents step; the auto-detect on the data page usually settles it
   * first. See companySetupAdditionalPageRequired().
   */
  passportHasNoAdditionalPage?: boolean;
  gender?: 'male' | 'female';
  placeOfBirth?: string;
  educationalQualification?: string;
  languagesSpoken?: string;
  religion?: string;             // mandatory on the authority application
  maritalStatus?: string;
  spouseFullName?: string;       // if married
  fatherFullName?: string;
  motherFullName?: string;
  email?: string;
  mobile?: string;
  fullAddress?: string;          // must match bank statement (proof of address)
  visitedOrResidedUAE?: boolean;
  currentOrPastEidVisa?: 'current' | 'past' | 'none';
  previousEmployer?: CompanySetupPreviousEmployer;
  otherEntityShareholder?: boolean; // shareholder in any other entity worldwide
  otherEntityCount?: number;
  visa: CompanySetupVisaInfo;
}

// One uploaded file reference (Supabase storage path pre-sync, local path post-sync).
export interface CompanySetupDocRef {
  path: string;
  filename: string;
  uploadedAt: string; // ISO timestamp
  needsReview?: boolean;
  validationErrors?: string[];
  // Passport slot only: the person fields the tme-staff form auto-filled from
  // this file (field -> applied value), so a resumed draft can undo exactly
  // those on removal. Client-side bookkeeping — the portal sync rebuilds refs
  // from a whitelist and drops it.
  extractedData?: Record<string, string>;
  // Who supplied the file: 'staff' = pre-uploaded in the portal editor (renders
  // read-only in the client form, omitted from the invite document checklist);
  // 'client'/undefined = uploaded by the client in the form.
  source?: 'staff' | 'client';
}

// Keyed per person index (string of the array index) -> slot -> ref.
// proof_of_address = BANK STATEMENT ONLY, max 3 months old, always needsReview.
export type CompanySetupPersonDocuments = Partial<{
  passport: CompanySetupDocRef;
  // Required for Indian and Syrian passports only: the additional page
  // (India: address/family page; Syria: issue-details page).
  passport_additional: CompanySetupDocRef;
  photo: CompanySetupDocRef;
  eid_front: CompanySetupDocRef;
  eid_back: CompanySetupDocRef;
  visa_document: CompanySetupDocRef;
  previous_visa_document: CompanySetupDocRef;
  proof_of_address: CompanySetupDocRef;
}>;

export type CompanySetupDocuments = Record<string, CompanySetupPersonDocuments>;

export interface CompanySetupContact {
  name: string;
  email: string;
  mobile?: string;
}

// What staff pre-fill before sending the link. Everything optional except contact.
export interface CompanySetupPrefillData {
  contact: CompanySetupContact;
  company?: Partial<CompanySetupCompanyData>;
  persons?: Array<Partial<CompanySetupPerson>>;
  notesForClient?: string; // optional free text shown in the form intro
}

// What the client submits (server-validated on tme-staff before accept).
export interface CompanySetupSubmittedData {
  company: CompanySetupCompanyData;
  persons: CompanySetupPerson[]; // 1..6
  // Client-corrected contact details (editable on the Welcome step). The portal
  // shows these diffed against the intake columns — NEVER auto-applied, because
  // contact_email is the address the link was sent to and a Resend would use.
  contact?: CompanySetupContact;
  confirmedAt: string;           // ISO; client ticked the confirm checkbox
}

export interface CompanySetupRemark {
  text: string;
  userId: number;
  userName: string;
  /** Employee code of the author ("071"), so a note reads "071 - text".
   *  Optional: notes written before this field existed have none. */
  userCode?: string;
  at: string; // ISO
}

// Portal row (company_setup_intakes). Not used by tme-staff at runtime —
// kept so this file stays a verbatim mirror of the portal contract.
export interface CompanySetupIntake {
  id: string; // UUID
  status: CompanySetupIntakeStatus;
  authority: string; // 'IFZA' in v1
  contactName: string;
  contactEmail: string;
  contactMobile: string | null;
  provisionalCompanyCode: string | null;
  prefillData: CompanySetupPrefillData;
  submittedData: CompanySetupSubmittedData | null;
  documents: CompanySetupDocuments;
  supabaseId: string | null;
  linkToken: string | null;
  expiresAt: string | null;
  inviteSentAt: string | null;
  inviteSentBy: number | null;
  reissueCount: number;
  setupNote: string | null;        // free-text current status (tracker column)
  remarks: CompanySetupRemark[];   // append-only notes
  isPaid: boolean;                 // manual fallback
  invoiceId: number | null;        // invoices.id — when set, paid derives from the invoice
  clientId: number | null;         // clients_v2.id after conversion
  createdBy: number;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Join the name parts into the single fullName the contract requires. Empty /
 * whitespace-only parts drop out, so "Damir" + "" + "Novalic" is
 * "Damir Novalic", never "Damir  Novalic".
 */
export function composeFullName(parts: {
  firstName?: string;
  middleName?: string;
  lastName?: string;
}): string {
  return [parts.firstName, parts.middleName, parts.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

// Role limits (tester feedback 27.09.26, approved): at most 1 General Manager
// and at most 1 Secretary (0 allowed), 1 to 6 Shareholders, at least 1
// Director. One person can hold all roles. The shareholder cap counts people
// with the Shareholder role, not all persons.
export const COMPANY_SETUP_MAX_SHAREHOLDERS = 6;
export const COMPANY_SETUP_MAX_GENERAL_MANAGERS = 1;
export const COMPANY_SETUP_MAX_SECRETARIES = 1;
// Hard cap on the persons list: 6 shareholders + a separate General Manager,
// Secretary and Director.
export const COMPANY_SETUP_MAX_PERSONS = 9;

/**
 * Why a role cannot be ticked for one person right now, or null when it can.
 * Only ADDING a role is ever blocked (unticking always works): a 2nd General
 * Manager, a 2nd Secretary or a 7th Shareholder. Used by the role buttons in
 * the client form and the staff editor so they match validatePersons.
 */
export function companySetupRoleBlockedReason(
  persons: ReadonlyArray<{ roles?: Partial<CompanySetupPersonRoles> }>,
  index: number,
  role: keyof CompanySetupPersonRoles
): string | null {
  if (persons[index]?.roles?.[role]) return null;
  const others = persons.filter((p, i) => i !== index && p?.roles?.[role]).length;
  if (role === 'generalManager' && others >= COMPANY_SETUP_MAX_GENERAL_MANAGERS) {
    return 'Only one person can be the General Manager.';
  }
  if (role === 'secretary' && others >= COMPANY_SETUP_MAX_SECRETARIES) {
    return 'Only one person can be the Secretary.';
  }
  if (role === 'shareholder' && others >= COMPANY_SETUP_MAX_SHAREHOLDERS) {
    return `A company can have up to ${COMPANY_SETUP_MAX_SHAREHOLDERS} shareholders.`;
  }
  return null;
}
export const COMPANY_SETUP_MAX_ACTIVITIES = 10;
export const COMPANY_SETUP_INCLUDED_ACTIVITIES = 3;
export const COMPANY_SETUP_NAME_OPTIONS_REQUIRED = 3;
export const COMPANY_SETUP_LINK_EXPIRES_HOURS = 720; // 30 days
export const IFZA_BUSINESS_ACTIVITIES_URL = 'https://activities.ifza.com/';

// IFZA share capital rules (shown on the Share Capital step). The fields stay
// optional; when filled in they must meet these minimums.
export const COMPANY_SETUP_MIN_SHARE_CAPITAL_AED = 10_000;
export const COMPANY_SETUP_MIN_VALUE_PER_SHARE_AED = 10;

/**
 * Religion values IFZA does not offer. They stay in the shared staff lists
 * (staff onboarding still uses them) but are removed from every company setup
 * dropdown. A stored value from before is treated as "not answered yet".
 */
export const COMPANY_SETUP_EXCLUDED_RELIGIONS: readonly string[] = ['Atheist/Non-religious'];

/** The religion list for a company setup dropdown: the app's list minus IFZA gaps. */
export function companySetupReligionOptions<T extends string>(all: readonly T[]): T[] {
  return all.filter((r) => !COMPANY_SETUP_EXCLUDED_RELIGIONS.includes(r));
}

/** A stored religion as the dropdown should show it: '' when blank or no longer offered. */
export function companySetupReligionValue(value: string | undefined): string {
  const v = (value ?? '').trim();
  return v && !COMPANY_SETUP_EXCLUDED_RELIGIONS.includes(v) ? v : '';
}

/**
 * Portrait photo + proof of address (bank statement) are needed for every
 * shareholder, and for a company officer who wants a UAE visa. The visa is
 * ticked on the Visa & Facility step, AFTER the documents step, so for an
 * officer this only becomes true once that tick is set.
 */
export function companySetupNeedsPhotoAndAddress(
  person: Pick<CompanySetupPerson, 'roles' | 'visa'> | undefined
): boolean {
  return !!person?.roles?.shareholder || !!person?.visa?.visaRequired;
}
