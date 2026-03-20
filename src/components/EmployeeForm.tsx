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
import type { EmployeeFormData, EmployeeFormProps, PassportPageReference } from '@/types';
import { uploadDocument, updateDocumentReferences, uploadPassportPage, PassportPageKey, getDocumentUrl, autoSaveEmployeeData } from '@/lib/supabase';
import { calculateFullName, compressImageForAI } from '@/lib/utils';
import { nationalityToCountryCode } from '@/lib/country-utils';
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
  'Family Details',
  'Address & Contact',
  'Education & More',
  'Review & Sign',
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
function StepProgress({
  currentStep,
  viewingStep,
  totalSteps,
  onStepClick,
}: {
  currentStep: number;
  viewingStep: number;
  totalSteps: number;
  onStepClick: (step: number) => void;
}) {
  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-sm mb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStepClick(Math.max(1, viewingStep - 1))}
            disabled={viewingStep <= 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: TME_COLORS.primary }}>
            Step {viewingStep} of {totalSteps}
          </span>
          <button
            type="button"
            onClick={() => onStepClick(Math.min(currentStep, viewingStep + 1))}
            disabled={viewingStep >= currentStep}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${TME_COLORS.primary}15`, color: TME_COLORS.primary }}>
          {STEP_LABELS[viewingStep - 1] || ''}
        </span>
      </div>
      {/* Clickable step dots */}
      <div className="flex items-center gap-1.5 mb-2">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => {
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
      // Delay scroll to allow animation to start
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

  // Passport upload UI state (preview, validating, error — separate from persisted data)
  const initCover = submission.documents?.passportPages?.cover;
  const initInside = submission.documents?.passportPages?.insidePages;
  const [coverUI, setCoverUI] = useState({
    preview: initCover?.path ? getDocumentUrl(initCover.path) : null as string | null,
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });
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
    register('passport_expiry');
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
  const passportNumber = watch('passport_number');
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

  // Compute the highest unlocked step (1-indexed, 8 steps total)
  const computeCurrentStep = useCallback(() => {
    if (!isPhotoUploaded) return 1;
    if (!isCoverUploaded) return 2;
    if (!isInsidePagesUploaded || !passportDataReady || !isPersonalComplete) return 3;
    if (requiresAdditionalPage && !isAdditionalPageUploaded) return 3;
    if (!isFamilyComplete) return 4;
    if (!isContactComplete) return 5;
    if (!isEducationComplete) return 6;
    return 7;
  }, [isPhotoUploaded, isCoverUploaded, isInsidePagesUploaded, isAdditionalPageUploaded, requiresAdditionalPage, passportDataReady, isPersonalComplete, isFamilyComplete, isContactComplete, isEducationComplete]);

  const currentStep = computeCurrentStep();
  const totalSteps = STEP_LABELS.length;
  const [viewingStep, setViewingStep] = useState(currentStep);

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

    // Validate all passport pages are uploaded
    const pagesUploaded = passportPages.cover && passportPages.insidePages;
    if (!pagesUploaded) {
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

  const handlePhotoUpload = async (file: File) => {
    const result = await uploadDocument(submission.id, 'photo', file);
    if (result) {
      const newDoc = { ...result, validated: false };
      setPhotoDoc(newDoc);
      photoDocRef.current = newDoc;
      setPhotoError(null);
      await updateDocumentReferences(submission.id, {
        photo: newDoc,
        passportPages: passportPagesRef.current,
      });
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
        // Skip passport_issue_date (no form field for it)
        if (key === 'passport_issue_date') return;
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
    await updateDocumentReferences(submission.id, { photo: photoDocRef.current, passportPages: updatedPages });
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
    await updateDocumentReferences(submission.id, { photo: photoDocRef.current, passportPages: updatedPages });

    // Extract passport data — show extracting state so user knows it's working
    setExtractingPassport(true);
    const extracted = await extractPassportData(preview);
    setExtractingPassport(false);
    if (extracted) {
      handlePassportExtracted(extracted);
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
    await updateDocumentReferences(submission.id, { photo: photoDocRef.current, passportPages: updatedPages });
  };

  const handleInsideRemove = async () => {
    setInsideUI({ preview: null, validating: false, error: null, file: null });
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.insidePages;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportDataReady(false);
    await updateDocumentReferences(submission.id, { photo: photoDocRef.current, passportPages: updatedPages });
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
    await updateDocumentReferences(submission.id, { photo: photoDocRef.current, passportPages: updatedPages });

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
    await updateDocumentReferences(submission.id, { photo: photoDocRef.current, passportPages: updatedPages });
  };

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
        totalSteps={totalSteps}
        onStepClick={setViewingStep}
      />

      {/* Step 1: Photo Upload */}
      <RevealSection show={viewingStep === 1 || viewingStep === 7}>
        <FormSection
          title="ID Photo"
          icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={1}
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
                await updateDocumentReferences(submission.id, {
                  photo: updatedDoc,
                  passportPages: passportPagesRef.current,
                });
              }
              if (photoError) setPhotoError(null);
            }}
            onRemove={async () => {
              setPhotoDoc(undefined);
              photoDocRef.current = undefined;
              await updateDocumentReferences(submission.id, {
                photo: undefined,
                passportPages: passportPagesRef.current,
              });
            }}
            error={photoError || undefined}
          />
          {isPhotoUploaded && viewingStep === 7 && (
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

      {/* Step 2: Passport Cover */}
      <RevealSection
        show={viewingStep === 2 || viewingStep === 7}
        onReveal={viewingStep !== 7 ? () => scrollToRef(passportCoverRef) : undefined}
      >
        <div ref={passportCoverRef}>
          <FormSection
            title="Passport Cover (OUTSIDE)"
            icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={2}
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
                onUpload={handleCoverUpload}
                onRemove={handleCoverRemove}
              />
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
        show={viewingStep === 3 || viewingStep === 7}
        onReveal={viewingStep !== 7 ? () => scrollToRef(passportInsideRef) : undefined}
      >
        <div ref={passportInsideRef} className="space-y-6">
          <FormSection
            title="Passport Data (INSIDE)"
            icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={3}
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
                onUpload={handleInsideUpload}
                onRemove={handleInsideRemove}
              />
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

          {/* Personal Details — merged into step 3 */}
          {passportDataReady && (
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

              <Input
                label="Full Name"
                value={calculateFullName(firstName || '', middleName, lastName || '')}
                disabled
                helperText="Auto-calculated from name fields"
              />

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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Passport Number"
                  placeholder="e.g. X12345678"
                  {...register('passport_number')}
                />
                <CustomDatePicker
                  label="Passport Expiry"
                  value={passportExpiry || ''}
                  onChange={(val) => setValue('passport_expiry', val)}
                  error={errors.passport_expiry?.message}
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
                  onUpload={handleAdditionalPageUpload}
                  onRemove={handleAdditionalPageRemove}
                />

                {isAdditionalPageUploaded && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    Additional page uploaded. Family details and address will be pre-filled.
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

      {/* Step 4: Family Details */}
      <RevealSection
        show={viewingStep === 4 || viewingStep === 7}
        onReveal={viewingStep !== 7 ? () => scrollToRef(familyRef) : undefined}
      >
        <div ref={familyRef}>
          <FormSection
            title="Family Details"
            icon={<Users className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={4}
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
            {viewingStep === 4 && (
              <StepNavButtons enabled={isFamilyComplete} onContinue={() => setViewingStep(5)} onBack={() => setViewingStep(3)} />
            )}
          </FormSection>
        </div>
      </RevealSection>

      {/* Step 5: Address & Contact */}
      <RevealSection
        show={viewingStep === 5 || viewingStep === 7}
        onReveal={viewingStep !== 7 ? () => scrollToRef(contactRef) : undefined}
      >
        <div ref={contactRef} className="space-y-6">
          {/* Home Country Address */}
          <FormSection
            title="Home Country Address"
            icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={5}
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
                      label="City"
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
          {viewingStep === 5 && (
            <StepNavButtons enabled={isContactComplete} onContinue={() => setViewingStep(6)} onBack={() => setViewingStep(4)} />
          )}
        </div>
      </RevealSection>

      {/* Step 6: Education & More */}
      <RevealSection
        show={viewingStep === 6 || viewingStep === 7}
        onReveal={viewingStep !== 7 ? () => scrollToRef(educationRef) : undefined}
      >
        <div ref={educationRef} className="space-y-6">
          {/* Education & Languages */}
          <FormSection
            title="Education & Languages"
            icon={<GraduationCap className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={6}
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
            </div>
          </FormSection>

          {/* Bank Details */}
          <FormSection
            title="Bank Details"
            icon={<Building2 className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <div className="space-y-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...register('has_uae_bank')}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">I have a bank account</span>
              </label>

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
          <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm">
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: TME_COLORS.primary }}
            >
              Other Information
            </label>
            <textarea
              className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 min-h-[100px]"
              placeholder="Any additional information you would like to provide..."
              {...register('other_information')}
            />
          </div>
          {viewingStep === 6 && (
            <StepNavButtons enabled={isEducationComplete} onContinue={() => setViewingStep(7)} onBack={() => setViewingStep(5)} label="Review & Sign" />
          )}
        </div>
      </RevealSection>

      {/* Step 7: Review & Sign */}
      <RevealSection
        show={viewingStep === 7}
        onReveal={() => scrollToRef(signatureRef)}
      >
        <div ref={signatureRef}>
          {!reuseEmployerSignature && (
            <FormSection
              title="Review & Sign"
              icon={<FileSignature className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
              stepNumber={7}
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
              Submit Onboarding Form
            </Button>
          </div>
        </div>
      </RevealSection>
    </form>
  );
}
