/**
 * Staff onboarding type definitions
 */

// ===================================================================
// EMPLOYER FORM DATA
// ===================================================================

export interface EmployerFormData {
  job_title_visa: string;
  job_title_visa_custom?: string;
  job_title_company: string;
  job_title_company_custom?: string;
  department: string;
  department_custom?: string;
  working_location: string;
  working_location_custom?: string;
  responsible_manager?: string;
  sponsor: string;
  salary_currency: string;
  salary_total: number;
  salary_basic: number;
  salary_accommodation: number;
  salary_transport: number;
  salary_food?: number;
  salary_other?: number;
  // Typed allowance breakdown for the contract salary's "Other" bucket. When
  // entries exist, salary_other is locked to the sum of these amounts —
  // mirrors the payroll-side payroll_salary_other_breakdown.
  salary_other_breakdown?: Array<{
    type: 'education' | 'phone' | 'commute' | 'bonus' | 'salik'
        | 'petrol' | 'pension' | 'health_insurance' | 'car' | 'flight' | 'prepay_card' | 'other';
    amount: number;
  }>;
  // Provided-benefit flags — 'yes' = company provides directly (FIRST PARTY),
  // 'allowance' = paid as cash (amount lives in the matching salary_* field),
  // 'no' = not provided. Default 'no' when AI extraction can't determine.
  accommodation_provided: 'yes' | 'no' | 'allowance';
  transport_provided: 'yes' | 'no' | 'allowance';
  food_provided: 'yes' | 'no' | 'allowance';
  payroll_salary_currency?: string;
  payroll_salary_total?: number;
  payroll_salary_basic?: number;
  payroll_salary_accommodation?: number;
  payroll_salary_transport?: number;
  payroll_salary_food?: number;
  payroll_salary_other?: number;
  payroll_salary_other_breakdown?: Array<{
    type: 'education' | 'phone' | 'commute' | 'bonus' | 'salik'
        | 'petrol' | 'pension' | 'health_insurance' | 'car' | 'flight' | 'prepay_card' | 'other';
    amount: number;
  }>;
  annual_leave_days: number;
  annual_leave_type: 'calendar' | 'working';
  notice_period_value: number;
  notice_period_unit: 'days' | 'weeks' | 'months';
  probation_period_value: number;
  probation_period_unit: 'days' | 'weeks' | 'months';
  weekly_off: 'sunday' | 'saturday_sunday';
  starting_date: string; // ISO format YYYY-MM-DD

  // UAE Visa Status (employer only indicates whether applicant is currently in UAE;
  // the employee picks the visa category themselves)
  applicant_in_uae?: boolean;
}

export type VisaCategory =
  | 'visa_on_arrival'
  | 'tourist_visa'
  | 'employment_visa'
  | 'immigration_cancellation'
  | 'golden_visa'
  | 'dependent_visa'
  | 'other';

// ===================================================================
// EMPLOYEE FORM DATA
// ===================================================================

export interface EmployeeFormData {
  // Personal (from passport)
  title: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  full_name?: string; // Auto-calculated
  nationality: string;
  other_nationality?: string; // For "I have another nationality" checkbox
  additional_nationalities?: string[]; // Legacy field
  previous_nationality?: string;
  date_of_birth?: string; // ISO format
  passport_number?: string;
  passport_issue_date?: string; // ISO format
  passport_expiry?: string; // ISO format
  place_of_issue?: string;
  gender?: 'male' | 'female';

  // Family
  father_full_name: string;
  mother_full_name: string;
  religion: string;
  marital_status: string;
  spouse_name?: string;

  // Contact - Home Country (separate fields)
  home_street_address: string;
  home_city: string;
  home_country: string;
  home_postal_code?: string;
  home_telephone?: string;
  // Legacy field (for backwards compatibility)
  home_address?: string;

  // Contact - UAE
  uae_presence: 'inside' | 'outside';
  uae_street_address?: string;
  uae_city?: string;
  uae_postal_code?: string;
  uae_emirate?: string;
  // Deprecated (kept for backwards compat)
  uae_flat_villa?: string;
  uae_building_name?: string;
  uae_street_name?: string;

  // Email & Phone
  personal_email: string;
  company_email?: string;
  same_emails: boolean;
  mobile_uae: string;
  mobile_international?: string;
  // True when the employee confirms they don't have an active UAE mobile yet.
  // Lets isContactComplete pass without a UAE number and flags the staff
  // record on the portal side until HR fills one in.
  mobile_uae_unavailable?: boolean;

  // Education
  educational_qualification: string;
  educational_qualification_custom?: string;
  languages_spoken: string[];

  // DET-only extended education details (collected when registered_authority
  // is DET and the qualification is degree-level). Degree type is captured
  // via the unified Educational Qualification dropdown, not a separate field.
  det_university_name?: string;
  det_faculty?: string;
  det_study_majors?: string;
  det_degree_start_date?: string; // ISO YYYY-MM-DD
  det_degree_end_date?: string;   // ISO YYYY-MM-DD
  det_graduation_year?: number;
  det_actual_years_of_degree?: number;

  // Bank
  has_uae_bank: boolean;
  bank_name?: string;
  bank_branch?: string;
  bank_swift?: string;
  bank_account_name?: string;
  bank_iban?: string;
  bank_routing_code?: string;

  // Emirates ID (previously held)
  has_previous_eid?: boolean;
  eid_number?: string;
  eid_issue_date?: string;   // ISO format
  eid_expiry_date?: string;  // ISO format

  // UAE Visa Status (employee picks their current visa category when employer
  // indicated applicant_in_uae = true)
  visa_category?: VisaCategory;
  visa_arrival_date?: string; // ISO format YYYY-MM-DD, only when visa_category = 'visa_on_arrival'

  // Family-sponsored only — sponsor metadata + dependent snapshot captured in
  // the sponsor step. Sponsor signs the NOC inline; the dependent_* fields are
  // seeded read-only from the applicant's own extracted passport so they
  // snapshot into the payload alongside the sponsor merge fields.
  sponsor_name?: string;
  sponsor_nationality?: string;
  sponsor_passport_number?: string;
  sponsor_mobile?: string;
  sponsor_relationship?: 'husband' | 'wife' | 'father' | 'mother' | 'son' | 'daughter';
  dependent_name?: string;
  dependent_nationality?: string;
  dependent_passport_number?: string;
  sponsor_noc_signature?: string;
  sponsor_noc_signed_at?: string; // ISO timestamp

  // Other
  other_information?: string;

  // Submission telemetry — stamped at final submit, not user-entered.
  // Device is the client's touch+viewport heuristic (same signal that gates
  // the mobile upload policy); the user agent is set server-side from the
  // request header in /api/submit-employee.
  submission_device?: 'phone' | 'desktop';
  submission_user_agent?: string;
}

// ===================================================================
// DEPENDENT FORM DATA
// ===================================================================

/** The eight relationship types a sponsor may register a dependent under. */
export type DependentType =
  | 'Spouse'
  | 'Son'
  | 'Daughter'
  | 'Father'
  | 'Mother'
  | 'Father-in-Law'
  | 'Mother-in-Law'
  | 'Maid';

/**
 * What the TME Portal writes into `prefill_employee_data` when it creates a
 * dependent row.
 *
 * - `dependent` (first registration): only `dependent_type` and the sponsor
 *   display fields are guaranteed; the name fields are present only when CS
 *   typed them.
 * - `dependent_renewal` / `dependent_document_request`: the portal ALSO writes
 *   the dependent's full current field block, using the SAME key names and
 *   date-string formats DependentForm emits into `employee_data`. Every field
 *   stays optional — a missing key just leaves that input blank.
 *
 * The `sponsor_*` fields are display/contact metadata only; they never travel
 * into the submitted payload (they drive the "use my number/email" checkboxes
 * and the page header).
 */
export interface DependentPrefillData extends Partial<DependentFormData> {
  sponsor_staff_name?: string;
  sponsor_staff_number?: string;
  /** Sponsor's UAE mobile — the UAE Mobile "use my number" checkbox copies this. */
  sponsor_mobile?: string;
  /** Sponsor's home-country mobile — the Home Country Mobile checkbox copies this. */
  sponsor_mobile_home?: string;
  sponsor_email?: string;
}

/**
 * Payload the sponsor-facing DependentForm writes into `employee_data` on a
 * dependent onboarding row. Keys are the shared contract with the portal's
 * dependent sync branch — do not rename.
 */
export interface DependentFormData {
  // Identity (from the dependent's passport)
  first_name: string;
  middle_name?: string;
  /** May be '' — many passports (e.g. Indian) carry no surname. */
  last_name: string;
  full_name?: string; // Auto-calculated
  nationality: string;
  date_of_birth?: string;
  gender?: 'male' | 'female';
  passport_no?: string;
  passport_issue_date?: string;
  passport_expiry?: string;

  /** Read-only, mirrored from prefill_employee_data.dependent_type. */
  dependent_type?: DependentType;

  // Personal
  mother_full_name: string;
  father_full_name: string;
  religion: string;
  marital_status: string;

  // UAE visa history
  previously_held_uae_visa?: boolean;

  // Presence + addresses
  uae_presence: 'inside' | 'outside';
  uae_street_address?: string;
  uae_city?: string;
  uae_postal_code?: string;
  uae_emirate?: string;
  home_street_address: string;
  home_city: string;
  home_country: string;
  home_postal_code?: string;

  // Contacts — each may be copied from the sponsor via a checkbox
  mobile_uae?: string;
  mobile_uae_use_sponsor?: boolean;
  mobile_home_country?: string;
  mobile_home_use_sponsor?: boolean;
  email?: string;
  email_use_sponsor?: boolean;

  /** Mandatory attestation tick on the relationship certificate. */
  certificate_attestation_confirmed?: boolean;

  other_information?: string;

  // Submission telemetry — stamped at final submit, not user-entered.
  submission_device?: 'phone' | 'desktop';
  submission_user_agent?: string;
}

// ===================================================================
// DOCUMENT REFERENCES
// ===================================================================

export interface PassportPageReference {
  path: string;
  filename: string;
  validated: boolean;
  extracted_data?: Record<string, unknown>;
  // Set when the user submitted via the manual-review fallback after
  // 3 consecutive AI-validation rejections. AI gate was bypassed; the
  // upload still needs human verification before processing.
  needsReview?: boolean;
}

export interface StaffDocumentReferences {
  photo?: {
    path: string;
    filename: string;
    validated: boolean;
    validation_errors?: string[];
    // Set when the user submitted via the manual-review fallback after
    // MANUAL_REVIEW_THRESHOLD consecutive AI rejections. `validated` is
    // stamped true to unblock the form; a TME team member verifies the
    // photo on the portal side (needs_review column).
    needsReview?: boolean;
    // Set when the manual-review submit happened after the vision comparison
    // judged THIS upload to be the same capture as the photo on file
    // (renewals / photo re-requests). The portal folds it into needs_review
    // with a "same photo already on record" review label.
    samePhotoSuspected?: boolean;
  };
  // Legacy single passport field (for backwards compatibility)
  passport?: {
    path: string;
    filename: string;
    extracted_data?: Record<string, unknown>;
  };
  // New multi-page passport structure
  passportPages?: {
    cover?: PassportPageReference;
    insidePages?: PassportPageReference;
    additionalPage?: PassportPageReference;
    extracted_data?: Record<string, unknown>;
  };
  // Renewals only ('renewal' and 'dependent_renewal'): the employee — or, on
  // a dependent renewal, the sponsor — ticked "the passport is the same as
  // shown" and skipped the passport upload steps. Persisted so the
  // server-side submit gate can verify the skip was legitimate (both existing
  // pages on file) instead of trusting client state.
  passport_unchanged?: boolean;
  eid?: {
    path: string;
    filename: string;
  };
  // DMCC Job Offer Letter (employer uploads)
  job_offer_letter?: {
    path: string;
    filename: string;
  };
  // Visa document (based on employer's visa category selection)
  visa_document?: {
    path: string;
    filename: string;
    validated?: boolean;
    visa_category?: string;
  };
  // Previously held UAE visa / residence permit (optional, step 4)
  previous_visa_document?: {
    path: string;
    filename: string;
    validated?: boolean;
    extracted_data?: Record<string, unknown>;
  };
  // Emirates ID (front + back, employee uploads)
  eid_front?: {
    path: string;
    filename: string;
    validated?: boolean;
    extracted_data?: Record<string, unknown>;
    // Set when the user submitted via the 2-strike manual-review fallback
    // (document re-request flow) — TME verifies the upload manually.
    needsReview?: boolean;
  };
  eid_back?: {
    path: string;
    filename: string;
    validated?: boolean;
    extracted_data?: Record<string, unknown>;
    // Set when the user submitted via the 2-strike manual-review fallback
    // (document re-request flow) — TME verifies the upload manually.
    needsReview?: boolean;
  };
  // Pakistani National ID (front + back, for Pakistani nationals)
  pakistan_id_front?: {
    path: string;
    filename: string;
    validated?: boolean;
    extracted_data?: Record<string, unknown>;
  };
  pakistan_id_back?: {
    path: string;
    filename: string;
    validated?: boolean;
    extracted_data?: Record<string, unknown>;
  };
  // Sponsor identity documents (family-sponsored only). AI VALIDATES the
  // uploads (type-check parity with applicant docs) but does NOT extract into
  // the dependent's own identity fields — pointing the applicant extract
  // routes at sponsor docs would corrupt the dependent's data. `needsReview`
  // is set when the user submitted via the 2-strike manual-review fallback.
  sponsor_passport?: {
    path: string;
    filename: string;
    validated?: boolean;
    extracted_data?: Record<string, unknown>;
    needsReview?: boolean;
  };
  sponsor_visa?: {
    path: string;
    filename: string;
    validated?: boolean;
    visa_category?: string;
    needsReview?: boolean;
  };
  sponsor_eid_front?: {
    path: string;
    filename: string;
    validated?: boolean;
    needsReview?: boolean;
  };
  sponsor_eid_back?: {
    path: string;
    filename: string;
    validated?: boolean;
    needsReview?: boolean;
  };
  // Dependent onboarding (onboarding_type === 'dependent'). Plain uploads —
  // no AI validation anywhere in the flow. The certificate is additionally
  // flagged for human review on the portal side (attestation check).
  // NOTE: on a 'dependent_document_request' the same four documents are
  // re-requested through the GENERIC slot machinery instead, so they land in
  // `extra_documents[<key>]` (with needsReview) rather than in these flat
  // refs — a re-request always wants a fresh copy, never a stale flat ref.
  relationship_certificate?: {
    path: string;
    filename: string;
  };
  previous_visa?: {
    path: string;
    filename: string;
  };
  previous_eid_front?: {
    path: string;
    filename: string;
  };
  previous_eid_back?: {
    path: string;
    filename: string;
  };
  degree_attested?: {
    path: string;
    filename: string;
  };
  transcript_of_records?: {
    path: string;
    filename: string;
  };
  education_additional?: {
    path: string;
    filename: string;
  };
  // Document re-request flow: uploads for requestable portal document_type
  // keys that have no dedicated slot above (visa, employment_contract,
  // work_permit, insurances, driving license, sponsor docs, ...). Keyed by
  // the portal document_type. Generic uploads are never AI-checked, so they
  // always carry needsReview: true — the portal flags them for human review
  // on sync. Mirrors the portal's StaffDocumentReferences in supabase-client.ts.
  extra_documents?: Record<string, { path: string; filename: string; needsReview?: boolean }>;
}

// ===================================================================
// STAFF ONBOARDING SUBMISSION
// ===================================================================

export type OnboardingStep = 'employer' | 'employee' | 'complete';
export type OnboardingStatus = 'pending' | 'employer_completed' | 'complete' | 'cancelled';

/**
 * What kind of form a submission row renders. Written by the TME Portal when
 * it creates the row; tme-staff never changes it.
 *
 * Staff flows (the employee is the subject and the signer):
 *   new_hire | renewal   — two-stage employer + employee onboarding
 *   document_request     — single-stage re-upload of `requested_documents`
 *
 * Sponsor flows (an existing staff member fills the form FOR a dependent —
 * always single-stage: current_step='employee', is_same_person=true, no
 * employee_access_token; the rotatable link_token is the only secret):
 *   dependent                    — first registration of a dependent
 *   dependent_renewal            — visa renewal of a dependent already on file
 *   dependent_document_request   — re-upload of `requested_documents` for a
 *                                  dependent already on file
 */
export type OnboardingType =
  | 'new_hire'
  | 'renewal'
  | 'document_request'
  | 'dependent'
  | 'dependent_renewal'
  | 'dependent_document_request';

// How the staff member's residence visa is sponsored. Drives the sponsor-step
// + NOC requirements: 'family' demands sponsor docs + a signed NOC (on both
// new_hire and renewal); 'company' and 'self_gcc' demand neither.
export type SponsorshipType = 'company' | 'family' | 'self_gcc';

export interface StaffOnboardingSubmission {
  id: string;
  tme_request_id: string | null;
  client_code: string | null;
  current_step: OnboardingStep;
  is_same_person: boolean;

  // Staff info (pre-filled from TME Portal)
  staff_name?: string;
  staff_email?: string;

  // Pre-fill data (from TME Portal for renewals). `visa_track` is a portal-set
  // marker, not an employer form field: 'partner_investor' flags a DET
  // Partner/Investor visa (company shareholder) — the employer stage is
  // skipped entirely (rows arrive with status='employer_completed',
  // current_step='employee', is_same_person=false).
  prefill_employer_data: (Partial<EmployerFormData> & { visa_track?: string }) | null;
  prefill_employee_data: Partial<EmployeeFormData> | null;
  onboarding_type: OnboardingType;
  sponsorship_type?: SponsorshipType | null;

  // Document re-request flow (onboarding_type === 'document_request' or
  // 'dependent_document_request'): type keys the uploader must (re-)upload.
  // Staff v1 allow-list: photo, passport_cover, passport_inside,
  // passport_additional, eid_front, eid_back, degree_attested,
  // transcript_of_records — plus every generic requestable key (see
  // GENERIC_REQUESTED_KEYS in submit-validation.ts) and `custom:<name>`.
  // Null/absent for regular new_hire / renewal / dependent onboardings.
  requested_documents?: string[] | null;

  // Sponsor NOC audit trail (family-sponsored only). Set server-side by
  // submit-employee, mirroring the employee_signature_* columns.
  sponsor_noc_signature_data?: string | null;
  sponsor_noc_signed_at?: string | null;
  sponsor_noc_signer_ip?: string | null;

  // Employer section
  employer_data: EmployerFormData | null;
  employer_signature_data: string | null;
  employer_signed_at: string | null;
  employer_signer_ip: string | null;

  // Employee section
  employee_data: EmployeeFormData | null;
  employee_signature_data: string | null;
  employee_signed_at: string | null;
  employee_signer_ip: string | null;

  // Documents
  documents: StaffDocumentReferences | null;

  // Existing documents from portal (for renewals — passport confirmation).
  // Most entries carry a signed URL so the form can display them read-only.
  // The `photo` entry carries sha256 (instant byte-identical rejection) and —
  // since the same-photo comparison feature — also path/publicUrl so the
  // upload slot can SHOW the client which photo not to re-submit and the
  // compare-photo route can fetch it server-side for the vision check.
  // Legacy rows have sha256+filename only; everything degrades gracefully.
  existing_documents?: Record<
    string,
    { path?: string; publicUrl?: string; filename?: string; sha256?: string }
  > | null;

  // Access control
  employee_access_token?: string;

  // Status
  synced_to_tme: boolean;
  status: OnboardingStatus;

  // Timestamps
  created_at: string;
  updated_at: string;
}

// ===================================================================
// FORM PROPS
// ===================================================================

export interface EmployerFormProps {
  submission: StaffOnboardingSubmission;
  onSubmit: (data: EmployerFormData, signature: string) => Promise<void>;
  isSubmitting: boolean;
  isRenewal?: boolean;
}

export interface EmployeeFormProps {
  submission: StaffOnboardingSubmission;
  onSubmit: (data: EmployeeFormData, signature: string) => Promise<void>;
  isSubmitting: boolean;
  reuseEmployerSignature?: boolean;
}

// ===================================================================
// API RESPONSES
// ===================================================================

export interface PhotoValidationResponse {
  valid: boolean;
  errors: string[];
  confidence: number;
}

export interface PassportExtractionResponse {
  success: boolean;
  data?: Partial<EmployeeFormData>;
  errors?: string[];
}
