'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TME_COLORS,
  TITLES,
  NATIONALITIES,
  RELIGIONS,
  MARITAL_STATUS_OPTIONS,
  EDUCATIONAL_QUALIFICATIONS,
  DET_DEGREE_YEAR_MIN,
  DET_DEGREE_ACTUAL_YEARS_MAX,
  LANGUAGES,
  UAE_EMIRATES,
} from '@/lib/constants';
import {
  lookupBankFromIban,
  isUaeIban,
  validateIbanFormat,
  getBankNameOptions,
  findBanksByName,
  routingIbanBankMismatch,
  bankCodeFromRouting,
  ibanBankCode,
  INTERNATIONAL_BANK_LABEL,
} from '@/lib/uae-bank-directory';
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
  passportAdditionalPageVariant as getPassportAdditionalPageVariant,
  isDetAuthority,
  visaDocumentRequirement,
  requiresArrivalDate,
  shouldOfferManualReview,
  buildManualReviewPageRef,
  sponsorDocsRequired,
  employeeVisaMandatoryOverride,
  sponsorshipTypeFromSponsor,
  relationshipOptionsForSponsor,
  initialIsInUae,
} from '@/lib/staff-form-logic';
import { buildNocText } from '@/lib/noc-letter';
import { uploadDocument, updateDocumentReferences, uploadPassportPage, PassportPageKey, getDocumentUrl, autoSaveEmployeeData } from '@/lib/supabase';
import { calculateFullName, compressImageForAI, normalizePersonName } from '@/lib/utils';
import { singlePagePdfError } from '@/lib/single-page-pdf';
import { useIsMobile } from '@/lib/useIsMobile';
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
  Phone,
  ShieldCheck,
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
// Internal step indices are stable (1..8 = array positions 0..7). The
// family-sponsored "Sponsor Documents & NOC" step is internal index 9
// (array position 8) — appended here so the existing 1..8 literals never
// shift. `visibleStepIndices` appends it as the VERY LAST display step
// (after Review & Sign) for family-sponsored applicants.
const STEP_LABELS = [
  'ID Photo',
  'Passport OUTSIDE',
  'Passport INSIDE',
  'Identity & Visa Documents',
  'Family Details',
  'Address & Contact',
  'Education & More',
  'Review & Sign',
  'Sponsor Documents & NOC',
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

// Bank options for the "UAE IBAN not in directory" fallback dropdown. The
// international label is excluded here: this branch only fires for a valid UAE
// IBAN, so the bank is a UAE one we simply don't have listed yet.
const UAE_BANK_PICK_OPTIONS = getBankNameOptions().filter(
  (o) => o.value !== INTERNATIONAL_BANK_LABEL
);

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
          // Compare by DISPLAY position, not raw internal index. The sponsor
          // step is internal index 9 appended LAST for family-sponsored
          // applicants (order [1,2,3,4,5,6,7,8,9]); comparing by display
          // position keeps the dot colouring/gating robust regardless of how
          // the internal indices map onto display order.
          const pos = visibleStepIndices.indexOf(step);
          const currentPos = visibleStepIndices.indexOf(currentStep);
          const isCompleted = currentPos >= 0 ? pos < currentPos : step < currentStep;
          const isCurrent = step === currentStep;
          const isViewing = step === viewingStep;
          const isClickable = currentPos >= 0 ? pos <= currentPos : step <= currentStep;
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
  // Token from the URL (`/onboard/<id>?token=...`). The seven AI extract /
  // validate routes require this — we attach it to every fetch body below.
  // It also gates `/api/onboarding/<id>/autosave` and `/documents` (P0-3),
  // which now back the autosave + document-refs writes that used to hit
  // anon Supabase directly.
  const aiToken = useSearchParams().get('token');
  // Drives device-specific upload copy: on mobile we accept scanned PDFs only
  // (camera disabled); on desktop, PDF or JPEG. Never show the mobile camera
  // wording on desktop.
  const isMobile = useIsMobile();
  // Pre-bound wrappers so the 30+ callsites below stay terse and don't have
  // to thread submission.id + aiToken through every line.
  const submissionId = submission.id;
  const saveDocRefs = useCallback(
    (docs: import('@/types').StaffDocumentReferences) =>
      updateDocumentReferences(submissionId, docs, aiToken),
    [submissionId, aiToken],
  );
  const autoSave = useCallback(
    (data: Partial<EmployeeFormData>) =>
      autoSaveEmployeeData(submissionId, data, aiToken),
    [submissionId, aiToken],
  );
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
  // Family-sponsored variant — drives the sponsor step + NOC + mandatory
  // applicant Visa/EID. Derive the gate from the employer's FINAL sponsor pick
  // (employer_data.sponsor) so the flow reacts to whatever the employer chose;
  // employer_data is populated by the time the employee section runs. Fall back
  // to the prefilled sponsorship_type column, then 'company', when absent.
  const effectiveSponsor = (submission.employer_data as Record<string, unknown> | null)?.sponsor as string | undefined;
  const sponsorshipType = effectiveSponsor
    ? sponsorshipTypeFromSponsor(effectiveSponsor)
    : (submission.sponsorship_type ?? 'company');
  const isFamilySponsored = sponsorDocsRequired(sponsorshipType);
  const existingDocs = submission.existing_documents;
  // The "passport unchanged" skip is only legitimate when BOTH pages are
  // actually on file — with only one of them, confirming "same as shown"
  // would attest a page TME never had (this let a renewal complete with no
  // cover page anywhere). Entries need a displayable URL; the metadata-only
  // photo entry (sha256, no path) never counts.
  const hasExistingPassport = !!(
    existingDocs?.passport_cover?.path && existingDocs?.passport_inside?.path
  );
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
  //
  // Default priority (first hit wins):
  //   1. Previously-saved employee answer
  //   2. Any existing EID/previous-visa upload on the submission → Yes
  //   3. Employer answered "applicant currently in UAE" → Yes (auto-default;
  //      the employee can still flip to No, in which case we surface a warning)
  //   4. Otherwise null (must answer)
  const employerSaysInUae = submission.employer_data?.applicant_in_uae === true;
  const savedHasPreviousUaeDocs =
    submission.employee_data?.has_previous_eid ??
    (!!submission.documents?.eid_front || !!submission.documents?.previous_visa_document ? true : undefined) ??
    (employerSaysInUae ? true : undefined);
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

  // If we defaulted hasPreviousUaeDocs above (e.g. from the employer's
  // in-UAE flag) and the user hasn't explicitly answered yet, push that
  // initial value into the form state so the submitted answer matches
  // the displayed radio. Subsequent clicks call setValue directly.
  // Also: on renewal force uae_presence to 'inside' (employee MUST be in
  // UAE for a renewal — the toggle is hidden in the JSX below).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (hasPreviousUaeDocs !== null && submission.employee_data?.has_previous_eid === undefined) {
      setValue('has_previous_eid', hasPreviousUaeDocs);
    }
    if (submission.onboarding_type === 'renewal') {
      setValue('uae_presence', 'inside');
    }
  }, []);

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

  // Sponsor identity documents (family-sponsored only). Upload-only — no AI
  // extraction (the applicant extract routes write into the dependent's own
  // identity fields, so pointing them at sponsor docs would corrupt the data).
  const [sponsorPassportDoc, setSponsorPassportDoc] = useState(submission.documents?.sponsor_passport);
  const [sponsorVisaDoc, setSponsorVisaDoc] = useState(submission.documents?.sponsor_visa);
  const [sponsorEidFrontDoc, setSponsorEidFrontDoc] = useState(submission.documents?.sponsor_eid_front);
  const [sponsorEidBackDoc, setSponsorEidBackDoc] = useState(submission.documents?.sponsor_eid_back);
  const [sponsorPassportUI, setSponsorPassportUI] = useState({
    preview: submission.documents?.sponsor_passport?.path ? getDocumentUrl(submission.documents.sponsor_passport.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const [sponsorVisaUI, setSponsorVisaUI] = useState({
    preview: submission.documents?.sponsor_visa?.path ? getDocumentUrl(submission.documents.sponsor_visa.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const [sponsorEidFrontUI, setSponsorEidFrontUI] = useState({
    preview: submission.documents?.sponsor_eid_front?.path ? getDocumentUrl(submission.documents.sponsor_eid_front.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const [sponsorEidBackUI, setSponsorEidBackUI] = useState({
    preview: submission.documents?.sponsor_eid_back?.path ? getDocumentUrl(submission.documents.sponsor_eid_back.path) : null as string | null,
    validating: false, error: null as string | null, file: null as File | null,
  });
  const sponsorPassportDocRef = React.useRef(sponsorPassportDoc);
  const sponsorVisaDocRef = React.useRef(sponsorVisaDoc);
  const sponsorEidFrontDocRef = React.useRef(sponsorEidFrontDoc);
  const sponsorEidBackDocRef = React.useRef(sponsorEidBackDoc);
  React.useEffect(() => { sponsorPassportDocRef.current = sponsorPassportDoc; }, [sponsorPassportDoc]);
  React.useEffect(() => { sponsorVisaDocRef.current = sponsorVisaDoc; }, [sponsorVisaDoc]);
  React.useEffect(() => { sponsorEidFrontDocRef.current = sponsorEidFrontDoc; }, [sponsorEidFrontDoc]);
  React.useEffect(() => { sponsorEidBackDocRef.current = sponsorEidBackDoc; }, [sponsorEidBackDoc]);

  // Sponsor NOC signature — INDEPENDENT of the employee/employer signature
  // (never reused, even in same-person mode). On renewal we force a fresh
  // signature by initializing to null even though sponsor metadata is
  // prefilled. Stored into the form via setValue('sponsor_noc_signature') so
  // it travels inside employeeData to the submit handler.
  const [sponsorSignature, setSponsorSignature] = useState<string | null>(null);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const sponsorSignatureRef = React.useRef(sponsorSignature);
  React.useEffect(() => { sponsorSignatureRef.current = sponsorSignature; }, [sponsorSignature]);

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

  // Manual-review fallback: after MANUAL_REVIEW_THRESHOLD consecutive AI
  // page-type rejections on a passport step, surface a confirmation-gated
  // "submit for manual review" affordance. Counters reset on remove or
  // successful upload. State is intentionally client-side only — a fresh
  // session starts the user back at zero, which is what we want.
  // Threshold + helpers live in @/lib/staff-form-logic so they can be
  // unit-tested without mounting this component.
  const [coverRejectionCount, setCoverRejectionCount] = useState(0);
  const [insideRejectionCount, setInsideRejectionCount] = useState(0);
  const [coverManualReviewConfirmed, setCoverManualReviewConfirmed] = useState(false);
  const [insideManualReviewConfirmed, setInsideManualReviewConfirmed] = useState(false);
  // Separate "submitting via manual-review" flags so the slot's
  // "Validating..." badge stays off during this path. Reusing
  // coverUI.validating for both AI checks AND manual-review uploads
  // produced confusing UX where the user saw "Submitting..." on the
  // button AND "Validating..." in the corner at the same time.
  const [coverManualReviewSubmitting, setCoverManualReviewSubmitting] = useState(false);
  const [insideManualReviewSubmitting, setInsideManualReviewSubmitting] = useState(false);
  // Additional-page (Indian passport) gets the same manual-review escape
  // hatch as cover/inside: 2 AI rejections → amber affordance → user
  // confirms + submits → page stamped needsReview, TME verifies later.
  const [additionalRejectionCount, setAdditionalRejectionCount] = useState(0);
  const [additionalManualReviewConfirmed, setAdditionalManualReviewConfirmed] = useState(false);
  const [additionalManualReviewSubmitting, setAdditionalManualReviewSubmitting] = useState(false);
  // Sponsor docs (family-sponsored) get the same 2-strike manual-review
  // escape hatch as the applicant passport pages: 2 AI rejections → amber
  // affordance → user confirms + submits → doc stamped needsReview, TME
  // verifies later on the portal side. Four independent counters (passport /
  // visa / EID front / EID back) so a failure on one doesn't unlock another.
  const [sponsorPassportRejectionCount, setSponsorPassportRejectionCount] = useState(0);
  const [sponsorPassportManualReviewConfirmed, setSponsorPassportManualReviewConfirmed] = useState(false);
  const [sponsorPassportManualReviewSubmitting, setSponsorPassportManualReviewSubmitting] = useState(false);
  const [sponsorVisaRejectionCount, setSponsorVisaRejectionCount] = useState(0);
  const [sponsorVisaManualReviewConfirmed, setSponsorVisaManualReviewConfirmed] = useState(false);
  const [sponsorVisaManualReviewSubmitting, setSponsorVisaManualReviewSubmitting] = useState(false);
  const [sponsorEidFrontRejectionCount, setSponsorEidFrontRejectionCount] = useState(0);
  const [sponsorEidFrontManualReviewConfirmed, setSponsorEidFrontManualReviewConfirmed] = useState(false);
  const [sponsorEidFrontManualReviewSubmitting, setSponsorEidFrontManualReviewSubmitting] = useState(false);
  const [sponsorEidBackRejectionCount, setSponsorEidBackRejectionCount] = useState(0);
  const [sponsorEidBackManualReviewConfirmed, setSponsorEidBackManualReviewConfirmed] = useState(false);
  const [sponsorEidBackManualReviewSubmitting, setSponsorEidBackManualReviewSubmitting] = useState(false);
  // ID photo gets the same 2-strike manual-review escape hatch. The photo is
  // already uploaded when validation fails (upload + AI run in parallel), so
  // the manual-review submit just re-stamps the stored doc ref — validated
  // (unblocks the form) + needsReview (TME verifies on the portal side).
  const [photoRejectionCount, setPhotoRejectionCount] = useState(0);
  const [photoManualReviewConfirmed, setPhotoManualReviewConfirmed] = useState(false);
  const [photoManualReviewSubmitting, setPhotoManualReviewSubmitting] = useState(false);

  // Refs to track latest values (avoids stale closure issues in callbacks)
  const photoDocRef = React.useRef(photoDoc);
  // Whether the vision comparison judged the CURRENT photo upload to be the
  // same capture as the photo on file (renewals). Consumed by the
  // manual-review submit to stamp samePhotoSuspected on the stored doc ref.
  const photoSamePhotoRef = React.useRef(false);
  const passportPagesRef = React.useRef(passportPages);
  // Persisted "passport unchanged" attestation (renewal skip). Lives in a ref
  // (not just component state) because buildDocRefs merges from the INITIAL
  // submission.documents — without threading it through every save, a later
  // saveDocRefs call would silently drop the flag.
  const passportUnchangedRef = React.useRef<boolean | undefined>(
    submission.documents?.passport_unchanged
  );

  // Section refs for auto-scrolling
  const passportCoverRef = useRef<HTMLDivElement>(null);
  const passportInsideRef = useRef<HTMLDivElement>(null);
  const identityDocsRef = useRef<HTMLDivElement>(null);
  const familyRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const educationRef = useRef<HTMLDivElement>(null);
  const sponsorRef = useRef<HTMLDivElement>(null);
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
    register('det_university_name');
    register('det_faculty');
    register('det_study_majors');
    register('det_degree_start_date');
    register('det_degree_end_date');
    register('det_graduation_year');
    register('det_actual_years_of_degree');
    // Family-sponsored sponsor metadata + dependent snapshot + NOC signature.
    register('sponsor_name');
    register('sponsor_nationality');
    register('sponsor_passport_number');
    register('sponsor_mobile');
    register('sponsor_relationship');
    register('dependent_name');
    register('dependent_nationality');
    register('dependent_passport_number');
    register('sponsor_noc_signature');
    register('sponsor_noc_signed_at');
  }, [register]);

  const title = watch('title');
  const nationality = watch('nationality');
  const religion = watch('religion');
  const maritalStatus = watch('marital_status');
  const educationalQualification = watch('educational_qualification');
  const sameEmails = watch('same_emails');
  const hasUAEBank = watch('has_uae_bank');
  const bankIban = watch('bank_iban');
  const bankName = watch('bank_name');
  const bankRoutingCode = watch('bank_routing_code');
  const firstName = watch('first_name');
  const middleName = watch('middle_name');
  const lastName = watch('last_name');
  const languagesSpoken = watch('languages_spoken') || [];
  const otherNationality = watch('other_nationality');
  const previousNationality = watch('previous_nationality');
  const mobileUae = watch('mobile_uae');
  const mobileUaeUnavailable = watch('mobile_uae_unavailable') === true;
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
  // Family-sponsored staff always carry an existing residence visa + EID held
  // by their sponsor, so TME needs both on file regardless of the visa
  // category's normal requirement (and regardless of the employer's in-UAE
  // answer). The override forces the visa picker + visa doc + EID mandatory.
  const forceVisaMandatory = employeeVisaMandatoryOverride(sponsorshipType);
  // On renewal the employee already holds the employment visa being renewed, so
  // the "current visa status" picker is redundant and must NOT appear — without
  // the `!isRenewal` guard the employer's locked in-UAE answer (always true on
  // renewal) would resurface it. Family-sponsored renewals still force it (they
  // carry a sponsor-held residence visa TME needs on file → forceVisaMandatory).
  const showVisaCategoryPicker = (!isRenewal && employerVisaInUAE) || forceVisaMandatory;
  const showArrivalDatePicker = showVisaCategoryPicker && requiresArrivalDate(employeeVisaCategory);
  const showVisaDocumentUpload = (showVisaCategoryPicker && visaUploadRule !== 'none') || forceVisaMandatory;
  const visaDocumentRequired = (showVisaCategoryPicker && visaUploadRule === 'mandatory') || forceVisaMandatory;
  const passportNumber = watch('passport_number');
  const passportIssueDate = watch('passport_issue_date');
  const passportExpiry = watch('passport_expiry');
  const placeOfIssue = watch('place_of_issue');
  const gender = watch('gender');

  // Family-sponsored sponsor metadata (NOC merge fields).
  const sponsorName = watch('sponsor_name');
  const sponsorNationality = watch('sponsor_nationality');
  const sponsorPassportNumber = watch('sponsor_passport_number');
  const sponsorMobile = watch('sponsor_mobile');
  const sponsorRelationship = watch('sponsor_relationship') as 'husband' | 'wife' | 'father' | 'mother' | 'son' | 'daughter' | undefined;
  const fullName = watch('full_name');

  // Narrow the NOC "Relationship to You" options by the employer's sponsor pick
  // (Spouse -> husband/wife, Parent -> father/mother, Child -> son/daughter;
  // anything else -> all six). Mapped to {value,label} for the dropdown.
  const RELATIONSHIP_LABELS: Record<'husband' | 'wife' | 'father' | 'mother' | 'son' | 'daughter', string> = {
    husband: 'Husband',
    wife: 'Wife',
    father: 'Father',
    mother: 'Mother',
    son: 'Son',
    daughter: 'Daughter',
  };
  const narrowedRelationships = relationshipOptionsForSponsor(effectiveSponsor);
  const relationshipOptions = narrowedRelationships.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }));
  // Stable key for the narrowed set so the effects below only re-run when the
  // allowed options actually change (not on every render).
  const narrowedRelationshipsKey = narrowedRelationships.join(',');

  // One-time-per-narrowed-set guard: if a stale sponsor_relationship sits
  // outside the now-allowed options (e.g. the employer flipped Spouse -> Parent
  // after a value was picked), clear it so it can't silently persist. Then, for
  // Spouse only, pre-select the gender-appropriate option from the employee's
  // own gender (female -> husband, male -> wife) when the field is empty —
  // never overwrites an existing user choice.
  React.useEffect(() => {
    if (sponsorRelationship && !narrowedRelationships.includes(sponsorRelationship)) {
      setValue('sponsor_relationship', undefined);
      return;
    }
    if (!sponsorRelationship && effectiveSponsor === 'Spouse') {
      if (gender === 'female') setValue('sponsor_relationship', 'husband');
      else if (gender === 'male') setValue('sponsor_relationship', 'wife');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrowedRelationshipsKey, effectiveSponsor, gender]);

  // DET (Department of Economy & Tourism, Dubai mainland) requires extra
  // education fields. Authority comes from the portal via prefill_employer_data
  // (already set by /api/clients-v2/staff/onboarding). Mirrors the DMCC pattern
  // used in EmployerForm.tsx for the Job Offer Letter slot.
  const registeredAuthority = (submission.prefill_employer_data as Record<string, unknown> | null)?.registered_authority as string | undefined;
  const isDET = isDetAuthority(registeredAuthority);

  // STL lock: when the portal has issued a Salary Transfer Letter for this
  // staff member, bank details are managed by TME and the employee may NOT edit
  // them here. The portal sets `bank_locked` in the employee prefill; we hide
  // the entire Bank Details step when it's set (existing bank values still flow
  // through unchanged via prefill, and the portal ignores any bank edits on
  // sync-back as a backstop).
  const bankLocked = Boolean(
    (submission.prefill_employee_data as Record<string, unknown> | null)?.bank_locked
  );

  // NOC merge values (family-sponsored). Company name + job title come from
  // the employer data: prefer the company-name field from prefill, falling
  // back to working location / authority; the job title is the employer's
  // visa job title (filled in the employer step that precedes this one, or
  // prefilled on renewal). Read like registeredAuthority above.
  const prefillEmployer = (submission.prefill_employer_data as Record<string, unknown> | null) || {};
  const nocCompanyName =
    (prefillEmployer.company_name as string | undefined) ||
    (prefillEmployer.working_location as string | undefined) ||
    registeredAuthority ||
    '';
  const employerJobTitleVisa =
    submission.employer_data?.job_title_visa === 'Other'
      ? submission.employer_data?.job_title_visa_custom
      : submission.employer_data?.job_title_visa;
  const nocJobTitle =
    employerJobTitleVisa ||
    (prefillEmployer.job_title_visa as string | undefined) ||
    '';

  // DET extended education fields (only relevant when isDET is true).
  // Degree type is captured via the unified Educational Qualification
  // dropdown — no separate field here.
  const detUniversityName = watch('det_university_name');
  const detFaculty = watch('det_faculty');
  const detStudyMajors = watch('det_study_majors');
  const detDegreeStartDate = watch('det_degree_start_date');
  const detDegreeEndDate = watch('det_degree_end_date');
  const detGraduationYear = watch('det_graduation_year');
  const detActualYearsOfDegree = watch('det_actual_years_of_degree');

  // DET extended fields are only collected when the user has a degree-level
  // qualification (anything past high-school/vocational). Primary, Secondary,
  // and Vocational don't have university/faculty/etc. — the DET form skips
  // them too. Keep this list aligned with EDUCATIONAL_QUALIFICATIONS.
  const isDegreeLevelQualification = !!(
    educationalQualification &&
    !['Primary School', 'Secondary School / High School', 'Vocational Certificate'].includes(educationalQualification)
  );
  const showDetExtendedBlock = isDET && isDegreeLevelQualification;

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
        // Bank not in directory: clear any routing code derived from a
        // previously-entered (recognized) IBAN so it can't silently mismatch
        // this one. bank_name/bank_swift stay editable for manual entry.
        setValue('bank_routing_code', '');
      }
    } else if (/^[A-Z]{2}/.test(clean) && !clean.startsWith('AE')) {
      // International IBAN — no UAE routing code applies; clear any stale one.
      setBankLookupResult({ found: false, isUae: false, isInternational: true });
      setValue('bank_routing_code', '');
    } else {
      setBankLookupResult(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankIban]);

  // Picking a bank from the fallback dropdown (UAE IBAN not in directory) fills
  // SWIFT + routing from the directory. If the picked bank's routing doesn't
  // match the IBAN's bank, the mismatch warning below flags it for the employee.
  const handleUnrecognizedBankPick = (name: string) => {
    setValue('bank_name', name, { shouldValidate: true });
    const matches = findBanksByName(name);
    if (matches.length === 1) {
      setValue('bank_swift', matches[0].swift11);
      setValue('bank_routing_code', matches[0].routingCode);
    }
    // Ambiguous multi-entity banks (e.g. First Abu Dhabi Bank): leave SWIFT and
    // routing blank rather than guessing the wrong entity.
  };

  // New checkbox states for nationality and address
  const [hasOtherNationality, setHasOtherNationality] = useState(
    !!submission.employee_data?.other_nationality
  );
  const [hasPreviousNationality, setHasPreviousNationality] = useState(
    !!submission.employee_data?.previous_nationality
  );
  // On renewal, the employee MUST be inside the UAE — the toggle is hidden
  // below and UAE address fields are always shown. Init to true regardless
  // of any prior saved value so the form state matches the locked UI.
  // For new-hires: prefer the employee's saved answer; fall back to the
  // employer's "applicant in the UAE" answer so the box arrives pre-checked
  // (the employee can still uncheck it).
  const [isInUAE, setIsInUAE] = useState(() => initialIsInUae(submission, isRenewal));

  // Sync the submitted `uae_presence` value to the checkbox's initial state.
  // The form default is 'inside', so without this an applicant abroad who
  // never touched the (unchecked) checkbox submitted 'inside' with no UAE
  // address — the checkbox onChange is the only other place that sets it.
  // The isInUAE initializer above already respects any saved answer, and
  // renewals are forced to 'inside' by the earlier mount effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!isRenewal) {
      setValue('uae_presence', isInUAE ? 'inside' : 'outside');
    }
  }, []);

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
  // 'india' | 'syria' | null — which additional-page flavour this passport
  // needs (copy, sample image, AI prompt, and extraction all key off it).
  const additionalPageVariant = getPassportAdditionalPageVariant(nationality);
  const isPakistaniNationality = checkPakistaniNationality(nationality);
  const requiresAdditionalPage = !!additionalPageVariant && isInsidePagesUploaded && passportDataReady;
  // Variant-specific copy for the additional-page section. India: last page
  // with family details + address (auto-extracted into the form). Syria: the
  // issue-details page next to the photo page (date/place of issue, national
  // number) — no extraction, parents' names are on the Syrian data page.
  const additionalPageCopy = additionalPageVariant === 'syria'
    ? {
        title: 'Syrian Passport — Additional Page',
        heading: 'Upload the additional page of your Syrian passport',
        sub: 'This is the page next to your photo page showing the date and place of issue, expiry date, and national number. The issue and expiry dates will be automatically extracted.',
        sampleSrc: '/samples/passport-additional-syria-example.png',
        sampleAlt: 'Example Syrian passport additional page',
        slotDescription: 'Page with date/place of issue and national number',
        successNote: 'Additional page uploaded. Passport issue and expiry dates will be pre-filled.',
        manualNoun: 'Syrian passport additional page (issue details / national number)',
      }
    : {
        title: 'Indian Passport — Additional Page',
        heading: 'Upload the last page of your Indian passport',
        sub: 'This page contains your parents’ names, spouse name, and address. These details will be automatically extracted.',
        sampleSrc: '/samples/passport-additional-example.png',
        sampleAlt: 'Example Indian passport additional page',
        slotDescription: 'Last page with parents’ names and address',
        successNote: 'Additional page uploaded. Family details and address will be pre-filled.',
        manualNoun: 'Indian passport additional page (address / family details)',
      };
  const isPersonalComplete = !!(firstName && lastName && nationality);
  const isFamilyComplete = !!(fatherFullName && motherFullName && religion && maritalStatus);
  // UAE mobile requires an EXPLICIT answer from everyone, inside or outside
  // the UAE: either a number, or the `mobile_uae_unavailable` tick ("I don't
  // have an active UAE mobile number yet"). A blank field must never be
  // ambiguous — the portal's ICP mobile tracker (company number used at EID
  // typing) depends on knowing whether the applicant truly has no number.
  const isContactComplete = !!(
    homeStreetAddress && homeCity && homeCountry && personalEmail &&
    (mobileUae || mobileUaeUnavailable)
  );
  const educationalQualificationCustom = watch('educational_qualification_custom');
  // DET extended fields are only required when the DET block is actually
  // shown (DET client + degree-level qualification). For non-degree levels
  // the block is hidden, so those fields stay optional.
  const isDetEducationComplete = !showDetExtendedBlock || !!(
    detUniversityName &&
    detFaculty &&
    detStudyMajors &&
    detDegreeStartDate &&
    detDegreeEndDate &&
    detGraduationYear &&
    detActualYearsOfDegree
  );
  const isEducationComplete = !!(
    educationalQualification &&
    (educationalQualification !== 'Other' || educationalQualificationCustom) &&
    languagesSpoken.length > 0 &&
    isDetEducationComplete
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
  // new-hire onboarding. Uploads themselves are optional. Family-sponsored
  // applicants always hold an existing residence visa and the previous-docs
  // Yes/No UI is hidden for them (its EID upload is replaced by the dedicated
  // mandatory family EID block below), so treat the answer as satisfied —
  // otherwise a family new-hire whose employer didn't flag applicant_in_uae
  // would be soft-locked at step 4 with no UI to answer.
  const isPreviousUaeDocsAnswered = isRenewal || isFamilySponsored || hasPreviousUaeDocs !== null;
  // Family-sponsored applicants MUST upload their own Visa + EID (front + back)
  // — the override forces the visa doc mandatory above; here we add the EID
  // requirement. This branch is keyed on isFamilySponsored (not !isRenewal) so
  // it applies on renewal too.
  const isFamilyApplicantEidComplete =
    !isFamilySponsored || !!(eidFrontDoc?.validated && eidBackDoc?.validated);
  const isStep4Complete =
    isVisaSectionComplete && isPreviousUaeDocsAnswered && isFamilyApplicantEidComplete;

  // Sponsor step (internal index 9) completion gate. Requires the sponsor
  // metadata, all four sponsor docs, and a fresh NOC signature. No-op (always
  // complete) for non-family flows.
  const isSponsorMetadataComplete = !!(
    sponsorName && sponsorNationality && sponsorPassportNumber && sponsorMobile && sponsorRelationship
  );
  const isSponsorDocsComplete = !!(
    sponsorPassportDoc && sponsorVisaDoc && sponsorEidFrontDoc && sponsorEidBackDoc
  );
  const isSponsorStepComplete =
    !isFamilySponsored ||
    (isSponsorMetadataComplete && isSponsorDocsComplete && !!sponsorSignature);

  // Compute the highest unlocked step. Internal indices are stable (1..8);
  // the family-sponsored sponsor step is internal index 9 and is gated as the
  // VERY LAST step — it only unlocks after the employee has reviewed and
  // signed at step 8 (Review & Sign). Non-family flows end at step 8.
  const isEmployeeSigned = !!signature || reuseEmployerSignature;
  const computeCurrentStep = useCallback(() => {
    if (!isPhotoUploaded) return 1;
    if (!isCoverUploaded) return 2;
    if (!isInsidePagesUploaded || !passportDataReady || !isPersonalComplete) return 3;
    if (requiresAdditionalPage && !isAdditionalPageUploaded) return 3;
    if (!isStep4Complete) return 4;
    if (!isFamilyComplete) return 5;
    if (!isContactComplete) return 6;
    if (!isEducationComplete) return 7;
    // Steps 1-7 done. For family-sponsored applicants the sponsor step (9) is
    // the final step but only after the employee has signed at review (8):
    // not yet signed → stay on 8; signed but sponsor step incomplete → 9.
    if (isFamilySponsored && isEmployeeSigned && !isSponsorStepComplete) return 9;
    return 8;
  }, [isPhotoUploaded, isCoverUploaded, isInsidePagesUploaded, isAdditionalPageUploaded, requiresAdditionalPage, passportDataReady, isPersonalComplete, isStep4Complete, isFamilyComplete, isFamilySponsored, isEmployeeSigned, isSponsorStepComplete, isContactComplete, isEducationComplete]);

  const currentStep = computeCurrentStep();

  // Step 4 ("Identity & Visa Documents") has two sub-sections:
  //   - UAE Visa Status picker — only shown when the employer answered
  //     "Yes, applicant is in the UAE" (new-hire only).
  //   - Previous UAE Visa + Emirates ID — new-hire only.
  // On renewal where the employer didn't enable the visa picker, both are
  // gone and step 4 has no UI at all. Drop it from the indicator so the
  // user doesn't land on a blank screen.
  // For family-sponsored staff, showVisaCategoryPicker is forced true (the
  // visa-mandatory override), so step 4 is never empty — they always take the
  // non-empty branch. The sponsor step (internal index 9) is the VERY LAST
  // step in DISPLAY order — appended after Review & Sign (8) — so the sponsor
  // signs the NOC after the employee has reviewed and signed. StepProgress +
  // displayedStepNumber derive the "Step X of Y" numbering from this array's
  // positions automatically.
  const isStep4Empty = !showVisaCategoryPicker && isRenewal;
  const baseStepIndices = isStep4Empty
    ? [1, 2, 3, 5, 6, 7, 8]
    : [1, 2, 3, 4, 5, 6, 7, 8];
  const visibleStepIndices = isFamilySponsored
    ? [...baseStepIndices, 9]
    : baseStepIndices;

  // Map an internal step number to its displayed position (1..N) so the
  // FormSection badges and the "Step X of Y" header match the dot row.
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

  // Scroll to top of page on every step transition (Continue / Back / arrows)
  // so the user always lands on the "Staff Onboarding" header instead of
  // somewhere mid-section.
  //
  // Why this is more involved than `window.scrollTo`:
  //   1. The Continue button has focus when clicked. After the step
  //      transition, the browser tries to keep the focused element in
  //      view — even after our scrollTo — and the new step's Continue
  //      button typically lives at the BOTTOM of the new content, so
  //      the page snaps to the bottom. Blurring the active element
  //      removes that anchor BEFORE we scroll.
  //   2. A single synchronous scrollTo gets undone by late layout
  //      shifts when the next step's heavy sections mount. We re-fire
  //      in rAF and at +100ms / +300ms so any late shift gets corrected.
  //   3. Some browsers route window.scrollTo to a different scrolling
  //      element. We also write to documentElement/body directly.
  //   4. Instant (no `behavior: 'smooth'`) so the scroll can't be
  //      interrupted mid-animation.
  useEffect(() => {
    if (document.activeElement && 'blur' in document.activeElement) {
      (document.activeElement as HTMLElement).blur();
    }
    const scrollTop = () => {
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    scrollTop();
    const raf = requestAnimationFrame(scrollTop);
    const t1 = setTimeout(scrollTop, 100);
    const t2 = setTimeout(scrollTop, 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [viewingStep]);

  // No auto-advance — user controls navigation via "Continue" button or arrows

  // Auto-save form data when step advances (persists across refresh)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Debounce auto-save to avoid excessive writes
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (currentStep > 2) {
        autoSave(getValues());
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

  // Family-sponsored: seed the read-only dependent_* fields from the
  // applicant's OWN extracted passport so they snapshot into the payload
  // alongside the sponsor merge fields. One-time per source value — never
  // overwrites a value the user has already (e.g. via prefill) edited.
  React.useEffect(() => {
    if (!isFamilySponsored) return;
    if (fullName && !getValues('dependent_name')) setValue('dependent_name', fullName);
    if (nationality && !getValues('dependent_nationality')) setValue('dependent_nationality', nationality);
    if (passportNumber && !getValues('dependent_passport_number')) setValue('dependent_passport_number', passportNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFamilySponsored, fullName, nationality, passportNumber]);

  // On renewal, force a FRESH NOC signature: clear any prefilled value once on
  // mount so the sponsor must re-sign even though their metadata is prefilled.
  React.useEffect(() => {
    if (isFamilySponsored && isRenewal) {
      setSponsorSignature(null);
      setValue('sponsor_noc_signature', undefined);
      setValue('sponsor_noc_signed_at', undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFormSubmit = async (data: EmployeeFormData) => {
    // Validate photo is uploaded AND accepted — either AI-validated or
    // explicitly submitted for manual review. A merely-existing photo that
    // failed validation must not slip through the final submit.
    if (!photoDoc) {
      setPhotoError('Please upload your photo');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!photoDoc.validated && !photoDoc.needsReview) {
      setPhotoError('Your photo has not passed validation. Please upload a compliant photo, or submit it for manual review.');
      setViewingStep(1);
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

    // Validate signature. The employee signature is captured on the Review &
    // Sign step (internal index 8) — jump there on failure (for family the
    // submit fires from step 9, so we must navigate back to 8).
    if (!signature && !reuseEmployerSignature) {
      setSignatureError('Please sign the form');
      setViewingStep(8);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSignatureError(null);

    // Family-sponsored gate: sponsor metadata + all four sponsor docs + a
    // fresh NOC signature are mandatory. Use refs for the docs/signature to
    // avoid stale-closure reads; metadata comes straight off the submitted
    // form data. Jump to the sponsor step (internal index 9) on failure.
    if (isFamilySponsored) {
      const metaComplete = !!(
        data.sponsor_name && data.sponsor_nationality && data.sponsor_passport_number &&
        data.sponsor_mobile && data.sponsor_relationship
      );
      const docsComplete = !!(
        sponsorPassportDocRef.current && sponsorVisaDocRef.current &&
        sponsorEidFrontDocRef.current && sponsorEidBackDocRef.current
      );
      const nocSigned = !!sponsorSignatureRef.current;
      if (!metaComplete || !docsComplete || !nocSigned) {
        setSponsorError(
          !metaComplete
            ? 'Please complete all sponsor details.'
            : !docsComplete
            ? 'Please upload all sponsor documents (passport, visa, and Emirates ID front + back).'
            : 'The sponsor must sign the NOC letter.'
        );
        setViewingStep(9);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      setSponsorError(null);
    }

    // Use employer signature if same person mode
    const signatureToUse = reuseEmployerSignature && submission.employer_signature_data
      ? submission.employer_signature_data
      : signature!;

    // Stamp the device the form was submitted from — the same touch+viewport
    // heuristic that gates the mobile upload policy, so we can later tell
    // whether an employee saw the phone or desktop behavior.
    data.submission_device = isMobile ? 'phone' : 'desktop';

    await onSubmit(data, signatureToUse);
  };

  // Helper to build full document references including education docs + new identity docs.
  // mergeStaffDocRefs spreads submission.documents first to preserve employer-uploaded docs
  // (e.g. job_offer_letter). Tested in src/lib/staff-form-logic.test.ts.
  const buildDocRefs = (overrides?: { photo?: typeof photoDoc; passportPages?: typeof passportPages }) =>
    mergeStaffDocRefs(submission.documents, {
      photo: overrides?.photo ?? photoDocRef.current,
      passportPages: overrides?.passportPages ?? passportPagesRef.current,
      passport_unchanged: passportUnchangedRef.current,
      degree_attested: degreeDocRef.current,
      transcript_of_records: transcriptDocRef.current,
      education_additional: educationAdditionalDocRef.current,
      eid_front: eidFrontDocRef.current,
      eid_back: eidBackDocRef.current,
      pakistan_id_front: pakistanIdFrontDocRef.current,
      pakistan_id_back: pakistanIdBackDocRef.current,
      visa_document: visaDocRef.current,
      previous_visa_document: previousVisaDocRef.current,
      sponsor_passport: sponsorPassportDocRef.current,
      sponsor_visa: sponsorVisaDocRef.current,
      sponsor_eid_front: sponsorEidFrontDocRef.current,
      sponsor_eid_back: sponsorEidBackDocRef.current,
    });

  const handlePhotoUpload = async (file: File) => {
    const result = await uploadDocument(submission.id, 'photo', file);
    if (result) {
      const newDoc = { ...result, validated: false };
      setPhotoDoc(newDoc);
      photoDocRef.current = newDoc;
      setPhotoError(null);
      await saveDocRefs(buildDocRefs({ photo: newDoc }));
      return result;
    }
    return null;
  };

  // Photo manual-review fallback: after MANUAL_REVIEW_THRESHOLD AI rejections
  // the user can confirm + submit the already-uploaded photo as-is. Stamps
  // validated:true (unblocks the form) + needsReview:true (TME verifies it —
  // the portal records photo_validation_passed=false, needs_review=true).
  const handlePhotoManualReview = async () => {
    const current = photoDocRef.current;
    if (!current) return;
    setPhotoManualReviewSubmitting(true);
    const updatedDoc = {
      ...current,
      validated: true,
      needsReview: true,
      // Carry the same-photo verdict of THIS upload (not earlier strikes on
      // other files) so the portal can label the review accordingly.
      samePhotoSuspected: photoSamePhotoRef.current || undefined,
    };
    setPhotoDoc(updatedDoc);
    photoDocRef.current = updatedDoc;
    setPhotoError(null);
    await saveDocRefs(buildDocRefs({ photo: updatedDoc }));
    setPhotoRejectionCount(0);
    setPhotoManualReviewConfirmed(false);
    setPhotoManualReviewSubmitting(false);
  };

  // Passport validation helper
  const validatePassportPageType = async (imageBase64: string, expectedType: 'COVER' | 'INSIDE_PAGES' | 'ADDITIONAL_PAGE') => {
    try {
      const compressedImage = await compressImageForAI(imageBase64);
      const response = await fetch('/api/validate-passport-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // nationality selects the additional-page prompt variant (Indian
        // family-details page vs Syrian issue-details page); ignored for
        // cover/inside checks.
        body: JSON.stringify({ image: compressedImage, expectedType, nationality, submissionId: submission.id, token: aiToken }),
      });
      const result = await response.json();
      if (!response.ok) {
        // Surface a specific reason (e.g. the single-page rule enforced by the
        // AI route guard) instead of a generic failure.
        return {
          valid: false,
          error:
            (result?.error as string) ||
            (result?.errorMessage as string) ||
            'Unable to validate page. Please try again.',
          infra: result?.infra === true,
        };
      }
      return {
        valid: result.matches as boolean,
        error: result.errorMessage as string | undefined,
        infra: result?.infra === true,
      };
    } catch {
      // Network failure: the check could not run — infra, never a strike.
      return { valid: false, error: 'Unable to validate page. Please try again.', infra: true };
    }
  };

  // Passport data extraction helper
  const extractPassportData = async (imageBase64: string) => {
    try {
      const compressedImage = await compressImageForAI(imageBase64);
      const response = await fetch('/api/extract-passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage, submissionId: submission.id, token: aiToken }),
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
      autoSave(getValues());
    }, 100);
  };

  // Cover upload handler
  const handleCoverUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'passport cover spread');
    if (pageErr) {
      setCoverUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const isImage = file.type.startsWith('image/');
    let preview: string;
    try {
      preview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
    } catch {
      setCoverUI({ preview: null, validating: false, error: "We couldn't read this file. Please try a different one.", file });
      return false;
    }

    setCoverUI({ preview, validating: true, error: null, file });

    // Both images and PDFs run through page-type validation — PDFs use
    // Claude's `document` content block (handled in passport-page-validation.ts).
    try {
      const validation = await validatePassportPageType(preview, 'COVER');
      if (!validation.valid) {
        // infra=true means the check could not RUN (API/model error) — never
        // a rejection; don't burn a strike, just ask the user to retry.
        if (validation.infra) {
          setCoverUI({ preview, validating: false, error: "We could not check this file right now — please try again in a moment.", file });
          return false;
        }
        setCoverRejectionCount((c) => c + 1);
        setCoverUI({ preview, validating: false, error: validation.error || 'This does not look like a passport cover spread. Please upload a clearer photo.', file });
        // Clear any previously-validated cover page so a stale green "Valid"
        // badge can't sit next to this red error border (mirrors sponsor handlers).
        const clearedPages = { ...passportPagesRef.current };
        delete clearedPages.cover;
        setPassportPages(clearedPages);
        passportPagesRef.current = clearedPages;
        await saveDocRefs(buildDocRefs({ passportPages: clearedPages }));
        return false;
      }
    } catch {
      setCoverUI({ preview, validating: false, error: "We couldn't check this file. Please try again.", file });
      return false;
    }

    let result: { path: string; filename: string } | null;
    try {
      result = await uploadPassportPage(submission.id, 'cover', file);
    } catch {
      result = null;
    }
    if (!result) {
      setCoverUI({ preview, validating: false, error: 'Upload failed. Please check your connection and try again.', file });
      return false;
    }

    setCoverUI({ preview, validating: false, error: null, file });
    const newPage: PassportPageReference = { path: result.path, filename: result.filename, validated: true };
    const updatedPages = { ...passportPagesRef.current, cover: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setCoverRejectionCount(0);
    setCoverManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
    return true;
  };

  // Inside pages upload handler
  const handleInsideUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'passport data-page spread');
    if (pageErr) {
      setInsideUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const isImage = file.type.startsWith('image/');
    let preview: string;
    try {
      preview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
    } catch {
      setInsideUI({ preview: null, validating: false, error: "We couldn't read this file. Please try a different one.", file });
      return false;
    }

    setInsideUI({ preview, validating: true, error: null, file });

    // Both images and PDFs go through the page-type validator. Anthropic
    // accepts PDFs natively via the `document` content block (handled in
    // passport-page-validation.ts), so no client-side rasterization needed.
    try {
      const validation = await validatePassportPageType(preview, 'INSIDE_PAGES');
      if (!validation.valid) {
        // infra=true means the check could not RUN (API/model error) — never
        // a rejection; don't burn a strike, just ask the user to retry.
        if (validation.infra) {
          setInsideUI({ preview, validating: false, error: "We could not check this file right now — please try again in a moment.", file });
          return false;
        }
        setInsideRejectionCount((c) => c + 1);
        setInsideUI({ preview, validating: false, error: validation.error || 'This does not look like a passport inside-pages spread. Please upload a clearer photo.', file });
        // Clear any previously-validated inside page (and its extracted-data
        // ready flag) so a stale green "Valid" badge can't sit next to this red
        // error border (mirrors sponsor handlers + handleInsideRemove).
        const clearedPages = { ...passportPagesRef.current };
        delete clearedPages.insidePages;
        setPassportPages(clearedPages);
        passportPagesRef.current = clearedPages;
        setPassportDataReady(false);
        await saveDocRefs(buildDocRefs({ passportPages: clearedPages }));
        return false;
      }
    } catch {
      setInsideUI({ preview, validating: false, error: "We couldn't check this file. Please try again.", file });
      return false;
    }

    let result: { path: string; filename: string } | null;
    try {
      result = await uploadPassportPage(submission.id, 'insidePages', file);
    } catch {
      result = null;
    }
    if (!result) {
      setInsideUI({ preview, validating: false, error: 'Upload failed. Please check your connection and try again.', file });
      return false;
    }

    setInsideUI({ preview, validating: false, error: null, file });
    const newPage: PassportPageReference = { path: result.path, filename: result.filename, validated: true };
    const updatedPages = { ...passportPagesRef.current, insidePages: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setInsideRejectionCount(0);
    setInsideManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));

    // Extraction works on both images and PDFs — Claude's `document` block
    // handles PDFs internally. (Previously we early-returned for PDFs, which
    // forced users to type passport details by hand even when the PDF
    // contained a perfectly readable data page.)
    setExtractingPassport(true);
    let extracted: Record<string, unknown> | null = null;
    try {
      extracted = await extractPassportData(preview);
    } catch {
      extracted = null;
    }
    setExtractingPassport(false);
    if (extracted) {
      handlePassportExtracted(extracted);
      const updatedInsidePage: PassportPageReference = {
        ...passportPagesRef.current.insidePages!,
        extracted_data: extracted as Record<string, unknown>,
      };
      const updatedPagesWithData = { ...passportPagesRef.current, insidePages: updatedInsidePage };
      setPassportPages(updatedPagesWithData);
      passportPagesRef.current = updatedPagesWithData;
      await saveDocRefs(buildDocRefs({ passportPages: updatedPagesWithData }));
    } else {
      setPassportDataReady(true);
    }
    return true;
  };

  // Remove handlers
  const handleCoverRemove = async () => {
    setCoverUI({ preview: null, validating: false, error: null, file: null });
    // Intentionally do NOT reset coverRejectionCount on remove. The user
    // can only re-upload by clicking X first (FileUploadSlot.tsx hides
    // Upload while a file is shown), so resetting here makes the
    // manual-review threshold unreachable in practice — the counter
    // would never climb past 1. Counter tracks session-level AI
    // frustration; only a successful AI validation or a successful
    // manual-review submit should clear it.
    setCoverManualReviewConfirmed(false);
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.cover;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const handleInsideRemove = async () => {
    setInsideUI({ preview: null, validating: false, error: null, file: null });
    // Same rationale as handleCoverRemove — see comment there.
    setInsideManualReviewConfirmed(false);
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.insidePages;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportDataReady(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  // Manual-review fallback handlers — invoked only after the user has hit
  // MANUAL_REVIEW_THRESHOLD AI rejections AND ticked the confirmation
  // checkbox. Skips the AI page-type gate, uploads as-is, marks the page
  // as needing human review.
  const handleCoverManualReview = async () => {
    if (!coverUI.file || !coverUI.preview) return;
    // Clear the previous AI-rejection error and DO NOT set validating:true
    // — the manual-review path bypasses AI, so showing "Validating..."
    // while the user has clicked "Submit for manual review" is misleading.
    // The submit button gets its own dedicated submitting flag below.
    setCoverUI({ preview: coverUI.preview, file: coverUI.file, validating: false, error: null });
    setCoverManualReviewSubmitting(true);
    let result: { path: string; filename: string } | null;
    try {
      result = await uploadPassportPage(submission.id, 'cover', coverUI.file);
    } catch {
      result = null;
    }
    if (!result) {
      setCoverUI({ preview: coverUI.preview, file: coverUI.file, validating: false, error: 'Upload failed. Please check your connection and try again.' });
      setCoverManualReviewSubmitting(false);
      return;
    }
    setCoverManualReviewSubmitting(false);
    const newPage: PassportPageReference = buildManualReviewPageRef(result);
    const updatedPages = { ...passportPagesRef.current, cover: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setCoverRejectionCount(0);
    setCoverManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const handleInsideManualReview = async () => {
    if (!insideUI.file || !insideUI.preview) return;
    // Same rationale as handleCoverManualReview — keep validating:false so
    // the slot's "Validating..." badge stays off while the dedicated
    // submitting flag drives the manual-review button.
    setInsideUI({ preview: insideUI.preview, file: insideUI.file, validating: false, error: null });
    setInsideManualReviewSubmitting(true);
    let result: { path: string; filename: string } | null;
    try {
      result = await uploadPassportPage(submission.id, 'insidePages', insideUI.file);
    } catch {
      result = null;
    }
    if (!result) {
      setInsideUI({ preview: insideUI.preview, file: insideUI.file, validating: false, error: 'Upload failed. Please check your connection and try again.' });
      setInsideManualReviewSubmitting(false);
      return;
    }

    // Best-effort extraction even though the AI rejected this as a proper
    // spread. Reasoning: a single passport data page (the most common
    // rejection cause) still has fully readable MRZ + name + dates. If
    // we can pre-fill the form from it, the user verifies/corrects fields
    // instead of typing everything from scratch — and the portal sync
    // also benefits because extracted_data lands on the page reference.
    // The needsReview flag still goes through, so TME re-checks the photo.
    // Works on both images and PDFs — extraction uses Claude's `document`
    // content block for PDFs.
    setExtractingPassport(true);
    let extracted: Record<string, unknown> | null = null;
    try {
      extracted = await extractPassportData(insideUI.preview);
    } catch {
      extracted = null;
    }
    setExtractingPassport(false);
    if (extracted) handlePassportExtracted(extracted);

    setInsideManualReviewSubmitting(false);
    const newPage: PassportPageReference = {
      ...buildManualReviewPageRef(result),
      // Persist the extraction onto the page ref so the portal-side
      // sync picks it up alongside the needsReview flag.
      ...(extracted ? { extracted_data: extracted } : {}),
    };
    const updatedPages = { ...passportPagesRef.current, insidePages: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setInsideRejectionCount(0);
    setInsideManualReviewConfirmed(false);
    setPassportDataReady(true);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  // Helper: best-effort extraction of the additional-page fields from a
  // base64 image/PDF preview. Returns the raw extracted dict so the
  // caller can also persist it onto the page reference. Image AND PDF —
  // Claude's `document` content block handles PDFs in extractAdditionalPage.
  const extractAdditionalPageData = async (preview: string): Promise<Record<string, unknown> | null> => {
    try {
      const isImg = preview.startsWith('data:image/');
      const payload = isImg ? await compressImageForAI(preview) : preview;
      const response = await fetch('/api/extract-passport-additional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // nationality picks the extraction variant (Indian family-details
        // page vs Syrian issue-details page).
        body: JSON.stringify({ image: payload, nationality, submissionId: submission.id, token: aiToken }),
      });
      if (!response.ok) return null;
      const result = await response.json();
      if (result.success && result.data) return result.data as Record<string, unknown>;
      return null;
    } catch {
      return null;
    }
  };

  // Apply extracted additional-page fields to the form. Used by both the
  // regular upload path and the manual-review path so behaviour is identical.
  // Indian pages fill family details + address; Syrian issue-details pages
  // fill the passport issue/expiry dates (which the Syrian DATA page lacks —
  // without this the date fields above the additional-page section stay
  // empty and the employee has to type them by hand).
  const applyAdditionalPageData = (d: Record<string, unknown>) => {
    if (d.passport_issue_date) setValue('passport_issue_date', d.passport_issue_date as string);
    if (d.passport_expiry_date) setValue('passport_expiry', d.passport_expiry_date as string);
    if (d.father_name) setValue('father_full_name', d.father_name as string);
    if (d.mother_name) setValue('mother_full_name', d.mother_name as string);
    if (d.spouse_name) {
      setValue('marital_status', 'Married');
      setValue('spouse_name', d.spouse_name as string);
    }
    if (d.address_street) setValue('home_street_address', d.address_street as string);
    if (d.address_city) setValue('home_city', d.address_city as string);
    if (d.address_pin) setValue('home_postal_code', d.address_pin as string);
    if (d.address_country) setValue('home_country', d.address_country as string);
    setTimeout(() => autoSave(getValues()), 100);
  };

  // Passport additional page handlers (Indian / Syrian)
  const handleAdditionalPageUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'passport additional page');
    if (pageErr) {
      setAdditionalPageUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });

    setAdditionalPageUI({ preview, validating: true, error: null, file });

    // AI page-type validation — same pattern as cover/inside. Permissive
    // (the prompt favours valid=true) because additional-page layouts vary,
    // but it still catches the common mistake of uploading the cover or
    // the data page here. Counter feeds the manual-review affordance.
    try {
      const validation = await validatePassportPageType(preview, 'ADDITIONAL_PAGE');
      if (!validation.valid) {
        // infra=true means the check could not RUN (API/model error) — never
        // a rejection; don't burn a strike, just ask the user to retry.
        if (validation.infra) {
          setAdditionalPageUI({ preview, validating: false, error: "We could not check this file right now — please try again in a moment.", file });
          return false;
        }
        setAdditionalRejectionCount((c) => c + 1);
        setAdditionalPageUI({ preview, validating: false, error: validation.error || 'This does not look like your passport’s additional page.', file });
        return false;
      }
    } catch {
      setAdditionalPageUI({ preview, validating: false, error: "We couldn't check this file. Please try again.", file });
      return false;
    }

    const result = await uploadPassportPage(submission.id, 'additionalPage', file);
    if (!result) {
      setAdditionalPageUI({ preview, validating: false, error: 'Failed to upload file', file });
      return false;
    }

    setAdditionalPageUI({ preview, validating: false, error: null, file });
    const extracted = await extractAdditionalPageData(preview);
    if (extracted) applyAdditionalPageData(extracted);

    const newPage: PassportPageReference = {
      path: result.path,
      filename: result.filename,
      validated: true,
      ...(extracted ? { extracted_data: extracted } : {}),
    };
    const updatedPages = { ...passportPagesRef.current, additionalPage: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setAdditionalRejectionCount(0);
    setAdditionalManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
    return true;
  };

  // Manual-review fallback for the additional page — same shape as cover/
  // inside: bypass AI validation, upload as-is, stamp needsReview=true,
  // best-effort extract so the form is still pre-filled where possible.
  const handleAdditionalManualReview = async () => {
    if (!additionalPageUI.file || !additionalPageUI.preview) return;
    setAdditionalPageUI({ preview: additionalPageUI.preview, file: additionalPageUI.file, validating: false, error: null });
    setAdditionalManualReviewSubmitting(true);
    let result: { path: string; filename: string } | null;
    try {
      result = await uploadPassportPage(submission.id, 'additionalPage', additionalPageUI.file);
    } catch {
      result = null;
    }
    if (!result) {
      setAdditionalPageUI({ preview: additionalPageUI.preview, file: additionalPageUI.file, validating: false, error: 'Upload failed. Please check your connection and try again.' });
      setAdditionalManualReviewSubmitting(false);
      return;
    }

    const extracted = await extractAdditionalPageData(additionalPageUI.preview);
    if (extracted) applyAdditionalPageData(extracted);

    setAdditionalManualReviewSubmitting(false);
    const newPage: PassportPageReference = {
      ...buildManualReviewPageRef(result),
      ...(extracted ? { extracted_data: extracted } : {}),
    };
    const updatedPages = { ...passportPagesRef.current, additionalPage: newPage };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setAdditionalRejectionCount(0);
    setAdditionalManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const handleAdditionalPageRemove = async () => {
    setAdditionalPageUI({ preview: null, validating: false, error: null, file: null });
    // Same rationale as handleCoverRemove — keep the rejection counter
    // so the manual-review threshold is reachable through the Replace
    // path (X+upload would otherwise reset every iteration).
    setAdditionalManualReviewConfirmed(false);
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.additionalPage;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  // Named upload handlers extracted from inline JSX so they can be wrapped
  // by useScannerIntercept (image → scanner → handler, PDF → handler direct).
  const handlePreviousVisaUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'visa document page');
    if (pageErr) {
      setPreviousVisaUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
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
        body: JSON.stringify({ image: imageData, expectedCategory: 'previous_visa', submissionId: submission.id, token: aiToken }),
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
          // Clear any previously-validated doc so a stale green "Valid" badge
          // can't sit next to this red error border (mirrors sponsor handlers).
          setPreviousVisaDoc(undefined);
          previousVisaDocRef.current = undefined;
          await saveDocRefs(buildDocRefs());
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
    await saveDocRefs(buildDocRefs());
    return true;
  };

  const handleEidFrontUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'Emirates ID (front)');
    if (pageErr) {
      setEidFrontUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setEidFrontUI({ preview, validating: true, error: null, file });

    let extractedData: Record<string, unknown> | null = null;
    if (isImage) {
      try {
        const compressedImage = await compressImageForAI(preview);
        const response = await fetch('/api/extract-eid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressedImage, side: 'front', submissionId: submission.id, token: aiToken }),
        });
        if (response.ok) {
          const extractResult = await response.json();
          // infra=true means the check could not RUN (API/model error) —
          // never a rejection. Fall through to the upload without extracted
          // data (mirrors the sponsor/EID-back handlers).
          if (extractResult.infra !== true) {
            if (extractResult.success && extractResult.data) {
              if (!extractResult.data.emirates_id_number) {
                setEidFrontUI({ preview, validating: false, error: 'This does not appear to be an Emirates ID card. Please upload the front of a valid UAE Emirates ID.', file });
                // Clear any previously-validated doc so a stale green "Valid"
                // badge can't sit next to this red error border (mirrors sponsor handlers).
                setEidFrontDoc(undefined);
                eidFrontDocRef.current = undefined;
                await saveDocRefs(buildDocRefs());
                return false;
              }
              extractedData = extractResult.data;
            } else {
              setEidFrontUI({ preview, validating: false, error: 'Could not read this document. Please upload a clear photo of the front of your Emirates ID card.', file });
              setEidFrontDoc(undefined);
              eidFrontDocRef.current = undefined;
              await saveDocRefs(buildDocRefs());
              return false;
            }
          }
        }
      } catch (err) {
        // Validation-infra error: log + continue — must not hard-block a
        // genuine upload (mirrors the sponsor EID handlers).
        console.error('EID front validation error:', err);
      }
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
      setTimeout(() => autoSave(getValues()), 100);
    }

    await saveDocRefs(buildDocRefs());
    return true;
  };

  const handleEidBackUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'Emirates ID (back)');
    if (pageErr) {
      setEidBackUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setEidBackUI({ preview, validating: true, error: null, file });

    if (isImage) {
      try {
        const compressedImage = await compressImageForAI(preview);
        const response = await fetch('/api/extract-eid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressedImage, side: 'back', submissionId: submission.id, token: aiToken }),
        });
        if (response.ok) {
          const extractResult = await response.json();
          if (!extractResult.success && !extractResult.infra) {
            setEidBackUI({ preview, validating: false, error: 'This does not appear to be the back of an Emirates ID card. Please upload a clear photo of the back.', file });
            // Clear any previously-validated doc so a stale green "Valid" badge
            // can't sit next to this red error border (mirrors sponsor handlers).
            setEidBackDoc(undefined);
            eidBackDocRef.current = undefined;
            await saveDocRefs(buildDocRefs());
            return false;
          }
        }
      } catch (err) {
        console.error('EID back validation error:', err);
      }
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
    await saveDocRefs(buildDocRefs());
    return true;
  };

  // --- Sponsor document uploads (family-sponsored only) ---
  // AI VALIDATES each sponsor upload (type-check parity with the applicant
  // docs) before marking `validated: true`, so the green "Valid" badge is
  // truthful. We do NOT extract into form fields — the applicant extract
  // routes write into the dependent's OWN identity fields, so pointing them
  // at sponsor docs would corrupt the dependent's data. The typed sponsor
  // metadata fields remain the source of truth for the NOC. Any extracted
  // payload is used only to decide valid/invalid and is then discarded.
  //
  // PDF-safe: mirrors handlePreviousVisaUpload — images go through
  // compressImageForAI, PDFs pass the data URL straight to the model (the
  // validation libs accept PDF data URLs via Claude's `document` block).
  // Soft-on-route-error: a thrown validation-infra error logs + continues
  // (must not hard-block a genuine upload). Hard-block on an explicit
  // invalid verdict. Two failed validations surface the manual-review
  // affordance (see handleSponsor*ManualReview below).

  const handleSponsorPassportUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, "sponsor's passport page");
    if (pageErr) {
      setSponsorPassportUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setSponsorPassportUI({ preview, validating: true, error: null, file });

    try {
      const isImage = file.type.startsWith('image/');
      const imageData = isImage ? await compressImageForAI(preview) : preview;
      // Sponsor passport is validated as the photo/data page spread
      // (INSIDE_PAGES) — that validator's VALID criteria are exactly the
      // data page (photo + MRZ + name) plus its opposite half, which is the
      // sponsor passport page TME needs. It does NOT write applicant fields.
      const response = await fetch('/api/validate-passport-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, expectedType: 'INSIDE_PAGES', submissionId: submission.id, token: aiToken }),
      });
      if (response.ok) {
        const validationResult = await response.json();
        // infra=true means the check could not RUN (API/model error) — never
        // a rejection. Fall through to the upload like the catch path below.
        if (!validationResult.matches && validationResult.infra !== true) {
          setSponsorPassportRejectionCount((c) => c + 1);
          setSponsorPassportUI({
            preview,
            validating: false,
            error: validationResult.errorMessage || "This does not look like the sponsor's passport page. Please upload the passport spread open showing the photo / data page.",
            file,
          });
          // Clear any previously-validated doc so a stale green "Valid" badge
          // can't sit next to this red error border.
          setSponsorPassportDoc(undefined);
          sponsorPassportDocRef.current = undefined;
          await saveDocRefs(buildDocRefs());
          return false;
        }
      }
    } catch (err) {
      console.error('Sponsor passport validation error:', err);
    }

    const result = await uploadDocument(submission.id, 'sponsor_passport', file);
    if (!result) {
      setSponsorPassportUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }
    const newDoc = { ...result, validated: true };
    setSponsorPassportDoc(newDoc);
    sponsorPassportDocRef.current = newDoc;
    setSponsorPassportUI({ preview, validating: false, error: null, file });
    setSponsorPassportRejectionCount(0);
    setSponsorPassportManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());

    // Auto-fill the typed SPONSOR metadata (name / nationality / passport no.)
    // from the sponsor's passport so the user doesn't re-type them and the NOC
    // matches the document. Non-fatal: the upload above already validated, so a
    // failed/unreadable extraction must NOT block it — silently skip and let the
    // user type manually. Writes SPONSOR fields ONLY (never applicant fields).
    // Empty-guard: only fill a field the user hasn't already filled, mirroring
    // the applicant's one-time seed pattern.
    try {
      const isImageForExtract = file.type.startsWith('image/');
      const imageData = isImageForExtract ? await compressImageForAI(preview) : preview;
      const extractResponse = await fetch('/api/extract-passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, submissionId: submission.id, token: aiToken }),
      });
      if (extractResponse.ok) {
        const extractResult = await extractResponse.json();
        if (extractResult.success && extractResult.data) {
          const data = extractResult.data as {
            first_name?: string;
            middle_name?: string;
            family_name?: string;
            nationality?: string;
            passport_no?: string;
          };

          // sponsor_name = full printed name = given name(s) + surname.
          const fullName = [data.first_name, data.middle_name, data.family_name]
            .filter((part) => typeof part === 'string' && part.trim().length > 0)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (fullName && !getValues('sponsor_name')) {
            setValue('sponsor_name', fullName);
          }

          if (data.nationality && !getValues('sponsor_nationality')) {
            const resolved = resolveExtractedNationality(data.nationality, NATIONALITIES);
            if (resolved) setValue('sponsor_nationality', resolved);
          }

          const passportNo = data.passport_no?.trim();
          if (passportNo && !getValues('sponsor_passport_number')) {
            setValue('sponsor_passport_number', passportNo);
          }

          // Persist after setValue (setTimeout lets the values propagate first),
          // mirroring handlePassportExtracted's auto-save.
          setTimeout(() => {
            autoSave(getValues());
          }, 100);
        }
      }
    } catch (err) {
      // Non-fatal: upload already validated; user can type the fields manually.
      console.error('Sponsor passport auto-fill error:', err);
    }

    return true;
  };

  const handleSponsorVisaUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, "sponsor's visa document page");
    if (pageErr) {
      setSponsorVisaUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setSponsorVisaUI({ preview, validating: true, error: null, file });

    try {
      const isImage = file.type.startsWith('image/');
      const imageData = isImage ? await compressImageForAI(preview) : preview;
      // Reuse the applicant previous-visa category ('previous_visa') — both
      // mean "an existing UAE residence visa". Safe: no applicant writes.
      const response = await fetch('/api/validate-visa-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, expectedCategory: 'previous_visa', submissionId: submission.id, token: aiToken }),
      });
      if (response.ok) {
        const validationResult = await response.json();
        if (!validationResult.valid) {
          setSponsorVisaRejectionCount((c) => c + 1);
          setSponsorVisaUI({
            preview,
            validating: false,
            error: validationResult.errorMessage || "This does not look like the sponsor's UAE residence visa. You can retry or submit it for manual review.",
            file,
          });
          // Clear any previously-validated doc so a stale green "Valid" badge
          // can't sit next to this red error border.
          setSponsorVisaDoc(undefined);
          sponsorVisaDocRef.current = undefined;
          await saveDocRefs(buildDocRefs());
          return false;
        }
      }
    } catch (err) {
      console.error('Sponsor visa validation error:', err);
    }

    const result = await uploadDocument(submission.id, 'sponsor_visa', file);
    if (!result) {
      setSponsorVisaUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }
    const newDoc = { ...result, validated: true };
    setSponsorVisaDoc(newDoc);
    sponsorVisaDocRef.current = newDoc;
    setSponsorVisaUI({ preview, validating: false, error: null, file });
    setSponsorVisaRejectionCount(0);
    setSponsorVisaManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());
    return true;
  };

  const handleSponsorEidFrontUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, "sponsor's Emirates ID (front)");
    if (pageErr) {
      setSponsorEidFrontUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setSponsorEidFrontUI({ preview, validating: true, error: null, file });

    try {
      const isImage = file.type.startsWith('image/');
      const imageData = isImage ? await compressImageForAI(preview) : preview;
      // TYPE-CHECK ONLY via /api/extract-eid. Front EID is valid when the
      // route returns success AND an EID-shaped number. The extracted data
      // is DISCARDED — we never setValue() it onto the applicant.
      const response = await fetch('/api/extract-eid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, side: 'front', submissionId: submission.id, token: aiToken }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        if (extractResult.infra !== true && (!extractResult.success || !extractResult.data?.emirates_id_number)) {
          setSponsorEidFrontRejectionCount((c) => c + 1);
          setSponsorEidFrontUI({
            preview,
            validating: false,
            error: "This does not look like the front of the sponsor's Emirates ID. Please upload the front of a valid UAE Emirates ID, or submit it for manual review.",
            file,
          });
          // Clear any previously-validated doc so a stale green "Valid" badge
          // can't sit next to this red error border.
          setSponsorEidFrontDoc(undefined);
          sponsorEidFrontDocRef.current = undefined;
          await saveDocRefs(buildDocRefs());
          return false;
        }
      }
    } catch (err) {
      console.error('Sponsor EID front validation error:', err);
    }

    const result = await uploadDocument(submission.id, 'sponsor_eid_front', file);
    if (!result) {
      setSponsorEidFrontUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }
    const newDoc = { ...result, validated: true };
    setSponsorEidFrontDoc(newDoc);
    sponsorEidFrontDocRef.current = newDoc;
    setSponsorEidFrontUI({ preview, validating: false, error: null, file });
    setSponsorEidFrontRejectionCount(0);
    setSponsorEidFrontManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());
    return true;
  };

  const handleSponsorEidBackUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, "sponsor's Emirates ID (back)");
    if (pageErr) {
      setSponsorEidBackUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setSponsorEidBackUI({ preview, validating: true, error: null, file });

    try {
      const isImage = file.type.startsWith('image/');
      const imageData = isImage ? await compressImageForAI(preview) : preview;
      // TYPE-CHECK ONLY via /api/extract-eid (back). The back is valid when
      // the route returns success (is_valid_back true). Data is DISCARDED.
      const response = await fetch('/api/extract-eid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, side: 'back', submissionId: submission.id, token: aiToken }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        if (!extractResult.success && !extractResult.infra) {
          setSponsorEidBackRejectionCount((c) => c + 1);
          setSponsorEidBackUI({
            preview,
            validating: false,
            error: "This does not look like the back of the sponsor's Emirates ID. Please upload a clear photo of the back, or submit it for manual review.",
            file,
          });
          // Clear any previously-validated doc so a stale green "Valid" badge
          // can't sit next to this red error border.
          setSponsorEidBackDoc(undefined);
          sponsorEidBackDocRef.current = undefined;
          await saveDocRefs(buildDocRefs());
          return false;
        }
      }
    } catch (err) {
      console.error('Sponsor EID back validation error:', err);
    }

    const result = await uploadDocument(submission.id, 'sponsor_eid_back', file);
    if (!result) {
      setSponsorEidBackUI({ preview, validating: false, error: 'Failed to upload', file });
      return false;
    }
    const newDoc = { ...result, validated: true };
    setSponsorEidBackDoc(newDoc);
    sponsorEidBackDocRef.current = newDoc;
    setSponsorEidBackUI({ preview, validating: false, error: null, file });
    setSponsorEidBackRejectionCount(0);
    setSponsorEidBackManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());
    return true;
  };

  // --- Sponsor manual-review fallbacks ---
  // Mirror the applicant passport cover/inside manual-review path: bypass the
  // AI gate after 2 rejections, upload as-is, stamp validated:true (unblocks
  // the form) AND needsReview:true (TME verifies on the portal side via the
  // needs_review column). needsReview flows through buildDocRefs because it
  // lives on the same ref object pulled into saveDocRefs.
  const handleSponsorPassportManualReview = async () => {
    if (!sponsorPassportUI.file || !sponsorPassportUI.preview) return;
    setSponsorPassportUI({ preview: sponsorPassportUI.preview, file: sponsorPassportUI.file, validating: false, error: null });
    setSponsorPassportManualReviewSubmitting(true);
    const result = await uploadDocument(submission.id, 'sponsor_passport', sponsorPassportUI.file);
    if (!result) {
      setSponsorPassportUI({ preview: sponsorPassportUI.preview, file: sponsorPassportUI.file, validating: false, error: 'Upload failed. Please check your connection and try again.' });
      setSponsorPassportManualReviewSubmitting(false);
      return;
    }
    setSponsorPassportManualReviewSubmitting(false);
    const newDoc = { ...result, validated: true, needsReview: true };
    setSponsorPassportDoc(newDoc);
    sponsorPassportDocRef.current = newDoc;
    setSponsorPassportRejectionCount(0);
    setSponsorPassportManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());
  };

  const handleSponsorVisaManualReview = async () => {
    if (!sponsorVisaUI.file || !sponsorVisaUI.preview) return;
    setSponsorVisaUI({ preview: sponsorVisaUI.preview, file: sponsorVisaUI.file, validating: false, error: null });
    setSponsorVisaManualReviewSubmitting(true);
    const result = await uploadDocument(submission.id, 'sponsor_visa', sponsorVisaUI.file);
    if (!result) {
      setSponsorVisaUI({ preview: sponsorVisaUI.preview, file: sponsorVisaUI.file, validating: false, error: 'Upload failed. Please check your connection and try again.' });
      setSponsorVisaManualReviewSubmitting(false);
      return;
    }
    setSponsorVisaManualReviewSubmitting(false);
    const newDoc = { ...result, validated: true, needsReview: true };
    setSponsorVisaDoc(newDoc);
    sponsorVisaDocRef.current = newDoc;
    setSponsorVisaRejectionCount(0);
    setSponsorVisaManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());
  };

  const handleSponsorEidFrontManualReview = async () => {
    if (!sponsorEidFrontUI.file || !sponsorEidFrontUI.preview) return;
    setSponsorEidFrontUI({ preview: sponsorEidFrontUI.preview, file: sponsorEidFrontUI.file, validating: false, error: null });
    setSponsorEidFrontManualReviewSubmitting(true);
    const result = await uploadDocument(submission.id, 'sponsor_eid_front', sponsorEidFrontUI.file);
    if (!result) {
      setSponsorEidFrontUI({ preview: sponsorEidFrontUI.preview, file: sponsorEidFrontUI.file, validating: false, error: 'Upload failed. Please check your connection and try again.' });
      setSponsorEidFrontManualReviewSubmitting(false);
      return;
    }
    setSponsorEidFrontManualReviewSubmitting(false);
    const newDoc = { ...result, validated: true, needsReview: true };
    setSponsorEidFrontDoc(newDoc);
    sponsorEidFrontDocRef.current = newDoc;
    setSponsorEidFrontRejectionCount(0);
    setSponsorEidFrontManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());
  };

  const handleSponsorEidBackManualReview = async () => {
    if (!sponsorEidBackUI.file || !sponsorEidBackUI.preview) return;
    setSponsorEidBackUI({ preview: sponsorEidBackUI.preview, file: sponsorEidBackUI.file, validating: false, error: null });
    setSponsorEidBackManualReviewSubmitting(true);
    const result = await uploadDocument(submission.id, 'sponsor_eid_back', sponsorEidBackUI.file);
    if (!result) {
      setSponsorEidBackUI({ preview: sponsorEidBackUI.preview, file: sponsorEidBackUI.file, validating: false, error: 'Upload failed. Please check your connection and try again.' });
      setSponsorEidBackManualReviewSubmitting(false);
      return;
    }
    setSponsorEidBackManualReviewSubmitting(false);
    const newDoc = { ...result, validated: true, needsReview: true };
    setSponsorEidBackDoc(newDoc);
    sponsorEidBackDocRef.current = newDoc;
    setSponsorEidBackRejectionCount(0);
    setSponsorEidBackManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs());
  };

  const handlePakistanIdFrontUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'ID card (front)');
    if (pageErr) {
      setPakistanIdFrontUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setPakistanIdFrontUI({ preview, validating: true, error: null, file });

    if (isImage) {
      try {
        const compressedImage = await compressImageForAI(preview);
        const response = await fetch('/api/extract-pakistan-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressedImage, side: 'front', submissionId: submission.id, token: aiToken }),
        });
        if (response.ok) {
          const extractResult = await response.json();
          if (!extractResult.success && !extractResult.infra) {
            setPakistanIdFrontUI({ preview, validating: false, error: 'This does not appear to be a Pakistani National ID card (CNIC/NICOP). Please upload the correct document.', file });
            // Clear any previously-validated doc so a stale green "Valid" badge
            // can't sit next to this red error border (mirrors sponsor handlers).
            setPakistanIdFrontDoc(undefined);
            pakistanIdFrontDocRef.current = undefined;
            await saveDocRefs(buildDocRefs());
            return false;
          }
          if (extractResult.data?.father_name) setValue('father_full_name', extractResult.data.father_name);
        } else {
          setPakistanIdFrontUI({ preview, validating: false, error: 'Verification failed. Please try again.', file });
          setPakistanIdFrontDoc(undefined);
          pakistanIdFrontDocRef.current = undefined;
          await saveDocRefs(buildDocRefs());
          return false;
        }
      } catch (err) {
        console.error('Pakistan ID front validation error:', err);
        setPakistanIdFrontUI({ preview, validating: false, error: 'Verification failed. Please try again.', file });
        setPakistanIdFrontDoc(undefined);
        pakistanIdFrontDocRef.current = undefined;
        await saveDocRefs(buildDocRefs());
        return false;
      }
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
    await saveDocRefs(buildDocRefs());
    return true;
  };

  const handlePakistanIdBackUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'ID card (back)');
    if (pageErr) {
      setPakistanIdBackUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    const preview = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    setPakistanIdBackUI({ preview, validating: true, error: null, file });

    if (isImage) {
      try {
        const compressedImage = await compressImageForAI(preview);
        const response = await fetch('/api/extract-pakistan-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressedImage, side: 'back', submissionId: submission.id, token: aiToken }),
        });
        if (response.ok) {
          const extractResult = await response.json();
          if (!extractResult.success && !extractResult.infra) {
            setPakistanIdBackUI({ preview, validating: false, error: 'This does not appear to be the back of a Pakistani National ID card. Please upload the correct document.', file });
            // Clear any previously-validated doc so a stale green "Valid" badge
            // can't sit next to this red error border (mirrors sponsor handlers).
            setPakistanIdBackDoc(undefined);
            pakistanIdBackDocRef.current = undefined;
            await saveDocRefs(buildDocRefs());
            return false;
          }
          if (extractResult.data?.address) {
            if (!getValues('home_street_address')) setValue('home_street_address', String(extractResult.data.address));
            setValue('home_country', 'Pakistan');
            if (extractResult.data.address_city && !getValues('home_city')) {
              setValue('home_city', String(extractResult.data.address_city));
            }
            setTimeout(() => autoSave(getValues()), 100);
          }
        }
      } catch (err) {
        console.error('Pakistan ID back validation error:', err);
      }
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
    await saveDocRefs(buildDocRefs());
    return true;
  };

  // Wrap each image-capable handler with the document scanner.
  const additionalPageScan = useScannerIntercept(handleAdditionalPageUpload);
  const previousVisaScan = useScannerIntercept(handlePreviousVisaUpload);
  const eidFrontScan = useScannerIntercept(handleEidFrontUpload);
  const eidBackScan = useScannerIntercept(handleEidBackUpload);
  const pakistanIdFrontScan = useScannerIntercept(handlePakistanIdFrontUpload);
  const pakistanIdBackScan = useScannerIntercept(handlePakistanIdBackUpload);
  const sponsorPassportScan = useScannerIntercept(handleSponsorPassportUpload);
  const sponsorVisaScan = useScannerIntercept(handleSponsorVisaUpload);
  const sponsorEidFrontScan = useScannerIntercept(handleSponsorEidFrontUpload);
  const sponsorEidBackScan = useScannerIntercept(handleSponsorEidBackUpload);

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
            submissionId={submission.id}
            value={photoDoc}
            existingPhoto={existingDocs?.photo}
            onUpload={handlePhotoUpload}
            onValidated={async (validated, validationErrors, aiRejected, flags) => {
              // Remember whether the CURRENT upload was judged a reuse of the
              // photo on file — a later manual-review submit stamps it so the
              // portal flags the suspected reuse for human verification.
              photoSamePhotoRef.current = flags?.samePhoto === true;
              const currentPhotoDoc = photoDocRef.current;
              if (currentPhotoDoc) {
                const updatedDoc = { ...currentPhotoDoc, validated, validation_errors: validationErrors, needsReview: undefined, samePhotoSuspected: undefined };
                setPhotoDoc(updatedDoc);
                photoDocRef.current = updatedDoc;
                await saveDocRefs(buildDocRefs({ photo: updatedDoc }));
              }
              if (validated) {
                setPhotoRejectionCount(0);
              } else if (aiRejected) {
                // Only genuine AI rejections count toward the manual-review
                // threshold — service failures don't.
                setPhotoRejectionCount((c) => c + 1);
              }
              if (photoError) setPhotoError(null);
            }}
            onRemove={async () => {
              setPhotoDoc(undefined);
              photoDocRef.current = undefined;
              // Keep photoRejectionCount across removes (same rationale as
              // handleCoverRemove) so the manual-review threshold stays
              // reachable; only reset the confirmation tick.
              setPhotoManualReviewConfirmed(false);
              await saveDocRefs(buildDocRefs({ photo: undefined }));
            }}
            error={photoError || undefined}
          />

          {shouldOfferManualReview(photoRejectionCount) && photoDoc && !photoDoc.validated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
              <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this photo meets the requirements, you can submit it for manual review.
              </p>
              <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                <input
                  type="checkbox"
                  className="mt-0.5 flex-shrink-0"
                  checked={photoManualReviewConfirmed}
                  onChange={(e) => setPhotoManualReviewConfirmed(e.target.checked)}
                />
                <span>I confirm this is a recent passport-style photo of myself (plain light background, head and shoulders visible, no glasses). I understand a TME team member will verify it manually.</span>
              </label>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handlePhotoManualReview}
                  disabled={!photoManualReviewConfirmed || photoManualReviewSubmitting}
                  className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: TME_COLORS.primary }}
                >
                  {photoManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                </button>
              </div>
            </div>
          )}

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
              onClick={() => {
                setPassportChanged(true);
                // Withdraw any previously-saved attestation — the server-side
                // submit gate must now see freshly uploaded pages instead.
                if (passportUnchangedRef.current) {
                  passportUnchangedRef.current = false;
                  void saveDocRefs(buildDocRefs());
                }
              }}
              className="text-sm text-red-600 hover:text-red-700 font-medium underline"
            >
              My passport has changed — I need to upload new pages
            </button>
            {passportConfirmed && (
              <button
                type="button"
                onClick={() => {
                  // Persist the attestation so the server-side submit gate can
                  // verify the skip (defense-in-depth; it also checks both
                  // existing pages are on file).
                  passportUnchangedRef.current = true;
                  void saveDocRefs(buildDocRefs());
                  // Skip passport upload steps. Step 4 (Identity & Visa) is empty
                  // on a standard renewal, so jump straight to step 5 then.
                  setViewingStep(isStep4Empty ? 5 : 4);
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
                  <p className="mt-2 text-xs text-gray-600">
                    All four corners of the passport must be visible — no glare, blur, or cut-off edges.{' '}
                    {isMobile
                      ? 'Upload a scanned PDF — the camera is disabled, and only proper scans are accepted.'
                      : 'Upload a PDF or a clear JPEG/PNG scan (not a photo of the passport on a table).'}
                  </p>
                  <SampleImageToggle imageSrc="/samples/passport-cover-example.png" altText="Example passport cover spread" label="See example photo" />
                </div>
              </div>

              <UploadSlot
                label="Passport Cover"
                description="Spread open: front + back cover visible"
                expectedType="COVER"
                accept="application/pdf,image/jpeg,image/png"
                file={coverUI.file}
                preview={coverUI.preview || undefined}
                validated={!!passportPages.cover?.validated}
                validating={coverUI.validating}
                needsReview={!!passportPages.cover?.needsReview}
                error={coverUI.error || undefined}
                onUpload={async (file) => {
                  // PDFs skip the corner-drag scanner — it renders via <img>
                  // and would hang on a non-image.
                  if (file.type === 'application/pdf') {
                    await handleCoverUpload(file);
                    return true;
                  }
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

              {shouldOfferManualReview(coverRejectionCount) && coverUI.file && !passportPages.cover?.validated && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
                  <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this photo is your passport cover spread, you can submit it for manual review.
                  </p>
                  <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 flex-shrink-0"
                      checked={coverManualReviewConfirmed}
                      onChange={(e) => setCoverManualReviewConfirmed(e.target.checked)}
                    />
                    <span>I confirm this is my passport cover (front + back) photographed spread open. I understand a TME team member will verify it manually.</span>
                  </label>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCoverManualReview}
                      disabled={!coverManualReviewConfirmed || coverManualReviewSubmitting}
                      className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: TME_COLORS.primary }}
                    >
                      {coverManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                    </button>
                  </div>
                </div>
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
                  <p className="mt-2 text-xs text-gray-600">
                    All four corners of the passport must be visible — no glare, blur, or cut-off edges.{' '}
                    {isMobile
                      ? 'Upload a scanned PDF — the camera is disabled, and only proper scans are accepted.'
                      : 'Upload a PDF or a clear JPEG/PNG scan (not a photo of the passport on a table).'}
                  </p>
                  <SampleImageToggle imageSrc="/samples/passport-inside-example.png" altText="Example passport inside pages spread" label="See example photo" />
                </div>
              </div>

              <UploadSlot
                label=""
                description="Spread open: data page + opposite page"
                expectedType="INSIDE_PAGES"
                accept="application/pdf,image/jpeg,image/png"
                file={insideUI.file}
                preview={insideUI.preview || undefined}
                validated={!!passportPages.insidePages?.validated}
                validating={insideUI.validating}
                needsReview={!!passportPages.insidePages?.needsReview}
                error={insideUI.error || undefined}
                onUpload={async (file) => {
                  if (file.type === 'application/pdf') {
                    await handleInsideUpload(file);
                    return true;
                  }
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

              {shouldOfferManualReview(insideRejectionCount) && insideUI.file && !passportPages.insidePages?.validated && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
                  <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this photo is your passport inside-pages spread, you can submit it for manual review.
                  </p>
                  <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 flex-shrink-0"
                      checked={insideManualReviewConfirmed}
                      onChange={(e) => setInsideManualReviewConfirmed(e.target.checked)}
                    />
                    <span>I confirm this is my passport inside pages (data page + opposite page) photographed spread open.</span>
                  </label>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleInsideManualReview}
                      disabled={!insideManualReviewConfirmed || insideManualReviewSubmitting}
                      className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: TME_COLORS.primary }}
                    >
                      {insideManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                    </button>
                  </div>
                </div>
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
                  {...register('first_name', {
                    required: 'Required',
                    onBlur: (e) => setValue('first_name', normalizePersonName(e.target.value), { shouldValidate: true }),
                  })}
                />
                <Input
                  label="Middle Name"
                  {...register('middle_name', {
                    onBlur: (e) => setValue('middle_name', normalizePersonName(e.target.value)),
                  })}
                />
                <Input
                  label="Family Name"
                  error={errors.last_name?.message}
                  required
                  {...register('last_name', {
                    required: 'Required',
                    onBlur: (e) => setValue('last_name', normalizePersonName(e.target.value), { shouldValidate: true }),
                  })}
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
          {/* Passport Additional Page (Indian / Syrian) */}
          {requiresAdditionalPage && (
            <FormSection
              title={additionalPageCopy.title}
              icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            >
              <div className="space-y-4">
                <div
                  className="flex items-start gap-3 p-4 rounded-lg"
                  style={{ backgroundColor: '#EBF4FF' }}
                >
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <p className="font-medium">{additionalPageCopy.heading}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      {additionalPageCopy.sub}
                    </p>
                    <SampleImageToggle imageSrc={additionalPageCopy.sampleSrc} altText={additionalPageCopy.sampleAlt} label="See example photo" />
                  </div>
                </div>

                <UploadSlot
                  label=""
                  description={additionalPageCopy.slotDescription}
                  expectedType="INSIDE_PAGES"
                  accept="application/pdf,image/jpeg,image/png"
                  file={additionalPageUI.file}
                  preview={additionalPageUI.preview || undefined}
                  validated={!!passportPages.additionalPage?.validated}
                  validating={additionalPageUI.validating}
                  needsReview={!!passportPages.additionalPage?.needsReview}
                  error={additionalPageUI.error || undefined}
                  onUpload={additionalPageScan.intercepted}
                  onRemove={handleAdditionalPageRemove}
                />
                {additionalPageScan.scannerModal}

                {isAdditionalPageUploaded && !passportPages.additionalPage?.needsReview && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    {additionalPageCopy.successNote}
                  </div>
                )}

                {/* Manual-review affordance — same pattern as cover/inside.
                    Appears after MANUAL_REVIEW_THRESHOLD AI rejections so a
                    user with an unusual layout (handwritten, photocopy,
                    addendum sheet) isn't permanently blocked. */}
                {shouldOfferManualReview(additionalRejectionCount) && additionalPageUI.file && !passportPages.additionalPage?.validated && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
                    <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                      <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this is your passport&apos;s additional page, you can submit it for manual review.
                    </p>
                    <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                      <input
                        type="checkbox"
                        className="mt-0.5 flex-shrink-0"
                        checked={additionalManualReviewConfirmed}
                        onChange={(e) => setAdditionalManualReviewConfirmed(e.target.checked)}
                      />
                      <span>I confirm this is my {additionalPageCopy.manualNoun}. I understand a TME team member will verify it manually.</span>
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleAdditionalManualReview}
                        disabled={!additionalManualReviewConfirmed || additionalManualReviewSubmitting}
                        className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: TME_COLORS.primary }}
                      >
                        {additionalManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                      </button>
                    </div>
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
                        accept="application/pdf,image/jpeg,image/png"
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
                          await saveDocRefs(buildDocRefs());
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
                        accept="application/pdf,image/jpeg,image/png"
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
                          await saveDocRefs(buildDocRefs());
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
              onContinue={() => setViewingStep(isStep4Empty ? 5 : 4)}
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
              /* Family-sponsored hides the previous-docs section below (which
                 normally carries the step-4 badge), so surface the badge here
                 instead so the indicator numbering stays consistent. */
              stepNumber={isFamilySponsored ? displayedStepNumber(4) : undefined}
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  {isFamilySponsored
                    ? 'Please confirm the visa you currently hold (sponsored by your family member) and upload a copy below.'
                    : submission.is_same_person
                    ? 'Please confirm your current visa status.'
                    : 'Your employer has indicated that you are currently in the UAE. Please confirm your current visa status.'}
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
                        saveDocRefs(buildDocRefs()).catch(() => {});
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
                      This is the date you entered the UAE on your arrival visa. It will be included in the confirmation document.
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
                      accept="application/pdf,image/jpeg,image/png"
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
                          await saveDocRefs(refs);
                        } catch (err) {
                          console.error('[VisaUpload] failed to persist doc refs', err);
                        }
                        return true;
                      }}
                      onRemove={async () => {
                        setVisaDoc(undefined);
                        visaDocRef.current = undefined;
                        setVisaDocUI({ preview: null, validating: false, error: null, file: null });
                        await saveDocRefs(buildDocRefs());
                      }}
                    />
                  </div>
                )}
              </div>
            </FormSection>
          )}

          {/* UAE Visa and Emirates ID — combined previous-documents section.
              New-hire path only (on renewal we already have these on file).
              Hidden for family-sponsored: their EID is mandatory and handled
              by the dedicated "Your Emirates ID" block below, so we don't
              render the optional previous-docs version (would duplicate the
              same eid_front/eid_back slots). */}
          {!isRenewal && !isFamilySponsored && (
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

              {employerSaysInUae && hasPreviousUaeDocs === false && !submission.is_same_person && (
                <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: '#FEF3C7', border: '1px solid #F59E0B' }}>
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#92400E' }} />
                  <p className="text-xs" style={{ color: '#92400E' }}>
                    Your employer indicated that you are currently in the UAE.
                  </p>
                </div>
              )}

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
                      accept="application/pdf,image/jpeg,image/png"
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
                        await saveDocRefs(buildDocRefs());
                      }}
                    />
                    {previousVisaScan.scannerModal}
                  </div>


                  {/* EID sample images — stacked on mobile so each renders the
                      same size as the visa example above (a 2-col grid squeezed
                      them too small on phones); side-by-side from sm up. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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
                          accept="application/pdf,image/jpeg,image/png"
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
                            await saveDocRefs(buildDocRefs());
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
                          accept="application/pdf,image/jpeg,image/png"
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
                            await saveDocRefs(buildDocRefs());
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

          {/* Family-sponsored: applicant's OWN Emirates ID is MANDATORY
              (front + back), regardless of renewal status. The applicant's
              residence visa is collected by the visa-status section above
              (forced visible + mandatory via the visa override). This block
              is keyed on isFamilySponsored — NOT the !isRenewal section — so
              it also shows on renewal. */}
          {isFamilySponsored && (
            <FormSection
              title="Your Emirates ID"
              icon={<CreditCard className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            >
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#FEF3C7' }}>
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
                  <p className="text-sm text-amber-800 font-medium">
                    Please upload the front and back of your own Emirates ID. This is required for your
                    employment ID / labour card application.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                  {/* Applicant EID Front */}
                  <div className="flex flex-col">
                    <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Front</p>
                    <UploadSlot
                      label=""
                      description="Front of your Emirates ID"
                      expectedType="INSIDE_PAGES"
                      accept="application/pdf,image/jpeg,image/png"
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
                        await saveDocRefs(buildDocRefs());
                      }}
                    />
                    {eidFrontScan.scannerModal}
                  </div>

                  {/* Applicant EID Back */}
                  <div className="flex flex-col">
                    <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Back</p>
                    <UploadSlot
                      label=""
                      description="Back of your Emirates ID"
                      expectedType="INSIDE_PAGES"
                      accept="application/pdf,image/jpeg,image/png"
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
                        await saveDocRefs(buildDocRefs());
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
              </div>
            </FormSection>
          )}

          {!employerVisaInUAE && !isFamilySponsored && hasPreviousUaeDocs === false && (
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
                  {...register('father_full_name', {
                    required: 'Required',
                    onBlur: (e) => setValue('father_full_name', normalizePersonName(e.target.value), { shouldValidate: true }),
                  })}
                />
                <Input
                  label="Mother's Full Name"
                  error={errors.mother_full_name?.message}
                  required
                  {...register('mother_full_name', {
                    required: 'Required',
                    onBlur: (e) => setValue('mother_full_name', normalizePersonName(e.target.value), { shouldValidate: true }),
                  })}
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
                    onBlur: (e) => setValue('spouse_name', normalizePersonName(e.target.value), { shouldValidate: true }),
                  })}
                />
              )}
            </div>
            {viewingStep === 5 && (
              <StepNavButtons
                enabled={isFamilyComplete}
                onContinue={() => setViewingStep(6)}
                onBack={() => setViewingStep(isStep4Empty ? 3 : 4)}
              />
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
                label="International Mobile"
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
              {/* On renewal the employee MUST be in the UAE — no toggle.
                  On new-hire onboarding the checkbox stays so applicants
                  abroad can skip the UAE address fields. */}
              {!isRenewal ? (
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
                        // The "no UAE mobile yet" flag is valid outside the
                        // UAE too (the checkbox is always shown), so it is
                        // deliberately NOT cleared here.
                      }
                    }}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                    Applicant is currently in the UAE
                  </span>
                </label>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <p className="text-xs" style={{ color: TME_COLORS.primary }}>
                    Visa renewal requires you to be currently inside the UAE. Please provide your UAE address below.
                  </p>
                </div>
              )}

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
                </div>
              )}
            </div>
          </FormSection>

          {/* UAE Mobile — placed below the UAE Address section so it stays
              prominently visible while sitting next to the related address
              fields. Still only required when the applicant is in the UAE. */}
          <FormSection
            title="UAE Mobile"
            icon={<Phone className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <PhoneInput
              label="UAE Mobile"
              value={mobileUae}
              onChange={(value) => setValue('mobile_uae', value || '')}
              country="AE"
              required={!mobileUaeUnavailable}
              disabled={mobileUaeUnavailable}
            />
            {/* Always shown (inside AND outside the UAE): everyone must either
                enter a number or explicitly confirm they don't have one, so a
                blank field can never be mistaken for "no number". The portal's
                ICP mobile tracker relies on this being an explicit answer. */}
            <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mobileUaeUnavailable}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setValue('mobile_uae_unavailable', checked, { shouldDirty: true });
                  if (checked) setValue('mobile_uae', '', { shouldDirty: true });
                }}
                className="rounded"
              />
              I don&apos;t have an active UAE mobile number yet
            </label>
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
            <StepNavButtons
              enabled={isContactComplete}
              onContinue={() => setViewingStep(7)}
              onBack={() => setViewingStep(5)}
            />
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

              {showDetExtendedBlock && (
                <>
                  <p className="text-xs -mt-2" style={{ color: TME_COLORS.primary }}>
                    Additional details required for DET work permits.
                  </p>

                  <Input
                    label="University Name"
                    required
                    error={errors.det_university_name?.message}
                    {...register('det_university_name', { required: isDET ? 'University name is required' : false })}
                  />

                  <Input
                    label="Faculty"
                    required
                    error={errors.det_faculty?.message}
                    {...register('det_faculty', { required: isDET ? 'Faculty is required' : false })}
                  />

                  <Input
                    label="Study Majors"
                    required
                    error={errors.det_study_majors?.message}
                    {...register('det_study_majors', { required: isDET ? 'Study majors are required' : false })}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <CustomDatePicker
                      label="Degree Start Date"
                      value={detDegreeStartDate || ''}
                      onChange={(val) => setValue('det_degree_start_date', val)}
                      error={errors.det_degree_start_date?.message}
                      required
                    />
                    <CustomDatePicker
                      label="Degree End Date"
                      value={detDegreeEndDate || ''}
                      onChange={(val) => setValue('det_degree_end_date', val)}
                      error={errors.det_degree_end_date?.message}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <CustomDropdown
                      label="Graduation Year"
                      options={(() => {
                        const max = new Date().getFullYear() + 1;
                        const years: { value: string; label: string }[] = [];
                        for (let y = max; y >= DET_DEGREE_YEAR_MIN; y--) {
                          years.push({ value: String(y), label: String(y) });
                        }
                        return years;
                      })()}
                      value={detGraduationYear ? String(detGraduationYear) : ''}
                      onChange={(val) => setValue('det_graduation_year', val ? Number(val) : undefined)}
                      error={errors.det_graduation_year?.message}
                      required
                    />
                    <CustomDropdown
                      label="Actual Years of Degree"
                      options={Array.from({ length: DET_DEGREE_ACTUAL_YEARS_MAX }, (_, i) => {
                        const n = i + 1;
                        return { value: String(n), label: `${n} ${n === 1 ? 'year' : 'years'}` };
                      })}
                      value={detActualYearsOfDegree ? String(detActualYearsOfDegree) : ''}
                      onChange={(val) => setValue('det_actual_years_of_degree', val ? Number(val) : undefined)}
                      error={errors.det_actual_years_of_degree?.message}
                      required
                    />
                  </div>
                </>
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
                        await saveDocRefs(buildDocRefs());
                      }
                      return result;
                    }}
                    onRemove={async () => {
                      setDegreeDoc(undefined);
                      degreeDocRef.current = undefined;
                      await saveDocRefs(buildDocRefs());
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
                        await saveDocRefs(buildDocRefs());
                      }
                      return result;
                    }}
                    onRemove={async () => {
                      setTranscriptDoc(undefined);
                      transcriptDocRef.current = undefined;
                      await saveDocRefs(buildDocRefs());
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
                          await saveDocRefs(buildDocRefs());
                        }
                        return result;
                      }}
                      onRemove={async () => {
                        setEducationAdditionalDoc(undefined);
                        educationAdditionalDocRef.current = undefined;
                        setShowAdditionalEducation(false);
                        await saveDocRefs(buildDocRefs());
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

          {/* Bank Details — hidden when a Salary Transfer Letter (STL) has been
              issued; bank details are then managed by TME and not editable here. */}
          {!bankLocked && (
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
                    onChange={() => {
                      setValue('has_uae_bank', false);
                      // Clear any details entered while "Yes" was selected —
                      // otherwise a stale IBAN/bank/account name is submitted
                      // alongside has_uae_bank=false (same pattern as the
                      // previous-EID and UAE-address toggles).
                      setValue('bank_iban', '');
                      setValue('bank_name', '');
                      setValue('bank_swift', '');
                      setValue('bank_routing_code', '');
                      setValue('bank_account_name', '');
                    }}
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

                  {/* UAE IBAN — bank code not recognized: pick the bank + manual SWIFT */}
                  {bankLookupResult?.isUae && !bankLookupResult.found && (
                    <>
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <Info className="w-4 h-4 text-amber-600" />
                          <span className="text-sm text-amber-800">Bank not recognized from this IBAN. Please pick your bank below — double-check your IBAN if your bank isn&apos;t listed.</span>
                        </div>
                      </div>
                      {/* Hidden field keeps bank_name required + submitted; the
                          dropdown drives it via setValue. */}
                      <input
                        type="hidden"
                        {...register('bank_name', { required: hasUAEBank ? 'Required' : false })}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <CustomDropdown
                          label="Bank Name"
                          required
                          value={bankName || ''}
                          onChange={handleUnrecognizedBankPick}
                          options={UAE_BANK_PICK_OPTIONS}
                          placeholder="Select your bank..."
                          searchable
                          error={errors.bank_name?.message as string | undefined}
                        />
                        <Input
                          label="SWIFT Code"
                          {...register('bank_swift')}
                        />
                      </div>
                      {routingIbanBankMismatch(bankRoutingCode, bankIban) && (
                        <p className="text-sm text-red-600">
                          The selected bank&apos;s routing code (bank {bankCodeFromRouting(bankRoutingCode)})
                          doesn&apos;t match your IBAN (bank {ibanBankCode(bankIban)}). Re-check your IBAN or
                          your bank selection — payroll will reject a mismatch.
                        </p>
                      )}
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
          )}

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
            <StepNavButtons enabled={isEducationComplete} onContinue={() => setViewingStep(8)} onBack={() => setViewingStep(6)} label="Review & Sign" />
          )}
        </div>
      </RevealSection>

      {/* Sponsor Documents & NOC (internal index 9) — family-sponsored only.
          This is the VERY LAST display step (after Review & Sign 8) per
          visibleStepIndices: the sponsor signs the NOC and the form is
          submitted from here. */}
      {isFamilySponsored && (
      <RevealSection
        show={viewingStep === 9}
        onReveal={() => scrollToRef(sponsorRef)}
      >
        <div ref={sponsorRef} className="space-y-6">
          {/* Sponsor identity documents */}
          <FormSection
            title="Sponsor Documents"
            icon={<ShieldCheck className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(9)}
          >
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                  Your residence visa is sponsored by a family member — please upload your sponsor&apos;s documents below.
                </p>
              </div>

              {/* Sponsor passport */}
              <div className="space-y-2">
                <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Sponsor&apos;s Passport <span className="text-red-500">*</span></p>
                <div
                  className="flex items-start gap-3 p-4 rounded-lg"
                  style={{ backgroundColor: '#EBF4FF' }}
                >
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <p className="font-medium">Upload your sponsor&apos;s passport — the data page with their photo.</p>
                    <p className="mt-2 text-xs text-gray-600">
                      PDF or a clear photo. A crop of just the photo may be rejected.
                    </p>
                    <SampleImageToggle imageSrc="/samples/passport-inside-example.png" altText="Example sponsor passport data page with photo" label="See example photo" imageClassName="w-64 h-auto" />
                  </div>
                </div>
                <UploadSlot
                  label=""
                  description="Scan or photo of your sponsor's passport (PDF or image)"
                  expectedType="INSIDE_PAGES"
                  accept="application/pdf,image/jpeg,image/png"
                  maxSizeMB={10}
                  file={sponsorPassportUI.file}
                  preview={sponsorPassportUI.preview || undefined}
                  validated={!!sponsorPassportDoc?.validated}
                  validating={sponsorPassportUI.validating}
                  error={sponsorPassportUI.error || undefined}
                  onUpload={sponsorPassportScan.intercepted}
                  onRemove={async () => {
                    setSponsorPassportUI({ preview: null, validating: false, error: null, file: null });
                    // Keep sponsorPassportRejectionCount (same rationale as
                    // handleCoverRemove) so the manual-review threshold stays
                    // reachable through the remove + re-upload path.
                    setSponsorPassportManualReviewConfirmed(false);
                    setSponsorPassportDoc(undefined);
                    sponsorPassportDocRef.current = undefined;
                    await saveDocRefs(buildDocRefs());
                  }}
                />
                {sponsorPassportScan.scannerModal}
                {shouldOfferManualReview(sponsorPassportRejectionCount) && sponsorPassportUI.file && !sponsorPassportDoc?.validated && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
                    <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                      <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this is your sponsor&apos;s passport, you can submit it for manual review.
                    </p>
                    <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                      <input
                        type="checkbox"
                        className="mt-0.5 flex-shrink-0"
                        checked={sponsorPassportManualReviewConfirmed}
                        onChange={(e) => setSponsorPassportManualReviewConfirmed(e.target.checked)}
                      />
                      <span>I confirm this is my sponsor&apos;s passport. I understand a TME team member will verify it manually.</span>
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSponsorPassportManualReview}
                        disabled={!sponsorPassportManualReviewConfirmed || sponsorPassportManualReviewSubmitting}
                        className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: TME_COLORS.primary }}
                      >
                        {sponsorPassportManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Sponsor visa */}
              <div className="space-y-2">
                <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Sponsor&apos;s Residence Visa <span className="text-red-500">*</span></p>
                <div
                  className="flex items-start gap-3 p-4 rounded-lg"
                  style={{ backgroundColor: '#EBF4FF' }}
                >
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <p className="font-medium">Upload your sponsor&apos;s UAE residence visa.</p>
                    <p className="mt-2 text-xs text-gray-600">
                      The visa showing their name and visa details.
                    </p>
                    <SampleImageToggle imageSrc="/samples/visa-example.png" altText="Example sponsor UAE residence visa" label="See example photo" imageClassName="w-64 h-auto" />
                  </div>
                </div>
                <UploadSlot
                  label=""
                  description="Scan or photo of your sponsor's residence visa (PDF or image)"
                  expectedType="INSIDE_PAGES"
                  accept="application/pdf,image/jpeg,image/png"
                  maxSizeMB={10}
                  file={sponsorVisaUI.file}
                  preview={sponsorVisaUI.preview || undefined}
                  validated={!!sponsorVisaDoc?.validated}
                  validating={sponsorVisaUI.validating}
                  error={sponsorVisaUI.error || undefined}
                  onUpload={sponsorVisaScan.intercepted}
                  onRemove={async () => {
                    setSponsorVisaUI({ preview: null, validating: false, error: null, file: null });
                    setSponsorVisaManualReviewConfirmed(false);
                    setSponsorVisaDoc(undefined);
                    sponsorVisaDocRef.current = undefined;
                    await saveDocRefs(buildDocRefs());
                  }}
                />
                {sponsorVisaScan.scannerModal}
                {shouldOfferManualReview(sponsorVisaRejectionCount) && sponsorVisaUI.file && !sponsorVisaDoc?.validated && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
                    <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                      <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this is your sponsor&apos;s residence visa, you can submit it for manual review.
                    </p>
                    <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                      <input
                        type="checkbox"
                        className="mt-0.5 flex-shrink-0"
                        checked={sponsorVisaManualReviewConfirmed}
                        onChange={(e) => setSponsorVisaManualReviewConfirmed(e.target.checked)}
                      />
                      <span>I confirm this is my sponsor&apos;s UAE residence visa. I understand a TME team member will verify it manually.</span>
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSponsorVisaManualReview}
                        disabled={!sponsorVisaManualReviewConfirmed || sponsorVisaManualReviewSubmitting}
                        className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: TME_COLORS.primary }}
                      >
                        {sponsorVisaManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Sponsor EID front + back */}
              <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Sponsor&apos;s Emirates ID <span className="text-red-500">*</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                <div className="flex flex-col">
                  <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Front</p>
                  <div
                    className="flex items-start gap-3 p-4 rounded-lg mb-2"
                    style={{ backgroundColor: '#EBF4FF' }}
                  >
                    <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                    <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                      <p className="font-medium">Front of your sponsor&apos;s Emirates ID.</p>
                      <SampleImageToggle imageSrc="/samples/eid-front-example.png" altText="Example front of sponsor's Emirates ID" label="See example photo" imageClassName="max-w-full h-auto" />
                    </div>
                  </div>
                  <UploadSlot
                    label=""
                    description="Front of sponsor's Emirates ID"
                    expectedType="INSIDE_PAGES"
                    accept="application/pdf,image/jpeg,image/png"
                    maxSizeMB={10}
                    file={sponsorEidFrontUI.file}
                    preview={sponsorEidFrontUI.preview || undefined}
                    validated={!!sponsorEidFrontDoc?.validated}
                    validating={sponsorEidFrontUI.validating}
                    error={sponsorEidFrontUI.error || undefined}
                    onUpload={sponsorEidFrontScan.intercepted}
                    onRemove={async () => {
                      setSponsorEidFrontUI({ preview: null, validating: false, error: null, file: null });
                      setSponsorEidFrontManualReviewConfirmed(false);
                      setSponsorEidFrontDoc(undefined);
                      sponsorEidFrontDocRef.current = undefined;
                      await saveDocRefs(buildDocRefs());
                    }}
                  />
                  {sponsorEidFrontScan.scannerModal}
                  {shouldOfferManualReview(sponsorEidFrontRejectionCount) && sponsorEidFrontUI.file && !sponsorEidFrontDoc?.validated && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
                      <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                        <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this is the front of your sponsor&apos;s Emirates ID, you can submit it for manual review.
                      </p>
                      <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-0.5 flex-shrink-0"
                          checked={sponsorEidFrontManualReviewConfirmed}
                          onChange={(e) => setSponsorEidFrontManualReviewConfirmed(e.target.checked)}
                        />
                        <span>I confirm this is the front of my sponsor&apos;s Emirates ID. I understand a TME team member will verify it manually.</span>
                      </label>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleSponsorEidFrontManualReview}
                          disabled={!sponsorEidFrontManualReviewConfirmed || sponsorEidFrontManualReviewSubmitting}
                          className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ backgroundColor: TME_COLORS.primary }}
                        >
                          {sponsorEidFrontManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>Back</p>
                  <div
                    className="flex items-start gap-3 p-4 rounded-lg mb-2"
                    style={{ backgroundColor: '#EBF4FF' }}
                  >
                    <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                    <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                      <p className="font-medium">Back of your sponsor&apos;s Emirates ID.</p>
                      <SampleImageToggle imageSrc="/samples/eid-back-example.png" altText="Example back of sponsor's Emirates ID" label="See example photo" imageClassName="max-w-full h-auto" />
                    </div>
                  </div>
                  <UploadSlot
                    label=""
                    description="Back of sponsor's Emirates ID"
                    expectedType="INSIDE_PAGES"
                    accept="application/pdf,image/jpeg,image/png"
                    maxSizeMB={10}
                    file={sponsorEidBackUI.file}
                    preview={sponsorEidBackUI.preview || undefined}
                    validated={!!sponsorEidBackDoc?.validated}
                    validating={sponsorEidBackUI.validating}
                    error={sponsorEidBackUI.error || undefined}
                    onUpload={sponsorEidBackScan.intercepted}
                    onRemove={async () => {
                      setSponsorEidBackUI({ preview: null, validating: false, error: null, file: null });
                      setSponsorEidBackManualReviewConfirmed(false);
                      setSponsorEidBackDoc(undefined);
                      sponsorEidBackDocRef.current = undefined;
                      await saveDocRefs(buildDocRefs());
                    }}
                  />
                  {sponsorEidBackScan.scannerModal}
                  {shouldOfferManualReview(sponsorEidBackRejectionCount) && sponsorEidBackUI.file && !sponsorEidBackDoc?.validated && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
                      <p className="text-sm" style={{ color: TME_COLORS.primary }}>
                        <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this is the back of your sponsor&apos;s Emirates ID, you can submit it for manual review.
                      </p>
                      <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-0.5 flex-shrink-0"
                          checked={sponsorEidBackManualReviewConfirmed}
                          onChange={(e) => setSponsorEidBackManualReviewConfirmed(e.target.checked)}
                        />
                        <span>I confirm this is the back of my sponsor&apos;s Emirates ID. I understand a TME team member will verify it manually.</span>
                      </label>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleSponsorEidBackManualReview}
                          disabled={!sponsorEidBackManualReviewConfirmed || sponsorEidBackManualReviewSubmitting}
                          className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ backgroundColor: TME_COLORS.primary }}
                        >
                          {sponsorEidBackManualReviewSubmitting ? 'Submitting...' : 'Submit for manual review'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </FormSection>

          {/* Sponsor metadata — NOC merge fields */}
          <FormSection
            title="Sponsor Details"
            icon={<User className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Sponsor's Full Name"
                  required
                  value={sponsorName || ''}
                  onChange={(e) => setValue('sponsor_name', e.target.value)}
                  onBlur={(e) => setValue('sponsor_name', normalizePersonName(e.target.value))}
                />
                <CustomDropdown
                  label="Sponsor's Nationality"
                  options={SORTED_NATIONALITIES.map((n) => ({ value: n, label: n }))}
                  value={sponsorNationality || ''}
                  onChange={(val) => setValue('sponsor_nationality', val)}
                  placeholder="Select nationality"
                  required
                  searchable
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Sponsor's Passport Number"
                  required
                  value={sponsorPassportNumber || ''}
                  onChange={(e) => setValue('sponsor_passport_number', e.target.value)}
                />
                <CustomDropdown
                  label="Relationship to You"
                  options={relationshipOptions}
                  value={sponsorRelationship || ''}
                  onChange={(val) => setValue('sponsor_relationship', val as 'husband' | 'wife' | 'father' | 'mother' | 'son' | 'daughter')}
                  placeholder="Select relationship"
                  required
                />
              </div>
              <PhoneInput
                label="Sponsor's Mobile"
                value={sponsorMobile}
                onChange={(value) => setValue('sponsor_mobile', value || '')}
                defaultCountry="AE"
              />
            </div>
          </FormSection>

          {/* Inline NOC letter review + sponsor signature */}
          <FormSection
            title="No Objection Certificate (NOC)"
            icon={<FileSignature className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Please review the No Objection Certificate below. The sponsor must read and sign it to
                confirm they have no objection to you working at the company.
              </p>
              <div className="rounded-lg border-2 border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
                {buildNocText({
                  sponsorName,
                  sponsorNationality,
                  sponsorPassportNumber,
                  sponsorMobile,
                  relationship: sponsorRelationship,
                  dependentName: fullName,
                  dependentNationality: nationality,
                  dependentPassportNumber: passportNumber,
                  dependentGender: gender,
                  companyName: nocCompanyName,
                  jobTitle: nocJobTitle,
                })}
              </div>
              <SignaturePad
                onSignatureChange={(value) => {
                  setSponsorSignature(value);
                  setValue('sponsor_noc_signature', value ?? undefined);
                  setValue('sponsor_noc_signed_at', value ? new Date().toISOString() : undefined);
                  if (value && sponsorError) setSponsorError(null);
                }}
                disabled={isSubmitting}
                label="Sponsor Signature (NOC)"
                initialValue={sponsorSignature}
              />
              {sponsorError && (
                <p className="text-sm text-red-500">{sponsorError}</p>
              )}
            </div>
          </FormSection>

          {/* Sponsor step is the FINAL step for family-sponsored applicants:
              Back returns to Review & Sign (8); the form is submitted via the
              Submit button below (the form's only submit). */}
          {viewingStep === 9 && (
            <div className="flex justify-between items-center mt-6">
              <button
                type="button"
                onClick={() => setViewingStep(8)}
                className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border-2 hover:bg-gray-50"
                style={{ color: TME_COLORS.primary, borderColor: TME_COLORS.primary }}
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <Button
                type="submit"
                loading={isSubmitting}
                size="lg"
              >
                {submission.onboarding_type === 'renewal' ? 'Submit Renewal Form' : 'Submit Onboarding Form'}
              </Button>
            </div>
          )}
        </div>
      </RevealSection>
      )}

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
                  initialValue={signature}
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

          {/* Non-family: Review & Sign is the FINAL step — submit here. */}
          {!isFamilySponsored && (
            <div className="flex justify-end mt-6">
              <Button
                type="submit"
                loading={isSubmitting}
                size="lg"
              >
                {submission.onboarding_type === 'renewal' ? 'Submit Renewal Form' : 'Submit Onboarding Form'}
              </Button>
            </div>
          )}

          {/* Family-sponsored: the sponsor signs the NOC AFTER review, so this
              is not the final step. Continue to the Sponsor step (9) once the
              employee signature is present; Back returns to Education (7). */}
          {isFamilySponsored && (
            <StepNavButtons
              enabled={!!signature || reuseEmployerSignature}
              onContinue={() => setViewingStep(9)}
              onBack={() => setViewingStep(7)}
            />
          )}
        </div>
      </RevealSection>
    </form>
  );
}
