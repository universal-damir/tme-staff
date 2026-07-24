'use client';

import React, { useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { PhotoUpload } from '@/components/PhotoUpload';
import { UploadSlot } from '@/components/UploadSlot';
import { FileUploadSlot } from '@/components/FileUploadSlot';
import type {
  StaffOnboardingSubmission,
  StaffDocumentReferences,
  PassportPageReference,
} from '@/types';
import {
  mergeStaffDocRefs,
  shouldOfferManualReview,
  buildManualReviewPageRef,
  passportAdditionalPageVariant,
} from '@/lib/staff-form-logic';
import {
  CUSTOM_REQUESTED_KEY_PREFIX,
  VISA_STATUS_REQUESTED_KEY_PREFIX,
  isCustomRequestedKey,
  isVisaStatusRequestedKey,
} from '@/lib/submit-validation';
import {
  uploadDocument,
  uploadPassportPage,
  updateDocumentReferences,
  PassportPageKey,
} from '@/lib/supabase';
import { compressImageForAI } from '@/lib/utils';
import { singlePagePdfError } from '@/lib/single-page-pdf';
import { AlertTriangle, Camera, CreditCard, FileText, GraduationCap } from 'lucide-react';
import { SampleImageToggle } from '@/components/SampleImageToggle';

/**
 * Lean employee-facing form for the "document re-request" flow
 * (onboarding_type === 'document_request'). The TME Portal lists the type
 * keys the employee must re-upload in `requested_documents`; this form
 * renders ONE slot per requested key, reusing the same upload routes, AI
 * validation, and 2-strike manual-review fallback as the main EmployeeForm —
 * but with no signature and no personal-data steps. Extraction endpoints are
 * deliberately skipped: there is no form to pre-fill here, validation only.
 *
 * Keys outside the 8 AI-validated slots but inside GENERIC_REQUESTABLE_LABELS
 * render a plain FileUploadSlot (no AI validation) and store into
 * `documents.extra_documents[<key>]` with needsReview: true.
 */

interface DocumentRequestFormProps {
  submission: StaffOnboardingSubmission;
  onSubmitted: () => void;
}

// Allow-list of AI-VALIDATED requestable type keys. The three passport keys
// map to the NESTED documents.passportPages.* refs; everything else is flat.
const PASSPORT_KEYS = ['passport_cover', 'passport_inside', 'passport_additional'] as const;
type PassportRequestKey = (typeof PASSPORT_KEYS)[number];

const EID_KEYS = ['eid_front', 'eid_back'] as const;
type EidRequestKey = (typeof EID_KEYS)[number];

const PLAIN_KEYS = ['degree_attested', 'transcript_of_records'] as const;
type PlainRequestKey = (typeof PLAIN_KEYS)[number];

const VALIDATED_KEYS = ['photo', ...PASSPORT_KEYS, ...EID_KEYS, ...PLAIN_KEYS] as const;
type ValidatedRequestKey = (typeof VALIDATED_KEYS)[number];

// All OTHER requestable portal document_type keys render a single GENERIC
// upload slot: plain upload (FileUploadSlot), no AI validation, no strike
// counters. Uploads land in `documents.extra_documents[<key>]` with
// `needsReview: true` — nothing AI-checked them, so the portal flags them
// for human review on sync. Must stay in sync with GENERIC_REQUESTED_KEYS
// in submit-validation.ts and the portal's request-documents allow-list.
const GENERIC_REQUESTABLE_LABELS = {
  visa: 'Visa',
  visa_document: 'Visa Status Document',
  employment_contract: 'Employment Contract',
  work_permit: 'Employment ID',
  health_insurance: 'Insurance — Health',
  iloe_insurance: 'Insurance — ILOE',
  driving_license: 'Driving License',
  job_offer_letter: 'Job Offer Letter',
  pakistan_id_front: 'Pakistan ID — Front',
  pakistan_id_back: 'Pakistan ID — Back',
  education_additional: 'Education — Additional',
  sponsor_passport: 'Sponsor — Passport',
  sponsor_visa: 'Sponsor — Visa',
  sponsor_eid_front: 'Sponsor — Emirates ID (Front)',
  sponsor_eid_back: 'Sponsor — Emirates ID (Back)',
} as const;
type GenericRequestKey = keyof typeof GENERIC_REQUESTABLE_LABELS;
const GENERIC_KEYS = Object.keys(GENERIC_REQUESTABLE_LABELS) as readonly GenericRequestKey[];

const GENERIC_SLOT_HINT = 'Upload a clear scan or photo (PDF or image).';

// Custom-named requests travel as `custom:<display name>` keys. They render
// the same generic FileUploadSlot, upload under the fixed 'custom' storage
// segment, and store into `documents.extra_documents[<full key>]`.
type CustomRequestKey = `${typeof CUSTOM_REQUESTED_KEY_PREFIX}${string}`;
const customKeyLabel = (key: string): string =>
  key.slice(CUSTOM_REQUESTED_KEY_PREFIX.length).trim();

// Subcategorized visa-status requests (`visa_document:<slug>`) — a generic
// slot whose label names the exact status paper (upload goes under the
// 'visa_document' storage segment). Slugs mirror the portal's
// VISA_STATUS_SUBCATEGORIES; unknown slugs fall back to the generic label.
type VisaStatusRequestKey = `${typeof VISA_STATUS_REQUESTED_KEY_PREFIX}${string}`;
const VISA_STATUS_SLUG_LABELS: Record<string, string> = {
  visa_on_arrival: 'On arrival visa',
  tourist_visa: 'Tourist visa',
  employment_visa: 'Employment visa',
  immigration_cancellation: 'Immigration cancellation',
  golden_visa: 'Golden visa',
  dependent_visa: 'Dependent visa',
  other: 'Other',
};
const visaStatusKeyLabel = (key: string): string => {
  const slug = key.slice(VISA_STATUS_REQUESTED_KEY_PREFIX.length).trim();
  const subLabel = VISA_STATUS_SLUG_LABELS[slug];
  return subLabel ? `Visa Status Document — ${subLabel}` : 'Visa Status Document';
};

type RequestedKey =
  | ValidatedRequestKey
  | GenericRequestKey
  | CustomRequestKey
  | VisaStatusRequestKey;

const PASSPORT_SLOTS: Record<
  PassportRequestKey,
  {
    pageKey: PassportPageKey;
    expectedType: 'COVER' | 'INSIDE_PAGES' | 'ADDITIONAL_PAGE';
    label: string;
    description: string;
    pageNoun: string;
    rejectCopy: string;
    confirmCopy: string;
    /** Example image shown via SampleImageToggle (same assets as EmployeeForm). */
    sampleSrc: string;
    sampleAlt: string;
  }
> = {
  passport_cover: {
    pageKey: 'cover',
    expectedType: 'COVER',
    label: 'Passport Cover (OUTSIDE)',
    description: 'Spread open: front + back cover visible',
    pageNoun: 'passport cover spread',
    rejectCopy: 'This does not look like a passport cover spread. Please upload a clearer photo.',
    confirmCopy:
      'I confirm this is my passport cover (front + back) photographed spread open. I understand a TME team member will verify it manually.',
    sampleSrc: '/samples/passport-cover-example.png',
    sampleAlt: 'Example passport cover spread',
  },
  passport_inside: {
    pageKey: 'insidePages',
    expectedType: 'INSIDE_PAGES',
    label: 'Passport Data Page (INSIDE)',
    description: 'Spread open: photo/data page + the page next to it',
    pageNoun: 'passport data-page spread',
    rejectCopy: 'This does not look like a passport inside-pages spread. Please upload a clearer photo.',
    confirmCopy:
      'I confirm this is my passport photo/data page photographed spread open. I understand a TME team member will verify it manually.',
    sampleSrc: '/samples/passport-inside-example.png',
    sampleAlt: 'Example passport inside pages spread',
  },
  passport_additional: {
    pageKey: 'additionalPage',
    expectedType: 'ADDITIONAL_PAGE',
    label: 'Passport Additional Page',
    description: "Last page with parents' names and address",
    pageNoun: 'passport additional page',
    rejectCopy: 'This does not look like a passport additional page.',
    confirmCopy:
      'I confirm this is my passport additional page. I understand a TME team member will verify it manually.',
    sampleSrc: '/samples/passport-additional-example.png',
    sampleAlt: 'Example passport additional page',
  },
};

const EID_SLOTS: Record<
  EidRequestKey,
  { side: 'front' | 'back'; label: string; description: string; pageNoun: string; rejectCopy: string; confirmCopy: string; sampleSrc: string; sampleAlt: string }
> = {
  eid_front: {
    side: 'front',
    label: 'Emirates ID (Front)',
    description: 'Front of Emirates ID',
    pageNoun: 'Emirates ID (front)',
    rejectCopy:
      'This does not appear to be an Emirates ID card. Please upload the front of a valid UAE Emirates ID, or submit it for manual review.',
    confirmCopy:
      'I confirm this is the front of my Emirates ID. I understand a TME team member will verify it manually.',
    sampleSrc: '/samples/eid-front-example.png',
    sampleAlt: 'Example Emirates ID front',
  },
  eid_back: {
    side: 'back',
    label: 'Emirates ID (Back)',
    description: 'Back of Emirates ID',
    pageNoun: 'Emirates ID (back)',
    rejectCopy:
      'This does not appear to be the back of an Emirates ID card. Please upload a clear photo of the back, or submit it for manual review.',
    confirmCopy:
      'I confirm this is the back of my Emirates ID. I understand a TME team member will verify it manually.',
    sampleSrc: '/samples/eid-back-example.png',
    sampleAlt: 'Example Emirates ID back',
  },
};

const PLAIN_SLOTS: Record<PlainRequestKey, { label: string; description: string }> = {
  degree_attested: {
    label: 'Attested Degree Certificate',
    description: 'PDF, JPEG, or PNG of your attested degree',
  },
  transcript_of_records: {
    label: 'Transcript of Records',
    description: 'PDF, JPEG, or PNG of your transcript',
  },
};

// Human-readable names for the intro list.
const KEY_DISPLAY_NAMES: Record<ValidatedRequestKey | GenericRequestKey, string> = {
  photo: 'ID Photo',
  passport_cover: 'Passport Cover (OUTSIDE)',
  passport_inside: 'Passport Data Page (INSIDE)',
  passport_additional: 'Passport Additional Page',
  eid_front: 'Emirates ID (Front)',
  eid_back: 'Emirates ID (Back)',
  degree_attested: 'Attested Degree Certificate',
  transcript_of_records: 'Transcript of Records',
  ...GENERIC_REQUESTABLE_LABELS,
};

const keyDisplayName = (key: RequestedKey): string => {
  if (isCustomRequestedKey(key)) return customKeyLabel(key);
  if (isVisaStatusRequestedKey(key)) return visaStatusKeyLabel(key);
  return KEY_DISPLAY_NAMES[key as ValidatedRequestKey | GenericRequestKey];
};

interface SlotUI {
  preview: string | null;
  validating: boolean;
  error: string | null;
  file: File | null;
}

const EMPTY_UI: SlotUI = { preview: null, validating: false, error: null, file: null };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export function DocumentRequestForm({ submission, onSubmitted }: DocumentRequestFormProps) {
  // Token from the URL (`/onboard/<id>?token=...`) — required by the AI
  // validate/extract routes and the documents write route (P0-3).
  const aiToken = useSearchParams().get('token');

  // Keys that are neither validated slots nor in the generic map are NOT
  // rendered — the submit gate fails closed on them server-side.
  const requested = (submission.requested_documents ?? []).filter(
    (k): k is RequestedKey =>
      (VALIDATED_KEYS as readonly string[]).includes(k) ||
      (GENERIC_KEYS as readonly string[]).includes(k) ||
      isCustomRequestedKey(k) ||
      isVisaStatusRequestedKey(k)
  );

  // The passport_additional slot copy/sample/prompt depends on the holder's
  // nationality (Indian address page vs Syrian issue-details page). The
  // static PASSPORT_SLOTS entry carries the Indian defaults; override here.
  const nationality = submission.employee_data?.nationality;
  const additionalVariant = passportAdditionalPageVariant(nationality);
  const passportSlotConfig = (key: PassportRequestKey) => {
    const cfg = PASSPORT_SLOTS[key];
    if (key !== 'passport_additional' || additionalVariant !== 'syria') return cfg;
    return {
      ...cfg,
      description: 'Page with date/place of issue and national number',
      confirmCopy:
        'I confirm this is my Syrian passport additional page (issue details / national number). I understand a TME team member will verify it manually.',
      sampleSrc: '/samples/passport-additional-syria-example.png',
      sampleAlt: 'Example Syrian passport additional page',
    };
  };

  // Full document-references object, seeded from the row so persisting never
  // clobbers keys other flows wrote (mergeStaffDocRefs is belt-and-braces on
  // top of that). Ref mirror so sequential async handlers see fresh state.
  const [docs, setDocs] = useState<StaffDocumentReferences>(() => ({
    ...(submission.documents ?? {}),
    passportPages: { ...(submission.documents?.passportPages ?? {}) },
  }));
  const docsRef = useRef(docs);

  const persistDocs = async (next: StaffDocumentReferences) => {
    docsRef.current = next;
    setDocs(next);
    await updateDocumentReferences(
      submission.id,
      mergeStaffDocRefs(submission.documents, next),
      aiToken
    );
  };

  const setFlatDoc = (
    key: 'photo' | EidRequestKey | PlainRequestKey,
    value: StaffDocumentReferences[typeof key]
  ) => persistDocs({ ...docsRef.current, [key]: value });

  const setPage = (pageKey: PassportPageKey, ref: PassportPageReference | undefined) => {
    const pages = { ...(docsRef.current.passportPages ?? {}) };
    if (ref) pages[pageKey] = ref;
    else delete pages[pageKey];
    return persistDocs({ ...docsRef.current, passportPages: pages });
  };

  // Per-slot UI state (preview/validating/error) + 2-strike manual-review
  // state, keyed by requested type. Mirrors the per-slot useStates in
  // EmployeeForm without 20 separate hooks.
  const [slotUI, setSlotUI] = useState<Record<string, SlotUI>>({});
  const [rejections, setRejections] = useState<Record<string, number>>({});
  const [reviewConfirmed, setReviewConfirmed] = useState<Record<string, boolean>>({});
  const [reviewSubmitting, setReviewSubmitting] = useState<Record<string, boolean>>({});

  const setSlot = (key: string, ui: SlotUI | ((prev: SlotUI) => SlotUI)) =>
    setSlotUI((prev) => ({
      ...prev,
      [key]: typeof ui === 'function' ? ui(prev[key] ?? EMPTY_UI) : ui,
    }));
  const bumpRejection = (key: string) =>
    setRejections((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  const resetRejection = (key: string) => {
    setRejections((prev) => ({ ...prev, [key]: 0 }));
    setReviewConfirmed((prev) => ({ ...prev, [key]: false }));
  };

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Photo — same 2-strike wrapper the parent EmployeeForm implements
  // around PhotoUpload (PhotoUpload runs the AI validation itself).
  // ------------------------------------------------------------------

  const handlePhotoUpload = async (file: File) => {
    const result = await uploadDocument(submission.id, 'photo', file);
    if (result) {
      await setFlatDoc('photo', { ...result, validated: false });
      return result;
    }
    return null;
  };

  // Whether the vision comparison judged the CURRENT photo upload to be the
  // same capture as the photo on file. Consumed by the manual-review submit
  // to stamp samePhotoSuspected (portal folds it into needs_review labels).
  const photoSamePhotoRef = useRef(false);

  const handlePhotoValidated = async (
    validated: boolean,
    validationErrors?: string[],
    aiRejected?: boolean,
    flags?: { samePhoto?: boolean }
  ) => {
    photoSamePhotoRef.current = flags?.samePhoto === true;
    const current = docsRef.current.photo;
    if (current) {
      await setFlatDoc('photo', {
        ...current,
        validated,
        validation_errors: validationErrors,
        needsReview: undefined,
        samePhotoSuspected: undefined,
      });
    }
    if (validated) {
      setRejections((prev) => ({ ...prev, photo: 0 }));
    } else if (aiRejected) {
      // Only genuine AI rejections count toward the manual-review
      // threshold — service failures don't.
      bumpRejection('photo');
    }
  };

  const handlePhotoManualReview = async () => {
    const current = docsRef.current.photo;
    if (!current) return;
    setReviewSubmitting((prev) => ({ ...prev, photo: true }));
    await setFlatDoc('photo', {
      ...current,
      validated: true,
      needsReview: true,
      // Carry the same-photo verdict of THIS upload so the portal can label
      // the review as a suspected reuse of the photo on file.
      samePhotoSuspected: photoSamePhotoRef.current || undefined,
    });
    resetRejection('photo');
    setReviewSubmitting((prev) => ({ ...prev, photo: false }));
  };

  const handlePhotoRemove = async () => {
    // Keep the rejection counter across removes (same rationale as the
    // EmployeeForm handlers) so the manual-review threshold stays reachable.
    setReviewConfirmed((prev) => ({ ...prev, photo: false }));
    await setFlatDoc('photo', undefined);
  };

  // ------------------------------------------------------------------
  // Passport pages — same validate-then-upload flow as EmployeeForm
  // (validation only; extraction is skipped, there is no form to fill).
  // ------------------------------------------------------------------

  const validatePassportPageType = async (
    imageBase64: string,
    expectedType: 'COVER' | 'INSIDE_PAGES' | 'ADDITIONAL_PAGE'
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
        // Surface a specific reason (e.g. the single-page rule enforced by
        // the AI route guard) instead of a generic failure.
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

  const handlePassportUpload = (key: PassportRequestKey) => async (file: File): Promise<boolean> => {
    const cfg = passportSlotConfig(key);
    const pageErr = await singlePagePdfError(file, cfg.pageNoun);
    if (pageErr) {
      setSlot(key, (prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    let preview: string;
    try {
      preview = await readFileAsDataUrl(file);
    } catch {
      setSlot(key, {
        preview: null,
        validating: false,
        error: "We couldn't read this file. Please try a different one.",
        file,
      });
      return false;
    }

    setSlot(key, { preview, validating: true, error: null, file });

    try {
      const validation = await validatePassportPageType(preview, cfg.expectedType);
      if (!validation.valid) {
        // infra=true means the check could not RUN (API/model error) — never
        // a rejection; don't burn a strike, just ask the user to retry.
        if (validation.infra) {
          setSlot(key, { preview, validating: false, error: "We could not check this file right now — please try again in a moment.", file });
          return false;
        }
        bumpRejection(key);
        setSlot(key, { preview, validating: false, error: validation.error || cfg.rejectCopy, file });
        // Clear any previously-validated page so a stale green "Valid" badge
        // can't sit next to this red error border (mirrors EmployeeForm).
        await setPage(cfg.pageKey, undefined);
        return false;
      }
    } catch {
      setSlot(key, { preview, validating: false, error: "We couldn't check this file. Please try again.", file });
      return false;
    }

    let result: { path: string; filename: string } | null;
    try {
      result = await uploadPassportPage(submission.id, cfg.pageKey, file);
    } catch {
      result = null;
    }
    if (!result) {
      setSlot(key, { preview, validating: false, error: 'Upload failed. If the file is larger than 4MB (common with PDFs), please compress it or upload a JPEG/PNG — otherwise check your connection and try again.', file });
      return false;
    }

    setSlot(key, { preview, validating: false, error: null, file });
    await setPage(cfg.pageKey, { path: result.path, filename: result.filename, validated: true });
    resetRejection(key);
    return true;
  };

  const handlePassportManualReview = (key: PassportRequestKey) => async () => {
    const cfg = passportSlotConfig(key);
    const ui = slotUI[key];
    if (!ui?.file || !ui.preview) return;
    // Keep validating:false — the manual-review path bypasses AI, so the
    // slot's "Validating..." badge would be misleading (mirrors EmployeeForm).
    setSlot(key, { preview: ui.preview, file: ui.file, validating: false, error: null });
    setReviewSubmitting((prev) => ({ ...prev, [key]: true }));
    let result: { path: string; filename: string } | null;
    try {
      result = await uploadPassportPage(submission.id, cfg.pageKey, ui.file);
    } catch {
      result = null;
    }
    if (!result) {
      setSlot(key, { preview: ui.preview, file: ui.file, validating: false, error: 'Upload failed. If the file is larger than 4MB (common with PDFs), please compress it or upload a JPEG/PNG — otherwise check your connection and try again.' });
      setReviewSubmitting((prev) => ({ ...prev, [key]: false }));
      return;
    }
    setReviewSubmitting((prev) => ({ ...prev, [key]: false }));
    await setPage(cfg.pageKey, buildManualReviewPageRef(result));
    resetRejection(key);
  };

  // ------------------------------------------------------------------
  // Emirates ID — type-check via /api/extract-eid (validate-then-store,
  // extracted data kept on the ref like EmployeeForm; no form fields to
  // fill here). Soft on route/infra errors, hard on an explicit invalid
  // verdict, with the 2-strike manual-review fallback per side.
  // ------------------------------------------------------------------

  const handleEidUpload = (key: EidRequestKey) => async (file: File): Promise<boolean> => {
    const cfg = EID_SLOTS[key];
    const pageErr = await singlePagePdfError(file, cfg.pageNoun);
    if (pageErr) {
      setSlot(key, (prev) => ({ ...prev, validating: false, error: pageErr }));
      return false;
    }
    let preview: string;
    try {
      preview = await readFileAsDataUrl(file);
    } catch {
      setSlot(key, {
        preview: null,
        validating: false,
        error: "We couldn't read this file. Please try a different one.",
        file,
      });
      return false;
    }

    setSlot(key, { preview, validating: true, error: null, file });

    let extractedData: Record<string, unknown> | null = null;
    try {
      const isImage = file.type.startsWith('image/');
      const imageData = isImage ? await compressImageForAI(preview) : preview;
      const response = await fetch('/api/extract-eid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, side: cfg.side, submissionId: submission.id, token: aiToken }),
      });
      if (response.ok) {
        const extractResult = await response.json();
        const invalid =
          cfg.side === 'front'
            ? !extractResult.success || !extractResult.data?.emirates_id_number
            : !extractResult.success;
        // infra=true means the check could not RUN (API/model error) — never
        // a rejection. Fall through to the upload like the catch path below;
        // counting infra failures as strikes locked users out for weeks when
        // the extraction model was retired upstream.
        if (invalid && !extractResult.infra) {
          bumpRejection(key);
          setSlot(key, { preview, validating: false, error: cfg.rejectCopy, file });
          // Clear any previously-validated doc so a stale green "Valid" badge
          // can't sit next to this red error border (mirrors EmployeeForm).
          await setFlatDoc(key, undefined);
          return false;
        }
        if (cfg.side === 'front' && extractResult.success && extractResult.data) {
          extractedData = extractResult.data as Record<string, unknown>;
        }
      }
    } catch (err) {
      // Validation-infra error: log + continue — must not hard-block a
      // genuine upload (mirrors the sponsor EID handlers).
      console.error(`EID ${cfg.side} validation error:`, err);
    }

    const result = await uploadDocument(submission.id, key, file);
    if (!result) {
      setSlot(key, { preview, validating: false, error: 'Upload failed. If the file is larger than 4MB (common with PDFs), please compress it or upload a JPEG/PNG instead.', file });
      return false;
    }

    setSlot(key, { preview, validating: false, error: null, file });
    await setFlatDoc(key, {
      ...result,
      validated: true,
      ...(extractedData ? { extracted_data: extractedData } : {}),
    });
    resetRejection(key);
    return true;
  };

  const handleEidManualReview = (key: EidRequestKey) => async () => {
    const ui = slotUI[key];
    if (!ui?.file || !ui.preview) return;
    setSlot(key, { preview: ui.preview, file: ui.file, validating: false, error: null });
    setReviewSubmitting((prev) => ({ ...prev, [key]: true }));
    let result: { path: string; filename: string } | null;
    try {
      result = await uploadDocument(submission.id, key, ui.file);
    } catch {
      result = null;
    }
    if (!result) {
      setSlot(key, { preview: ui.preview, file: ui.file, validating: false, error: 'Upload failed. If the file is larger than 4MB (common with PDFs), please compress it or upload a JPEG/PNG — otherwise check your connection and try again.' });
      setReviewSubmitting((prev) => ({ ...prev, [key]: false }));
      return;
    }
    setReviewSubmitting((prev) => ({ ...prev, [key]: false }));
    await setFlatDoc(key, buildManualReviewPageRef(result));
    resetRejection(key);
  };

  // ------------------------------------------------------------------
  // Degree / transcript — plain upload, no validation (matches the app:
  // these refs are `{path, filename}` only).
  // ------------------------------------------------------------------

  const handlePlainUpload = (key: PlainRequestKey) => async (file: File) => {
    const result = await uploadDocument(submission.id, key, file);
    if (result) {
      await setFlatDoc(key, result);
    }
    return result;
  };

  const handlePlainRemove = (key: PlainRequestKey) => async () => {
    await setFlatDoc(key, undefined);
  };

  // ------------------------------------------------------------------
  // Generic requestable types — plain upload into
  // documents.extra_documents[<portal document_type>]. No AI validation,
  // no strike counters; every entry carries needsReview: true so the
  // portal flags it for human review on sync. Storage goes through the
  // same /api/storage/upload route (shrinkImageToBudget applies) under
  // `<submissionId>/<type>/...` like every other slot.
  // ------------------------------------------------------------------

  const setExtraDoc = (
    key: GenericRequestKey | CustomRequestKey | VisaStatusRequestKey,
    ref: { path: string; filename: string; needsReview: true } | undefined
  ) => {
    const extras = { ...(docsRef.current.extra_documents ?? {}) };
    if (ref) extras[key] = ref;
    else delete extras[key];
    return persistDocs({ ...docsRef.current, extra_documents: extras });
  };

  const handleGenericUpload =
    (key: GenericRequestKey | CustomRequestKey | VisaStatusRequestKey) => async (file: File) => {
      // Custom keys carry a free-text name and visa-status keys a slug —
      // storage paths must stay opaque, so those files upload under their
      // fixed base segment; the full key lives only in extra_documents.
      const storageType = isCustomRequestedKey(key)
        ? 'custom'
        : isVisaStatusRequestedKey(key)
          ? 'visa_document'
          : (key as GenericRequestKey);
      const result = await uploadDocument(submission.id, storageType, file);
      if (result) {
        await setExtraDoc(key, { path: result.path, filename: result.filename, needsReview: true });
      }
      return result;
    };

  const handleGenericRemove =
    (key: GenericRequestKey | CustomRequestKey | VisaStatusRequestKey) => async () => {
      await setExtraDoc(key, undefined);
    };

  // ------------------------------------------------------------------
  // Submit — every requested slot must be present AND validated-or-
  // needsReview (path-only for degree/transcript). The server enforces
  // the same rule in /api/submit-document-request.
  // ------------------------------------------------------------------

  const acceptedDoc = (
    doc: { path?: string; validated?: boolean; needsReview?: boolean } | undefined
  ): boolean => !!doc?.path && (doc.validated === true || doc.needsReview === true);

  const isSatisfied = (key: RequestedKey): boolean => {
    if (
      (GENERIC_KEYS as readonly string[]).includes(key) ||
      isCustomRequestedKey(key) ||
      isVisaStatusRequestedKey(key)
    ) {
      // Generic slots have no AI validation — a stored upload is enough
      // (the entry always carries needsReview: true). Mirrors the server
      // gate in missingRequestedDocuments.
      return !!docs.extra_documents?.[key]?.path;
    }
    const pages = docs.passportPages ?? {};
    switch (key as ValidatedRequestKey) {
      case 'photo':
        return acceptedDoc(docs.photo);
      case 'passport_cover':
        return acceptedDoc(pages.cover);
      case 'passport_inside':
        return acceptedDoc(pages.insidePages);
      case 'passport_additional':
        return acceptedDoc(pages.additionalPage);
      case 'eid_front':
        return acceptedDoc(docs.eid_front);
      case 'eid_back':
        return acceptedDoc(docs.eid_back);
      case 'degree_attested':
        return !!docs.degree_attested?.path;
      case 'transcript_of_records':
        return !!docs.transcript_of_records?.path;
    }
  };

  const allSatisfied = requested.length > 0 && requested.every(isSatisfied);

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch('/api/submit-document-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: submission.id }),
      });
      if (response.ok) {
        onSubmitted();
        return;
      }
      let message = 'Failed to submit. Please try again.';
      try {
        const body = await response.json();
        if (typeof body?.error === 'string' && body.error) message = body.error;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      setSubmitError(message);
    } catch (err) {
      console.error('Error submitting document request:', err);
      setSubmitError('An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Shared amber manual-review affordance — copied from the EmployeeForm
  // pattern so the wording/behavior stays consistent across the app.
  const renderManualReview = (
    key: RequestedKey,
    confirmCopy: string,
    onManualReview: () => void | Promise<void>,
    hasFile: boolean,
    alreadyValidated: boolean
  ) => {
    const show = shouldOfferManualReview(rejections[key] ?? 0) && hasFile && !alreadyValidated;
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
            checked={!!reviewConfirmed[key]}
            onChange={(e) => setReviewConfirmed((prev) => ({ ...prev, [key]: e.target.checked }))}
          />
          <span>{confirmCopy}</span>
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onManualReview}
            disabled={!reviewConfirmed[key] || !!reviewSubmitting[key]}
            className="px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: TME_COLORS.primary }}
          >
            {reviewSubmitting[key] ? 'Submitting...' : 'Submit for manual review'}
          </button>
        </div>
      </div>
    );
  };

  const sectionIcon = (key: RequestedKey) => {
    if (key === 'photo') return <Camera className="w-5 h-5" style={{ color: TME_COLORS.primary }} />;
    if (key === 'eid_front' || key === 'eid_back')
      return <CreditCard className="w-5 h-5" style={{ color: TME_COLORS.primary }} />;
    if (key === 'degree_attested' || key === 'transcript_of_records')
      return <GraduationCap className="w-5 h-5" style={{ color: TME_COLORS.primary }} />;
    return <FileText className="w-5 h-5" style={{ color: TME_COLORS.primary }} />;
  };

  const renderSlot = (key: RequestedKey) => {
    if (key === 'photo') {
      const photoDoc = docs.photo;
      return (
        <>
          <PhotoUpload
            submissionId={submission.id}
            value={photoDoc}
            existingPhoto={submission.existing_documents?.photo}
            onUpload={handlePhotoUpload}
            onValidated={handlePhotoValidated}
            onRemove={handlePhotoRemove}
          />
          {renderManualReview(
            'photo',
            'I confirm this is a recent passport-style photo of myself (plain light background, head and shoulders visible, no glasses). I understand a TME team member will verify it manually.',
            handlePhotoManualReview,
            !!photoDoc,
            !!photoDoc?.validated
          )}
        </>
      );
    }

    if ((PASSPORT_KEYS as readonly string[]).includes(key)) {
      const pKey = key as PassportRequestKey;
      const cfg = passportSlotConfig(pKey);
      const pageRef = (docs.passportPages ?? {})[cfg.pageKey] as PassportPageReference | undefined;
      const ui = slotUI[pKey] ?? EMPTY_UI;
      return (
        <>
          <UploadSlot
            label={cfg.label}
            description={cfg.description}
            expectedType={cfg.expectedType === 'COVER' ? 'COVER' : 'INSIDE_PAGES'}
            accept="application/pdf,image/jpeg,image/png"
            file={ui.file}
            preview={ui.preview || undefined}
            validated={!!pageRef?.validated}
            validating={ui.validating}
            needsReview={!!pageRef?.needsReview}
            error={ui.error || undefined}
            onUpload={handlePassportUpload(pKey)}
            onRemove={() => {}}
          />
          <SampleImageToggle imageSrc={cfg.sampleSrc} altText={cfg.sampleAlt} label="See example photo" />
          {renderManualReview(pKey, cfg.confirmCopy, handlePassportManualReview(pKey), !!ui.file, !!pageRef?.validated)}
        </>
      );
    }

    if ((EID_KEYS as readonly string[]).includes(key)) {
      const eKey = key as EidRequestKey;
      const cfg = EID_SLOTS[eKey];
      const docRef = docs[eKey];
      const ui = slotUI[eKey] ?? EMPTY_UI;
      return (
        <>
          <UploadSlot
            label={cfg.label}
            description={cfg.description}
            expectedType="INSIDE_PAGES"
            accept="application/pdf,image/jpeg,image/png"
            maxSizeMB={10}
            file={ui.file}
            preview={ui.preview || undefined}
            validated={!!docRef?.validated}
            validating={ui.validating}
            needsReview={!!(docRef as { needsReview?: boolean } | undefined)?.needsReview}
            error={ui.error || undefined}
            onUpload={handleEidUpload(eKey)}
            onRemove={() => {}}
          />
          <SampleImageToggle imageSrc={cfg.sampleSrc} altText={cfg.sampleAlt} label="See example photo" />
          {renderManualReview(eKey, cfg.confirmCopy, handleEidManualReview(eKey), !!ui.file, !!docRef?.validated)}
        </>
      );
    }

    if (
      (GENERIC_KEYS as readonly string[]).includes(key) ||
      isCustomRequestedKey(key) ||
      isVisaStatusRequestedKey(key)
    ) {
      const gKey = key as GenericRequestKey | CustomRequestKey | VisaStatusRequestKey;
      const extraRef = docs.extra_documents?.[gKey];
      return (
        <FileUploadSlot
          label={keyDisplayName(gKey)}
          description={GENERIC_SLOT_HINT}
          onUpload={handleGenericUpload(gKey)}
          onRemove={handleGenericRemove(gKey)}
          uploaded={!!extraRef?.path}
          filename={extraRef?.filename}
        />
      );
    }

    const plainKey = key as PlainRequestKey;
    const cfg = PLAIN_SLOTS[plainKey];
    const docRef = docs[plainKey];
    return (
      <FileUploadSlot
        label={cfg.label}
        description={cfg.description}
        onUpload={handlePlainUpload(plainKey)}
        onRemove={handlePlainRemove(plainKey)}
        uploaded={!!docRef?.path}
        filename={docRef?.filename}
      />
    );
  };

  if (requested.length === 0) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <p className="text-sm text-gray-600">
          No documents are currently requested. If you believe this is an error, please contact your HR representative.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <p className="text-sm text-gray-600">
          TME Services needs you to re-upload the following {requested.length === 1 ? 'document' : 'documents'}.
          Once every item shows as uploaded and accepted, you can submit.
        </p>
        <ul className="mt-3 space-y-1">
          {requested.map((key) => (
            <li key={key} className="flex items-center gap-2 text-sm text-gray-700">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${isSatisfied(key) ? 'bg-green-500' : 'bg-gray-300'}`}
              />
              {keyDisplayName(key)}
            </li>
          ))}
        </ul>
      </div>

      {/* One section per requested document */}
      {requested.map((key) => (
        <div key={key} className="bg-white rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            {sectionIcon(key)}
            <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
              {keyDisplayName(key)}
            </h2>
          </div>
          {renderSlot(key)}
        </div>
      ))}

      {/* Submit */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        {submitError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allSatisfied || submitting}
          className="w-full px-8 py-3 rounded-lg font-semibold text-white transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: TME_COLORS.primary }}
        >
          {submitting ? 'Submitting...' : 'Submit Documents'}
        </button>
        {!allSatisfied && (
          <p className="mt-2 text-xs text-gray-500 text-center">
            Upload every requested document above to enable submission.
          </p>
        )}
      </div>
    </div>
  );
}
