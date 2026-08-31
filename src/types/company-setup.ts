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
  licenseType: CompanySetupLicenseType;  // 'Both' adds AED 2,000/yr
  businessDescription?: string;          // brief description of intended business
  shareCapitalAED?: number;
  valuePerShareAED?: number;
  numberOfShares?: number;
  visaCount?: number;                    // employment visas required
  facilityType?: CompanySetupFacilityType;
  facilitySize?: string;                 // approx size, free text; 'n/a' for virtual office
}

export interface CompanySetupPersonRoles {
  shareholder: boolean;
  generalManager: boolean; // exactly 1 across all persons
  director: boolean;       // at least 1 across all persons
  secretary: boolean;      // exactly 1 across all persons
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
  fullName: string;              // as per passport
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

export const COMPANY_SETUP_MAX_SHAREHOLDERS = 6;
export const COMPANY_SETUP_MAX_ACTIVITIES = 10;
export const COMPANY_SETUP_INCLUDED_ACTIVITIES = 3;
export const COMPANY_SETUP_NAME_OPTIONS_REQUIRED = 3;
export const COMPANY_SETUP_LINK_EXPIRES_HOURS = 336; // 14 days, matches staff onboarding
export const IFZA_BUSINESS_ACTIVITIES_URL = 'https://activities.ifza.com/';
