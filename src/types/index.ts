/**
 * Staff onboarding type definitions
 */

// ===================================================================
// EMPLOYER FORM DATA
// ===================================================================

export interface EmployerFormData {
  job_title: string;
  job_title_custom?: string;
  department: string;
  department_custom?: string;
  salary_currency: string;
  salary_total: number;
  salary_basic: number;
  salary_accommodation: number;
  salary_transport: number;
  salary_food?: number;
  salary_other?: number;
  annual_leave_days: number;
  annual_leave_type: 'calendar' | 'working';
  notice_period_value: number;
  notice_period_unit: 'days' | 'weeks' | 'months';
  probation_period_value: number;
  probation_period_unit: 'days' | 'weeks' | 'months';
  weekly_off: 'sunday' | 'saturday_sunday';
  starting_date: string; // ISO format YYYY-MM-DD
}

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
  passport_expiry?: string; // ISO format
  place_of_issue?: string;
  gender?: 'male' | 'female';

  // Family
  father_full_name: string;
  mother_full_name: string;
  religion: string;
  marital_status: string;
  spouse_name?: string;

  // Contact - Home Country (single textarea)
  home_address: string; // Full address in single field
  home_telephone?: string;
  // Legacy fields (for backwards compatibility)
  home_street_address?: string;
  home_postal_code?: string;
  home_city?: string;
  home_country?: string;

  // Contact - UAE
  uae_presence: 'inside' | 'outside';
  uae_flat_villa?: string;
  uae_building_name?: string;
  uae_street_name?: string;

  // Email & Phone
  personal_email: string;
  company_email?: string;
  same_emails: boolean;
  mobile_uae: string;
  mobile_international?: string;

  // Education
  educational_qualification: string;
  languages_spoken: string[];

  // Bank
  has_uae_bank: boolean;
  bank_name?: string;
  bank_branch?: string;
  bank_swift?: string;
  bank_account_name?: string;
  bank_iban?: string;

  // Other
  other_information?: string;
}

// ===================================================================
// DOCUMENT REFERENCES
// ===================================================================

export interface PassportPageReference {
  path: string;
  filename: string;
  validated: boolean;
}

export interface StaffDocumentReferences {
  photo?: {
    path: string;
    filename: string;
    validated: boolean;
    validation_errors?: string[];
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
    extracted_data?: Record<string, unknown>;
  };
  eid?: {
    path: string;
    filename: string;
  };
}

// ===================================================================
// STAFF ONBOARDING SUBMISSION
// ===================================================================

export type OnboardingStep = 'employer' | 'employee' | 'complete';
export type OnboardingStatus = 'pending' | 'employer_completed' | 'complete' | 'cancelled';

export interface StaffOnboardingSubmission {
  id: string;
  tme_request_id: string | null;
  client_code: string | null;
  current_step: OnboardingStep;
  is_same_person: boolean;

  // Staff info (pre-filled from TME Portal)
  staff_name?: string;
  staff_email?: string;

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
