'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TME_COLORS,
  NATIONALITIES,
  RELIGIONS,
  MARITAL_STATUS_OPTIONS,
  UAE_EMIRATES,
} from '@/lib/constants';
import { Input, Button, CustomDropdown, CustomDatePicker, PhoneInput } from '@/components/ui';
import { SignaturePad } from '@/components/SignatureCanvas';
import { PhotoUpload } from '@/components/PhotoUpload';
import { UploadSlot } from '@/components/UploadSlot';
import { FileUploadSlot } from '@/components/FileUploadSlot';
import { useScannerIntercept } from '@/components/DocumentScanner';
import { SampleImageToggle } from '@/components/SampleImageToggle';
import type {
  DependentFormData,
  DependentPrefillData,
  EmployeeFormData,
  PassportPageReference,
  StaffDocumentReferences,
  StaffOnboardingSubmission,
} from '@/types';
import {
  mergeStaffDocRefs,
  shouldOfferManualReview,
  buildManualReviewPageRef,
  passportAdditionalPageVariant,
  isPakistaniNationality,
  initialIsInUae,
} from '@/lib/staff-form-logic';
import { isUaeIban, validateIbanFormat } from '@/lib/uae-bank-directory';
import {
  uploadDocument,
  uploadPassportPage,
  updateDocumentReferences,
  autoSaveEmployeeData,
  getDocumentUrl,
} from '@/lib/supabase';
import { calculateFullName, compressImageForAI, normalizePersonName } from '@/lib/utils';
import { singlePagePdfError } from '@/lib/single-page-pdf';
import { useIsMobile } from '@/lib/useIsMobile';
import ExistingDocPreview from '@/components/ExistingDocPreview';
import { nationalityToCountryCode, resolveExtractedNationality } from '@/lib/country-utils';
import {
  AlertTriangle,
  Camera,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileSignature,
  FileText,
  Info,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';

/**
 * Sponsor-facing form for the dependent flows. An existing staff member (the
 * sponsor) fills it in for their spouse / child / parent / maid:
 *
 *   - `dependent`         — first registration. On submit the portal creates a
 *                           `client_staff_dependents` row from the payload.
 *   - `dependent_renewal` — the dependent is already on file and their
 *                           residence visa is being renewed. Same eight
 *                           internal steps, but steps 4 (Relationship
 *                           Certificate — already attested and on record) and
 *                           5 (UAE Visa History — self-evident) are hidden, so
 *                           the sponsor sees 6 steps; every personal/address/
 *                           contact field arrives prefilled from
 *                           `prefill_employee_data`; the passport on file can
 *                           be confirmed unchanged instead of re-uploaded; and
 *                           the photo must be a NEW one (reuse protection).
 *
 * Both write the same `employee_data` shape and go through
 * `/api/submit-dependent`; the signature is always required.
 *
 * Lean standalone component in the shape of DocumentRequestForm (own useForm,
 * own submit call) with the passport / photo / personal-detail / address /
 * contact sections copied from EmployeeForm so the UX — AI validation,
 * 2-strike manual review, sample toggles, progressive reveal — matches the
 * employment-visa flow the same users already know.
 *
 * Deliberately NOT here: the photo compare-photo check (there is no photo on
 * file to compare against), education/bank/visa-category steps, and the NOC.
 */

interface DependentFormProps {
  submission: StaffOnboardingSubmission;
  onSubmitted: () => void;
}

// Sort lists alphabetically (with "Other" at the end) — same helper as EmployeeForm.
const sortWithOtherLast = (items: readonly string[]) =>
  [...items].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

const SORTED_NATIONALITIES = sortWithOtherLast(NATIONALITIES);
const SORTED_RELIGIONS = sortWithOtherLast(RELIGIONS);

// --- Step definitions for progressive reveal ---
// Internal step indices are STABLE (1..8) in both modes, so every gate, reveal
// condition, and navigation target reads the same whether or not this is a
// renewal. What changes is which indices are VISIBLE: a renewal drops step 4
// (Relationship Certificate — the attested certificate is already on file) and
// step 5 (UAE Visa History — self-evident on a renewal). StepProgress and the
// FormSection badges derive the displayed "Step X of Y" numbering from the
// visible array's positions, exactly like EmployeeForm's visibleStepIndices.
const STEP_LABELS = [
  'ID Photo',
  'Passport',
  'Personal Details',
  'Relationship Certificate',
  'UAE Visa History',
  'Address',
  'Contact Details',
  'Review & Sign',
];
const ONBOARDING_STEP_INDICES = [1, 2, 3, 4, 5, 6, 7, 8];
const RENEWAL_STEP_INDICES = [1, 2, 3, 6, 7, 8];

/**
 * Fields a renewal seeds from `prefill_employee_data`.
 *
 * The portal writes the dependent's current field block using the SAME key
 * names and date-string formats this form emits into `employee_data`, so the
 * seed is a straight copy. This is an explicit ALLOW-LIST, not a spread:
 *   - `sponsor_*` are display/contact metadata for the "use my number/email"
 *     checkboxes and must never end up in the submitted payload;
 *   - `certificate_attestation_confirmed` is an attestation the sponsor makes
 *     in THIS session — a renewal never re-asks it, so it is never re-asserted;
 *   - `previously_held_uae_visa` IS carried through (a factual attribute of
 *     the dependent, already known) even though the step that collects it is
 *     hidden and the renewal gate does not require it;
 *   - anything the portal adds later is ignored until it is listed here.
 * Every key is optional: a missing one simply leaves that input blank.
 */
const PREFILL_SEEDED_KEYS = [
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'nationality',
  'date_of_birth',
  'gender',
  'passport_no',
  'passport_issue_date',
  'passport_expiry',
  'mother_full_name',
  'father_full_name',
  'religion',
  'marital_status',
  'previously_held_uae_visa',
  'uae_presence',
  'uae_street_address',
  'uae_city',
  'uae_postal_code',
  'uae_emirate',
  'home_street_address',
  'home_city',
  'home_country',
  'home_postal_code',
  'mobile_uae',
  'mobile_uae_use_sponsor',
  'mobile_home_country',
  'mobile_home_use_sponsor',
  'email',
  'email_use_sponsor',
  'other_information',
] as const satisfies readonly (keyof DependentFormData)[];

function seedFromPrefill(prefill: DependentPrefillData): Partial<DependentFormData> {
  const seeded: Record<string, unknown> = {};
  for (const key of PREFILL_SEEDED_KEYS) {
    const value = prefill[key];
    if (value !== undefined && value !== null && value !== '') seeded[key] = value;
  }
  return seeded as Partial<DependentFormData>;
}

/**
 * Relationship-driven certificate set (CS amendments 13.08).
 *
 * `relationship_certificate` stays the PRIMARY slot for every relationship;
 * the matrix adds `marriage_certificate` and, for the parent relationships, a
 * mandatory "marital status of the parents" select that conditionally demands
 * `divorce_certificate` / `death_certificate`. The doc type keys are a fixed
 * contract with the portal — only the labels differ per relationship.
 *
 * Maid is no longer offered a link by the portal; a legacy prefill (or an
 * unknown/absent relationship) falls back to the generic single-certificate
 * behavior instead of crashing.
 */
interface CertificateSet {
  /** Label for the primary `relationship_certificate` slot. */
  primaryLabel: string;
  /** When set, `marriage_certificate` is required, under this label. */
  marriageLabel?: string;
  /** When set, the parents' marital-status select is required, under this label. */
  maritalSelectLabel?: string;
  /** Son/Daughter only: show the NOC info note once the dependent is 18+. */
  childAgeNote?: boolean;
}

function certificateSetFor(dependentType: string | undefined): CertificateSet {
  switch (dependentType) {
    case 'Spouse':
      return { primaryLabel: 'Marriage Certificate (attested)' };
    case 'Son':
    case 'Daughter':
      return {
        primaryLabel: 'Birth Certificate of the Child (attested)',
        marriageLabel: 'Marriage Certificate of the Parents (attested)',
        childAgeNote: true,
      };
    case 'Father':
    case 'Mother':
      return {
        primaryLabel: 'Birth Certificate of the Sponsor (attested)',
        marriageLabel: "Marriage Certificate of the Sponsor's Parents (attested)",
        maritalSelectLabel: "Marital Status of the Sponsor's Parents",
      };
    case 'Father-in-Law':
    case 'Mother-in-Law':
      return {
        primaryLabel: 'Birth Certificate of the Spouse (attested)',
        marriageLabel: 'Marriage Certificate of Sponsor and Spouse (attested)',
        maritalSelectLabel: "Marital Status of the Spouse's Parents",
      };
    default:
      // Maid / legacy / unknown — generic single certificate.
      return { primaryLabel: 'Proof of Relationship (attested)' };
  }
}

/**
 * Age in whole years from the stored DOB. CustomDatePicker keeps
 * `date_of_birth` as dd.mm.yyyy; prefill/extraction may supply ISO
 * YYYY-MM-DD. Both carry a 4-digit year, so neither can hit the dd.mm.yy
 * 69-pivot trap. Anything else (partial, 2-digit year) returns null and the
 * caller simply shows no age-dependent note.
 */
function ageFromIsoDate(dob: string | undefined): number | null {
  if (!dob) return null;
  let year: number, month: number, day: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    [year, month, day] = dob.split('-').map(Number);
  } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(dob)) {
    [day, month, year] = dob.split('.').map(Number);
  } else {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - year;
  const m = today.getMonth() + 1;
  if (m < month || (m === month && today.getDate() < day)) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/** UAE IBAN check: AE + 21 digits (23 chars), spaces tolerated/stripped. */
function isValidSponsorIban(value: string | undefined): boolean {
  const clean = (value ?? '').replace(/\s+/g, '').toUpperCase();
  return isUaeIban(clean) && validateIbanFormat(clean).valid;
}

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
  stepIndices,
  onStepClick,
}: {
  currentStep: number;
  viewingStep: number;
  /** Visible internal step indices, in display order. */
  stepIndices: number[];
  onStepClick: (step: number) => void;
}) {
  const steps = stepIndices;
  const total = steps.length;
  const position = steps.indexOf(viewingStep);
  const displayedStep = position < 0 ? viewingStep : position + 1;
  const prevStep = position > 0 ? steps[position - 1] : viewingStep;
  const nextStep = position >= 0 && position < total - 1 ? steps[position + 1] : viewingStep;
  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-sm mb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStepClick(prevStep)}
            disabled={position <= 0}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: TME_COLORS.primary }}>
            Step {displayedStep} of {total}
          </span>
          <button
            type="button"
            onClick={() => onStepClick(nextStep)}
            disabled={nextStep === viewingStep || nextStep > currentStep}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${TME_COLORS.primary}15`, color: TME_COLORS.primary }}
        >
          {STEP_LABELS[viewingStep - 1] || ''}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        {steps.map((step) => {
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
                isViewing ? '' : isCompleted ? 'bg-green-400' : isCurrent ? '' : 'bg-gray-200'
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

function RevealSection({ show, children }: { show: boolean; children: React.ReactNode }) {
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export function DependentForm({ submission, onSubmitted }: DependentFormProps) {
  // Token from the URL (`/onboard/<id>?token=...`) — required by the AI
  // validate/extract routes and the autosave + documents write routes.
  const aiToken = useSearchParams().get('token');
  const isMobile = useIsMobile();
  const submissionId = submission.id;

  const saveDocRefs = useCallback(
    (docs: StaffDocumentReferences) => updateDocumentReferences(submissionId, docs, aiToken),
    [submissionId, aiToken],
  );
  const autoSave = useCallback(
    (data: Partial<DependentFormData>) =>
      // The autosave route writes the object into employee_data verbatim; the
      // shared helper is typed against the employee payload.
      autoSaveEmployeeData(submissionId, data as unknown as Partial<EmployeeFormData>, aiToken),
    [submissionId, aiToken],
  );

  // Renewal mode: the dependent is already on file and their residence visa is
  // being renewed. Same form, minus the two steps a renewal doesn't re-collect
  // (certificate + visa history), plus a prefilled field block, the
  // "passport unchanged" confirmation panel, and the same-photo protection.
  const isRenewal = submission.onboarding_type === 'dependent_renewal';

  // Portal-written prefill: relationship + sponsor display/contact details,
  // plus — on a renewal — the dependent's full current field block.
  const prefill = (submission.prefill_employee_data ?? {}) as unknown as DependentPrefillData;
  // Saved draft (autosave writes the dependent payload into employee_data).
  const saved = (submission.employee_data ?? null) as unknown as Partial<DependentFormData> | null;
  const dependentType = prefill.dependent_type ?? saved?.dependent_type;
  const certSet = certificateSetFor(dependentType);
  // Whether the relationship demands more than the single primary certificate
  // — drives the pluralized info-box + attestation wording.
  const multipleCertificates = !!certSet.marriageLabel;
  const sponsorMobile = prefill.sponsor_mobile;
  // Distinct number for the Home Country Mobile checkbox — copying the
  // sponsor's UAE number into an "outside the UAE" field was wrong.
  const sponsorHomeMobile = prefill.sponsor_mobile_home;
  const sponsorEmail = prefill.sponsor_email;
  // Renewal seed (allow-listed prefill fields). Null on a first registration,
  // where only the three name fields may be prefilled.
  const prefillSeed = isRenewal ? seedFromPrefill(prefill) : null;

  // Visible steps + the display-position helpers (see STEP_LABELS above).
  const stepIndices = isRenewal ? RENEWAL_STEP_INDICES : ONBOARDING_STEP_INDICES;
  const displayedStepNumber = (internal: number): number => {
    const idx = stepIndices.indexOf(internal);
    return idx < 0 ? internal : idx + 1;
  };
  const stepAfter = (internal: number): number => {
    const idx = stepIndices.indexOf(internal);
    return idx >= 0 && idx < stepIndices.length - 1 ? stepIndices[idx + 1] : internal;
  };
  const stepBefore = (internal: number): number => {
    const idx = stepIndices.indexOf(internal);
    return idx > 0 ? stepIndices[idx - 1] : internal;
  };

  const [signature, setSignature] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  // Renewal only: the mandatory "details on file are still up to date" tick.
  const [detailsConfirmError, setDetailsConfirmError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [passportError, setPassportError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // --- Document state ---
  const [photoDoc, setPhotoDoc] = useState(submission.documents?.photo);
  const [passportPages, setPassportPages] = useState<{
    cover?: PassportPageReference;
    insidePages?: PassportPageReference;
    additionalPage?: PassportPageReference;
  }>(submission.documents?.passportPages || {});
  // First registrations only: surfaced when the final-submit re-check finds
  // the certificate section incomplete (it can regress as late as Review —
  // parents' marital status flipped, certificate removed).
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [certificateDoc, setCertificateDoc] = useState(submission.documents?.relationship_certificate);
  const [marriageCertDoc, setMarriageCertDoc] = useState(submission.documents?.marriage_certificate);
  const [divorceCertDoc, setDivorceCertDoc] = useState(submission.documents?.divorce_certificate);
  const [deathCertDoc, setDeathCertDoc] = useState(submission.documents?.death_certificate);
  const [previousVisaDoc, setPreviousVisaDoc] = useState(submission.documents?.previous_visa);
  const [previousEidFrontDoc, setPreviousEidFrontDoc] = useState(submission.documents?.previous_eid_front);
  const [previousEidBackDoc, setPreviousEidBackDoc] = useState(submission.documents?.previous_eid_back);

  const photoDocRef = useRef(photoDoc);
  const passportPagesRef = useRef(passportPages);
  const certificateDocRef = useRef(certificateDoc);
  const marriageCertDocRef = useRef(marriageCertDoc);
  const divorceCertDocRef = useRef(divorceCertDoc);
  const deathCertDocRef = useRef(deathCertDoc);
  const previousVisaDocRef = useRef(previousVisaDoc);
  const previousEidFrontDocRef = useRef(previousEidFrontDoc);
  const previousEidBackDocRef = useRef(previousEidBackDoc);
  useEffect(() => { photoDocRef.current = photoDoc; }, [photoDoc]);
  useEffect(() => { passportPagesRef.current = passportPages; }, [passportPages]);
  useEffect(() => { certificateDocRef.current = certificateDoc; }, [certificateDoc]);
  useEffect(() => { marriageCertDocRef.current = marriageCertDoc; }, [marriageCertDoc]);
  useEffect(() => { divorceCertDocRef.current = divorceCertDoc; }, [divorceCertDoc]);
  useEffect(() => { deathCertDocRef.current = deathCertDoc; }, [deathCertDoc]);
  useEffect(() => { previousVisaDocRef.current = previousVisaDoc; }, [previousVisaDoc]);
  useEffect(() => { previousEidFrontDocRef.current = previousEidFrontDoc; }, [previousEidFrontDoc]);
  useEffect(() => { previousEidBackDocRef.current = previousEidBackDoc; }, [previousEidBackDoc]);

  // Pakistani National ID (front + back) — conditional on the DEPENDENT's
  // nationality being Pakistan. Same UI-state split + AI side-check as the
  // EmployeeForm pattern this form was cloned from.
  const [pakistanIdFrontDoc, setPakistanIdFrontDoc] = useState(submission.documents?.pakistan_id_front);
  const [pakistanIdBackDoc, setPakistanIdBackDoc] = useState(submission.documents?.pakistan_id_back);
  const [pakistanIdFrontUI, setPakistanIdFrontUI] = useState({
    preview: submission.documents?.pakistan_id_front?.path ? getDocumentUrl(submission.documents.pakistan_id_front.path) : (null as string | null),
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });
  const [pakistanIdBackUI, setPakistanIdBackUI] = useState({
    preview: submission.documents?.pakistan_id_back?.path ? getDocumentUrl(submission.documents.pakistan_id_back.path) : (null as string | null),
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });
  const pakistanIdFrontDocRef = useRef(pakistanIdFrontDoc);
  const pakistanIdBackDocRef = useRef(pakistanIdBackDoc);
  useEffect(() => { pakistanIdFrontDocRef.current = pakistanIdFrontDoc; }, [pakistanIdFrontDoc]);
  useEffect(() => { pakistanIdBackDocRef.current = pakistanIdBackDoc; }, [pakistanIdBackDoc]);
  const [pakistanIdError, setPakistanIdError] = useState<string | null>(null);

  // --- Renewal: what the portal already holds for this dependent ---
  const existingDocs = submission.existing_documents;
  // The "passport unchanged" skip is only legitimate when BOTH pages are
  // actually on file — with only one of them, confirming "same as shown" would
  // attest a page TME never had. Mirrors EmployeeForm's hasExistingPassport and
  // the server gate in missingDependentRenewalRequirements.
  const hasExistingPassport = !!(
    existingDocs?.passport_cover?.path && existingDocs?.passport_inside?.path
  );
  // Seeded from the PERSISTED attestation so a mid-flow refresh doesn't throw
  // the sponsor back to the passport step (the flag is what the server gate
  // reads, so it is the authoritative record of the choice).
  const [passportConfirmed, setPassportConfirmed] = useState(
    submission.documents?.passport_unchanged === true,
  );
  // Seeded true when the saved refs already carry freshly uploaded passport
  // pages and the "unchanged" attestation is NOT standing: the sponsor already
  // chose "the passport has changed" and uploaded at least one page, so a
  // refresh must land back on the upload steps. Without this the confirm panel
  // reappears and hides work already done. Renewal only — on a first
  // registration the panel never renders and this stays false.
  const [passportChanged, setPassportChanged] = useState(
    isRenewal &&
      submission.documents?.passport_unchanged !== true &&
      !!(
        submission.documents?.passportPages?.cover?.path ||
        submission.documents?.passportPages?.insidePages?.path ||
        submission.documents?.passportPages?.additionalPage?.path
      ),
  );
  // Lives in a ref (not just state) because buildDocRefs merges from the
  // INITIAL submission.documents — without threading it through every save, a
  // later saveDocRefs call would silently drop the flag.
  const passportUnchangedRef = useRef<boolean | undefined>(
    submission.documents?.passport_unchanged,
  );

  // Passport upload UI state (preview / validating / error), separate from the
  // persisted refs — same split as EmployeeForm.
  const initCover = submission.documents?.passportPages?.cover;
  const initInside = submission.documents?.passportPages?.insidePages;
  const initAdditional = submission.documents?.passportPages?.additionalPage;
  const [coverUI, setCoverUI] = useState({
    preview: initCover?.path ? getDocumentUrl(initCover.path) : (null as string | null),
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });
  const [insideUI, setInsideUI] = useState({
    preview: initInside?.path ? getDocumentUrl(initInside.path) : (null as string | null),
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });
  const [additionalPageUI, setAdditionalPageUI] = useState({
    preview: initAdditional?.path ? getDocumentUrl(initAdditional.path) : (null as string | null),
    validating: false,
    error: null as string | null,
    file: null as File | null,
  });

  // 2-strike manual-review counters (threshold + helpers in staff-form-logic).
  const [coverRejectionCount, setCoverRejectionCount] = useState(0);
  const [insideRejectionCount, setInsideRejectionCount] = useState(0);
  const [additionalRejectionCount, setAdditionalRejectionCount] = useState(0);
  const [photoRejectionCount, setPhotoRejectionCount] = useState(0);
  const [coverManualReviewConfirmed, setCoverManualReviewConfirmed] = useState(false);
  const [insideManualReviewConfirmed, setInsideManualReviewConfirmed] = useState(false);
  const [additionalManualReviewConfirmed, setAdditionalManualReviewConfirmed] = useState(false);
  const [photoManualReviewConfirmed, setPhotoManualReviewConfirmed] = useState(false);
  const [coverManualReviewSubmitting, setCoverManualReviewSubmitting] = useState(false);
  const [insideManualReviewSubmitting, setInsideManualReviewSubmitting] = useState(false);
  const [additionalManualReviewSubmitting, setAdditionalManualReviewSubmitting] = useState(false);
  const [photoManualReviewSubmitting, setPhotoManualReviewSubmitting] = useState(false);

  const [extractingPassport, setExtractingPassport] = useState(false);
  // A renewal arrives with the identity block already prefilled, so the data
  // is "ready" from the start — same rule as EmployeeForm (a first name in the
  // payload means extraction already happened, here or on a previous visa).
  const [passportDataReady, setPassportDataReady] = useState(
    !!saved?.first_name || (isRenewal && !!prefill.first_name),
  );

  // --- Form ---
  // NOTE: `uae_presence` deliberately has NO default here. A hidden
  // react-hook-form default is what made applicants abroad submit 'inside'
  // with no UAE address; the checkbox state below is the single source and is
  // pushed into the form on mount (see the sync effect).
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<DependentFormData>({
    defaultValues: {
      // Renewal: seed EVERY prefilled field, not just the names. Only the
      // allow-listed keys are taken (see PREFILL_SEEDED_KEYS) so sponsor
      // metadata and anything else the portal may add can never leak into the
      // submitted payload. A saved draft always wins over the prefill.
      ...(prefillSeed ?? {}),
      ...(prefill.first_name ? { first_name: prefill.first_name } : {}),
      ...(prefill.middle_name ? { middle_name: prefill.middle_name } : {}),
      ...(prefill.last_name ? { last_name: prefill.last_name } : {}),
      // Sponsor's UAE IBAN from client_staff.bank_iban (when on file) —
      // editable, both modes; a saved draft below still wins.
      ...(prefill.sponsor_bank_iban ? { sponsor_iban: prefill.sponsor_bank_iban } : {}),
      ...(saved ?? {}),
      dependent_type: dependentType,
    },
  });

  // Fields written through setValue must be registered explicitly.
  useEffect(() => {
    register('nationality');
    register('gender');
    register('date_of_birth');
    register('passport_issue_date');
    register('passport_expiry');
    register('religion');
    register('marital_status');
    register('dependent_type');
    register('previously_held_uae_visa');
    register('certificate_attestation_confirmed');
    register('parents_marital_status');
    register('details_confirmed_up_to_date');
    register('uae_presence');
    register('uae_emirate');
    register('home_country');
    register('mobile_uae');
    register('mobile_uae_use_sponsor');
    register('mobile_home_country');
    register('mobile_home_use_sponsor');
    register('email_use_sponsor');
    register('full_name');
  }, [register]);

  const firstName = watch('first_name');
  const middleName = watch('middle_name');
  const lastName = watch('last_name');
  const nationality = watch('nationality');
  const gender = watch('gender');
  const dateOfBirth = watch('date_of_birth');
  const passportIssueDate = watch('passport_issue_date');
  const passportExpiry = watch('passport_expiry');
  const passportNo = watch('passport_no');
  const motherFullName = watch('mother_full_name');
  const fatherFullName = watch('father_full_name');
  const religion = watch('religion');
  const maritalStatus = watch('marital_status');
  const homeStreetAddress = watch('home_street_address');
  const homeCity = watch('home_city');
  const homeCountry = watch('home_country');
  const uaeStreetAddress = watch('uae_street_address');
  const uaeCity = watch('uae_city');
  const uaeEmirate = watch('uae_emirate');
  const mobileUae = watch('mobile_uae');
  const mobileHomeCountry = watch('mobile_home_country');
  const email = watch('email');
  const mobileUaeUseSponsor = watch('mobile_uae_use_sponsor') === true;
  const mobileHomeUseSponsor = watch('mobile_home_use_sponsor') === true;
  const emailUseSponsor = watch('email_use_sponsor') === true;
  const attestationConfirmed = watch('certificate_attestation_confirmed') === true;
  const sponsorIban = watch('sponsor_iban');
  const detailsConfirmed = watch('details_confirmed_up_to_date') === true;

  // CS feedback 21.08: the parents' marital status is asked ONCE — Step 3's
  // Marital Status field IS it (for the parent relationships the dependent is
  // one of the sponsor's/spouse's parents). Step 4 derives from it instead of
  // asking again: Widowed maps to the portal's 'Deceased'; Single (never
  // married) demands no marriage certificate at all.
  const derivedParentsStatus: 'Married' | 'Divorced' | 'Deceased' | undefined =
    certSet.maritalSelectLabel
      ? maritalStatus === 'Married' || maritalStatus === 'Divorced'
        ? maritalStatus
        : maritalStatus === 'Widowed'
          ? 'Deceased'
          : undefined
      : undefined;
  // Divorced/deceased parents need no marriage certificate (confirmed by
  // Ulesh, CS feedback 21.08); Son/Daughter keep it unconditionally.
  const marriageCertNeeded =
    !!certSet.marriageLabel && (!certSet.maritalSelectLabel || derivedParentsStatus === 'Married');

  // Keep the synced payload field in step with the derived value — the portal
  // contract (`parents_marital_status`, migration 442) is unchanged.
  useEffect(() => {
    setValue('parents_marital_status', derivedParentsStatus);
  }, [derivedParentsStatus, setValue]);

  const nationalityCountryCode = nationality ? nationalityToCountryCode(nationality) : undefined;

  // Auto-calculate full name (blank family names are fine — see the
  // soft-confirm below; calculateFullName drops empty parts).
  useEffect(() => {
    if (firstName || lastName) {
      setValue('full_name', calculateFullName(firstName || '', middleName, lastName || ''));
    }
  }, [firstName, middleName, lastName, setValue]);

  // Pre-fill Home Country from nationality (same as EmployeeForm).
  useEffect(() => {
    if (nationality && !homeCountry) {
      setValue('home_country', nationality);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nationality]);

  // A spouse of the sponsor is married by definition — seed it so the form
  // can't ship the contradiction "Relationship: Spouse / Marital Status:
  // Single". Only ever fills a BLANK value, so it never overrides a renewal
  // prefill, a restored draft, or a choice the sponsor already made (the
  // dropdown has no empty option, so once set this cannot re-fire). The
  // sponsor can still change it — a spouse mid-divorce is a real case.
  useEffect(() => {
    if (dependentType === 'Spouse' && !maritalStatus) {
      setValue('marital_status', 'Married');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependentType, maritalStatus]);

  // "Is the dependent currently in the UAE?" — explicit state, synced to the
  // form value on mount so a never-touched checkbox can't submit a stale
  // 'inside'. Reuses the shared initializer; its own `isRenewal` flag (which
  // hard-returns true for staff renewals) stays FALSE here — a dependent
  // renewal must still reflect the prefilled uae_presence, which the seed
  // supplies when there is no saved draft yet. There is no employer step on a
  // dependent row, so employer_data is always null.
  const [isInUAE, setIsInUAE] = useState(() =>
    initialIsInUae({ employee_data: (saved ?? prefillSeed) as never, employer_data: null }, false),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setValue('uae_presence', isInUAE ? 'inside' : 'outside');
  }, []);

  // "Previously held a UAE visa?" — tri-state so No is a real answer.
  const [previouslyHeldVisa, setPreviouslyHeldVisa] = useState<boolean | null>(
    typeof saved?.previously_held_uae_visa === 'boolean'
      ? saved.previously_held_uae_visa
      : typeof prefillSeed?.previously_held_uae_visa === 'boolean'
        ? prefillSeed.previously_held_uae_visa
        : null,
  );

  // Blank family name soft-confirm: many passports (e.g. Indian) carry no
  // surname. The first Continue with an empty family name warns; the second
  // proceeds. Reset as soon as a name is typed.
  const [noLastNameWarning, setNoLastNameWarning] = useState(false);
  useEffect(() => {
    if (lastName) setNoLastNameWarning(false);
  }, [lastName]);

  // --- Progressive reveal step computation ---
  const additionalPageVariant = passportAdditionalPageVariant(nationality);
  const isPhotoUploaded = !!photoDoc?.validated;
  const isCoverUploaded = !!passportPages.cover?.validated;
  const isInsidePagesUploaded = !!passportPages.insidePages?.validated;
  const isAdditionalPageUploaded = !!passportPages.additionalPage?.validated;
  const requiresAdditionalPage = !!additionalPageVariant && isInsidePagesUploaded && passportDataReady;
  const additionalPageCopy = additionalPageVariant === 'syria'
    ? {
        title: 'Syrian Passport — Additional Page',
        heading: 'Upload the additional page of the Syrian passport',
        sub: 'This is the page next to the photo page showing the date and place of issue, expiry date, and national number. The issue and expiry dates will be automatically extracted.',
        sampleSrc: '/samples/passport-additional-syria-example.png',
        sampleAlt: 'Example Syrian passport additional page',
        slotDescription: 'Page with date/place of issue and national number',
        successNote: 'Additional page uploaded. Passport issue and expiry dates will be pre-filled.',
        manualNoun: 'Syrian passport additional page (issue details / national number)',
      }
    : {
        title: 'Indian Passport — Additional Page',
        heading: 'Upload the last page of the Indian passport',
        sub: 'This page contains the parents’ names, spouse name, and address. These details will be automatically extracted.',
        sampleSrc: '/samples/passport-additional-example.png',
        sampleAlt: 'Example Indian passport additional page',
        slotDescription: 'Last page with parents’ names and address',
        successNote: 'Additional page uploaded. Family details and address will be pre-filled.',
        manualNoun: 'Indian passport additional page (address / family details)',
      };

  // Renewal skip: the sponsor confirmed the passport on file is unchanged and
  // did not click "the passport has changed". Both existing pages must be on
  // file for the confirmation panel to appear at all.
  const passportSkipped = isRenewal && hasExistingPassport && passportConfirmed && !passportChanged;
  const isPassportComplete =
    passportSkipped ||
    (isCoverUploaded &&
      isInsidePagesUploaded &&
      passportDataReady &&
      (!requiresAdditionalPage || isAdditionalPageUploaded));
  // Family name is deliberately NOT part of the gate — the soft-confirm on
  // Continue handles the no-surname case.
  const isPersonalComplete = !!(
    firstName && nationality && dateOfBirth && gender && passportNo && passportExpiry &&
    motherFullName && fatherFullName && religion && maritalStatus
  );

  // Pakistan National ID (front + back) when the DEPENDENT is Pakistani.
  // Gated exactly like the India/Syria additional page: on a fresh upload
  // path only once the data page is read (nationality may come from the
  // extraction); on the renewal "passport unchanged" skip the nationality is
  // prefilled, so the requirement stands immediately. Copies already on file
  // (renewals) satisfy each side; a fresh upload replaces it — mirrors the
  // server gate in missingDependentRequirements/-RenewalRequirements.
  const isPakistaniDependent = isPakistaniNationality(nationality);
  const requiresPakistanId =
    isPakistaniDependent && (passportSkipped || (isInsidePagesUploaded && passportDataReady));
  const pakistanIdFrontOnFile = !!existingDocs?.pakistan_id_front?.path;
  const pakistanIdBackOnFile = !!existingDocs?.pakistan_id_back?.path;
  const isPakistanIdComplete =
    !requiresPakistanId ||
    ((!!pakistanIdFrontDoc?.path || (isRenewal && pakistanIdFrontOnFile)) &&
      (!!pakistanIdBackDoc?.path || (isRenewal && pakistanIdBackOnFile)));

  // Certificate set per the relationship matrix: primary always, marriage
  // certificate when the matrix adds it, the parents' marital-status select
  // (and its conditional divorce/death certificate) for the parent
  // relationships, plus the mandatory attestation tick.
  const isCertificateComplete =
    !!certificateDoc?.path &&
    (!marriageCertNeeded || !!marriageCertDoc?.path) &&
    (derivedParentsStatus !== 'Divorced' || !!divorceCertDoc?.path) &&
    (derivedParentsStatus !== 'Deceased' || !!deathCertDoc?.path) &&
    attestationConfirmed;
  const isVisaHistoryComplete =
    previouslyHeldVisa === false ||
    (previouslyHeldVisa === true &&
      !!previousVisaDoc?.path &&
      !!previousEidFrontDoc?.path &&
      !!previousEidBackDoc?.path);
  const isAddressComplete = !!(
    homeStreetAddress && homeCity && homeCountry &&
    (!isInUAE || (uaeStreetAddress && uaeCity && uaeEmirate))
  );
  const isSponsorIbanValid = isValidSponsorIban(sponsorIban);
  const isContactComplete = !!(mobileUae && email) && isSponsorIbanValid;

  const computeCurrentStep = useCallback(() => {
    if (!isPhotoUploaded) return 1;
    if (!isPassportComplete) return 2;
    // Pakistan ID lives in step 3 (after nationality confirmation), so it
    // holds the Personal Details step open exactly like the missing fields.
    if (!isPersonalComplete || !isPakistanIdComplete) return 3;
    // Steps 4 + 5 are not collected on a renewal — never gate on them there.
    if (!isRenewal && !isCertificateComplete) return 4;
    if (!isRenewal && !isVisaHistoryComplete) return 5;
    if (!isAddressComplete) return 6;
    if (!isContactComplete) return 7;
    return 8;
  }, [
    isRenewal,
    isPhotoUploaded,
    isPassportComplete,
    isPersonalComplete,
    isPakistanIdComplete,
    isCertificateComplete,
    isVisaHistoryComplete,
    isAddressComplete,
    isContactComplete,
  ]);

  const currentStep = computeCurrentStep();
  const [viewingStep, setViewingStep] = useState(currentStep);

  // Scroll to top on every step transition (blur first so the browser doesn't
  // re-anchor on the focused Continue button) — same treatment as EmployeeForm.
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

  // Debounced autosave, so a refresh doesn't lose the typed data.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (currentStep > 1) autoSave(getValues());
    }, 1000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, viewingStep]);

  // Fallback: inside pages on file from a previous session but extraction
  // never ran — unlock the form (mirrors EmployeeForm).
  useEffect(() => {
    if (isInsidePagesUploaded && !passportDataReady && !extractingPassport) {
      setPassportDataReady(true);
    }
  }, [isInsidePagesUploaded, passportDataReady, extractingPassport]);

  // ------------------------------------------------------------------
  // Document references
  // ------------------------------------------------------------------

  const buildDocRefs = (overrides?: {
    photo?: typeof photoDoc;
    passportPages?: typeof passportPages;
  }): StaffDocumentReferences =>
    mergeStaffDocRefs(submission.documents, {
      photo: overrides?.photo ?? photoDocRef.current,
      passportPages: overrides?.passportPages ?? passportPagesRef.current,
      relationship_certificate: certificateDocRef.current,
      marriage_certificate: marriageCertDocRef.current,
      divorce_certificate: divorceCertDocRef.current,
      death_certificate: deathCertDocRef.current,
      pakistan_id_front: pakistanIdFrontDocRef.current,
      pakistan_id_back: pakistanIdBackDocRef.current,
      previous_visa: previousVisaDocRef.current,
      previous_eid_front: previousEidFrontDocRef.current,
      previous_eid_back: previousEidBackDocRef.current,
      // Renewal only — the persisted "passport unchanged" attestation the
      // server-side gate reads. Never written on a first registration.
      ...(isRenewal ? { passport_unchanged: passportUnchangedRef.current } : {}),
    });

  // ------------------------------------------------------------------
  // Photo — validate-photo on a first registration (no photo on file to
  // compare against, so `existingPhoto` is never passed).
  //
  // On a RENEWAL the photo is always re-uploaded (the authority requires a
  // newly-taken one for the new visa) and `existing_documents.photo` is
  // handed to PhotoUpload, which then runs the same reuse protection as the
  // staff flow: SHA-256 rejection of a byte-identical file (hashed in the
  // browser with SubtleCrypto) plus the server-side vision comparison that
  // catches re-exports/screenshots/scans of the same capture.
  // ------------------------------------------------------------------

  // Whether the vision comparison judged the CURRENT upload to be the same
  // capture as the photo on file. Consumed by the manual-review submit to
  // stamp samePhotoSuspected (the portal folds it into needs_review labels).
  const photoSamePhotoRef = useRef(false);

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

  const handlePhotoManualReview = async () => {
    const current = photoDocRef.current;
    if (!current) return;
    setPhotoManualReviewSubmitting(true);
    const updatedDoc = {
      ...current,
      validated: true,
      needsReview: true,
      // Carry the same-photo verdict of THIS upload (renewals only) so the
      // portal can label the review as a suspected reuse of the photo on file.
      ...(photoSamePhotoRef.current ? { samePhotoSuspected: true } : {}),
    };
    setPhotoDoc(updatedDoc);
    photoDocRef.current = updatedDoc;
    setPhotoError(null);
    await saveDocRefs(buildDocRefs({ photo: updatedDoc }));
    setPhotoRejectionCount(0);
    setPhotoManualReviewConfirmed(false);
    setPhotoManualReviewSubmitting(false);
  };

  // ------------------------------------------------------------------
  // Passport pages — validate, upload, extract (same routes as EmployeeForm)
  // ------------------------------------------------------------------

  const validatePassportPageType = async (
    imageBase64: string,
    expectedType: 'COVER' | 'INSIDE_PAGES' | 'ADDITIONAL_PAGE',
  ) => {
    try {
      const compressedImage = await compressImageForAI(imageBase64);
      const response = await fetch('/api/validate-passport-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: compressedImage,
          expectedType,
          // Selects the additional-page prompt variant server-side; ignored
          // for cover/inside checks.
          nationality,
          submissionId: submission.id,
          token: aiToken,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
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
        if (result.success && result.data) return result.data as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  /**
   * Apply extracted passport fields to the dependent payload. The extractor
   * speaks the employee vocabulary (family_name / passport_expiry_date), so
   * map those onto the dependent keys and drop the fields this form has no
   * home for (title, place of birth, father's name, ...).
   */
  const handlePassportExtracted = (data: Record<string, unknown>) => {
    const setIf = (key: keyof DependentFormData, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') {
        setValue(key, value as never);
      }
    };
    setIf('first_name', data.first_name);
    setIf('middle_name', data.middle_name);
    setIf('last_name', (data.family_name ?? data.last_name) as string | undefined);
    setIf('passport_no', (data.passport_no ?? data.passport_number) as string | undefined);
    setIf('passport_issue_date', data.passport_issue_date);
    setIf('passport_expiry', (data.passport_expiry_date ?? data.passport_expiry) as string | undefined);
    setIf('date_of_birth', data.date_of_birth);
    if (typeof data.gender === 'string') {
      setValue('gender', data.gender.toLowerCase() as 'male' | 'female');
    }
    if (typeof data.nationality === 'string') {
      // Passports print demonyms / long official names — resolve onto a
      // NATIONALITIES entry so the dropdown actually selects it.
      const resolved = resolveExtractedNationality(data.nationality, NATIONALITIES);
      if (resolved) setValue('nationality', resolved);
    }
    setPassportDataReady(true);
    // Let setValue propagate before snapshotting the form.
    setTimeout(() => autoSave(getValues()), 100);
  };

  const handleCoverUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'passport cover spread');
    if (pageErr) {
      setCoverUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    let preview: string;
    try {
      preview = await readFileAsDataUrl(file);
    } catch {
      setCoverUI({ preview: null, validating: false, error: "We couldn't read this file. Please try a different one.", file });
      return false;
    }

    setCoverUI({ preview, validating: true, error: null, file });

    try {
      const validation = await validatePassportPageType(preview, 'COVER');
      if (!validation.valid) {
        // infra=true means the check could not RUN (API/model error) — never
        // a rejection; don't burn a strike, just ask the user to retry.
        if (validation.infra) {
          setCoverUI({ preview, validating: false, error: 'We could not check this file right now — please try again in a moment.', file });
          return false;
        }
        setCoverRejectionCount((c) => c + 1);
        setCoverUI({ preview, validating: false, error: validation.error || 'This does not look like a passport cover spread. Please upload a clearer photo.', file });
        // Clear any previously-validated cover so a stale green "Valid" badge
        // can't sit next to this red error border.
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
    const updatedPages = {
      ...passportPagesRef.current,
      cover: { path: result.path, filename: result.filename, validated: true } as PassportPageReference,
    };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setCoverRejectionCount(0);
    setCoverManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
    return true;
  };

  const handleInsideUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'passport data-page spread');
    if (pageErr) {
      setInsideUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    let preview: string;
    try {
      preview = await readFileAsDataUrl(file);
    } catch {
      setInsideUI({ preview: null, validating: false, error: "We couldn't read this file. Please try a different one.", file });
      return false;
    }

    setInsideUI({ preview, validating: true, error: null, file });

    try {
      const validation = await validatePassportPageType(preview, 'INSIDE_PAGES');
      if (!validation.valid) {
        if (validation.infra) {
          setInsideUI({ preview, validating: false, error: 'We could not check this file right now — please try again in a moment.', file });
          return false;
        }
        setInsideRejectionCount((c) => c + 1);
        setInsideUI({ preview, validating: false, error: validation.error || 'This does not look like a passport inside-pages spread. Please upload a clearer photo.', file });
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
    const updatedPages = {
      ...passportPagesRef.current,
      insidePages: { path: result.path, filename: result.filename, validated: true } as PassportPageReference,
    };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setInsideRejectionCount(0);
    setInsideManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));

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
      const updatedPagesWithData = {
        ...passportPagesRef.current,
        insidePages: { ...passportPagesRef.current.insidePages!, extracted_data: extracted },
      };
      setPassportPages(updatedPagesWithData);
      passportPagesRef.current = updatedPagesWithData;
      await saveDocRefs(buildDocRefs({ passportPages: updatedPagesWithData }));
    } else {
      setPassportDataReady(true);
    }
    return true;
  };

  const handleCoverRemove = async () => {
    setCoverUI({ preview: null, validating: false, error: null, file: null });
    // The rejection counter deliberately survives a remove — re-uploading is
    // only possible after removing, so resetting here would make the
    // manual-review threshold unreachable.
    setCoverManualReviewConfirmed(false);
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.cover;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const handleInsideRemove = async () => {
    setInsideUI({ preview: null, validating: false, error: null, file: null });
    setInsideManualReviewConfirmed(false);
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.insidePages;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportDataReady(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const handleCoverManualReview = async () => {
    if (!coverUI.file || !coverUI.preview) return;
    // Keep validating:false — the manual-review path bypasses AI, so the
    // slot's "Validating..." badge would be misleading.
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
    const updatedPages = { ...passportPagesRef.current, cover: buildManualReviewPageRef(result) };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setCoverRejectionCount(0);
    setCoverManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const handleInsideManualReview = async () => {
    if (!insideUI.file || !insideUI.preview) return;
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

    // Best-effort extraction even though the AI rejected the spread — a single
    // data page still has a readable MRZ, so the form gets pre-filled and the
    // reviewer only verifies. needsReview still travels with the page.
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
    const updatedPages = {
      ...passportPagesRef.current,
      insidePages: {
        ...buildManualReviewPageRef(result),
        ...(extracted ? { extracted_data: extracted } : {}),
      },
    };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setPassportError(null);
    setInsideRejectionCount(0);
    setInsideManualReviewConfirmed(false);
    setPassportDataReady(true);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const extractAdditionalPageData = async (preview: string): Promise<Record<string, unknown> | null> => {
    try {
      const isImg = preview.startsWith('data:image/');
      const payload = isImg ? await compressImageForAI(preview) : preview;
      const response = await fetch('/api/extract-passport-additional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // nationality picks the extraction variant (Indian family-details page
        // vs Syrian issue-details page).
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

  /**
   * Apply extracted additional-page fields. Same mapping as EmployeeForm,
   * minus the fields this form doesn't collect (father's name, spouse name).
   */
  const applyAdditionalPageData = (d: Record<string, unknown>) => {
    if (d.passport_issue_date) setValue('passport_issue_date', d.passport_issue_date as string);
    if (d.passport_expiry_date) setValue('passport_expiry', d.passport_expiry_date as string);
    if (d.mother_name) setValue('mother_full_name', d.mother_name as string);
    if (d.father_name) setValue('father_full_name', d.father_name as string);
    if (d.spouse_name) setValue('marital_status', 'Married');
    if (d.address_street) setValue('home_street_address', d.address_street as string);
    if (d.address_city) setValue('home_city', d.address_city as string);
    if (d.address_pin) setValue('home_postal_code', d.address_pin as string);
    if (d.address_country) setValue('home_country', d.address_country as string);
    setTimeout(() => autoSave(getValues()), 100);
  };

  const handleAdditionalPageUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'passport additional page');
    if (pageErr) {
      setAdditionalPageUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    let preview: string;
    try {
      preview = await readFileAsDataUrl(file);
    } catch {
      setAdditionalPageUI({ preview: null, validating: false, error: "We couldn't read this file. Please try a different one.", file });
      return false;
    }

    setAdditionalPageUI({ preview, validating: true, error: null, file });

    try {
      const validation = await validatePassportPageType(preview, 'ADDITIONAL_PAGE');
      if (!validation.valid) {
        if (validation.infra) {
          setAdditionalPageUI({ preview, validating: false, error: 'We could not check this file right now — please try again in a moment.', file });
          return false;
        }
        setAdditionalRejectionCount((c) => c + 1);
        setAdditionalPageUI({ preview, validating: false, error: validation.error || 'This does not look like the passport’s additional page.', file });
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

    const updatedPages = {
      ...passportPagesRef.current,
      additionalPage: {
        path: result.path,
        filename: result.filename,
        validated: true,
        ...(extracted ? { extracted_data: extracted } : {}),
      } as PassportPageReference,
    };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setAdditionalRejectionCount(0);
    setAdditionalManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
    return true;
  };

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
    const updatedPages = {
      ...passportPagesRef.current,
      additionalPage: {
        ...buildManualReviewPageRef(result),
        ...(extracted ? { extracted_data: extracted } : {}),
      },
    };
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    setAdditionalRejectionCount(0);
    setAdditionalManualReviewConfirmed(false);
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  const handleAdditionalPageRemove = async () => {
    setAdditionalPageUI({ preview: null, validating: false, error: null, file: null });
    setAdditionalManualReviewConfirmed(false);
    const updatedPages = { ...passportPagesRef.current };
    delete updatedPages.additionalPage;
    setPassportPages(updatedPages);
    passportPagesRef.current = updatedPages;
    await saveDocRefs(buildDocRefs({ passportPages: updatedPages }));
  };

  // ------------------------------------------------------------------
  // Pakistani National ID (front + back) — same AI side-check + upload flow
  // as the EmployeeForm pattern (extract-pakistan-id validates the card and
  // pre-fills the father's name / home address of the DEPENDENT).
  // ------------------------------------------------------------------

  const handlePakistanIdFrontUpload = async (file: File): Promise<boolean> => {
    const pageErr = await singlePagePdfError(file, 'ID card (front)');
    if (pageErr) {
      setPakistanIdFrontUI((prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    const isImage = file.type.startsWith('image/');
    let preview: string;
    try {
      preview = await readFileAsDataUrl(file);
    } catch {
      setPakistanIdFrontUI({ preview: null, validating: false, error: "We couldn't read this file. Please try a different one.", file });
      return false;
    }
    setPakistanIdFrontUI({ preview, validating: true, error: null, file });

    // Extracted CNIC number, carried on the doc ref — the portal sync reads
    // `extracted_data.cnic_number` off the pakistan_id_front row (fixed
    // contract, mirrors how the passport ref carries its extracted_data).
    let extractedCnic: string | null = null;
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
            // Clear any previously-validated doc so a stale green "Valid"
            // badge can't sit next to this red error border.
            setPakistanIdFrontDoc(undefined);
            pakistanIdFrontDocRef.current = undefined;
            await saveDocRefs(buildDocRefs());
            return false;
          }
          if (extractResult.data?.father_name) setValue('father_full_name', extractResult.data.father_name);
          if (typeof extractResult.data?.cnic_number === 'string' && extractResult.data.cnic_number) {
            extractedCnic = extractResult.data.cnic_number;
          }
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

    const newDoc = {
      ...result,
      validated: true,
      // Never attach an empty extracted_data object — the portal treats the
      // key's presence as "extraction ran".
      ...(extractedCnic ? { extracted_data: { cnic_number: extractedCnic } } : {}),
    };
    setPakistanIdFrontDoc(newDoc);
    pakistanIdFrontDocRef.current = newDoc;
    setPakistanIdFrontUI({ preview, validating: false, error: null, file });
    setPakistanIdError(null);
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
    let preview: string;
    try {
      preview = await readFileAsDataUrl(file);
    } catch {
      setPakistanIdBackUI({ preview: null, validating: false, error: "We couldn't read this file. Please try a different one.", file });
      return false;
    }
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
    setPakistanIdError(null);
    await saveDocRefs(buildDocRefs());
    return true;
  };

  const additionalPageScan = useScannerIntercept(handleAdditionalPageUpload);
  const coverScan = useScannerIntercept(handleCoverUpload);
  const insideScan = useScannerIntercept(handleInsideUpload);
  const pakistanIdFrontScan = useScannerIntercept(handlePakistanIdFrontUpload);
  const pakistanIdBackScan = useScannerIntercept(handlePakistanIdBackUpload);

  // ------------------------------------------------------------------
  // Plain uploads (no AI): certificate + previously-held visa / EID
  // ------------------------------------------------------------------

  type PlainDocKey =
    | 'relationship_certificate'
    | 'marriage_certificate'
    | 'divorce_certificate'
    | 'death_certificate'
    | 'previous_visa'
    | 'previous_eid_front'
    | 'previous_eid_back';

  const PLAIN_SETTERS: Record<
    PlainDocKey,
    {
      set: (doc: { path: string; filename: string } | undefined) => void;
      ref: React.MutableRefObject<{ path: string; filename: string } | undefined>;
    }
  > = {
    relationship_certificate: { set: setCertificateDoc, ref: certificateDocRef },
    marriage_certificate: { set: setMarriageCertDoc, ref: marriageCertDocRef },
    divorce_certificate: { set: setDivorceCertDoc, ref: divorceCertDocRef },
    death_certificate: { set: setDeathCertDoc, ref: deathCertDocRef },
    previous_visa: { set: setPreviousVisaDoc, ref: previousVisaDocRef },
    previous_eid_front: { set: setPreviousEidFrontDoc, ref: previousEidFrontDocRef },
    previous_eid_back: { set: setPreviousEidBackDoc, ref: previousEidBackDocRef },
  };

  const handlePlainUpload = (key: PlainDocKey) => async (file: File) => {
    const result = await uploadDocument(submission.id, key, file);
    if (result) {
      PLAIN_SETTERS[key].ref.current = result;
      PLAIN_SETTERS[key].set(result);
      await saveDocRefs(buildDocRefs());
    }
    return result;
  };

  const handlePlainRemove = (key: PlainDocKey) => async () => {
    PLAIN_SETTERS[key].ref.current = undefined;
    PLAIN_SETTERS[key].set(undefined);
    await saveDocRefs(buildDocRefs());
  };

  // ------------------------------------------------------------------
  // Submit
  // ------------------------------------------------------------------

  const handleFormSubmit = async (data: DependentFormData) => {
    if (!photoDoc) {
      setPhotoError('Please upload the ID photo');
      setViewingStep(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!photoDoc.validated && !photoDoc.needsReview) {
      setPhotoError('The photo has not passed validation. Please upload a compliant photo, or submit it for manual review.');
      setViewingStep(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPhotoError(null);

    // Passport pages are mandatory unless this is a renewal where the sponsor
    // confirmed the pages on file are unchanged (the server gate re-checks
    // that both pages really are on file plus the persisted attestation).
    if (!passportSkipped && (!passportPages.cover || !passportPages.insidePages)) {
      setPassportError('Please upload both passport images');
      setViewingStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Nationality can be changed as late as the review step — re-check the
    // India/Syria additional page here so the sponsor is sent back to the
    // right slot instead of hitting the server's 422.
    if (!passportSkipped && requiresAdditionalPage && !isAdditionalPageUploaded) {
      setPassportError(
        additionalPageVariant === 'syria'
          ? 'Syrian passports also need the additional page (date/place of issue and national number). Please upload it below.'
          : 'Indian passports also need the last page (parents’ names and address). Please upload it below.'
      );
      setViewingStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPassportError(null);

    // Nationality can also flip the Pakistan National ID requirement as late
    // as the review step — mirror the server gate so the sponsor is sent to
    // the right slot instead of hitting the 422.
    if (requiresPakistanId && !isPakistanIdComplete) {
      setPakistanIdError('Pakistani nationals also need the National ID card (CNIC/NICOP). Please upload the front and back below.');
      setViewingStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPakistanIdError(null);

    // The certificate matrix can also regress as late as the review step
    // (parents' marital status flipped, a certificate removed) — re-check it
    // here so the sponsor is sent back to the certificate step instead of
    // hitting the server's 422. First registrations only; renewals don't
    // collect step 4.
    if (!isRenewal && !isCertificateComplete) {
      setCertificateError('Please complete the relationship certificate section before submitting.');
      setViewingStep(4);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setCertificateError(null);

    // Renewal: the on-file confirmation is mandatory before signing.
    if (isRenewal && data.details_confirmed_up_to_date !== true) {
      setDetailsConfirmError('Please confirm that the details and documents on file are still up to date.');
      setViewingStep(8);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setDetailsConfirmError(null);

    if (!signature) {
      setSignatureError('Please sign the form');
      setViewingStep(8);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSignatureError(null);

    // Stamp the device the form was submitted from — same touch+viewport
    // heuristic that gates the mobile upload policy.
    data.submission_device = isMobile ? 'phone' : 'desktop';

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch('/api/submit-dependent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: submission.id, dependentData: data, signature }),
      });
      if (response.ok) {
        onSubmitted();
        return;
      }
      // Surface the server's reason (e.g. the required-documents gate listing
      // what's missing) instead of a generic failure.
      let message = 'Failed to submit. Please try again.';
      try {
        const body = await response.json();
        if (typeof body?.error === 'string' && body.error) message = body.error;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      setSubmitError(message);
    } catch (err) {
      console.error('Error submitting dependent form:', err);
      setSubmitError('An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Shared amber manual-review affordance (same wording/behaviour as the
  // other forms).
  const renderManualReview = (
    confirmCopy: string,
    confirmed: boolean,
    setConfirmed: (v: boolean) => void,
    onManualReview: () => void | Promise<void>,
    submittingFlag: boolean,
    show: boolean,
  ) => {
    if (!show) return null;
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3 space-y-3">
        <p className="text-sm" style={{ color: TME_COLORS.primary }}>
          <strong>Still can&apos;t get it accepted?</strong> If you&apos;re sure this document meets the requirements, you can submit it for manual review.
        </p>
        <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5 flex-shrink-0"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{confirmCopy}</span>
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onManualReview}
            disabled={!confirmed || submittingFlag}
            className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: TME_COLORS.primary }}
          >
            {submittingFlag ? 'Submitting...' : 'Submit for manual review'}
          </button>
        </div>
      </div>
    );
  };

  const relationshipNoun = dependentType ? dependentType.toLowerCase() : 'dependent';

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className={`space-y-6 relative ${submitting ? 'pointer-events-none' : ''}`}
    >
      {submitting && (
        <div className="fixed inset-0 z-50 bg-white/70 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: TME_COLORS.primary }} />
            <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Submitting the form...</p>
          </div>
        </div>
      )}

      <StepProgress
        currentStep={currentStep}
        viewingStep={viewingStep}
        stepIndices={stepIndices}
        onStepClick={(step) => {
          setViewingStep(step);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setTimeout(() => window.scrollTo({ top: 0 }), 300);
        }}
      />

      {/* Intro — who this form is for */}
      <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <Users className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
          <div className="text-sm text-gray-600">
            <p>
              You are {isRenewal ? 'renewing the residence visa of' : 'registering'}{' '}
              <span className="font-medium" style={{ color: TME_COLORS.primary }}>
                {dependentType ? `your ${relationshipNoun}` : 'your dependent'}
              </span>
              {prefill.sponsor_staff_name ? (
                <> as a dependent under your sponsorship ({prefill.sponsor_staff_name}).</>
              ) : (
                <> as a dependent under your sponsorship.</>
              )}
            </p>
            <p className="mt-2">
              {isRenewal ? (
                <>
                  The details below are the ones TME Services holds today — please review them,
                  correct anything that has changed, and upload a <strong>newly taken</strong> photo
                  (the authority does not accept the photo already on file). The attested
                  relationship certificate is already on record and is not needed again.
                </>
              ) : (
                <>
                  Please provide the dependent&apos;s passport, photo, personal details, and the
                  attested certificate proving your relationship. TME Services will use this
                  information to apply for the dependent&apos;s residence visa.
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: ID Photo */}
      <RevealSection show={viewingStep === 1 || viewingStep === 8}>
        <FormSection
          title="ID Photo"
          icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={displayedStepNumber(1)}
        >
          <PhotoUpload
            submissionId={submission.id}
            value={photoDoc}
            // Renewal only: shows the photo on file and enables the SHA-256 +
            // vision reuse protection. A first registration has none.
            existingPhoto={isRenewal ? existingDocs?.photo : undefined}
            onUpload={handlePhotoUpload}
            onValidated={async (validated, validationErrors, aiRejected, flags) => {
              photoSamePhotoRef.current = flags?.samePhoto === true;
              const currentPhotoDoc = photoDocRef.current;
              if (currentPhotoDoc) {
                const updatedDoc = {
                  ...currentPhotoDoc,
                  validated,
                  validation_errors: validationErrors,
                  needsReview: undefined,
                  samePhotoSuspected: undefined,
                };
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
              // Keep the rejection counter across removes so the
              // manual-review threshold stays reachable.
              setPhotoManualReviewConfirmed(false);
              await saveDocRefs(buildDocRefs({ photo: undefined }));
            }}
            error={photoError || undefined}
          />

          {renderManualReview(
            'I confirm this is a recent passport-style photo of the dependent (plain light background, head and shoulders visible, no glasses). I understand a TME team member will verify it manually.',
            photoManualReviewConfirmed,
            setPhotoManualReviewConfirmed,
            handlePhotoManualReview,
            photoManualReviewSubmitting,
            shouldOfferManualReview(photoRejectionCount) && !!photoDoc && !photoDoc.validated,
          )}

          {viewingStep === 1 && (
            <StepNavButtons enabled={isPhotoUploaded} onContinue={() => setViewingStep(stepAfter(1))} showBack={false} />
          )}
        </FormSection>
      </RevealSection>

      {/* Renewal: current passport on file — confirm unchanged, or upload new
          pages. Shown INSTEAD of the upload steps until the sponsor says the
          passport has changed (same treatment as EmployeeForm's renewal
          panel). Only ever rendered when BOTH pages are on file. */}
      {isRenewal && hasExistingPassport && (viewingStep === 2 || viewingStep === 8) && !passportChanged && (
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-4">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              {displayedStepNumber(2)}
            </span>
            <Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />
            <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
              Current Passport on File
            </h2>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            These are the passport documents TME Services holds for your {relationshipNoun}.
            Please review them and confirm they are still valid.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            {existingDocs?.passport_cover?.publicUrl && (
              <ExistingDocPreview label="Passport Cover" doc={existingDocs.passport_cover} />
            )}
            {existingDocs?.passport_inside?.publicUrl && (
              <ExistingDocPreview label="Passport Data Page" doc={existingDocs.passport_inside} />
            )}
            {existingDocs?.passport_additional?.publicUrl && (
              <ExistingDocPreview label="Additional Page" doc={existingDocs.passport_additional} />
            )}
          </div>

          <div className="space-y-3 border-t border-gray-200 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={passportConfirmed}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setPassportConfirmed(checked);
                  // Persist on the TICK, not just on Continue: once the box is
                  // ticked the passport step counts as complete, so the sponsor
                  // can advance via the progress bar and never press Continue.
                  // Without this write documents.passport_unchanged stays unset
                  // and the server gate 422s with no way back (step 8 renders
                  // no Continue). Withdrawing the tick must likewise withdraw
                  // the attestation — otherwise the server gate would still see
                  // a skip the sponsor no longer stands behind.
                  passportUnchangedRef.current = checked;
                  void saveDocRefs(buildDocRefs());
                }}
                className="mt-0.5 w-4 h-4 rounded border-gray-300"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">
                  I confirm the passport is the same as shown above
                </span>
                <p className="text-xs text-gray-500 mt-0.5">
                  It has not been renewed, replaced, or lost since the last submission.
                </p>
              </div>
            </label>
          </div>

          {/* Actions only on the passport step itself — on the review step
              (8) the panel is a read-back of what was confirmed, and a
              Continue button there would jump the sponsor backwards. */}
          {viewingStep === 2 && (
          <div className="flex items-center justify-between mt-5">
            <button
              type="button"
              onClick={() => {
                setPassportChanged(true);
                setPassportConfirmed(false);
                // Withdraw any previously-saved attestation — the server-side
                // submit gate must now see freshly uploaded pages instead.
                if (passportUnchangedRef.current) {
                  passportUnchangedRef.current = false;
                  void saveDocRefs(buildDocRefs());
                }
              }}
              className="text-sm text-red-600 hover:text-red-700 font-medium underline text-left"
            >
              The passport has changed — I need to upload new pages
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
                  setViewingStep(stepAfter(2));
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white text-sm flex-shrink-0"
                style={{ backgroundColor: TME_COLORS.primary }}
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
          )}
        </div>
      )}

      {/* Step 2: Passport (cover + data page + nationality additional page).
          Hidden on a renewal until the sponsor says the passport changed. */}
      <RevealSection
        show={
          (viewingStep === 2 || viewingStep === 8) &&
          (!isRenewal || !hasExistingPassport || passportChanged)
        }
      >
        <div className="space-y-6">
          <FormSection
            title="Passport Cover (OUTSIDE)"
            icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(2)}
          >
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                  <p className="font-medium">Upload the passport cover (open/spread showing front + back cover)</p>
                  <p className="mt-2 text-xs text-gray-600">
                    Single page photos are not accepted. The passport must be spread open.
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
                onUpload={coverScan.intercepted}
                onRemove={handleCoverRemove}
              />
              {coverScan.scannerModal}

              {renderManualReview(
                'I confirm this is the passport cover (front + back) photographed spread open. I understand a TME team member will verify it manually.',
                coverManualReviewConfirmed,
                setCoverManualReviewConfirmed,
                handleCoverManualReview,
                coverManualReviewSubmitting,
                shouldOfferManualReview(coverRejectionCount) && !!coverUI.file && !passportPages.cover?.validated,
              )}
            </div>
            {passportError && <p className="mt-2 text-sm text-red-500">{passportError}</p>}
          </FormSection>

          <FormSection
            title="Passport Data (INSIDE)"
            icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                  <p className="font-medium">Upload the passport inside pages (open/spread showing data page + opposite page)</p>
                  <p className="mt-2 text-xs text-gray-600">
                    The dependent&apos;s details will be automatically extracted from this page.
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
                onUpload={insideScan.intercepted}
                onRemove={handleInsideRemove}
              />
              {insideScan.scannerModal}

              {renderManualReview(
                'I confirm this is the passport inside pages (data page + opposite page) photographed spread open.',
                insideManualReviewConfirmed,
                setInsideManualReviewConfirmed,
                handleInsideManualReview,
                insideManualReviewSubmitting,
                shouldOfferManualReview(insideRejectionCount) && !!insideUI.file && !passportPages.insidePages?.validated,
              )}
            </div>
          </FormSection>

          {extractingPassport && (
            <div className="rounded-xl border-2 border-blue-100 bg-blue-50/50 p-6">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
                <div>
                  <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Reading passport data...</p>
                  <p className="text-xs text-gray-500 mt-0.5">Extracting the details from the passport. This may take a few seconds.</p>
                </div>
              </div>
            </div>
          )}

          {/* Additional page (Indian / Syrian passports) */}
          {requiresAdditionalPage && (
            <FormSection
              title={additionalPageCopy.title}
              icon={<Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            >
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <p className="font-medium">{additionalPageCopy.heading}</p>
                    <p className="mt-1 text-xs text-gray-600">{additionalPageCopy.sub}</p>
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

                {renderManualReview(
                  `I confirm this is the ${additionalPageCopy.manualNoun}. I understand a TME team member will verify it manually.`,
                  additionalManualReviewConfirmed,
                  setAdditionalManualReviewConfirmed,
                  handleAdditionalManualReview,
                  additionalManualReviewSubmitting,
                  shouldOfferManualReview(additionalRejectionCount) && !!additionalPageUI.file && !passportPages.additionalPage?.validated,
                )}
              </div>
            </FormSection>
          )}

          {viewingStep === 2 && (
            <StepNavButtons
              // Also hold Continue while extraction is in flight: a saved
              // draft can leave passportDataReady true from a previous run,
              // and until the fresh read resolves the nationality we don't
              // yet know whether the India/Syria additional page is required.
              enabled={isPassportComplete && !extractingPassport}
              onContinue={() => setViewingStep(stepAfter(2))}
              onBack={() => setViewingStep(stepBefore(2))}
            />
          )}
        </div>
      </RevealSection>

      {/* Step 3: Personal Details (+ Pakistan National ID when required) */}
      <RevealSection show={viewingStep === 3 || viewingStep === 8}>
        <div className="space-y-6">
        <FormSection
          title="Personal Details"
          icon={<User className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={displayedStepNumber(3)}
        >
          <p className="text-sm text-gray-500 mb-4">
            These details were auto-filled from the passport. Please review and correct if needed.
          </p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Relationship to you" value={dependentType || ''} disabled helperText="Set by TME Services when this link was sent" />
              <Input
                label="Full Name"
                value={calculateFullName(firstName || '', middleName, lastName || '')}
                disabled
                helperText="Auto-calculated from name fields"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                {...register('last_name', {
                  onBlur: (e) => setValue('last_name', normalizePersonName(e.target.value)),
                })}
              />
            </div>

            {/* Blank family name soft-confirm — some passports (e.g. many
                Indian ones) carry no surname. */}
            {noLastNameWarning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <p className="font-medium">No family name entered</p>
                <p className="mt-0.5 text-xs">
                  Some passports (e.g. many Indian passports) have no surname — if that is the case here,
                  click Continue again to proceed without a family name. Otherwise fill in the family name first.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Passport Number"
                placeholder="e.g. X12345678"
                error={errors.passport_no?.message}
                required
                {...register('passport_no', { required: 'Required' })}
              />
              <CustomDropdown
                label="Nationality"
                options={SORTED_NATIONALITIES.map((n) => ({ value: n, label: n }))}
                value={nationality || ''}
                onChange={(val) => setValue('nationality', val)}
                error={errors.nationality?.message}
                required
                searchable
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
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CustomDatePicker
                label="Date of Birth"
                value={dateOfBirth || ''}
                onChange={(val) => setValue('date_of_birth', val)}
                required
              />
              <CustomDropdown
                label="Gender"
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
                value={gender || ''}
                onChange={(val) => setValue('gender', val as 'male' | 'female')}
                required
              />
            </div>

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
                options={SORTED_RELIGIONS.map((r) => ({ value: r, label: r }))}
                value={religion || ''}
                onChange={(val) => setValue('religion', val)}
                error={errors.religion?.message}
                required
                searchable
              />
              <CustomDropdown
                label="Marital Status"
                options={MARITAL_STATUS_OPTIONS.map((m) => ({ value: m, label: m }))}
                value={maritalStatus || ''}
                onChange={(val) => setValue('marital_status', val)}
                error={errors.marital_status?.message}
                required
              />
            </div>
          </div>

          {/* If the passport extraction couldn't resolve the nationality and
              the sponsor picks India/Syria HERE, the additional-page slot
              back on the passport step just became required — without this
              gate they could walk to the end and only learn about it from
              the submit-time 422. */}
          {viewingStep === 3 && requiresAdditionalPage && !isAdditionalPageUploaded && (
            <div className="mt-4 p-4 rounded-lg border border-amber-300 bg-amber-50 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">{additionalPageCopy.title} still missing</p>
                <p className="mt-1">
                  {additionalPageVariant === 'syria'
                    ? 'Syrian passports also need the additional page (date/place of issue and national number).'
                    : 'Indian passports also need the last page (parents’ names and address).'}{' '}
                  Please upload it in the Passport step before continuing.
                </p>
                <button
                  type="button"
                  onClick={() => setViewingStep(2)}
                  className="mt-2 px-4 py-1.5 rounded-lg text-sm font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: TME_COLORS.primary }}
                >
                  Go to Passport step
                </button>
              </div>
            </div>
          )}

        </FormSection>

        {/* Pakistani National ID — conditional on the DEPENDENT's nationality.
            Same gating as the India/Syria additional page (fresh-upload path
            waits for the data-page read; the renewal "passport unchanged"
            skip requires it immediately off the prefilled nationality). On a
            renewal the copies on file satisfy the slots — re-uploading is
            only needed when the card was renewed or replaced. */}
        {requiresPakistanId && (
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
                    Please upload the front and back of the dependent&apos;s Pakistan National Identity Card.
                  </p>
                </div>
              </div>

              {/* Renewal: copies already on file — show them; a fresh upload
                  is only needed when the card changed. */}
              {isRenewal && (pakistanIdFrontOnFile || pakistanIdBackOnFile) && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    These are the copies TME Services holds. Upload a new front or back below only if the card has been renewed or replaced.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {existingDocs?.pakistan_id_front?.publicUrl && (
                      <ExistingDocPreview label="Pakistan ID (Front)" doc={existingDocs.pakistan_id_front} />
                    )}
                    {existingDocs?.pakistan_id_back?.publicUrl && (
                      <ExistingDocPreview label="Pakistan ID (Back)" doc={existingDocs.pakistan_id_back} />
                    )}
                  </div>
                </div>
              )}

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

              {pakistanIdError && <p className="text-sm text-red-500">{pakistanIdError}</p>}
            </div>
          </FormSection>
        )}

        {viewingStep === 3 && (
          <StepNavButtons
            enabled={isPersonalComplete && isPassportComplete && isPakistanIdComplete}
            onBack={() => setViewingStep(stepBefore(3))}
            onContinue={() => {
              if (!lastName && !noLastNameWarning) {
                setNoLastNameWarning(true);
                return;
              }
              setViewingStep(stepAfter(3));
            }}
          />
        )}
        </div>
      </RevealSection>

      {/* Step 4: Relationship Certificates — relationship-driven set (see
          certificateSetFor). The primary slot is always required; the matrix
          adds the marriage certificate, the parents' marital-status select,
          and the conditional divorce/death certificate. */}
      <RevealSection show={!isRenewal && (viewingStep === 4 || viewingStep === 8)}>
        <FormSection
          title={multipleCertificates ? 'Relationship Certificates' : 'Relationship Certificate'}
          icon={<FileText className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={displayedStepNumber(4)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
              <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                <p className="font-medium">
                  {multipleCertificates
                    ? 'Upload the certificates listed below'
                    : `Upload the ${certSet.primaryLabel}`}
                </p>
                <p className="mt-2 text-xs text-gray-600">
                  {multipleCertificates ? 'Each certificate' : 'The certificate'} must be attested by the
                  UAE Ministry of Foreign Affairs (MoFA) or, at minimum, by the UAE Embassy in the country
                  where it was issued. If a certificate is in a language other than English or Arabic, a
                  legal translation must be attached. An unattested certificate will be rejected by the
                  immigration authorities.
                </p>
                <p className="mt-2 text-xs text-gray-600">
                  Please note that TME Services can only proceed with the dependent visa application once
                  all of the requested documents have been provided.
                </p>
                <p className="mt-2 text-xs text-gray-600">
                  In case your marriage or birth certificate hasn&apos;t been attested yet, please
                  contact TME Services so that we can guide you through the process.
                </p>
              </div>
            </div>

            <FileUploadSlot
              label={certSet.primaryLabel}
              description="Upload a clear scan of the attested certificate (PDF or image)."
              onUpload={handlePlainUpload('relationship_certificate')}
              onRemove={handlePlainRemove('relationship_certificate')}
              uploaded={!!certificateDoc?.path}
              filename={certificateDoc?.filename}
            />

            {certSet.marriageLabel && marriageCertNeeded && (
              <FileUploadSlot
                label={certSet.marriageLabel}
                description="Upload a clear scan of the attested certificate (PDF or image)."
                onUpload={handlePlainUpload('marriage_certificate')}
                onRemove={handlePlainRemove('marriage_certificate')}
                uploaded={!!marriageCertDoc?.path}
                filename={marriageCertDoc?.filename}
              />
            )}

            {/* The parents' marital status comes from Step 3 (asked once) —
                divorced/deceased parents need no marriage certificate, only
                the matching divorce/death certificate. */}
            {certSet.marriageLabel && !marriageCertNeeded && (
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-700">{certSet.marriageLabel}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Based on the marital status provided in Personal Details.
                  </p>
                </div>
                <span className="text-sm font-medium text-red-700 flex-shrink-0">Not required</span>
              </div>
            )}

            {derivedParentsStatus === 'Divorced' && (
              <FileUploadSlot
                label="Divorce Certificate (attested)"
                description="Upload a clear scan of the attested certificate (PDF or image)."
                onUpload={handlePlainUpload('divorce_certificate')}
                onRemove={handlePlainRemove('divorce_certificate')}
                uploaded={!!divorceCertDoc?.path}
                filename={divorceCertDoc?.filename}
              />
            )}

            {derivedParentsStatus === 'Deceased' && (
              <FileUploadSlot
                label="Death Certificate (attested)"
                description="Upload a clear scan of the attested certificate (PDF or image)."
                onUpload={handlePlainUpload('death_certificate')}
                onRemove={handlePlainRemove('death_certificate')}
                uploaded={!!deathCertDoc?.path}
                filename={deathCertDoc?.filename}
              />
            )}

            {/* Child 18+: the non-marriage undertaking is arranged by TME
                separately (Arabic document) — an info note, no upload. Age is
                computed from the RAW stored DOB (ISO), never a display
                format. */}
            {certSet.childAgeNote &&
              (() => {
                const age = ageFromIsoDate(dateOfBirth);
                return age !== null && age >= 18;
              })() && (
                <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                  <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                    <p className="font-medium">Declaration of Unmarried Status</p>
                    <p className="mt-1 text-xs text-gray-600">
                      As the dependent is 18 years of age or older, the authorities also require an
                      undertaking letter from the Sponsor confirming that the dependent is unmarried.
                      You do not need to upload anything here. TME Services will arrange the required
                      document separately and contact you for a signature.
                    </p>
                  </div>
                </div>
              )}

            {/* Married Mother: her husband's NOC is arranged by TME separately
                — an info note, no upload. Only for Mother (not Father), and
                only while her Step-3 marital status is Married. */}
            {dependentType === 'Mother' && maritalStatus === 'Married' && (
              <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: '#EBF4FF' }}>
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
                <div className="text-sm" style={{ color: TME_COLORS.primary }}>
                  <p className="font-medium">Husband&apos;s Approval to proceed with Visa Application (NOC)</p>
                  <p className="mt-1 text-xs text-gray-600">
                    As the dependent is married, the authorities also require a no-objection
                    certificate (NOC) confirming her husband&apos;s approval for her to obtain the
                    residence visa. You do not need to upload anything here. TME Services will
                    arrange the required document separately and contact you for a signature.
                  </p>
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5 flex-shrink-0"
                checked={attestationConfirmed}
                onChange={(e) => setValue('certificate_attestation_confirmed', e.target.checked, { shouldDirty: true })}
              />
              <span>
                {multipleCertificates
                  ? 'I confirm these certificates are attested by MoFA or, at minimum, by the UAE Embassy in the country of issue. I understand TME Services will verify the attestation.'
                  : 'I confirm this certificate is attested by MoFA or, at minimum, by the UAE Embassy in the country of issue. I understand TME Services will verify the attestation.'}
              </span>
            </label>

            {certificateError && <p className="text-sm text-red-500">{certificateError}</p>}
          </div>

          {viewingStep === 4 && (
            <StepNavButtons enabled={isCertificateComplete} onContinue={() => setViewingStep(stepAfter(4))} onBack={() => setViewingStep(stepBefore(4))} />
          )}
        </FormSection>
      </RevealSection>

      {/* Step 5: UAE Visa History */}
      <RevealSection show={!isRenewal && (viewingStep === 5 || viewingStep === 8)}>
        <FormSection
          title="UAE Visa History"
          icon={<ShieldCheck className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={displayedStepNumber(5)}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Has the dependent previously held a UAE residence visa and Emirates ID?
            </p>
            {/* Radio pair, same pattern as EmployeeForm's UAE-docs question —
                the previous outline-button styling was identical to the Back
                button below it, so the answers read as navigation. */}
            <div className="flex items-center gap-6">
              {[
                { value: true, label: 'Yes' },
                { value: false, label: 'No' },
              ].map((opt) => (
                <label key={String(opt.value)} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="previously_held_uae_visa_choice"
                    checked={previouslyHeldVisa === opt.value}
                    onChange={() => {
                      setPreviouslyHeldVisa(opt.value);
                      setValue('previously_held_uae_visa', opt.value, { shouldDirty: true });
                    }}
                    className="w-4 h-4"
                    style={{ accentColor: TME_COLORS.primary }}
                  />
                  <span className="text-sm" style={{ color: TME_COLORS.primary }}>{opt.label}</span>
                </label>
              ))}
            </div>

            {previouslyHeldVisa === true && (
              <div className="space-y-4 pl-6 border-l-2 border-gray-200">
                <p className="text-sm text-gray-600">
                  Please upload the previous residence visa and both sides of the Emirates ID.
                </p>
                <FileUploadSlot
                  label="Previous UAE Residence Visa"
                  description="Upload a clear scan or photo (PDF or image)."
                  onUpload={handlePlainUpload('previous_visa')}
                  onRemove={handlePlainRemove('previous_visa')}
                  uploaded={!!previousVisaDoc?.path}
                  filename={previousVisaDoc?.filename}
                />
                <FileUploadSlot
                  label="Emirates ID (Front)"
                  description="Upload a clear scan or photo (PDF or image)."
                  onUpload={handlePlainUpload('previous_eid_front')}
                  onRemove={handlePlainRemove('previous_eid_front')}
                  uploaded={!!previousEidFrontDoc?.path}
                  filename={previousEidFrontDoc?.filename}
                />
                <FileUploadSlot
                  label="Emirates ID (Back)"
                  description="Upload a clear scan or photo (PDF or image)."
                  onUpload={handlePlainUpload('previous_eid_back')}
                  onRemove={handlePlainRemove('previous_eid_back')}
                  uploaded={!!previousEidBackDoc?.path}
                  filename={previousEidBackDoc?.filename}
                />
              </div>
            )}
          </div>

          {viewingStep === 5 && (
            <StepNavButtons enabled={isVisaHistoryComplete} onContinue={() => setViewingStep(stepAfter(5))} onBack={() => setViewingStep(stepBefore(5))} />
          )}
        </FormSection>
      </RevealSection>

      {/* Step 6: Address */}
      <RevealSection show={viewingStep === 6 || viewingStep === 8}>
        <div className="space-y-6">
          <FormSection
            title="Home Country Address"
            icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(6)}
          >
            <div className="space-y-4">
              <Input
                label="Street Address"
                placeholder="Enter the street address"
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
                <Input label="Postal Code" placeholder="Enter postal code" {...register('home_postal_code')} />
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
            </div>
          </FormSection>

          <FormSection title="UAE Address" icon={<MapPin className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}>
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
                  The dependent is currently in the UAE
                </span>
              </label>

              {isInUAE && (
                <div className="space-y-4 pl-6 border-l-2 border-gray-200">
                  <Input
                    label="Street Address"
                    error={errors.uae_street_address?.message}
                    required
                    {...register('uae_street_address', { required: isInUAE ? 'Required' : false })}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      label="Area"
                      error={errors.uae_city?.message}
                      required
                      {...register('uae_city', { required: isInUAE ? 'Required' : false })}
                    />
                    <Input label="Postal Code" {...register('uae_postal_code')} />
                    <CustomDropdown
                      label="Emirate"
                      value={uaeEmirate || ''}
                      onChange={(value) => setValue('uae_emirate', value)}
                      options={UAE_EMIRATES.map((e) => ({ value: e, label: e }))}
                      placeholder="Select emirate..."
                      required
                    />
                  </div>
                </div>
              )}
            </div>
          </FormSection>

          {viewingStep === 6 && (
            <StepNavButtons enabled={isAddressComplete} onContinue={() => setViewingStep(stepAfter(6))} onBack={() => setViewingStep(stepBefore(6))} />
          )}
        </div>
      </RevealSection>

      {/* Step 7: Contact Details */}
      <RevealSection show={viewingStep === 7 || viewingStep === 8}>
        <div className="space-y-6">
          <FormSection
            title="Mobile Numbers"
            icon={<Phone className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(7)}
          >
            <div className="space-y-4">
              <div>
                <PhoneInput
                  label="UAE Mobile"
                  value={mobileUae}
                  onChange={(value) => setValue('mobile_uae', value || '')}
                  country="AE"
                  required
                  disabled={mobileUaeUseSponsor}
                />
                {sponsorMobile && (
                  <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={mobileUaeUseSponsor}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setValue('mobile_uae_use_sponsor', checked, { shouldDirty: true });
                        setValue('mobile_uae', checked ? sponsorMobile : '', { shouldDirty: true });
                      }}
                      className="rounded"
                    />
                    Use my (the sponsor&apos;s) mobile number
                  </label>
                )}
              </div>

              <div>
                <PhoneInput
                  label="Home Country Mobile"
                  value={mobileHomeCountry}
                  onChange={(value) => setValue('mobile_home_country', value || '')}
                  defaultCountry={nationalityCountryCode || 'AE'}
                  disabled={mobileHomeUseSponsor}
                />
                {/* Copies the sponsor's HOME-COUNTRY number, never the UAE
                    one — hidden when the sponsor has no home number on file. */}
                {sponsorHomeMobile && (
                  <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={mobileHomeUseSponsor}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setValue('mobile_home_use_sponsor', checked, { shouldDirty: true });
                        setValue('mobile_home_country', checked ? sponsorHomeMobile : '', { shouldDirty: true });
                      }}
                      className="rounded"
                    />
                    Use my (the sponsor&apos;s) home country mobile number
                  </label>
                )}
              </div>
            </div>
          </FormSection>

          <FormSection title="Email" icon={<Mail className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}>
            <Input
              label="Email"
              type="email"
              error={errors.email?.message}
              required
              disabled={emailUseSponsor}
              {...register('email', {
                required: 'Required',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Invalid email format',
                },
              })}
            />
            {sponsorEmail && (
              <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={emailUseSponsor}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setValue('email_use_sponsor', checked, { shouldDirty: true });
                    setValue('email', checked ? sponsorEmail : '', { shouldValidate: true, shouldDirty: true });
                  }}
                  className="rounded"
                />
                Use my (the sponsor&apos;s) email address
              </label>
            )}
          </FormSection>

          {/* Sponsor's UAE bank account — sits with the other sponsor-related
              contact inputs. Stored only on the dependent application; never
              written back to the payroll account. */}
          <FormSection
            title="Sponsor's Bank Account"
            icon={<CreditCard className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          >
            <Input
              label="Your (the sponsor's) UAE bank account (IBAN)"
              placeholder="AE00 0000 0000 0000 0000 000"
              helperText="The authorities require the sponsor's UAE bank account for the dependent visa application."
              error={errors.sponsor_iban?.message}
              required
              {...register('sponsor_iban', {
                required: 'Required',
                validate: (value) =>
                  isValidSponsorIban(value) || 'Enter a UAE IBAN: AE followed by 21 digits',
                onBlur: (e) =>
                  setValue('sponsor_iban', e.target.value.replace(/\s+/g, '').toUpperCase(), {
                    shouldValidate: true,
                  }),
              })}
            />
          </FormSection>

          <FormSection title="Anything Else?" icon={<Info className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}>
            <textarea
              className="w-full px-4 py-2 border-2 rounded-lg text-sm focus:outline-none transition-colors"
              style={{ borderColor: TME_COLORS.border, minHeight: '96px' }}
              placeholder="Any additional information TME Services should know (optional)"
              {...register('other_information')}
            />
          </FormSection>

          {viewingStep === 7 && (
            <StepNavButtons
              enabled={isContactComplete}
              onContinue={() => setViewingStep(stepAfter(7))}
              onBack={() => setViewingStep(stepBefore(7))}
              label="Review & Sign"
            />
          )}
        </div>
      </RevealSection>

      {/* Step 8: Review & Sign */}
      <RevealSection show={viewingStep === 8}>
        <div>
          <FormSection
            title="Review & Sign"
            icon={<FileSignature className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
            stepNumber={displayedStepNumber(8)}
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                By signing below, I confirm that the information and documents provided above for my{' '}
                {relationshipNoun} are accurate and complete.
              </p>

              {/* Renewal only: mandatory confirmation that the on-file record
                  is still current. Blocks submission until ticked (client and
                  server side); travels in the payload as
                  details_confirmed_up_to_date. */}
              {isRenewal && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={detailsConfirmed}
                      onChange={(e) => {
                        setValue('details_confirmed_up_to_date', e.target.checked, { shouldDirty: true });
                        if (e.target.checked && detailsConfirmError) setDetailsConfirmError(null);
                      }}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-800">
                      I confirm that the details and documents TME Services has on file are still up to date.
                    </span>
                  </label>
                  {detailsConfirmError && (
                    <p className="mt-2 text-sm text-red-500">{detailsConfirmError}</p>
                  )}
                </div>
              )}

              <SignaturePad
                onSignatureChange={(value) => {
                  setSignature(value);
                  if (value && signatureError) setSignatureError(null);
                }}
                disabled={submitting}
                label="Sponsor Signature"
                initialValue={signature}
              />
              {signatureError && <p className="text-sm text-red-500">{signatureError}</p>}
            </div>
          </FormSection>

          {submitError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700">{submitError}</p>
            </div>
          )}

          <div className="flex justify-between items-center mt-6">
            <button
              type="button"
              onClick={() => setViewingStep(stepBefore(8))}
              className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border-2 hover:bg-gray-50"
              style={{ color: TME_COLORS.primary, borderColor: TME_COLORS.primary }}
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <Button type="submit" loading={submitting} size="lg">
              Submit Dependent Form
            </Button>
          </div>
        </div>
      </RevealSection>
    </form>
  );
}
