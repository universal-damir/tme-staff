'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TME_COLORS,
  TITLES,
  NATIONALITIES,
  RELIGIONS,
  MARITAL_STATUS_OPTIONS,
  EDUCATIONAL_QUALIFICATIONS,
  LANGUAGES,
  UAE_EMIRATES,
} from '@/lib/constants';
import { lookupBankFromIban, isUaeIban, validateIbanFormat } from '@/lib/uae-bank-directory';
import { Input, Button, MultiSelectDropdown, CustomDropdown, CustomDatePicker, PhoneInput } from '@/components/ui';
import { SignaturePad } from '@/components/SignatureCanvas';
import { PhotoUpload } from '@/components/PhotoUpload';
import { UploadSlot } from '@/components/UploadSlot';
import { FileUploadSlot } from '@/components/FileUploadSlot';
import { DocumentScanner, useScannerIntercept } from '@/components/DocumentScanner';
import type { EmployeeFormData, EmployeeFormProps, PassportPageReference, VisaCategory } from '@/types';
import {
  mergeStaffDocRefs,
  isPakistaniNationality as checkPakistaniNationality,
  visaDocumentRequirement,
  requiresArrivalDate,
} from '@/lib/staff-form-logic';
import { uploadDocument, updateDocumentReferences, uploadPassportPage, PassportPageKey, getDocumentUrl, autoSaveEmployeeData } from '@/lib/supabase';
import { calculateFullName, compressImageForAI } from '@/lib/utils';
import { nationalityToCountryCode, resolveExtractedNationality } from '@/lib/country-utils';
import { SampleImageToggle } from '@/components/SampleImageToggle';
import {
  User,
  Users,
  MapPin,
  Mail,
  GraduationCap,
  Building2,
  FileSignature,
  Camera,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  CreditCard,
  FileText,
} from 'lucide-react';

// Sort lists alphabetically (with "Other" at the end)
const sortWithOtherLast = (items: readonly string[]) =>
  [...items].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

const SORTED_LANGUAGES = sortWithOtherLast(LANGUAGES);
const SORTED_NATIONALITIES = sortWithOtherLast(NATIONALITIES);
const SORTED_RELIGIONS = sortWithOtherLast(RELIGIONS);

// --- Step definitions for progressive reveal ---
const STEP_LABELS = [
  'ID Photo',
  'Passport OUTSIDE',
  'Passport INSIDE',
  'Identity & Visa Documents',
  'Family Details',
  'Address & Contact',
  'Education & More',
  'Review & Sign',
];

// Visa category labels for display
const VISA_CATEGORY_LABELS: Record<string, string> = {
  visa_on_arrival: 'On arrival visa',
  tourist_visa: 'Tourist visa',
  employment_visa: 'Employment visa',
  immigration_cancellation: 'Immigration cancellation document',
  golden_visa: 'Golden visa',
  dependent_visa: 'Dependent visa',
  other: 'Supporting document',
};

// Options for the employee-facing visa status dropdown.
const EMPLOYEE_VISA_CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'visa_on_arrival', label: 'On arrival visa' },
  { value: 'tourist_visa', label: 'Tourist visa' },
  { value: 'employment_visa', label: 'Employment visa (currently employed with another company)' },
  { value: 'immigration_cancellation', label: 'Immigration cancellation' },
  { value: 'golden_visa', label: 'Golden visa holder' },
  { value: 'dependent_visa', label: 'Dependent visa' },
  { value: 'other', label: 'Other' },
];

interface FormSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  stepNumber?: number;
}

function FormSection({ title, icon, children, stepNumber }: FormSectionProps) {
  return (
    <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        {stepNumber !== undefined && (
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ backgroundColor: TME_COLORS.primary }}
          >
            {stepNumber}
          </span>
        )}
        {icon}
        <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

// --- Step navigation buttons (Back + Continue) ---
function StepNavButtons({
  enabled,
  onContinue,
  onBack,
  showBack = true,
  label,
}: {
  enabled: boolean;
  onContinue: () => void;
  onBack?: () => void;
  showBack?: boolean;
  label?: string;
}) {
  return (
    <div className={`flex ${showBack && onBack ? 'justify-between' : 'justify-end'} mt-4`}>
      {showBack && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border-2 hover:bg-gray-50"
          style={{ color: TME_COLORS.primary, borderColor: TME_COLORS.primary }}
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onContinue}
        disabled={!enabled}
        className={`px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 flex items-center gap-2 ${
          enabled ? 'hover:opacity-90 cursor-pointer' : 'opacity-40 cursor-not-allowed'
        }`}
        style={{ backgroundColor: TME_COLORS.primary }}
      >
        {label || 'Continue'}
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// --- Sticky Step Progress Bar ---
// Internal step indices (1..8) are stable so the existing show/hide guards
// keep working. The indicator uses `visibleStepIndices` to renumber dynamically
// — e.g. on renewal the "Identity & Visa Documents" step is empty and is
// hidden entirely, so a 7-step display replaces "Step 4 of 8 (empty)".
function StepProgress({
  currentStep,
  viewingStep,
  visibleStepIndices,
  onStepClick,
}: {
  currentStep: number;
  viewingStep: number;
  visibleStepIndices: number[];
  onStepClick: (step: number) => void;
}) {
  const totalSteps = visibleStepIndices.length;
  const visiblePos = (internal: number) => {
    const idx = visibleStepIndices.indexOf(internal);
    return idx < 0 ? 0 : idx + 1; // 1-based; 0 means hidden
  };
  const prevVisible = (() => {
    const idx = visibleStepIndices.indexOf(viewingStep);
    return idx > 0 ? visibleStepIndices[idx - 1] : viewingStep;
  })();
  const nextVisible = (() => {
    const idx = visibleStepIndices.indexOf(viewingStep);
    return idx >= 0 && idx < visibleStepIndices.length - 1
      ? visibleStepIndices[idx + 1]
      : viewingStep;
  })();
  const isAtFirstVisible = visibleStepIndices.indexOf(viewingStep) <= 0;
  const isAtLastVisibleReached = visiblePos(viewingStep) >= visiblePos(currentStep);
  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-sm mb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStepClick(prevVisible)}
            disabled={isAtFirstVisible}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: TME_COLORS.primary }}>
            Step {visiblePos(viewingStep) || 1} of {totalSteps}
          </span>
          <button
            type="button"
            onClick={() => onStepClick(nextVisible)}
            disabled={isAtLastVisibleReached}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${TME_COLORS.primary}15`, color: TME_COLORS.primary }}>
          {STEP_LABELS[viewingStep - 1] || ''}
        </span>
      </div>
      {/* Clickable step dots — only visible steps get a dot, so the user
          never sees a placeholder for an empty step. */}
      <div className="flex items-center gap-1.5 mb-2">
        {visibleStepIndices.map((step) => {
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;
          const isViewing = step === viewingStep;
          const isClickable = step <= currentStep;
          return (
            <button
              key={step}
              type="button"
              onClick={() => isClickable && onStepClick(step)}
              disabled={!isClickable}
              className={`h-2 flex-1 rounded-full transition-all duration-200 ${
                isViewing
                  ? ''
                  : isCompleted
                  ? 'bg-green-400'
                  : isCurrent
                  ? ''
                  : 'bg-gray-200'
              } ${isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed'}`}
              style={
                isViewing
                  ? { backgroundColor: TME_COLORS.primary }
                  : isCurrent && !isViewing
                  ? { backgroundColor: `${TME_COLORS.primary}60` }
                  : undefined
              }
              title={STEP_LABELS[step - 1]}
            />
          );
        })}
      </div>
    </div>
  );
}

// --- Reveal animation wrapper ---
const revealVariants = {
  hidden: { opacity: 0, y: 30, height: 0, marginBottom: 0 },
  visible: { opacity: 1, y: 0, height: 'auto', marginBottom: 24 },
  exit: { opacity: 0, y: -20, height: 0, marginBottom: 0 },
};

function RevealSection({ show, children, onReveal }: { show: boolean; children: React.ReactNode; onReveal?: () => void }) {
  const hasBeenShown = useRef(false);

  useEffect(() => {
    if (show && !hasBeenShown.current) {
      hasBeenShown.current = true;
      // Delay scroll to allow animation to start — but only if onReveal is provided
      // (onReveal is set to undefined for step 7 / review mode to prevent scroll conflicts)
      if (onReveal) {
        setTimeout(onReveal, 200);
      }
    }
  }, [show, onReveal]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={revealVariants}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmployeeForm({
  submission,
  onSubmit,
  isSubmitting,
  reuseEmployerSignature = false,
}: EmployeeFormProps) {
  const [signature, setSignature] = useState<string | null>(
    reuseEmployerSignature ? submission.employer_signature_data : null
  );
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [bankLookupResult, setBankLookupResult] = useState<{
    found: boolean;
    isUae: boolean;
    isInternational: boolean;
    bankName?: string;
    swift?: string;
    routingCode?: string;
  } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [passportError, setPassportError] = useState<string | null>(null);
  const [photoDoc, setPhotoDoc] = useState(submission.documents?.photo);

  // Passport pages state
  const [passportPages, setPassportPages] = useState<{
    cover?: PassportPageReference;
    insidePages?: PassportPageReference;
    additionalPage?: PassportPageReference;
  }>(submission.documents?.passportPages || {});

  // Renewal passport confirmation
  const isRenewal = submission.onboarding_type === 'renewal';
  const existingDocs = submission.existing_documents;
  const hasExistingPassport = !!(existingDocs?.passport_cover || existingDocs?.passport_inside);
  const [passportConfirmed, setPassportConfirmed] = useState(false);
  const [passportChanged, setPassportChanged] = useState(false);

  // Education document uploads
  const [degreeDoc, setDegreeDoc] = useState(submission.documents?.degree_attested);
  const [transcriptDoc, setTranscriptDoc] = useState(submission.documents?.transcript_of_records);
  const [educationAdditionalDoc, setEducationAdditionalDoc] = useState(submission.documents?.education_additional);
  const [showAdditionalEducation, setShowAdditionalEducation] = useState(!!submission.documents?.education_additional);
  const degreeDocRef = React.useRef(degreeDoc);
  const transcriptDocRef = React.useRef(transcriptDoc);
  const educationAdditionalDocRef = React.useRef(educationAdditionalDoc);
  React.useEffect(() => { degreeDocRef.current = degreeDoc; }, [degreeDoc]);
  React.useEffect(() => { transcriptDocRef.current = transcriptDoc; }, [transcriptDoc]);
  React.useEffect(() => { educationAdditionalDocRef.current = educationAdditionalDoc; }, [educationAdditionalDoc]);

  // "Did you previously hold a UAE visa and Emirates ID?" — tri-state so that
  // No is a real answer (collapses the section) and Yes unveils both the
  // previous-visa slot and the EID front/back slots. Stored back into
  // `has_previous_eid` in the form for backwards-compat with existing
  // downstream consumers.
  const savedHasPreviousUaeDocs =
    submission.employee_data?.has_previous_eid ??
    (!!submission.documents?.eid_front || !!submission.documents?.previous_visa_document ? true : undefined);
  const [hasPreviousUaeDocs, setHasPreviousUaeDocs] = useState<boolean | null>(
    typeof savedHasPreviousUaeDocs === 'boolean' ? savedHasPreviousUaeDocs : null
  );
  const [eidFrontDoc, setEidFrontDoc] = useState(submission.documents?.eid_front);
  const [eidBackDoc, setEidBackDoc] = useState(submission.documents?.eid_back);
  const [eidFrontUI, setEidFrontUI] = useState({
    preview: submission.documents?.eid_front?.path ? getDocumentUrl(submission.documents.eid_front.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const [eidBackUI, setEidBackUI] = useState({
    preview: submission.documents?.eid_back?.path ? getDocumentUrl(submission.documents.eid_back.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const eidFrontDocRef = React.useRef(eidFrontDoc);
  const eidBackDocRef = React.useRef(eidBackDoc);
  React.useEffect(() => { eidFrontDocRef.current = eidFrontDoc; }, [eidFrontDoc]);
  React.useEffect(() => { eidBackDocRef.current = eidBackDoc; }, [eidBackDoc]);

  // Previous UAE visa / residence permit state (optional, sits alongside EID
  // inside the same Yes/No section).
  const [previousVisaDoc, setPreviousVisaDoc] = useState(submission.documents?.previous_visa_document);
  const [previousVisaUI, setPreviousVisaUI] = useState({
    preview: submission.documents?.previous_visa_document?.path ? getDocumentUrl(submission.documents.previous_visa_document.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const previousVisaDocRef = React.useRef(previousVisaDoc);
  React.useEffect(() => { previousVisaDocRef.current = previousVisaDoc; }, [previousVisaDoc]);

  // Pakistani National ID state (conditional on Pakistani nationality)
  const [pakistanIdFrontDoc, setPakistanIdFrontDoc] = useState(submission.documents?.pakistan_id_front);
  const [pakistanIdBackDoc, setPakistanIdBackDoc] = useState(submission.documents?.pakistan_id_back);
  const [pakistanIdFrontUI, setPakistanIdFrontUI] = useState({
    preview: submission.documents?.pakistan_id_front?.path ? getDocumentUrl(submission.documents.pakistan_id_front.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const [pakistanIdBackUI, setPakistanIdBackUI] = useState({
    preview: submission.documents?.pakistan_id_back?.path ? getDocumentUrl(submission.documents.pakistan_id_back.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const pakistanIdFrontDocRef = React.useRef(pakistanIdFrontDoc);
  const pakistanIdBackDocRef = React.useRef(pakistanIdBackDoc);
  React.useEffect(() => { pakistanIdFrontDocRef.current = pakistanIdFrontDoc; }, [pakistanIdFrontDoc]);
  React.useEffect(() => { pakistanIdBackDocRef.current = pakistanIdBackDoc; }, [pakistanIdBackDoc]);

  // Visa document state (conditional on employer's visa category)
  const [visaDoc, setVisaDoc] = useState(submission.documents?.visa_document);
  const [visaDocUI, setVisaDocUI] = useState({
    preview: null as string | null, validating: false, error: null as string | null, file: null as File | null,
  });
  const visaDocRef = React.useRef(visaDoc);
  React.useEffect(() => { visaDocRef.current = visaDoc; }, [visaDoc]);

  // Employer's "Yes" answer gates the visa-status section below. The actual
  // category + arrival date are picked by the employee (derived below, after
  // useForm is initialized and `watch` is available).
  const employerVisaInUAE = submission.employer_data?.applicant_in_uae === true;

  // Passport upload UI state (preview, validating, error — separate from persisted data)
  const initCover = submission.documents?.passportPages?.cover;
  const initInside = submission.documents?.passportPages?.insidePages;
  const [coverUI, setCoverUI] = useState({
    preview: initCover?.path ? getDocumentUrl(initCover.path) : null as string | null,
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const [pendingInsideFile, setPendingInsideFile] = useState<File | null>(null);
  const [insideUI, setInsideUI] = useState({
    preview: initInside?.path ? getDocumentUrl(initInside.path) : null as string | null,
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });
  const initAdditional = submission.documents?.passportPages?.additionalPage;
  const [additionalPageUI, setAdditionalPageUI] = useState({
    preview: initAdditional?.path ? getDocumentUrl(initAdditional.path) : null as string | null,
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });

  // Refs to track latest values (avoids stale closure issues in callbacks)
  const photoDocRef = React.useRef(photoDoc);
  const passportPagesRef = React.useRef(passportPages);

  // Section refs for auto-scrolling
  const passportCoverRef = useRef<HTMLDivElement>(null);
  const passportInsideRef = useRef<HTMLDivElement>(null);
  const identityDocsRef = useRef<HTMLDivElement>(null);
  const familyRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const educationRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync with state
  React.useEffect(() => {
    photoDocRef.current = photoDoc;
  }, [photoDoc]);

  React.useEffect(() => {
    passportPagesRef.current = passportPages;
  }, [passportPages]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<EmployeeFormData>({
    defaultValues: submission.employee_data || {
      same_emails: false,
      has_uae_bank: false,
      uae_presence: 'inside',
      languages_spoken: ['English'],
      // Merge pre-fill data from TME Portal (renewals) — overrides defaults, but saved data overrides prefill
      ...submission.prefill_employee_data,
    },
  });

  // Register dropdown fields that use setValue (required for form submission)
  React.useEffect(() => {
    register('title');
    register('nationality');
    register('religion');
    register('marital_status');
    register('educational_qualification');
    register('other_nationality');
    register('previous_nationality');
    register('languages_spoken');
    register('uae_presence');
    register('gender');
    register('date_of_birth');
    register('passport_issue_date');
    register('passport_expiry');
    register('has_previous_eid');
    register('eid_number');
    register('eid_issue_date');
    register('eid_expiry_date');
    register('visa_category');
    register('visa_arrival_date');
  }, [register]);

  const title = watch('title');
  const nationality = watch('nationality');
  const religion = watch('religion');
  const maritalStatus = watch('marital_status');
  const educationalQualification = watch('educational_qualification');
  const sameEmails = watch('same_emails');
  const hasUAEBank = watch('has_uae_bank');
  const bankIban = watch('bank_iban');
  const firstName = watch('first_name');
  const middleName = watch('middle_name');
  const lastName = watch('last_name');
  const languagesSpoken = watch('languages_spoken') || [];
  const otherNationality = watch('other_nationality');
  const previousNationality = watch('previous_nationality');
  const mobileUae = watch('mobile_uae');
  const homeTelephone = watch('home_telephone');
  const personalEmail = watch('personal_email');
  const homeStreetAddress = watch('home_street_address');
  const homeCity = watch('home_city');
  const homeCountry = watch('home_country');
  const fatherFullName = watch('father_full_name');
  const motherFullName = watch('mother_full_name');
  const dateOfBirth = watch('date_of_birth');
  const employeeVisaCategory = watch('visa_category') as VisaCategory | undefined;
  const employeeVisaArrivalDate = watch('visa_arrival_date');
  const visaUploadRule = visaDocumentRequirement(employeeVisaCategory);
  const showVisaCategoryPicker = employerVisaInUAE;
  const showArrivalDatePicker = showVisaCategoryPicker && requiresArrivalDate(employeeVisaCategory);
  const showVisaDocumentUpload = showVisaCategoryPicker && visaUploadRule !== 'none';
  const visaDocumentRequired = showVisaCategoryPicker && visaUploadRule === 'mandatory';
  const passportNumber = watch('passport_number');
  const passportIssueDate = watch('passport_issue_date');
  const passportExpiry = watch('passport_expiry');
  const placeOfIssue = watch('place_of_issue');
  const gender = watch('gender');

  // Derive country code from nationality for phone inputs
  const nationalityCountryCode = nationality ? nationalityToCountryCode(nationality) : undefined;

  // Auto-prefill account name from employee name
  useEffect(() => {
    if (hasUAEBank && firstName && lastName) {
      const currentAccountName = watch('bank_account_name');
      if (!currentAccountName) {
        setValue('bank_account_name', `${firstName} ${lastName}`.trim());
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUAEBank, firstName, lastName]);

  // IBAN auto-derivation: detect bank from IBAN and auto-populate fields
  useEffect(() => {
    if (!bankIban) {
      setBankLookupResult(null);
      return;
    }
    const clean = bankIban.replace(/\s/g, '').toUpperCase();
    if (clean.length < 2) {
      setBankLookupResult(null);
      return;
    }

    if (isUaeIban(clean)) {
      const bankInfo = lookupBankFromIban(clean);
      if (bankInfo) {
        setBankLookupResult({ found: true, isUae: true, isInternational: false, bankName: bankInfo.name, swift: bankInfo.swift11, routingCode: bankInfo.routingCode });
        setValue('bank_name', bankInfo.name);
        setValue('bank_swift', bankInfo.swift11);
        setValue('bank_routing_code', bankInfo.routingCode);
      } else {
        setBankLookupResult({ found: false, isUae: true, isInternational: false });
      }
    } else if (/^[A-Z]{2}/.test(clean) && !clean.startsWith('AE')) {
      // International IBAN
      setBankLookupResult({ found: false, isUae: false, isInternational: true });
    } else {
      setBankLookupResult(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankIban]);

  // New checkbox states for nationality and address
  const [hasOtherNationality, setHasOtherNationality] = useState(
    !!submission.employee_data?.other_nationality
  );
  const [hasPreviousNationality, setHasPreviousNationality] = useState(
    !!submission.employee_data?.previous_nationality
  );
  const [isInUAE, setIsInUAE] = useState(
    submission.employee_data?.uae_presence === 'inside' ||
    !!(submission.employee_data?.uae_street_address || submission.employee_data?.uae_flat_villa || submission.employee_data?.uae_building_name || submission.employee_data?.uae_street_name)
  );

  // Track whether passport data has been extracted/pre-filled
  const [passportDataReady, setPassportDataReady] = useState(
    // If form already has employee data with a first name, data was previously extracted
    !!(submission.employee_data?.first_name)
  );
  const [extractingPassport, setExtractingPassport] = useState(false);

  // --- Progressive reveal step computation ---
  const isPhotoUploaded = !!(photoDoc?.validated);
  const isCoverUploaded = !!(passportPages.cover?.validated);
  const isInsidePagesUploaded = !!(passportPages.insidePages?.validated);
  const isAdditionalPageUploaded = !!(passportPages.additionalPage?.validated);
  const isIndianNationality = nationality === 'Indian' || nationality === 'India';
  const isPakistaniNationality = checkPakistaniNationality(nationality);
  const requiresAdditionalPage = isIndianNationality && isInsidePagesUploaded && passportDataReady;
  const isPersonalComplete = !!(firstName && lastName && nationality);
  const isFamilyComplete = !!(fatherFullName && motherFullName && religion && maritalStatus);
  const isContactComplete = !!(homeStreetAddress && homeCity && homeCountry && personalEmail);
  const educationalQualificationCustom = watch('educational_qualification_custom');
  const isEducationComplete = !!(
    educationalQualification &&
    (educationalQualification !== 'Other' || educationalQualificationCustom) &&
    languagesSpoken.length > 0
  );

  // Step 4 (Identity & Visa Documents) completion check
  const isVisaDocUploaded = !!visaDoc;
  const isVisaCategoryPicked = !!employeeVisaCategory;
  const isArrivalDateProvided = !!employeeVisaArrivalDate;
  const isVisaSectionComplete = !showVisaCategoryPicker
    ? true
    : isVisaCategoryPicked &&
      (!showArrivalDatePicker || isArrivalDateProvided) &&
      (!visaDocumentRequired || isVisaDocUploaded);
  // Combined "UAE Visa and Emirates ID" section requires a Yes/No answer on
  // new-hire onboarding. Uploads themselves are optional.
  const isPreviousUaeDocsAnswered = isRenewal || hasPreviousUaeDocs !== null;
  const isStep4Complete = isVisaSectionComplete && isPreviousUaeDocsAnswered;

  // Compute the highest unlocked step (1-indexed, 8 steps total)
  const computeCurrentStep = useCallback(() => {
    if (!isPhotoUploaded) return 1;
    if (!isCoverUploaded) return 2;
    if (!isInsidePagesUploaded || !passportDataReady || !isPersonalComplete) return 3;
    if (requiresAdditionalPage && !isAdditionalPageUploaded) return 3;
    if (!isStep4Complete) return 4;
    if (!isFamilyComplete) return 5;
    if (!isContactComplete) return 6;
    if (!isEducationComplete) return 7;
    return 8;
  }, [isPhotoUploaded, isCoverUploaded, isInsidePagesUploaded, isAdditionalPageUploaded, requiresAdditionalPage, passportDataReady, isPersonalComplete, isStep4Complete, isFamilyComplete, isContactComplete, isEducationComplete]);

  const currentStep = computeCurrentStep();

  // Step 4 ("Identity & Visa Documents") has two sub-sections:
  //   - UAE Visa Status picker — only shown when the employer answered
  //     "Yes, applicant is in the UAE" (new-hire only).
  //   - Previous UAE Visa + Emirates ID — new-hire only.
  // On renewal where the employer didn't enable the visa picker, both are
  // gone and step 4 has no UI at all. Drop it from the indicator so the
  // user doesn't land on a blank screen.
  const isStep4Empty = !showVisaCategoryPicker && isRenewal;
  const visibleStepIndices = isStep4Empty
    ? [1, 2, 3, 5, 6, 7, 8]
    : [1, 2, 3, 4, 5, 6, 7, 8];

  // Map an internal step number (1..8) to the displayed position (1..N) so
  // the FormSection badges and the "Step X of Y" header match the dot row.
  const displayedStepNumber = (internal: number): number => {
    const idx = visibleStepIndices.indexOf(internal);
    return idx < 0 ? internal : idx + 1;
  };
  const [viewingStep, setViewingStep] = useState(currentStep);

  // If viewingStep ever lands on a hidden internal step (e.g. user navigated
  // there before the renewal flow was loaded), advance to the next visible.
  useEffect(() => {
    if (!visibleStepIndices.includes(viewingStep)) {
      const next = visibleStepIndices.find((s) => s >= viewingStep) ?? visibleStepIndices[visibleStepIndices.length - 1];
      setViewingStep(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStep4Empty]);

  // No auto-advance — user controls navigation via "Continue" button or arrows

  // Auto-save form data when step advances (persists across refresh)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Debounce auto-save to avoid excessive writes
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (currentStep > 2) {
        autoSaveEmployeeData(submission.id, getValues());
      }
    }, 1000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, viewingStep]);

  // Pre-fill Home Country from nationality
  useEffect(() => {
    if (nationality && !homeCountry) {
      setValue('home_country', nationality);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nationality]);

  // Auto-scroll to newly revealed section
  const scrollToRef = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Auto-calculate full name
  React.useEffect(() => {
    if (firstName || lastName) {
      const fullName = calculateFullName(firstName || '', middleName, lastName || '');
      setValue('full_name', fullName);
    }
  }, [firstName, middleName, lastName, setValue]);

  const handleFormSubmit = async (data: EmployeeFormData) => {
    // Validate photo is uploaded
    if (!photoDoc) {
      setPhotoError('Please upload your photo');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPhotoError(null);

    // Validate all passport pages are uploaded (skip for renewals where passport was confirmed unchanged)
    const passportSkipped = isRenewal && hasExistingPassport && passportConfirmed && !passportChanged;
    const pagesUploaded = passportPages.cover && passportPages.insidePages;
    if (!pagesUploaded && !passportSkipped) {
      setPassportError('Please upload both passport images');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPassportError(null);

    // Validate signature
    if (!signature && !reuseEmployerSignature) {
      setSignatureError('Please sign the form');
      return;
    }
    setSignatureError(null);

    // Use employer signature if same person mode
    const signatureToUse = reuseEmployerSignature && submission.employer_signature_data
      ? submission.employer_signature_data
      : signature!;

    await onSubmit(data, signatureToUse);
  };

  // Helper to build full document references including education docs + new identity docs.
  // mergeStaffDocRefs spreads submission.documents first to preserve employer-uploaded docs
  // (e.g. job_offer_letter). Tested in src/lib/staff-form-logic.test.ts.
  const buildDocRefs = (overrides?: { photo?: typeof photoDoc; passportPages?: typeof passportPages }) =>
    mergeStaffDocRefs(submission.documents, {
      photo: overrides?.photo ?? photoDocRef.current,
      passportPages: overrides?.passportPages ?? passportPagesRef.current,
      degree_attested: degreeDocRef.current,
      transcript_of_records: transcriptDocRef.current,
      education_additional: educationAdditionalDocRef.current,
      eid_front: eidFrontDocRef.current,
      eid_back: eidBackDocRef.current,
      pakistan_id_front: pakistanIdFrontDocRef.current,
      pakistan_id_back: pakistanIdBackDocRef.current,
      visa_document: visaDocRef.current,
      previous_visa_document: previousVisaDocRef.current,
    });

  const handlePhotoUpload = async (file: File) => {
    const result = await uploadDocument(submission.id, 'photo', file);
    if (result) {
      const newDoc = { ...result, validated: false };
      setPhotoDoc(newDoc);
      photoDocRef.current = newDoc;
      setPhotoError(null);
      await updateDocumentReferences(submission.id, buildDocRefs({ photo: newDoc }));
      return result;
    }
    return null;
  };

  // Passport validation helper
  const validatePassportPageType = async (imageBase64: string, expectedType: 'COVER' | 'INSIDE_PAGES') => {
    try {
      const compressedImage = await compressImageForAI(imageBase64);
      const response = await fetch('/api/validate-passport-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage, expectedType }),
      });
      if (!response.ok) throw new Error('Validation failed');
      const result = await response.json();
      return { valid: result.matches as boolean, error: result.errorMessage as string | undefined };
    } catch {
      return { valid: false, error: 'Unable to validate page. Please try again.' };
    }
  };

  // Passport data extraction helper
  const extractPassportData = async (imageBase64: string) => {
    try {
      const compressedImage = await compressImageForAI(imageBase64);
      const response = await fetch('/api/extract-passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage }),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) return result.data as Partial<EmployeeFormData>;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handlePassportExtracted = (data: Partial<EmployeeFormData> & {
    family_name?: string;
    passport_no?: string;
    passport_issue_date?: string;
    passport_expiry_date?: string;
    place_of_birth?: string;
  }) => {
    const fieldMapping: Record<string, string> = {
      family_name: 'last_name',
      passport_no: 'passport_number',
      passport_issue_date: 'passport_issue_date',
      passport_expiry_date: 'passport_expiry',
      place_of_birth: 'place_of_issue',
    };

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const formField = fieldMapping[key] || key;
        // Normalize gender to lowercase
        if (formField === 'gender' && typeof value === 'string') {
          setValue('gender', value.toLowerCase() as 'male' | 'female');
          return;
        }
        // Normalize nationality to a NATIONALITIES entry so the dropdown
        // actually selects it. Passports print demonyms / long official
        // names that don't match the list verbatim.
        if (formField === 'nationality' && typeof value === 'string') {
          const resolved = resolveExtractedNationality(value, NATIONALITIES);
          if (resolved) setValue('nationality', resolved);
          return;
        }
        setValue(formField as keyof EmployeeFormData, value as never);
      }
    });
    setPassportDataReady(true);

    // Auto-save extracted data immediately (use setTimeout to let setValue propagate)
    setTimeout(() => {
      autoSaveEmployeeData(submission.id, getValues());
    }, 100);
  };

  // Cover upload handler
  const handleCoverUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });

    setCoverUI({ preview, validating: true, error: null, file });

    const validation = await validatePassportPageType(preview, 'COVER');
    if (!validation.valid) {
      setCoverUI({ preview, validating: false, error: validation.error || 'Not a valid passport cover', file });
      return false;
    }

    const result = await uploadPassportPage(submission.id, 'cover', file);
    if (!result) {
      setCoverUI({ preview, validating: false, error: 'Failed to upload file', file });
      return false;
    }

    setCoverUI({ preview, validating: false, error: null, file });
    const newPage: PassportPageReference = { path: result.path, filename: result.filename, validated: true };
    const updatedPages = { ...passportPagesRef.current, cover: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    await updateDocumentReferences(submission.id, buildDocRefs({ passportPages: updatedPages }));
    return true;
  };

  // Inside pages upload handler
  const handleInsideUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });

    setInsideUI({ preview, validating: true, error: null, file });

    const validation = await validatePassportPageType(preview, 'INSIDE_PAGES');
    if (!validation.valid) {
      setInsideUI({ preview, validating: false, error: validation.error || 'Not a valid inside page', file });
      return false;
    }

    const result = await uploadPassportPage(submission.id, 'insidePages', file);
    if (!result) {
      setInsideUI({ preview, validating: false, error: 'Failed to upload file', file });
      return false;
    }

    setInsideUI({ preview, validating: false, error: null, file });
    const newPage: PassportPageReference = { path: result.path, filename: result.filename, validated: true };
    const updatedPages = { ...passportPagesRef.current, insidePages: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    await updateDocumentReferences(submission.id, buildDocRefs({ passportPages: updatedPages }));

    // Extract passport data — show extracting state so user knows it's working
    setExtractingPassport(true);
    const extracted = await extractPassportData(preview);
    setExtractingPassport(false);
    if (extracted) {
      handlePassportExtracted(extracted);
      // Store extracted data in passport page reference so tme-portal sync can read passport_issue_date etc.
      const updatedInsidePage: PassportPageReference = {
        ...passportPagesRef.current.insidePages!,
        extracted_data: extracted as Record<string, unknown>,
      };
      const updatedPagesWithData = { ...passportPagesRef.current, insidePages: updatedInsidePage };
      setPassportPages(updatedPagesWithData);
      passportPagesRef.current = updatedPagesWithData;
      await updateDocumentReferences(submission.id, buildDocRefs({ passportPages: updatedPagesWithData }));
    } else {
      // Extraction failed — let user fill manually
      setPassportDataReady(true);
    }
    return true;
  };

  // Remove handlers
  const handleCoverRemove = async () => {
    setCoverUI({ preview: null, validating: false, error: null, file: null });
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.cover;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    await updateDocumentReferences(submission.id, buildDocRefs({ passportPages: updatedPages }));
  };

  const handleInsideRemove = async () => {
    setInsideUI({ preview: null, validating: false, error: null, file: null });
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.insidePages;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportDataReady(false);
    await updateDocumentReferences(submission.id, buildDocRefs({ passportPages: updatedPages }));
  };

  // Indian passport additional page handlers
  const handleAdditionalPageUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });

    setAdditionalPageUI({ preview, validating: true, error: null, file });

    const result = await uploadPassportPage(submission.id, 'additionalPage', file);
    if (!result) {
      setAdditionalPageUI({ preview, validating: false, error: 'Failed to upload file', file });
      return false;
    }

    setAdditionalPageUI({ preview, validating: false, error: null, file });
    const newPage: PassportPageReference = { path: result.path, filename: result.filename, validated: true };
    const updatedPages = { ...passportPagesRef.current, additionalPage: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    await updateDocumentReferences(submission.id, buildDocRefs({ passportPages: updatedPages }));

    // Extract data from additional page
    try {
      const compressedImage = await compressImageForAI(preview);
      const response = await fetch('/api/extract-passport-additional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        if (extractResult.success && extractResult.data) {
          const d = extractResult.data;
          if (d.father_name) setValue('father_full_name', d.father_name);
          if (d.mother_name) setValue('mother_full_name', d.mother_name);
          if (d.spouse_name) {
            setValue('marital_status', 'Married');
            setValue('spouse_name', d.spouse_name);
          }
          if (d.address_street) setValue('home_street_address', d.address_street);
          if (d.address_city) setValue('home_city', d.address_city);
          if (d.address_pin) setValue('home_postal_code', d.address_pin);
          if (d.address_country) setValue('home_country', d.address_country);
          // Auto-save after extraction
          setTimeout(() => autoSaveEmployeeData(submission.id, getValues()), 100);
        }
      }
    } catch (err) {
      console.error('Additional page extraction error:', err);
    }

    return true;
  };

  const handleAdditionalPageRemove = async () => {
    setAdditionalPageUI({ preview: null, validating: false, error: null, file: null });
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.additionalPage;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    await updateDocumentReferences(submission.id, buildDocRefs({ passportPages: updatedPages }));
  };

  // Named upload handlers extracted from inline JSX so they can be wrapped
  // by useScannerIntercept (image → scanner → handler, PDF → handler direct).
  const handlePreviousVisaUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setPreviousVisaUI({ preview, validating: true, error: null, file });

    try {
      const isImage = file.type.startsWith('image/');
      const imageData = isImage ? await compressImageForAI(preview) : preview;
      const response = await fetch('/api/validate-visa-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, expectedCategory: 'previous_visa' }),
      });
      if (response.ok) {
        const validationResult = await response.json();
        if (!validationResult.valid) {
          setPreviousVisaUI({
            preview,
            validating: false,
            error: validationResult.errorMessage || 'This does not look like a UAE visa. You can retry or skip this upload.',
            file,
          });
          return false;
        }
      }
    } catch (err) {
      console.error('Previous visa validation error:', err);
    }

    const result = await uploadDocument(submission.id, 'previous_visa_document', file);
    if (!result) {
      setPreviousVisaUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }
    setPreviousVisaUI({ preview, validating: false, error: null, file });
    const newDoc = { ...result, validated: true };
    setPreviousVisaDoc(newDoc);
    previousVisaDocRef.current = newDoc;
    await updateDocumentReferences(submission.id, buildDocRefs());
    return true;
  };

  const handleEidFrontUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setEidFrontUI({ preview, validating: true, error: null, file });

    let extractedData: Record<string, unknown> | null = null;
    try {
      const compressedImage = await compressImageForAI(preview);
      const response = await fetch('/api/extract-eid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage, side: 'front' }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        if (extractResult.success && extractResult.data) {
          if (!extractResult.data.emirates_id_number) {
            setEidFrontUI({ preview, validating: false, error: 'This does not appear to be an Emirates ID card. Please upload the front of a valid UAE Emirates ID.', file });
            return false;
          }
          extractedData = extractResult.data;
        } else {
          setEidFrontUI({ preview, validating: false, error: 'Could not read this document. Please upload a clear photo of the front of your Emirates ID card.', file });
          return false;
        }
      } else {
        setEidFrontUI({ preview, validating: false, error: 'Verification failed. Please try again.', file });
        return false;
      }
    } catch (err) {
      console.error('EID front validation error:', err);
      setEidFrontUI({ preview, validating: false, error: 'Verification failed. Please try again.', file });
      return false;
    }

    const result = await uploadDocument(submission.id, 'eid_front', file);
    if (!result) {
      setEidFrontUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }

    setEidFrontUI({ preview, validating: false, error: null, file });
    const newDoc = { ...result, validated: true, extracted_data: extractedData || undefined };
    setEidFrontDoc(newDoc);
    eidFrontDocRef.current = newDoc;

    if (extractedData) {
      const d = extractedData;
      if (d.emirates_id_number) setValue('eid_number', d.emirates_id_number as string);
      if (d.issue_date) setValue('eid_issue_date', d.issue_date as string);
      if (d.expiry_date) setValue('eid_expiry_date', d.expiry_date as string);
      setTimeout(() => autoSaveEmployeeData(submission.id, getValues()), 100);
    }

    await updateDocumentReferences(submission.id, buildDocRefs());
    return true;
  };

  const handleEidBackUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setEidBackUI({ preview, validating: true, error: null, file });

    try {
      const compressedImage = await compressImageForAI(preview);
      const response = await fetch('/api/extract-eid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage, side: 'back' }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        if (!extractResult.success) {
          setEidBackUI({ preview, validating: false, error: 'This does not appear to be the back of an Emirates ID card. Please upload a clear photo of the back.', file });
          return false;
        }
      }
    } catch (err) {
      console.error('EID back validation error:', err);
    }

    const result = await uploadDocument(submission.id, 'eid_back', file);
    if (!result) {
      setEidBackUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }

    setEidBackUI({ preview, validating: false, error: null, file });
    const newDoc = { ...result, validated: true };
    setEidBackDoc(newDoc);
    eidBackDocRef.current = newDoc;
    await updateDocumentReferences(submission.id, buildDocRefs());
    return true;
  };

  const handlePakistanIdFrontUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setPakistanIdFrontUI({ preview, validating: true, error: null, file });

    try {
      const compressedImage = await compressImageForAI(preview);
      const response = await fetch('/api/extract-pakistan-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage, side: 'front' }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        if (!extractResult.success) {
          setPakistanIdFrontUI({ preview, validating: false, error: 'This does not appear to be a Pakistani National ID card (CNIC/NICOP). Please upload the correct document.', file });
          return false;
        }
        if (extractResult.data?.father_name) setValue('father_full_name', extractResult.data.father_name);
      } else {
        setPakistanIdFrontUI({ preview, validating: false, error: 'Verification failed. Please try again.', file });
        return false;
      }
    } catch (err) {
      console.error('Pakistan ID front validation error:', err);
      setPakistanIdFrontUI({ preview, validating: false, error: 'Verification failed. Please try again.', file });
      return false;
    }

    const result = await uploadDocument(submission.id, 'pakistan_id_front', file);
    if (!result) {
      setPakistanIdFrontUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }

    const newDoc = { ...result, validated: true };
    setPakistanIdFrontDoc(newDoc);
    pakistanIdFrontDocRef.current = newDoc;
    setPakistanIdFrontUI({ preview, validating: false, error: null, file });
    await updateDocumentReferences(submission.id, buildDocRefs());
    return true;
  };

  const handlePakistanIdBackUpload = async (file: File): Promise<boolean> => {
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setPakistanIdBackUI({ preview, validating: true, error: null, file });

    try {
      const compressedImage = await compressImageForAI(preview);
      const response = await fetch('/api/extract-pakistan-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage, side: 'back' }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        if (!extractResult.success) {
          setPakistanIdBackUI({ preview, validating: false, error: 'This does not appear to be the back of a Pakistani National ID card. Please upload the correct document.', file });
          return false;
        }
        if (extractResult.data?.address) {
          if (!getValues('home_street_address')) setValue('home_street_address', String(extractResult.data.address));
          setValue('home_country', 'Pakistan');
          if (extractResult.data.address_city && !getValues('home_city')) {
            setValue('home_city', String(extractResult.data.address_city));
          }
          setTimeout(() => autoSaveEmployeeData(submission.id, getValues()), 100);
        }
      }
    } catch (err) {
      console.error('Pakistan ID back validation error:', err);
    }

    const result = await uploadDocument(submission.id, 'pakistan_id_back', file);
    if (!result) {
      setPakistanIdBackUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }

    const newDoc = { ...result, validated: true };
    setPakistanIdBackDoc(newDoc);
    pakistanIdBackDocRef.current = newDoc;
    setPakistanIdBackUI({ preview, validating: false, error: null, file });
    await updateDocumentReferences(submission.id, buildDocRefs());
    return true;
  };

  // Wrap each image-capable handler with the document scanner.
  const additionalPageScan = useScannerIntercept(handleAdditionalPageUpload);
  const previousVisaScan = useScannerIntercept(handlePreviousVisaUpload);
  const eidFrontScan = useScannerIntercept(handleEidFrontUpload);
  const eidBackScan = useScannerIntercept(handleEidBackUpload);
  const pakistanIdFrontScan = useScannerIntercept(handlePakistanIdFrontUpload);
  const pakistanIdBackScan = useScannerIntercept(handlePakistanIdBackUpload);

  // Fallback: if inside pages are uploaded but extraction hasn't run yet
  // (e.g. page reload with saved data), unlock the form
  useEffect(() => {
    if (isInsidePagesUploaded && !passportDataReady && !extractingPassport) {
      setPassportDataReady(true);
    }
  }, [isInsidePagesUploaded, passportDataReady, extractingPassport]);

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className={`space-y-6 relative ${isSubmitting ? 'pointer-events-none' : ''}`}>
      {/* Submitting overlay */}
      {isSubmitting && (
        <div className="fixed inset-0 z-50 bg-white/70 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: TME_COLORS.primary }} />
            <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Submitting your form...</p>
          </div>
        </div>
      )}
      {/* Step Progress */}
      <StepProgress
        currentStep={currentStep}
        viewingStep={viewingStep}
        visibleStepIndices={visibleStepIndices}
        onStepClick={(step) => {
          setViewingStep(step);
          // Always scroll to top on navigation. Without this, the page keeps
          // its previous scroll position from the prior step — and steps with
          // shorter content (Education in particular, which is shorter than
          // Address & Contact above it) leave the user looking at empty
          // space below the section. RevealSection's onReveal only fires on
          // the first visit (gated by hasBeenShown) so it can't be relied on
          // for re-visits. We also re-scroll after the reveal animation
          // (~300ms) because the page height changes mid-animation.
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setTimeout(() => window.scrollTo({ top: 0 }), 300);
        }}
      />

      {/* Step 1: Photo Upload */}
      <RevealSection show={viewingStep === 1 || viewingStep === 8}>
        <FormSection
          title="ID Photo"
          icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={displayedStepNumber(1)}
        >
          <PhotoUpload
            value={photoDoc}
            onUpload={handlePhotoUpload}
            onValidated={async (validated, validationErrors) => {
              const currentPhotoDoc = photoDocRef.current;
              if (currentPhotoDoc) {
                const updatedDoc = { ...currentPhotoDoc, validated, validation_errors: validationErrors };
                setPhotoDoc(updatedDoc);
                photoDocRef.current = updatedDoc;
                await updateDocumentReferences(submission.id, buildDocRefs({ photo: updatedDoc }));
              }
              if (photoError) setPhotoError(null);
            }}
            onRemove={async () => {
              setPhotoDoc(undefined);
              photoDocRef.current = undefined;
              await updateDocumentReferences(submission.id, buildDocRefs({ photo: undefined }));
            }}
            error={photoError || undefined}
          />
          {isPhotoUploaded && viewingStep === 8 && (
            <div className="mt-4 flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4" />
              ID Photo uploaded.
            </div>
          )}
          {viewingStep === 1 && (
            <StepNavButtons enabled={isPhotoUploaded} onContinue={() => setViewingStep(2)} showBack={false} />
          )}
        </FormSection>
      </RevealSection>

      {/* Renewal: Existing Passport Confirmation (shown before passport upload steps) */}
      {isRenewal && hasExistingPassport && (viewingStep === 2 || viewingStep === 8) && !passportChanged && (
        <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />
            <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
              Your Current Passport
            </h2>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Below are your passport documents on file. Please review and confirm they are still valid.
          </p>

          {/* Display existing passport images */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            {existingDocs?.passport_cover && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Passport Cover</label>
                <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={existingDocs.passport_cover.publicUrl}
                    alt="Passport Cover"
                    className="w-full h-auto max-h-64 object-contain"
                  />
                </div>
              </div>
            )}
            {existingDocs?.passport_inside && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Passport Data Page</label>
                <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={existingDocs.passport_inside.publicUrl}
                    alt="Passport Data Page"
                    className="w-full h-auto max-h-64 object-contain"
                  />
                </div>
              </div>
            )}
            {existingDocs?.passport_additional && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Additional Page</label>
                <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={existingDocs.passport_additional.publicUrl}
                    alt="Additional Page"
                    className="w-full h-auto max-h-64 object-contain"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Confirmation checkboxes */}
          <div className="space-y-3 border-t border-gray-200 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={passportConfirmed}
                onChange={(e) => setPassportConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#243F7B] focus:ring-[#243F7B]"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">I confirm my passport is the same as shown above</span>
                <p className="text-xs text-gray-500 mt-0.5">My passport has not been renewed, replaced, or lost since the last submission.</p>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-5">
            <button
              type="button"
              onClick={() => setPassportChanged(true)}
              className="text-sm text-red-600 hover:text-red-700 font-medium underline"
            >
              My passport has changed — I need to upload new pages
            </button>
            {passportConfirmed && (
              <button
                type="button"
                onClick={() => {
                  // Skip passport upload steps, go to step 4 (Identity & Visa) or 5 (Family)
                  setViewingStep(4);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white text-sm"
                style={{ backgroundColor: TME_COLORS.primary }}
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Passport Cover */}
      <RevealSection
        show={(viewingStep === 2 || viewingStep === 8) && (!isRenewal || !hasExistingPassport || passportChanged)}
        onReveal={viewingStep !== 8 ? () => scrollToRef(passportCoverRef) : undefined}
      >
        <div ref={passportCoverRef}>
          <FormSection
            title="Passport Cover (OUTSIDE)"
            icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(2)}
          >
            <div className="space-y-4">
              <div
                className="flex items-start gap-3 p-4 rounded-lg"
                style={{ backgroundColor: '#EBF4FF' }}
              >
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                  <p className="font-medium">Upload your passport cover (open/spread showing front + back cover)</p>
                  <p className="mt-2 text-xs text-gray-600">
                    Single page photos are not accepted. Passport must be spread open.
                  </p>
                  <SampleImageToggle imageSrc="/samples/passport-cover-example.png" altText="Example passport cover spread" label="See example photo" />
                </div>
              </div>

              <UploadSlot
                label="Passport Cover"
                description="Spread open: front + back cover visible"
                expectedType="COVER"
                file={coverUI.file}
                preview={coverUI.preview || undefined}
                validated={!!passportPages.cover?.validated}
                validating={coverUI.validating}
                error={coverUI.error || undefined}
                onUpload={async (file) => {
                  setPendingCoverFile(file);
                  return true;
                }}
                onRemove={handleCoverRemove}
              />

              {pendingCoverFile && (
                <DocumentScanner
                  file={pendingCoverFile}
                  onConfirm={async (scannedFile) => {
                    setPendingCoverFile(null);
                    await handleCoverUpload(scannedFile);
                  }}
                  onCancel={() => setPendingCoverFile(null)}
                />
              )}
            </div>
            {passportError && (
              <p className="mt-2 text-sm text-red-500">{passportError}</p>
            )}
            {viewingStep === 2 && (
              <StepNavButtons enabled={isCoverUploaded} onContinue={() => setViewingStep(3)} onBack={() => setViewingStep(1)} />
            )}
          </FormSection>
        </div>
      </RevealSection>

      {/* Step 3: Inside Pages + Personal Details */}
      <RevealSection
        show={(viewingStep === 3 || viewingStep === 8) && (!isRenewal || !hasExistingPassport || passportChanged)}
        onReveal={viewingStep !== 8 ? () => scrollToRef(passportInsideRef) : undefined}
      >
        <div ref={passportInsideRef} className="space-y-6">
          <FormSection
            title="Passport Data (INSIDE)"
            icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(3)}
          >
            <div className="space-y-4">
              <div
                className="flex items-start gap-3 p-4 rounded-lg"
                style={{ backgroundColor: '#EBF4FF' }}
              >
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                  <p className="font-medium">Upload your passport inside pages (open/spread showing data page + opposite page)</p>
                  <p className="mt-2 text-xs text-gray-600">
                    Your details will be automatically extracted from this page.
                  </p>
                  <SampleImageToggle imageSrc="/samples/passport-inside-example.png" altText="Example passport inside pages spread" label="See example photo" />
                </div>
              </div>

              <UploadSlot
                label=""
                description="Spread open: data page + opposite page"
                expectedType="INSIDE_PAGES"
                file={insideUI.file}
                preview={insideUI.preview || undefined}
                validated={!!passportPages.insidePages?.validated}
                validating={insideUI.validating}
                error={insideUI.error || undefined}
                onUpload={async (file) => {
                  setPendingInsideFile(file);
                  return true;
                }}
                onRemove={handleInsideRemove}
              />

              {pendingInsideFile && (
                <DocumentScanner
                  file={pendingInsideFile}
                  onConfirm={async (scannedFile) => {
                    setPendingInsideFile(null);
                    await handleInsideUpload(scannedFile);
                  }}
                  onCancel={() => setPendingInsideFile(null)}
                />
              )}
            </div>
          </FormSection>

          {/* Extracting passport data indicator */}
          {extractingPassport && (
            <div className="rounded-xl border-2 border-blue-100 bg-blue-50/50 p-6">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
                <div>
                  <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Reading passport data...</p>
                  <p className="text-xs text-gray-500 mt-0.5">Extracting your details from the passport. This may take a few seconds.</p>
                </div>
              </div>
            </div>
          )}

          {/* Personal Details — merged into step 3, hidden while extracting */}
          {passportDataReady && !extractingPassport && (
          <FormSection
            title="Personal Details"
            icon={<User className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <p className="text-sm text-gray-500 mb-4">
              These details were auto-filled from your passport. Please review and correct if needed.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <CustomDropdown
                  label="Title"
                  options={TITLES.map(t => ({ value: t, label: t }))}
                  value={title || ''}
                  onChange={(val) => setValue('title', val)}
                  error={errors.title?.message}
                  required
                />
                <Input
                  label="First Name"
                  error={errors.first_name?.message}
                  required
                  {...register('first_name', { required: 'Required' })}
                />
                <Input
                  label="Middle Name"
                  {...register('middle_name')}
                />
                <Input
                  label="Family Name"
                  error={errors.last_name?.message}
                  required
                  {...register('last_name', { required: 'Required' })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Full Name"
                  value={calculateFullName(firstName || '', middleName, lastName || '')}
                  disabled
                  helperText="Auto-calculated from name fields"
                />
                <Input
                  label="Passport Number"
                  placeholder="e.g. X12345678"
                  {...register('passport_number')}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CustomDatePicker
                  label="Passport Issue Date"
                  value={passportIssueDate || ''}
                  onChange={(val) => setValue('passport_issue_date', val)}
                />
                <CustomDatePicker
                  label="Passport Expiry"
                  value={passportExpiry || ''}
                  onChange={(val) => setValue('passport_expiry', val)}
                  error={errors.passport_expiry?.message}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CustomDropdown
                  label="Nationality"
                  options={SORTED_NATIONALITIES.map(n => ({ value: n, label: n }))}
                  value={nationality || ''}
                  onChange={(val) => setValue('nationality', val)}
                  error={errors.nationality?.message}
                  required
                  searchable
                />
                <CustomDropdown
                  label="Gender"
                  options={[
                    { value: 'male', label: 'Male' },
                    { value: 'female', label: 'Female' },
                  ]}
                  value={gender || ''}
                  onChange={(val) => setValue('gender', val as 'male' | 'female')}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CustomDatePicker
                  label="Date of Birth"
                  value={dateOfBirth || ''}
                  onChange={(val) => setValue('date_of_birth', val)}
                  error={errors.date_of_birth?.message}
                />
                <Input
                  label="Place of Birth / Issue"
                  placeholder="e.g. London, Dubai..."
                  {...register('place_of_issue')}
                />
              </div>

              {/* Other Nationality */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasOtherNationality}
                    onChange={(e) => {
                      setHasOtherNationality(e.target.checked);
                      if (!e.target.checked) {
                        setValue('other_nationality', undefined);
                      }
                    }}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                    I have another nationality
                  </span>
                </label>
                {hasOtherNationality && (
                  <div className="pl-6">
                    <CustomDropdown
                      label="Other Nationality"
                      options={SORTED_NATIONALITIES.map(n => ({ value: n, label: n }))}
                      value={otherNationality || ''}
                      onChange={(val) => setValue('other_nationality', val)}
                      placeholder="Select nationality"
                      searchable
                    />
                  </div>
                )}
              </div>

              {/* Previous Nationality */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasPreviousNationality}
                    onChange={(e) => {
                      setHasPreviousNationality(e.target.checked);
                      if (!e.target.checked) {
                        setValue('previous_nationality', undefined);
                      }
                    }}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                    I had a previous nationality
                  </span>
                </label>
                {hasPreviousNationality && (
                  <div className="pl-6">
                    <CustomDropdown
                      label="Previous Nationality"
                      options={SORTED_NATIONALITIES.map(n => ({ value: n, label: n }))}
                      value={previousNationality || ''}
                      onChange={(val) => setValue('previous_nationality', val)}
                      placeholder="Select previous nationality"
                      searchable
                    />
                  </div>
                )}
              </div>
            </div>
          </FormSection>
          )}
          {/* Indian Passport Additional Page */}
          {requiresAdditionalPage && (
            <FormSection
              title="Indian Passport — Additional Page"
              icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            >
              <div className="space-y-4">
                <div
                  className="flex items-start gap-3 p-4 rounded-lg"
                  style={{ backgroundColor: '#EBF4FF' }}
                >
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <p className="font-medium">Upload the last page of your Indian passport</p>
                    <p className="mt-1 text-xs text-gray-600">
                      This page contains your parents&apos; names, spouse name, and address. These details will be automatically extracted.
                    </p>
                    <SampleImageToggle imageSrc="/samples/passport-additional-example.png" altText="Example Indian passport additional page" label="See example photo" />
                  </div>
                </div>

                <UploadSlot
                  label=""
                  description="Last page with parents' names and address"
                  expectedType="INSIDE_PAGES"
                  file={additionalPageUI.file}
                  preview={additionalPageUI.preview || undefined}
                  validated={!!passportPages.additionalPage?.validated}
                  validating={additionalPageUI.validating}
                  error={additionalPageUI.error || undefined}
                  onUpload={additionalPageScan.intercepted}
                  onRemove={handleAdditionalPageRemove}
                />
                {additionalPageScan.scannerModal}

                {isAdditionalPageUploaded && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    Additional page uploaded. Family details and address will be pre-filled.
                  </div>
                )}
              </div>
            </FormSection>
          )}
          {/* Pakistani National ID — conditional on Pakistani nationality */}
          {isPakistaniNationality && isInsidePagesUploaded && passportDataReady && (
            <FormSection
              title="Pakistani National ID (CNIC/NICOP)"
              icon={<CreditCard className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            >
              <div className="space-y-4">
                <div
                  className="flex items-start gap-3 p-4 rounded-lg"
                  style={{ backgroundColor: '#EBF4FF' }}
                >
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <p className="font-medium">Pakistani nationals are required to provide a copy of their National ID Card (CNIC/NICOP) with chip</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Please upload the front and back of your Pakistan National Identity Card. Your details will be automatically extracted.
                    </p>
                  </div>
                </div>

                {/* Sample images above upload areas */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="text-center">
                    <p className="text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Front example</p>
                    <div className="rounded-lg overflow-hidden border border-gray-200 inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/samples/pakistan-id-front-example.png" alt="Example Pakistan ID front" className="h-32 sm:h-40 object-contain" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Back example</p>
                    <div className="rounded-lg overflow-hidden border border-gray-200 inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/samples/pakistan-id-back-example.png" alt="Example Pakistan ID back" className="h-32 sm:h-40 object-contain" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                  {/* Front */}
                  <div className="flex flex-col">
                    <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Front</p>
                      <UploadSlot
                        label=""
                        description="Front of Pakistan ID"
                        expectedType="INSIDE_PAGES"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        maxSizeMB={10}
                        file={pakistanIdFrontUI.file}
                        preview={pakistanIdFrontUI.preview || undefined}
                        validated={!!pakistanIdFrontDoc?.validated}
                        validating={pakistanIdFrontUI.validating}
                        error={pakistanIdFrontUI.error || undefined}
                        onUpload={pakistanIdFrontScan.intercepted}
                        onRemove={async () => {
                          setPakistanIdFrontUI({ preview: null, validating: false, error: null, file: null });
                          setPakistanIdFrontDoc(undefined);
                          pakistanIdFrontDocRef.current = undefined;
                          await updateDocumentReferences(submission.id, buildDocRefs());
                        }}
                      />
                    {pakistanIdFrontScan.scannerModal}
                  </div>

                  {/* Back */}
                  <div className="flex flex-col">
                    <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Back</p>
                      <UploadSlot
                        label=""
                        description="Back of Pakistan ID"
                        expectedType="INSIDE_PAGES"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        maxSizeMB={10}
                        file={pakistanIdBackUI.file}
                        preview={pakistanIdBackUI.preview || undefined}
                        validated={!!pakistanIdBackDoc?.validated}
                        validating={pakistanIdBackUI.validating}
                        error={pakistanIdBackUI.error || undefined}
                        onUpload={pakistanIdBackScan.intercepted}
                        onRemove={async () => {
                          setPakistanIdBackUI({ preview: null, validating: false, error: null, file: null });
                          setPakistanIdBackDoc(undefined);
                          pakistanIdBackDocRef.current = undefined;
                          await updateDocumentReferences(submission.id, buildDocRefs());
                        }}
                      />
                    {pakistanIdBackScan.scannerModal}
                  </div>
                </div>

                {pakistanIdFrontDoc?.validated && pakistanIdBackDoc?.validated && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    Pakistan National ID uploaded (front and back).
                  </div>
                )}
              </div>
            </FormSection>
          )}

          {viewingStep === 3 && (
            <StepNavButtons
              enabled={isInsidePagesUploaded && passportDataReady && isPersonalComplete && (!requiresAdditionalPage || isAdditionalPageUploaded)}
              onContinue={() => setViewingStep(4)}
              onBack={() => setViewingStep(2)}
            />
          )}
        </div>
      </RevealSection>

      {/* Step 4: Identity & Visa Documents (NEW) */}
      <RevealSection
        show={viewingStep === 4 || viewingStep === 8}
        onReveal={viewingStep !== 8 ? () => scrollToRef(identityDocsRef) : undefined}
      >
        <div ref={identityDocsRef} className="space-y-6">
          {/* UAE Visa Status — appears first when employer answered "Yes, applicant is in the UAE" */}
          {showVisaCategoryPicker && (
            <FormSection
              title="UAE Visa Status"
              icon={<FileText className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Your employer has indicated that you are currently in the UAE. Please confirm your current visa status.
                </p>

                <CustomDropdown
                  label="Current visa status"
                  options={EMPLOYEE_VISA_CATEGORY_OPTIONS}
                  value={employeeVisaCategory || ''}
                  onChange={(val) => {
                    setValue('visa_category', val as VisaCategory);
                    if (val !== 'visa_on_arrival') {
                      setValue('visa_arrival_date', undefined);
                    }
                    if (val === 'visa_on_arrival') {
                      if (visaDocRef.current) {
                        setVisaDoc(undefined);
                        visaDocRef.current = undefined;
                        updateDocumentReferences(submission.id, buildDocRefs()).catch(() => {});
                      }
                    }
                  }}
                  placeholder="Select your current visa status..."
                  required
                />

                {showArrivalDatePicker && (
                  <div className="space-y-2">
                    <CustomDatePicker
                      label="Date of Arrival"
                      value={employeeVisaArrivalDate || ''}
                      onChange={(val) => setValue('visa_arrival_date', val)}
                      required
                    />
                    <p className="text-xs text-gray-500">
                      This is the date you entered the UAE on your arrival visa. It will be included in the onboarding confirmation.
                    </p>
                  </div>
                )}

                {showVisaDocumentUpload && (
                  <div className="space-y-3">
                    <div
                      className="flex items-start gap-3 p-4 rounded-lg"
                      style={{ backgroundColor: visaUploadRule === 'mandatory' ? '#FEF3C7' : '#F3F4F6' }}
                    >
                      <Info className={`w-5 h-5 flex-shrink-0 mt-0.5 ${visaUploadRule === 'mandatory' ? 'text-amber-600' : 'text-gray-500'}`} />
                      <div className={`text-sm ${visaUploadRule === 'mandatory' ? 'text-amber-800' : 'text-gray-700'}`}>
                        <p className="font-medium">
                          {visaUploadRule === 'mandatory'
                            ? `Please upload a copy of your ${VISA_CATEGORY_LABELS[employeeVisaCategory!] || 'supporting document'}.`
                            : 'You may upload a supporting document if you have one (optional).'}
                        </p>
                      </div>
                    </div>

                    <UploadSlot
                      label=""
                      description={`Scan or photo of your ${VISA_CATEGORY_LABELS[employeeVisaCategory!] || 'supporting document'} (PDF or image)`}
                      expectedType="INSIDE_PAGES"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      maxSizeMB={10}
                      file={visaDocUI.file}
                      preview={visaDocUI.preview || undefined}
                      validated={!!visaDoc?.validated}
                      validating={visaDocUI.validating}
                      error={visaDocUI.error || undefined}
                      onUpload={async (file) => {
                        const reader = new FileReader();
                        const preview = await new Promise<string>((resolve) => {
                          reader.onload = (e) => resolve(e.target?.result as string);
                          reader.readAsDataURL(file);
                        });
                        setVisaDocUI({ preview, validating: false, error: null, file });
                        const result = await uploadDocument(submission.id, 'visa_document', file);
                        if (!result) {
                          setVisaDocUI({ preview, validating: false, error: 'Failed to upload', file });
                          return false;
                        }
                        const docWithMeta = { ...result, validated: true, visa_category: employeeVisaCategory };
                        setVisaDoc(docWithMeta);
                        visaDocRef.current = docWithMeta;
                        try {
                          const refs = buildDocRefs();
                          await updateDocumentReferences(submission.id, refs);
                        } catch (err) {
                          console.error('[VisaUpload] failed to persist doc refs', err);
                        }
                        return true;
                      }}
                      onRemove={async () => {
                        setVisaDoc(undefined);
                        visaDocRef.current = undefined;
                        setVisaDocUI({ preview: null, validating: false, error: null, file: null });
                        await updateDocumentReferences(submission.id, buildDocRefs());
                      }}
                    />
                  </div>
                )}
              </div>
            </FormSection>
          )}

          {/* UAE Visa and Emirates ID — combined previous-documents section.
              New-hire path only (on renewal we already have these on file). */}
          {!isRenewal && (
          <FormSection
            title="UAE Visa and Emirates ID"
            icon={<CreditCard className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(4)}
          >
            <div className="space-y-4">
              <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                Did you previously hold a UAE visa and Emirates ID? <span className="text-red-500">*</span>
              </p>
              <div className="flex items-center gap-6">
                {([
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' },
                ] as const).map((opt) => (
                  <label key={opt.label} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="has_previous_uae_docs"
                      checked={hasPreviousUaeDocs === opt.value}
                      onChange={() => {
                        setHasPreviousUaeDocs(opt.value);
                        setValue('has_previous_eid', opt.value);
                        if (opt.value === false) {
                          // Clear any previously entered EID fields when the
                          // user switches back to No.
                          setValue('eid_number', undefined);
                          setValue('eid_issue_date', undefined);
                          setValue('eid_expiry_date', undefined);
                        }
                      }}
                      className="w-4 h-4"
                      style={{ accentColor: TME_COLORS.primary }}
                    />
                    <span className="text-sm" style={{ color: TME_COLORS.primary }}>{opt.label}</span>
                  </label>
                ))}
              </div>

              {hasPreviousUaeDocs === true && (
                <div className="space-y-5 pl-6 border-l-2 border-gray-200">
                  {/* Combined guidance — applies to both the visa and the EID uploads below */}
                  <div
                    className="flex items-start gap-3 p-4 rounded-lg"
                    style={{ backgroundColor: '#EBF4FF' }}
                  >
                    <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                    <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                      <p className="font-medium">If you have a copy, please upload your previous UAE visa and the front and back of your Emirates ID.</p>

                      <p className="mt-1 text-xs text-gray-600">
                        UAE authorities may request these during visa processing. Expired documents are accepted.
                      </p>
                    </div>
                  </div>

                  {/* Previous UAE visa upload — accepts PDF/image, AI-validated loosely.
                      Uses UploadSlot for visual consistency with the EID drop-zones below. */}
                  <div className="space-y-3">
                    <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Previous UAE visa</p>
                    <div className="text-center mb-2">
                      <p className="text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Example</p>
                      <div className="rounded-lg overflow-hidden border border-gray-200 inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/samples/visa-example.png" alt="Example UAE visa" className="h-32 sm:h-40 object-contain" />
                      </div>
                    </div>
                    <UploadSlot
                      label=""
                      description="Scan or photo of your previous UAE visa (PDF or image)"
                      expectedType="INSIDE_PAGES"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      maxSizeMB={10}
                      file={previousVisaUI.file}
                      preview={previousVisaUI.preview || undefined}
                      validated={!!previousVisaDoc?.validated}
                      validating={previousVisaUI.validating}
                      error={previousVisaUI.error || undefined}
                      onUpload={previousVisaScan.intercepted}
                      onRemove={async () => {
                        setPreviousVisaUI({ preview: null, validating: false, error: null, file: null });
                        setPreviousVisaDoc(undefined);
                        previousVisaDocRef.current = undefined;
                        await updateDocumentReferences(submission.id, buildDocRefs());
                      }}
                    />
                    {previousVisaScan.scannerModal}
                  </div>


                  {/* Sample images — shown together above upload areas */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="text-center">
                      <p className="text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Front example</p>
                      <div className="rounded-lg overflow-hidden border border-gray-200 inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/samples/eid-front-example.png" alt="Example Emirates ID front" className="h-32 sm:h-40 object-contain" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>Back example</p>
                      <div className="rounded-lg overflow-hidden border border-gray-200 inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/samples/eid-back-example.png" alt="Example Emirates ID back" className="h-32 sm:h-40 object-contain" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                    {/* EID Front */}
                    <div className="flex flex-col">
                      <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Front</p>
                        <UploadSlot
                          label=""
                          description="Front of Emirates ID"
                          expectedType="INSIDE_PAGES"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          maxSizeMB={10}
                          file={eidFrontUI.file}
                          preview={eidFrontUI.preview || undefined}
                          validated={!!eidFrontDoc?.validated}
                          validating={eidFrontUI.validating}
                          error={eidFrontUI.error || undefined}
                          onUpload={eidFrontScan.intercepted}
                          onRemove={async () => {
                            setEidFrontUI({ preview: null, validating: false, error: null, file: null });
                            setEidFrontDoc(undefined);
                            eidFrontDocRef.current = undefined;
                            setValue('eid_number', undefined);
                            setValue('eid_issue_date', undefined);
                            setValue('eid_expiry_date', undefined);
                            await updateDocumentReferences(submission.id, buildDocRefs());
                          }}
                        />
                      {eidFrontScan.scannerModal}
                    </div>

                    {/* EID Back */}
                    <div className="flex flex-col">
                      <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Back</p>
                        <UploadSlot
                          label=""
                          description="Back of Emirates ID"
                          expectedType="INSIDE_PAGES"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          maxSizeMB={10}
                          file={eidBackUI.file}
                          preview={eidBackUI.preview || undefined}
                          validated={!!eidBackDoc?.validated}
                          validating={eidBackUI.validating}
                          error={eidBackUI.error || undefined}
                          onUpload={eidBackScan.intercepted}
                          onRemove={async () => {
                            setEidBackUI({ preview: null, validating: false, error: null, file: null });
                            setEidBackDoc(undefined);
                            eidBackDocRef.current = undefined;
                            await updateDocumentReferences(submission.id, buildDocRefs());
                          }}
                        />
                      {eidBackScan.scannerModal}
                    </div>
                  </div>

                  {eidFrontDoc?.validated && eidBackDoc?.validated && (
                    <div className="flex items-center gap-2 text-green-600 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      Emirates ID uploaded (front and back).
                    </div>
                  )}

                  {/* Show extracted EID data */}
                  {watch('eid_number') && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-900">
                        <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                          EID extracted
                        </span>
                        <span>{watch('eid_number')}</span>
                        {watch('eid_issue_date') && <span>Issued: {watch('eid_issue_date')}</span>}
                        {watch('eid_expiry_date') && <span>Expires: {watch('eid_expiry_date')}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </FormSection>
          )}

          {!employerVisaInUAE && hasPreviousUaeDocs === false && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-gray-400" />
                No additional identity or visa documents are required. You can continue to the next step.
              </div>
            </div>
          )}

          {viewingStep === 4 && (
            <StepNavButtons
              enabled={isStep4Complete}
              onContinue={() => setViewingStep(5)}
              onBack={() => setViewingStep(3)}
            />
          )}
        </div>
      </RevealSection>

      {/* Step 5: Family Details */}
      <RevealSection
        show={viewingStep === 5 || viewingStep === 8}
        onReveal={viewingStep !== 8 ? () => scrollToRef(familyRef) : undefined}
      >
        <div ref={familyRef}>
          <FormSection
            title="Family Details"
            icon={<Users className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(5)}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Father's Full Name"
                  error={errors.father_full_name?.message}
                  required
                  {...register('father_full_name', { required: 'Required' })}
                />
                <Input
                  label="Mother's Full Name"
                  error={errors.mother_full_name?.message}
                  required
                  {...register('mother_full_name', { required: 'Required' })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CustomDropdown
                  label="Religion"
                  options={SORTED_RELIGIONS.map(r => ({ value: r, label: r }))}
                  value={religion || ''}
                  onChange={(val) => setValue('religion', val)}
                  error={errors.religion?.message}
                  required
                  searchable
                />
                <CustomDropdown
                  label="Marital Status"
                  options={MARITAL_STATUS_OPTIONS.map(m => ({ value: m, label: m }))}
                  value={maritalStatus || ''}
                  onChange={(val) => setValue('marital_status', val)}
                  error={errors.marital_status?.message}
                  required
                />
              </div>

              {maritalStatus === 'Married' && (
                <Input
                  label="Spouse Name"
                  error={errors.spouse_name?.message}
                  required
                  {...register('spouse_name', {
                    required: maritalStatus === 'Married' ? 'Required' : false,
                  })}
                />
              )}
            </div>
            {viewingStep === 5 && (
              <StepNavButtons enabled={isFamilyComplete} onContinue={() => setViewingStep(6)} onBack={() => setViewingStep(4)} />
            )}
          </FormSection>
        </div>
      </RevealSection>

      {/* Step 6: Address & Contact */}
      <RevealSection
        show={viewingStep === 6 || viewingStep === 8}
        onReveal={viewingStep !== 8 ? () => scrollToRef(contactRef) : undefined}
      >
        <div ref={contactRef} className="space-y-6">
          {/* Home Country Address */}
          <FormSection
            title="Home Country Address"
            icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(6)}
          >
            <div className="space-y-4">
              <Input
                label="Street Address"
                placeholder="Enter your street address"
                error={errors.home_street_address?.message}
                required
                {...register('home_street_address', { required: 'Street address is required' })}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="City"
                  placeholder="Enter city"
                  error={errors.home_city?.message}
                  required
                  {...register('home_city', { required: 'City is required' })}
                />
                <Input
                  label="Postal Code"
                  placeholder="Enter postal code"
                  error={errors.home_postal_code?.message}
                  {...register('home_postal_code')}
                />
                <CustomDropdown
                  label="Country"
                  value={homeCountry || ''}
                  onChange={(value) => setValue('home_country', value)}
                  options={SORTED_NATIONALITIES.map((n) => ({ value: n, label: n }))}
                  placeholder="Select country"
                  error={errors.home_country?.message}
                  required
                  searchable
                />
              </div>

              <PhoneInput
                label="Home Telephone"
                value={homeTelephone}
                onChange={(value) => setValue('home_telephone', value || '')}
                defaultCountry={nationalityCountryCode || 'AE'}
              />
            </div>
          </FormSection>

          {/* UAE Address */}
          <FormSection
            title="UAE Address"
            icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInUAE}
                  onChange={(e) => {
                    setIsInUAE(e.target.checked);
                    setValue('uae_presence', e.target.checked ? 'inside' : 'outside');
                    if (!e.target.checked) {
                      setValue('uae_street_address', '');
                      setValue('uae_city', '');
                      setValue('uae_postal_code', '');
                      setValue('uae_emirate', '');
                    }
                  }}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                  Applicant is currently in the UAE
                </span>
              </label>

              {isInUAE && (
                <div className="space-y-4 pl-6 border-l-2 border-gray-200">
                  <Input
                    label="Street Address"
                    error={errors.uae_street_address?.message}
                    required
                    {...register('uae_street_address', {
                      required: isInUAE ? 'Required' : false,
                    })}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      label="Area"
                      error={errors.uae_city?.message}
                      required
                      {...register('uae_city', {
                        required: isInUAE ? 'Required' : false,
                      })}
                    />
                    <Input
                      label="Postal Code"
                      error={errors.uae_postal_code?.message}
                      {...register('uae_postal_code')}
                    />
                    <CustomDropdown
                      label="Emirate"
                      value={watch('uae_emirate') || ''}
                      onChange={(value) => setValue('uae_emirate', value)}
                      options={UAE_EMIRATES.map(e => ({ value: e, label: e }))}
                      placeholder="Select emirate..."
                      required
                    />
                  </div>
                  <PhoneInput
                    label="Telephone"
                    value={mobileUae}
                    onChange={(value) => setValue('mobile_uae', value || '')}
                    country="AE"
                  />
                </div>
              )}
            </div>
          </FormSection>

          {/* Email */}
          <FormSection
            title="Email"
            icon={<Mail className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Personal Email"
                type="email"
                error={errors.personal_email?.message}
                required
                {...register('personal_email', {
                  required: 'Required',
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: 'Invalid email format',
                  },
                })}
              />
              <div>
                <Input
                  label="Company Email"
                  type="email"
                  disabled={sameEmails}
                  {...register('company_email')}
                />
                <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    {...register('same_emails')}
                    className="rounded"
                  />
                  Same as personal email
                </label>
              </div>
            </div>
          </FormSection>
          {viewingStep === 6 && (
            <StepNavButtons enabled={isContactComplete} onContinue={() => setViewingStep(7)} onBack={() => setViewingStep(5)} />
          )}
        </div>
      </RevealSection>

      {/* Step 7: Education & More */}
      <RevealSection
        show={viewingStep === 7 || viewingStep === 8}
        onReveal={viewingStep !== 8 ? () => scrollToRef(educationRef) : undefined}
      >
        <div ref={educationRef} className="space-y-6">
          {/* Education & Languages */}
          <FormSection
            title="Education & Languages"
            icon={<GraduationCap className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(7)}
          >
            <div className="space-y-4">
              <CustomDropdown
                label="Educational Qualification"
                options={EDUCATIONAL_QUALIFICATIONS.map(e => ({ value: e, label: e }))}
                value={educationalQualification || ''}
                onChange={(val) => {
                  setValue('educational_qualification', val);
                  if (val !== 'Other') {
                    setValue('educational_qualification_custom', undefined);
                  }
                }}
                error={errors.educational_qualification?.message}
                required
              />

              {educationalQualification === 'Other' && (
                <Input
                  label="Please specify qualification"
                  error={errors.educational_qualification_custom?.message}
                  required
                  {...register('educational_qualification_custom', {
                    required: educationalQualification === 'Other' ? 'Please specify your qualification' : false,
                  })}
                />
              )}

              <MultiSelectDropdown
                label="Languages Spoken"
                options={SORTED_LANGUAGES}
                value={languagesSpoken}
                onChange={(values) => setValue('languages_spoken', values)}
                required
                searchable
                allowCustom
                customPlaceholder="Add another language..."
                error={errors.languages_spoken?.message}
              />

              {/* Education document uploads */}
              {educationalQualification && (
                <div className="space-y-3 pt-4 border-t border-gray-200">
                  {/* Show "highly recommended" warning for Vocational Certificate and above */}
                  {!['Primary School', 'Secondary School / High School'].includes(educationalQualification) && (
                    <div className="flex items-center gap-2">
                      <Info className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <span className="text-sm text-amber-700 font-medium">
                        Highly recommended: Please upload your translated and attested academic documents
                      </span>
                    </div>
                  )}
                  <FileUploadSlot
                    label="Translated & Attested Degree"
                    description="PDF or image of your attested degree certificate"
                    uploaded={!!degreeDoc}
                    filename={degreeDoc?.filename}
                    onUpload={async (file) => {
                      const result = await uploadDocument(submission.id, 'degree_attested', file);
                      if (result) {
                        setDegreeDoc(result);
                        degreeDocRef.current = result;
                        await updateDocumentReferences(submission.id, buildDocRefs());
                      }
                      return result;
                    }}
                    onRemove={async () => {
                      setDegreeDoc(undefined);
                      degreeDocRef.current = undefined;
                      await updateDocumentReferences(submission.id, buildDocRefs());
                    }}
                  />
                  <FileUploadSlot
                    label="Transcript of Records"
                    description="PDF or image of your academic transcript"
                    uploaded={!!transcriptDoc}
                    filename={transcriptDoc?.filename}
                    onUpload={async (file) => {
                      const result = await uploadDocument(submission.id, 'transcript_of_records', file);
                      if (result) {
                        setTranscriptDoc(result);
                        transcriptDocRef.current = result;
                        await updateDocumentReferences(submission.id, buildDocRefs());
                      }
                      return result;
                    }}
                    onRemove={async () => {
                      setTranscriptDoc(undefined);
                      transcriptDocRef.current = undefined;
                      await updateDocumentReferences(submission.id, buildDocRefs());
                    }}
                  />

                  {/* Additional education document */}
                  {showAdditionalEducation ? (
                    <FileUploadSlot
                      label="Additional Education Document"
                      description="Any other education-related document"
                      uploaded={!!educationAdditionalDoc}
                      filename={educationAdditionalDoc?.filename}
                      onUpload={async (file) => {
                        const result = await uploadDocument(submission.id, 'education_additional', file);
                        if (result) {
                          setEducationAdditionalDoc(result);
                          educationAdditionalDocRef.current = result;
                          await updateDocumentReferences(submission.id, buildDocRefs());
                        }
                        return result;
                      }}
                      onRemove={async () => {
                        setEducationAdditionalDoc(undefined);
                        educationAdditionalDocRef.current = undefined;
                        setShowAdditionalEducation(false);
                        await updateDocumentReferences(submission.id, buildDocRefs());
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAdditionalEducation(true)}
                      className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:underline"
                      style={{ color: TME_COLORS.primary }}
                    >
                      + Add additional education document
                    </button>
                  )}
                </div>
              )}
            </div>
          </FormSection>

          {/* Bank Details */}
          <FormSection
            title="Bank Details"
            icon={<Building2 className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all duration-200"
                  style={{
                    borderColor: hasUAEBank === true ? TME_COLORS.primary : '#e5e7eb',
                    backgroundColor: hasUAEBank === true ? '#f0f4ff' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="bank_status"
                    checked={hasUAEBank === true}
                    onChange={() => setValue('has_uae_bank', true)}
                    className="accent-[#243F7B]"
                  />
                  <span className="text-sm text-gray-700">I have a UAE bank account</span>
                </label>
                <label
                  className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all duration-200"
                  style={{
                    borderColor: hasUAEBank === false ? TME_COLORS.primary : '#e5e7eb',
                    backgroundColor: hasUAEBank === false ? '#f0f4ff' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="bank_status"
                    checked={hasUAEBank === false}
                    onChange={() => setValue('has_uae_bank', false)}
                    className="accent-[#243F7B]"
                  />
                  <span className="text-sm text-gray-700">I do not have a UAE bank account</span>
                </label>
              </div>

              {hasUAEBank && (
                <div className="space-y-4 pt-4 border-t border-gray-200">
                  <Input
                    label="IBAN"
                    placeholder="AExx xxx xxxx xxxx xxxx xxxx"
                    error={errors.bank_iban?.message}
                    required
                    value={(() => {
                      const c = (bankIban || '').replace(/\s/g, '').toUpperCase();
                      if (c.length <= 4) return c;
                      if (c.length <= 7) return `${c.slice(0, 4)} ${c.slice(4)}`;
                      // AExx xxx xxxx xxxx xxxx xxxx
                      let out = `${c.slice(0, 4)} ${c.slice(4, 7)}`;
                      for (let i = 7; i < c.length; i += 4) {
                        out += ` ${c.slice(i, i + 4)}`;
                      }
                      return out;
                    })()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\s/g, '').toUpperCase();
                      setValue('bank_iban', raw, { shouldValidate: true });
                    }}
                    ref={undefined}
                  />
                  {/* Hidden field for validation */}
                  <input type="hidden" {...register('bank_iban', {
                    required: hasUAEBank ? 'Required' : false,
                    validate: (value) => {
                      if (!value) return true;
                      const result = validateIbanFormat(value);
                      return result.valid || result.message;
                    },
                  })} />

                  {/* UAE IBAN — bank found: show green info card */}
                  {bankLookupResult?.found && bankLookupResult.isUae && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <span className="text-sm font-medium text-emerald-800">Bank identified from IBAN</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-emerald-900">
                        <div><span className="font-medium">Bank:</span> {bankLookupResult.bankName}</div>
                        <div><span className="font-medium">SWIFT:</span> {bankLookupResult.swift}</div>
                        <div><span className="font-medium">Routing Code:</span> {bankLookupResult.routingCode}</div>
                      </div>
                    </div>
                  )}

                  {/* UAE IBAN — bank code not recognized: warning + manual fields */}
                  {bankLookupResult?.isUae && !bankLookupResult.found && (
                    <>
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <Info className="w-4 h-4 text-amber-600" />
                          <span className="text-sm text-amber-800">Bank not recognized from IBAN. Please enter details manually.</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input
                          label="Bank Name"
                          required
                          {...register('bank_name', { required: 'Required' })}
                          error={errors.bank_name?.message}
                        />
                        <Input
                          label="SWIFT Code"
                          {...register('bank_swift')}
                        />
                      </div>
                    </>
                  )}

                  {/* International IBAN — show manual Bank Name + SWIFT fields */}
                  {bankLookupResult?.isInternational && (
                    <>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <Info className="w-4 h-4 text-blue-600" />
                          <span className="text-sm text-blue-800">International IBAN detected. Please enter bank details.</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input
                          label="Bank Name"
                          required
                          {...register('bank_name', { required: 'Required' })}
                          error={errors.bank_name?.message}
                        />
                        <Input
                          label="SWIFT Code"
                          {...register('bank_swift')}
                        />
                      </div>
                    </>
                  )}

                  <Input
                    label="Account Name"
                    error={errors.bank_account_name?.message}
                    required
                    {...register('bank_account_name', {
                      required: hasUAEBank ? 'Required' : false,
                    })}
                  />
                </div>
              )}
            </div>
          </FormSection>

          {/* Other Information */}
          <FormSection
            title="Other Information"
            icon={<FileText className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <textarea
              className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 min-h-[100px]"
              placeholder="Any additional information you would like to provide..."
              {...register('other_information')}
            />
          </FormSection>
          {viewingStep === 7 && (
            <StepNavButtons enabled={isEducationComplete} onContinue={() => { setViewingStep(8); window.scrollTo({ top: 0 }); setTimeout(() => window.scrollTo({ top: 0 }), 300); }} onBack={() => setViewingStep(6)} label="Review & Sign" />
          )}
        </div>
      </RevealSection>

      {/* Step 8: Review & Sign */}
      <RevealSection
        show={viewingStep === 8}
        onReveal={() => scrollToRef(signatureRef)}
      >
        <div ref={signatureRef}>
          {!reuseEmployerSignature && (
            <FormSection
              title="Review & Sign"
              icon={<FileSignature className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
              stepNumber={displayedStepNumber(8)}
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  By signing below, I confirm that the information provided above is accurate and complete.
                </p>
                <SignaturePad
                  onSignatureChange={setSignature}
                  disabled={isSubmitting}
                  label="Employee Signature"
                />
                {signatureError && (
                  <p className="text-sm text-red-500">{signatureError}</p>
                )}
              </div>
            </FormSection>
          )}

          {reuseEmployerSignature && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: TME_COLORS.primary }}
                >
                  7
                </span>
                <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
                  Signature
                </h2>
              </div>
              <p className="text-sm text-blue-700">
                Your signature from the employer section will be used for both sections.
              </p>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end mt-6">
            <Button
              type="submit"
              loading={isSubmitting}
              size="lg"
            >
              {submission.onboarding_type === 'renewal' ? 'Submit Renewal Form' : 'Submit Onboarding Form'}
            </Button>
          </div>
        </div>
      </RevealSection>
    </form>
  );
}
