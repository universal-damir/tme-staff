'use client';

/**
 * Merged "People & Documents" step — one card per person, passport FIRST.
 *
 * The old flow asked the client to type name, nationality, DOB etc. by hand
 * (step 5) and only then upload the passport containing all of it (step 6).
 * This step reverses that: upload the passport, the accepted scan is read by
 * the same extraction the staff onboarding uses, and the personal fields
 * below arrive pre-filled for review. Manual entry stays fully possible —
 * every field is always editable and extraction failing is silent.
 *
 * Fill-only precedence: staff prefill and anything the client typed always
 * win — extraction only fills fields that are still empty. The applied
 * values are stored on the passport doc ref (extractedData) so a resumed
 * draft does not re-extract and a passport removal can undo exactly the
 * fields it auto-filled (never ones the client has since edited).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  NATIONALITIES,
  LANGUAGES,
  RELIGIONS,
  EDUCATIONAL_QUALIFICATIONS,
  MARITAL_STATUS_OPTIONS,
} from '@/lib/constants';
import {
  AutoGrowText,
  Input,
  textFieldClasses,
  CustomDropdown,
  CustomDatePicker,
  MultiSelectDropdown,
  PhoneInput,
  Button,
  StatusChip,
} from '@/components/ui';
import { UploadSlot } from '@/components/UploadSlot';
import { FileUploadSlot } from '@/components/FileUploadSlot';
import {
  shouldOfferManualReview,
  passportAdditionalPageVariant,
  type PassportAdditionalPageVariant,
} from '@/lib/staff-form-logic';
import { callAiCheck, UNREADABLE_FILE_MESSAGE, type AiCheckFailure } from '@/lib/ai-check-client';
import { isUploadFailure, type UploadResult } from '@/lib/supabase';
import { singlePagePdfError } from '@/lib/single-page-pdf';
import { renderPdfFirstPage } from '@/lib/pdf-thumbnail';
import {
  COMPANY_SETUP_MAX_PERSONS,
  companySetupNeedsPhotoAndAddress,
  companySetupRoleBlockedReason,
  companySetupReligionOptions,
  companySetupReligionValue,
  composeFullName,
  type CompanySetupDocRef,
  type CompanySetupDocuments,
  type CompanySetupPerson,
  type CompanySetupPersonDocuments,
} from '@/types/company-setup';
import { COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT } from '@/lib/company-setup-validation';
import { ADDRESS_MISMATCH_WARNING } from '@/lib/proof-of-address-validation';
import {
  additionalPageDataOf,
  applyAdditionalPageExtraction,
  applyPassportExtraction,
  clearAppliedAdditionalPage,
  clearAppliedExtraction,
  emptyPerson,
  extractedDataOf,
  statementAddressOf,
  STATEMENT_ADDRESS_KEY,
  PASSPORT_ISSUE_ON_DATA_PAGE_KEY,
  companySetupAdditionalPageRequired,
  isoToDisplayDate,
  displayToIsoDate,
  missingPersonDetails,
  missingPersonDocuments,
  roleTotals,
  type AdditionalPageExtractedFields,
  type AdditionalPageExtractionData,
  type PassportExtractedFields,
  type PassportExtractionData,
} from './draft';
import {
  CheckCircle,
  ChevronDown,
  FileText,
  Info,
  Plus,
  Sparkles,
  Trash2,
  User,
  XCircle,
} from 'lucide-react';

type AiSlot = 'photo' | 'passport' | 'passport_additional' | 'proof_of_address';
type PlainSlot =
  | 'eid_front'
  | 'eid_back'
  | 'visa_document'
  | 'previous_visa_document'
  | 'education_certificate';
export type DocSlot = AiSlot | PlainSlot;

interface SlotUiState {
  preview?: string;
  validating?: boolean;
  extracting?: boolean;
  error?: string;
  strikes: number;
  lastErrors?: string[];
  /** Accepted, but with something for the client (and TME) to look at. */
  warnings?: string[];
}

/** Copy for the nationality-dependent additional passport page. */
const ADDITIONAL_PAGE_COPY: Record<
  PassportAdditionalPageVariant,
  { label: string; description: string }
> = {
  syria: {
    label: 'Passport: issue-details page',
    description:
      'The page next to the data page, with the date and place of issue and the national number.',
  },
  india: {
    label: 'Passport: address / family-details page',
    description:
      'The last page, with the address and the parents’ / spouse’s names.',
  },
};

// Same helper as EmployeeForm/DependentForm — alphabetical with "Other" last.
const sortWithOtherLast = (items: readonly string[]) =>
  [...items].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

const SORTED_NATIONALITIES = sortWithOtherLast(NATIONALITIES);
// IFZA has no "Atheist/Non-religious": the shared list keeps it for staff
// onboarding, the company setup dropdown drops it.
const SORTED_RELIGIONS = companySetupReligionOptions(sortWithOtherLast(RELIGIONS));
const SORTED_LANGUAGES = sortWithOtherLast(LANGUAGES);

/** The contract stores languages as one comma-separated string; the picker
 *  works in a list. Empty entries drop out so "English, " never becomes a
 *  blank tag. */
function splitLanguages(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const EID_VISA_OPTIONS = [
  { value: 'none', label: 'No, never had a UAE EID or visa' },
  { value: 'current', label: 'Yes, currently holds a UAE EID / visa' },
  { value: 'past', label: 'Yes, held a UAE EID / visa in the past' },
];

const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const ROLE_DEFS: Array<{
  key: keyof CompanySetupPerson['roles'];
  label: string;
}> = [
  { key: 'shareholder', label: 'Shareholder' },
  { key: 'generalManager', label: 'General Manager' },
  { key: 'director', label: 'Director' },
  { key: 'secretary', label: 'Secretary' },
];

interface StepPeopleDocumentsProps {
  token: string;
  persons: CompanySetupPerson[];
  documents: CompanySetupDocuments;
  onChange: (persons: CompanySetupPerson[]) => void;
  /**
   * Functional single-person update — used by the async extraction apply so
   * it patches against the CURRENT person, never a stale closure (the client
   * may type while extraction runs).
   */
  onPatchPerson: (
    index: number,
    compute: (person: CompanySetupPerson) => CompanySetupPerson,
  ) => void;
  /** Called BEFORE a person is removed so document refs can be re-keyed. */
  onRemovePerson: (index: number) => void;
  onDocumentChange: (
    personIndex: number,
    slot: DocSlot,
    ref: CompanySetupDocRef | undefined,
  ) => void;
  uploadFile: (
    personIndex: number,
    slot: DocSlot,
    file: File,
  ) => Promise<UploadResult>;
  /** Flush the autosave right after an extraction prefill lands. */
  onExtractionApplied: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function ConstraintPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full ${
        ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-tme-red'
      }`}
    >
      {ok ? (
        <CheckCircle className="w-4 h-4 shrink-0" aria-label="OK" />
      ) : (
        <XCircle className="w-4 h-4 shrink-0" aria-label="Not yet" />
      )}
      {label}
    </span>
  );
}

/** Per-person completion: required fields + required documents all present.
 *  Same helpers as the step gate and the "Still needed" list, so a person can
 *  never show "Complete" and then fail the submit. */
export function isPersonComplete(
  person: CompanySetupPerson,
  docs: CompanySetupPersonDocuments,
): boolean {
  return (
    missingPersonDetails(person).length === 0 &&
    missingPersonDocuments(person, docs).length === 0
  );
}

export function StepPeopleDocuments({
  token,
  persons,
  documents,
  onChange,
  onPatchPerson,
  onRemovePerson,
  onDocumentChange,
  uploadFile,
  onExtractionApplied,
}: StepPeopleDocumentsProps) {
  const [openIndex, setOpenIndex] = useState<number>(0);
  const [slotState, setSlotState] = useState<Record<string, SlotUiState>>({});

  // Live view of the documents prop for async completions (extraction) — so
  // a result never resurrects a ref the client removed mid-flight.
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  // Same live view for the persons: the extraction result must be computed
  // against the CURRENT person and its `applied` map read straight after —
  // computing inside a setState updater made `applied` arrive one render too
  // late (empty auto-fill banner, undo that cleared nothing) and ran twice
  // under React StrictMode.
  const personsRef = useRef(persons);
  personsRef.current = persons;

  // Last uploaded-but-rejected file per slot, so the 2-strike manual-review
  // fallback can submit it without a re-upload.
  const pendingUploads = useRef<Record<string, { path: string; filename: string }>>({});

  const totals = roleTotals(persons);
  const shareholdingOk =
    totals.shareholderCount > 0 && Math.abs(totals.shareholdingSum - 100) <= 0.01;

  // ---------- Slot UI state ----------
  const stateKey = (personIndex: number, slot: DocSlot) => `${personIndex}:${slot}`;
  const getState = (personIndex: number, slot: DocSlot): SlotUiState =>
    slotState[stateKey(personIndex, slot)] ?? { strikes: 0 };
  const patchState = (personIndex: number, slot: DocSlot, patch: Partial<SlotUiState>) => {
    setSlotState((prev) => {
      const key = stateKey(personIndex, slot);
      return { ...prev, [key]: { ...(prev[key] ?? { strikes: 0 }), ...patch } };
    });
  };

  const previewFor = (
    personIndex: number,
    slot: DocSlot,
    ref?: CompanySetupDocRef,
  ): string | undefined => {
    const local = getState(personIndex, slot).preview;
    if (local) return local;
    if (ref?.path) return `/api/company-setup/${token}/file?path=${encodeURIComponent(ref.path)}`;
    return undefined;
  };

  // ---------- Persons ----------
  const updatePerson = (index: number, patch: Partial<CompanySetupPerson>) => {
    onChange(persons.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  /** The name is typed in three parts; fullName is the contract's required
   *  field, so it is recomposed on every keystroke and never typed directly. */
  const updateName = (
    index: number,
    patch: Pick<Partial<CompanySetupPerson>, 'firstName' | 'middleName' | 'lastName'>,
  ) => {
    const merged = { ...persons[index], ...patch };
    updatePerson(index, { ...patch, fullName: composeFullName(merged) });
  };

  const updateRoles = (index: number, key: keyof CompanySetupPerson['roles'], value: boolean) => {
    const person = persons[index];
    updatePerson(index, { roles: { ...person.roles, [key]: value } });
  };

  const addPerson = () => {
    if (persons.length >= COMPANY_SETUP_MAX_PERSONS) return;
    onChange([...persons, emptyPerson()]);
    setOpenIndex(persons.length);
  };

  const removePerson = (index: number) => {
    if (persons.length <= 1) return;
    onRemovePerson(index);
    onChange(persons.filter((_, i) => i !== index));
    // Re-key slot UI state and pending uploads alongside the document refs.
    setSlotState((prev) => {
      const next: Record<string, SlotUiState> = {};
      for (const [key, value] of Object.entries(prev)) {
        const [idxStr, slot] = key.split(':');
        const idx = Number(idxStr);
        if (!Number.isInteger(idx) || idx === index) continue;
        next[`${idx > index ? idx - 1 : idx}:${slot}`] = value;
      }
      return next;
    });
    const nextPending: Record<string, { path: string; filename: string }> = {};
    for (const [key, value] of Object.entries(pendingUploads.current)) {
      const [idxStr, slot] = key.split(':');
      const idx = Number(idxStr);
      if (!Number.isInteger(idx) || idx === index) continue;
      nextPending[`${idx > index ? idx - 1 : idx}:${slot}`] = value;
    }
    pendingUploads.current = nextPending;
    // Removing the OPEN person collapses the accordion — silently opening a
    // different person's card looks like the wrong person was deleted.
    setOpenIndex((prev) => {
      if (prev === index) return -1;
      return prev > index ? prev - 1 : prev;
    });
  };

  // ---------- Passport extraction ----------
  const runExtraction = async (
    personIndex: number,
    aiImage: string,
    ref: { path: string; filename: string; uploadedAt: string },
  ) => {
    patchState(personIndex, 'passport', { extracting: true });
    try {
      const outcome = await callAiCheck<{
        success?: boolean;
        data?: PassportExtractionData;
      }>(`/api/company-setup/${token}/extract-passport`, {}, aiImage, {
        form: 'company-setup',
        action: 'extract:passport',
        ref: token,
      });
      const result = outcome.ok ? outcome.data : null;

      // Abort if the client removed/replaced the passport while we read it.
      const current = documentsRef.current[String(personIndex)]?.passport;
      if (!current || current.path !== ref.path) return;

      if (result?.success && result.data) {
        // Compute FIRST against the live person, then patch with a pure merge.
        const person = personsRef.current[personIndex];
        if (!person) return;
        const outcome = applyPassportExtraction(person, result.data, NATIONALITIES);
        const applied: PassportExtractedFields = outcome.applied;
        onPatchPerson(personIndex, () => outcome.person);
        const refWithData: CompanySetupDocRef = {
          ...current,
          extractedData: {
            ...applied,
            // Did the DATA PAGE itself carry the issue date? On a Syrian
            // passport that is the whole test for whether a second page
            // exists — see companySetupAdditionalPageRequired. Recorded here
            // because `applied` is fill-only: a client who typed the date
            // themselves would leave no trace of where it came from.
            ...(typeof result.data.passport_issue_date === 'string' &&
            result.data.passport_issue_date.trim()
              ? { [PASSPORT_ISSUE_ON_DATA_PAGE_KEY]: 'yes' }
              : {}),
          },
        };
        onDocumentChange(personIndex, 'passport', refWithData);
        onExtractionApplied();
      }
      // Extraction failing is silent (callAiCheck logged it): the fields
      // below stay manual.
    } finally {
      patchState(personIndex, 'passport', { extracting: false });
    }
  };

  /** Additional page (India / Syria): same fill-only flow as the data page. */
  const runAdditionalExtraction = async (
    personIndex: number,
    aiImage: string,
    ref: { path: string; filename: string; uploadedAt: string },
    nationality: string | undefined,
  ) => {
    patchState(personIndex, 'passport_additional', { extracting: true });
    try {
      const outcome = await callAiCheck<{
        success?: boolean;
        data?: AdditionalPageExtractionData;
      }>(`/api/company-setup/${token}/extract-passport-additional`, { nationality }, aiImage, {
        form: 'company-setup',
        action: 'extract:passport_additional',
        ref: token,
      });
      const result = outcome.ok ? outcome.data : null;

      // Abort if the client removed/replaced the page while we read it.
      const current = documentsRef.current[String(personIndex)]?.passport_additional;
      if (!current || current.path !== ref.path) return;

      if (result?.success && result.data) {
        const person = personsRef.current[personIndex];
        if (!person) return;
        const outcome = applyAdditionalPageExtraction(person, result.data);
        const applied: AdditionalPageExtractedFields = outcome.applied;
        if (Object.keys(applied).length > 0) {
          onPatchPerson(personIndex, () => outcome.person);
          onDocumentChange(personIndex, 'passport_additional', {
            ...current,
            extractedData: applied,
          });
          onExtractionApplied();
        }
      }
      // Failing is silent (callAiCheck logged it): the fields stay manual.
    } finally {
      patchState(personIndex, 'passport_additional', { extracting: false });
    }
  };

  // ---------- AI-validated slots (photo + passport) ----------
  const handleAiUpload = async (
    personIndex: number,
    slot: AiSlot,
    file: File,
    person: CompanySetupPerson,
  ): Promise<boolean> => {
    patchState(personIndex, slot, { error: undefined, warnings: undefined });

    // A bank statement is legitimately several pages; identity documents are
    // one page per file (that rule is what stops a wrong page riding along).
    if (slot !== 'proof_of_address') {
      const pageErr = await singlePagePdfError(file, slot === 'photo' ? 'photo' : 'page');
      if (pageErr) {
        patchState(personIndex, slot, { error: pageErr });
        return false;
      }
    }

    let dataUrl: string;
    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch {
      patchState(personIndex, slot, { error: UNREADABLE_FILE_MESSAGE });
      return false;
    }

    const uploaded = await uploadFile(personIndex, slot, file);
    if (isUploadFailure(uploaded)) {
      patchState(personIndex, slot, { error: uploaded.error });
      return false;
    }
    patchState(personIndex, slot, { preview: dataUrl, validating: true });

    // Vision check runs against an image: PDFs are flattened to page 1 first
    // (same approach as the staff onboarding forms). callAiCheck makes it
    // small enough to send.
    let aiImage = dataUrl;
    try {
      if (file.type === 'application/pdf') {
        aiImage = await renderPdfFirstPage(dataUrl);
      }
    } catch {
      // Fall through with the PDF itself; callAiCheck shrinks it.
    }

    const endpoint =
      slot === 'photo'
        ? `/api/company-setup/${token}/validate-photo`
        : slot === 'proof_of_address'
          ? `/api/company-setup/${token}/validate-proof-of-address`
          : `/api/company-setup/${token}/validate-passport`;
    // Nationality is OPTIONAL context for the passport check: at this point
    // the client usually has not entered it yet (extraction fills it after
    // this very upload) — pass it only when prefill/extraction already set it.
    const body =
      slot === 'photo'
        ? {}
        : slot === 'proof_of_address'
          ? {
              expectedName: person.fullName?.trim() || undefined,
              expectedAddress: person.fullAddress?.trim() || undefined,
            }
          : {
              nationality: person.nationality || undefined,
              expectedType: slot === 'passport_additional' ? 'ADDITIONAL_PAGE' : 'INSIDE_PAGES',
            };

    const outcome = await callAiCheck(endpoint, body, aiImage, {
      form: 'company-setup',
      action: `check:${slot}`,
      ref: token,
      file: { size: file.size, type: file.type },
    });

    if (!outcome.ok) {
      // The file is stored but our check could not run on it (AI down, file
      // too large or unreadable for the check): never strand the client on
      // our side. Accept it flagged for manual review, as before.
      if (
        outcome.kind === 'check_unavailable' ||
        outcome.kind === 'too_large_for_check' ||
        outcome.kind === 'unreadable_file'
      ) {
        onDocumentChange(personIndex, slot, {
          path: uploaded.path,
          filename: uploaded.filename,
          uploadedAt: new Date().toISOString(),
          needsReview: true,
          validationErrors: ['Automatic check unavailable. Flagged for manual review.'],
        });
        patchState(personIndex, slot, { validating: false, error: undefined, warnings: undefined });
        return true;
      }
      // Anything the client can act on (connection, link, too many tries):
      // show the reason. It counts as a strike where a hand check can help,
      // so after two the client can send the file to our team.
      failCheck(personIndex, slot, outcome, uploaded);
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = outcome.data as any;

    const accepted =
      slot === 'photo' || slot === 'proof_of_address'
        ? result?.valid === true
        : result?.matches === true;

    if (accepted) {
      const warnings: string[] =
        slot === 'proof_of_address' && Array.isArray(result?.warnings) ? result.warnings : [];
      // The bank statement is ALWAYS a human decision (3-month rule, address
      // match): it stays needsReview whatever the model said, and any
      // warning travels with the ref so the portal review drawer shows it.
      // The address the statement actually prints rides along on the ref:
      // the form offers it as a one-click fix for the home address, and that
      // offer has to survive a reload or a resumed draft.
      const printedAddress =
        slot === 'proof_of_address' &&
        typeof result?.observations?.address_on_document === 'string'
          ? result.observations.address_on_document.trim()
          : '';
      const newRef: CompanySetupDocRef =
        slot === 'proof_of_address'
          ? {
              path: uploaded.path,
              filename: uploaded.filename,
              uploadedAt: new Date().toISOString(),
              needsReview: true,
              ...(warnings.length > 0 ? { validationErrors: warnings } : {}),
              ...(printedAddress
                ? { extractedData: { [STATEMENT_ADDRESS_KEY]: printedAddress } }
                : {}),
            }
          : {
              path: uploaded.path,
              filename: uploaded.filename,
              uploadedAt: new Date().toISOString(),
            };
      if (slot === 'passport' || slot === 'passport_additional') {
        // A replaced page must not leave the OLD auto-fill behind: clear the
        // fields the previous extraction filled and the client never edited,
        // then read the new scan.
        const prevRef = documentsRef.current[String(personIndex)]?.[slot];
        if (slot === 'passport') {
          const prevApplied = extractedDataOf(prevRef);
          if (prevApplied) {
            onPatchPerson(personIndex, (p) => clearAppliedExtraction(p, prevApplied));
          }
        } else {
          const prevApplied = additionalPageDataOf(prevRef);
          if (prevApplied) {
            onPatchPerson(personIndex, (p) => clearAppliedAdditionalPage(p, prevApplied));
          }
        }
      }
      onDocumentChange(personIndex, slot, newRef);
      patchState(personIndex, slot, {
        validating: false,
        error: undefined,
        strikes: 0,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
      if (slot === 'passport') {
        void runExtraction(personIndex, aiImage, newRef);
      }
      if (slot === 'passport_additional') {
        void runAdditionalExtraction(personIndex, aiImage, newRef, person.nationality);
      }
      return true;
    }

    const errors: string[] =
      slot === 'photo'
        ? Array.isArray(result?.errors) && result.errors.length > 0
          ? result.errors
          : ['The photo did not pass the automatic check.']
        : slot === 'proof_of_address'
          ? Array.isArray(result?.warnings) && result.warnings.length > 0
            ? result.warnings
            : ['This document did not pass the automatic check.']
          : [result?.errorMessage || 'The passport page did not pass the automatic check.'];

    // Rejection: clear the recorded ref AND the preview — a file that is
    // not recorded must not sit on screen looking accepted. Count a
    // strike and surface the reasons.
    onDocumentChange(personIndex, slot, undefined);
    setSlotState((prev) => {
      const key = stateKey(personIndex, slot);
      const current = prev[key] ?? { strikes: 0 };
      return {
        ...prev,
        [key]: {
          ...current,
          preview: undefined,
          validating: false,
          warnings: undefined,
          error: errors.join(' '),
          strikes: current.strikes + 1,
          lastErrors: errors,
        },
      };
    });
    // Remember the upload so a manual-review submit can reference it.
    pendingUploads.current[stateKey(personIndex, slot)] = uploaded;
    return false;
  };

  /** A check that could not run: same clean-up as a rejection, with the
   *  failure's own message; a strike only when a hand check can help. */
  const failCheck = (
    personIndex: number,
    slot: AiSlot,
    failure: AiCheckFailure,
    uploaded: { path: string; filename: string },
  ) => {
    onDocumentChange(personIndex, slot, undefined);
    setSlotState((prev) => {
      const key = stateKey(personIndex, slot);
      const current = prev[key] ?? { strikes: 0 };
      return {
        ...prev,
        [key]: {
          ...current,
          preview: undefined,
          validating: false,
          warnings: undefined,
          error: failure.message,
          strikes: failure.countsAsStrike ? current.strikes + 1 : current.strikes,
          lastErrors: ['Automatic check unavailable. Flagged for manual review.'],
        },
      };
    });
    pendingUploads.current[stateKey(personIndex, slot)] = uploaded;
  };

  const submitForManualReview = (personIndex: number, slot: AiSlot) => {
    const key = stateKey(personIndex, slot);
    const uploaded = pendingUploads.current[key];
    const state = getState(personIndex, slot);
    if (!uploaded) return;
    onDocumentChange(personIndex, slot, {
      path: uploaded.path,
      filename: uploaded.filename,
      uploadedAt: new Date().toISOString(),
      needsReview: true,
      validationErrors: state.lastErrors,
    });
    patchState(personIndex, slot, { error: undefined, warnings: undefined });
  };

  /** Remove an AI slot's file: ref + preview + strikes go; for the passport,
   *  the auto-filled (and since untouched) fields are cleared with it. */
  const removeAiDoc = (personIndex: number, slot: AiSlot) => {
    if (slot === 'passport') {
      const applied = extractedDataOf(documentsRef.current[String(personIndex)]?.passport);
      if (applied) {
        onPatchPerson(personIndex, (p) => clearAppliedExtraction(p, applied));
      }
    }
    if (slot === 'passport_additional') {
      const applied = additionalPageDataOf(
        documentsRef.current[String(personIndex)]?.passport_additional,
      );
      if (applied) {
        onPatchPerson(personIndex, (p) => clearAppliedAdditionalPage(p, applied));
      }
    }
    onDocumentChange(personIndex, slot, undefined);
    patchState(personIndex, slot, {
      preview: undefined,
      error: undefined,
      validating: false,
      extracting: false,
      strikes: 0,
      lastErrors: undefined,
      warnings: undefined,
    });
    delete pendingUploads.current[stateKey(personIndex, slot)];
  };

  // ---------- Plain slots ----------
  const handlePlainUpload = async (
    personIndex: number,
    slot: PlainSlot,
    file: File,
  ): Promise<UploadResult> => {
    const uploaded = await uploadFile(personIndex, slot, file);
    // A failure goes back to the slot as is; it shows the reason.
    if (isUploadFailure(uploaded)) return uploaded;
    onDocumentChange(personIndex, slot, {
      path: uploaded.path,
      filename: uploaded.filename,
      uploadedAt: new Date().toISOString(),
      needsReview: true,
    });
    return uploaded;
  };

  // ---------- Render ----------
  return (
    <div className="space-y-4">
      <div className="text-[15px] text-gray-700 leading-relaxed space-y-2 sm:text-sm">
        <p>
          <span className="font-medium text-gray-700">Shareholder</span> = owner of the company
          <br />
          <span className="font-medium text-gray-700">Company officer</span> = person holding a
          role within the company (Manager, Director, Secretary)
        </p>
        <div>
          <p>Every company can have:</p>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            <li>A maximum of 1 Manager and Secretary</li>
            <li>Up to 6 Shareholders</li>
            <li>One person can hold all roles.</li>
          </ul>
        </div>
        <p>
          Please start by uploading the passport, as we will read the personal details from it
          for you.
        </p>
      </div>

      {/* Live totals / constraints bar */}
      <div
        aria-live="polite"
        className="rounded-[10px] border border-gray-200 bg-gray-50/60 p-3 flex flex-wrap items-center gap-2"
      >
        <ConstraintPill
          ok={shareholdingOk}
          label={`Shareholding total: ${totals.shareholdingSum}%${shareholdingOk ? '' : ' (must be 100%)'}`}
        />
        <ConstraintPill
          ok={totals.gmCount === 1}
          label={`General Manager: ${totals.gmCount} (exactly 1)`}
        />
        <ConstraintPill
          ok={totals.secretaryCount === 1}
          label={`Secretary: ${totals.secretaryCount} (exactly 1)`}
        />
        <ConstraintPill
          ok={totals.directorCount >= 1}
          label={`Director: ${totals.directorCount} (at least 1)`}
        />
      </div>

      {persons.map((person, index) => {
        const isOpen = openIndex === index;
        const docs: CompanySetupPersonDocuments = documents[String(index)] ?? {};
        const complete = isPersonComplete(person, docs);
        const photoState = getState(index, 'photo');
        const passportState = getState(index, 'passport');
        const additionalState = getState(index, 'passport_additional');
        const proofState = getState(index, 'proof_of_address');
        const passportExtracted = extractedDataOf(docs.passport);
        const additionalExtracted = additionalPageDataOf(docs.passport_additional);
        const wasAutoFilled =
          (!!passportExtracted && Object.keys(passportExtracted).length > 0) ||
          (!!additionalExtracted && Object.keys(additionalExtracted).length > 0);
        // Which additional page this person must upload — nationality NARROWED
        // by what the data page already gave us and by their own declaration.
        // A new-format Syrian passport has no second page at all.
        const additionalVariant = companySetupAdditionalPageRequired(person, docs);
        // The tick stays visible for every Syrian so it can be unticked; the
        // slot above it disappears while it is on.
        const offersNoAdditionalPage = passportAdditionalPageVariant(person.nationality) === 'syria';
        const declaredNoAdditionalPage = !!person.passportHasNoAdditionalPage;
        // Staff-provided files render filled and read-only — the client is
        // asked to confirm them, never to re-upload them.
        const isStaffDoc = (slot: DocSlot) => docs[slot]?.source === 'staff';
        // Photo + bank statement: shareholders always, officers only with a
        // UAE visa (ticked on the next step).
        const needsPhotoAndAddress = companySetupNeedsPhotoAndAddress(person);
        return (
          <div key={index} className="bg-white rounded-[12px] border border-gray-200">
            {/* Card header */}
            <div className="flex items-center gap-2 p-2 sm:p-3">
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? -1 : index)}
                aria-expanded={isOpen}
                className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 flex-1 min-w-0 min-h-11 p-2 rounded-[10px] text-left hover:bg-gray-50 tme-btn-focus sm:min-h-9"
              >
                <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-blue-50">
                  <User className="w-[18px] h-[18px] text-tme-blue" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold break-words text-tme-blue sm:text-sm">
                    {person.fullName.trim() || `Person ${index + 1}`}
                  </span>
                  <span className="block text-sm text-gray-600 break-words sm:text-[13px]">
                    {ROLE_DEFS.filter((r) => person.roles[r.key])
                      .map((r) => r.label)
                      .join(' · ') || 'No roles selected yet'}
                    {person.roles.shareholder && typeof person.shareholdingPct === 'number'
                      ? ` · ${person.shareholdingPct}%`
                      : ''}
                  </span>
                </span>
                <StatusChip
                  tone={complete ? 'green' : 'grey'}
                  icon={complete ? <CheckCircle className="w-3.5 h-3.5" aria-hidden /> : undefined}
                  className="flex-shrink-0 ml-12 sm:ml-0"
                >
                  {complete ? 'Complete' : 'Incomplete'}
                </StatusChip>
                <ChevronDown
                  className={`w-5 h-5 text-gray-600 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
              <Button
                tone="dangerGhost"
                onClick={() => removePerson(index)}
                disabled={persons.length <= 1}
                aria-label={`Remove ${person.fullName.trim() || `person ${index + 1}`}`}
                className="size-11 !px-0 shrink-0 sm:size-9"
              >
                <Trash2 className="w-[18px] h-[18px]" aria-hidden />
              </Button>
            </div>

            {isOpen && (
              <div className="px-4 sm:px-5 pb-5 space-y-6 border-t border-gray-200 pt-4">
                {/* 1 — Passport first: the scan fills the fields below. */}
                <div>
                  <p className="text-[15px] font-semibold text-tme-blue mb-1 sm:text-sm">
                    Passport: data page (we read your details from it)
                  </p>
                  <p className="text-sm text-gray-600 mb-3 sm:text-[13px]">
                    The printed page with the photo and the two machine-readable lines.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <UploadSlot
                        label="Passport: data page"
                        required
                        description="Scan the whole spread: the data page and the page facing it."
                        expectedType="INSIDE_PAGES"
                        file={null}
                        onUpload={(file) => handleAiUpload(index, 'passport', file, person)}
                        onRemove={() => removeAiDoc(index, 'passport')}
                        removable={!isStaffDoc('passport')}
                        providedByStaff={isStaffDoc('passport')}
                        staffDocReplaceable
                        messagesBeside
                        validated={!!docs.passport?.path && !docs.passport.needsReview}
                        validating={!!passportState.validating}
                        error={passportState.error}
                        preview={previewFor(index, 'passport', docs.passport)}
                        needsReview={docs.passport?.needsReview === true}
                      />
                      {!docs.passport?.path &&
                        shouldOfferManualReview(passportState.strikes) &&
                        pendingUploads.current[stateKey(index, 'passport')] && (
                          <ManualReviewOffer
                            onAccept={() => submitForManualReview(index, 'passport')}
                          />
                        )}
                    </div>

                    {/* Indian and Syrian passports carry a second required page —
                        except the new Syrian booklet, which has none. */}
                    {additionalVariant && (
                      <div>
                        <div>
                          <UploadSlot
                            label={ADDITIONAL_PAGE_COPY[additionalVariant].label}
                            required
                            description={ADDITIONAL_PAGE_COPY[additionalVariant].description}
                            expectedType="ADDITIONAL_PAGE"
                            file={null}
                            onUpload={(file) =>
                              handleAiUpload(index, 'passport_additional', file, person)
                            }
                            onRemove={() => removeAiDoc(index, 'passport_additional')}
                            removable={!isStaffDoc('passport_additional')}
                            providedByStaff={isStaffDoc('passport_additional')}
                            staffDocReplaceable
                            messagesBeside
                            validated={
                              !!docs.passport_additional?.path &&
                              !docs.passport_additional.needsReview
                            }
                            validating={!!additionalState.validating}
                            error={additionalState.error}
                            preview={previewFor(
                              index,
                              'passport_additional',
                              docs.passport_additional,
                            )}
                            needsReview={docs.passport_additional?.needsReview === true}
                          />
                        </div>
                        {!docs.passport_additional?.path &&
                          shouldOfferManualReview(additionalState.strikes) &&
                          pendingUploads.current[stateKey(index, 'passport_additional')] && (
                            <ManualReviewOffer
                              onAccept={() => submitForManualReview(index, 'passport_additional')}
                            />
                          )}
                      </div>
                    )}

                    {/* Syria only: the new booklet (renewals from 2026) prints
                        the issue details on the data page and has no second
                        page. The auto-detect above settles it whenever we could
                        read the data page; this tick is what a person whose
                        data page did not extract can say for themselves.
                        Without it they simply cannot submit the form — and
                        unlike a staff record, nobody at TME can upload the page
                        on their behalf. India is never offered it: the address
                        page always exists. */}
                    {offersNoAdditionalPage && (
                      <label className="flex items-start gap-3 text-[15px] cursor-pointer text-gray-800 py-1 sm:text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 w-5 h-5 flex-shrink-0 accent-tme-blue sm:w-4 sm:h-4"
                          checked={declaredNoAdditionalPage}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            // Ticking drops any page already uploaded so the
                            // declaration and the file cannot contradict
                            // each other.
                            if (checked && docs.passport_additional?.path) {
                              removeAiDoc(index, 'passport_additional');
                            }
                            onPatchPerson(index, (p) => ({
                              ...p,
                              passportHasNoAdditionalPage: checked || undefined,
                            }));
                          }}
                        />
                        <span>
                          This passport does not have an additional page: the date and place of
                          issue, expiry date and national number are printed on the photo page.
                        </span>
                      </label>
                    )}

                    {/* The headshot belongs with the passport: both are this
                        person's identity, and the client has the passport open
                        anyway. It used to sit at the bottom next to the bank
                        statement, which has nothing to do with it. */}
                    <div>
                      <UploadSlot
                        label="Digital passport photo"
                        required={needsPhotoAndAddress}
                        description={
                          needsPhotoAndAddress
                            ? 'Recent photo, plain light background, no glasses.'
                            : 'Recent photo, plain light background, no glasses. Only needed if this person wants a UAE visa (you choose this on the next page).'
                        }
                        file={null}
                        onUpload={(file) => handleAiUpload(index, 'photo', file, person)}
                        onRemove={() => removeAiDoc(index, 'photo')}
                        removable={!isStaffDoc('photo')}
                        providedByStaff={isStaffDoc('photo')}
                        staffDocReplaceable
                        messagesBeside
                        validated={!!docs.photo?.path && !docs.photo.needsReview}
                        validating={!!photoState.validating}
                        error={photoState.error}
                        preview={previewFor(index, 'photo', docs.photo)}
                        needsReview={docs.photo?.needsReview === true}
                      />
                      {!docs.photo?.path &&
                        shouldOfferManualReview(photoState.strikes) &&
                        pendingUploads.current[stateKey(index, 'photo')] && (
                          <ManualReviewOffer
                            onAccept={() => submitForManualReview(index, 'photo')}
                          />
                        )}
                    </div>
                  </div>

                  {(passportState.extracting || additionalState.extracting) && (
                    <div className="mt-3 rounded-xl border-2 border-blue-100 bg-blue-50/50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
                        <div>
                          <p className="text-[15px] font-semibold text-tme-blue sm:text-sm" role="status">
                            Reading your passport…
                          </p>
                          <p className="text-sm text-gray-600 mt-0.5 sm:text-[13px]">
                            We are copying the details from the passport. This can take a few seconds.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2 — Personal details (auto-filled from the passport when possible) */}
                <div>
                  <p className="text-[15px] font-semibold text-tme-blue mb-2 sm:text-sm">Personal details</p>
                  {wasAutoFilled && !passportState.extracting && !additionalState.extracting && (
                    <div className="mb-3 rounded-[10px] border border-blue-100 bg-blue-50/70 p-3 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-tme-blue" aria-hidden />
                      <p className="text-sm text-gray-700">
                        These details were auto-filled from your passport. Please review and correct
                        if needed.
                      </p>
                    </div>
                  )}
                  <div className="space-y-4">
                    {/* Three parts, exactly as the passport prints them and as
                        TME stores them. */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <Input
                        label="First name (as in the passport)"
                        required
                        value={person.firstName ?? ''}
                        onChange={(e) => updateName(index, { firstName: e.target.value })}
                        placeholder="e.g. THOMAS"
                        maxLength={60}
                      />
                      <Input
                        label="Middle name"
                        value={person.middleName ?? ''}
                        onChange={(e) => updateName(index, { middleName: e.target.value })}
                        placeholder="e.g. MICHAEL"
                        maxLength={60}
                      />
                      <Input
                        label="Family name"
                        value={person.lastName ?? ''}
                        onChange={(e) => updateName(index, { lastName: e.target.value })}
                        placeholder="e.g. MUELLER"
                        maxLength={60}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <CustomDropdown
                        label="Nationality"
                        required
                        value={person.nationality ?? ''}
                        onChange={(val) => updatePerson(index, { nationality: val })}
                        options={SORTED_NATIONALITIES.map((n) => ({
                          value: n,
                          label: n,
                        }))}
                        placeholder="Select…"
                        searchable
                      />
                      <CustomDropdown
                        label="Second nationality (if any)"
                        value={person.otherNationality ?? ''}
                        onChange={(val) => updatePerson(index, { otherNationality: val })}
                        options={SORTED_NATIONALITIES.map((n) => ({
                          value: n,
                          label: n,
                        }))}
                        placeholder="None"
                        searchable
                      />
                      <CustomDatePicker
                        label="Date of birth"
                        required
                        value={isoToDisplayDate(person.dateOfBirth)}
                        onChange={(val) =>
                          updatePerson(index, {
                            dateOfBirth: displayToIsoDate(val),
                          })
                        }
                      />
                      <CustomDropdown
                        label="Gender"
                        value={person.gender ?? ''}
                        onChange={(val) =>
                          updatePerson(index, {
                            gender: val === 'male' || val === 'female' ? val : undefined,
                          })
                        }
                        options={GENDER_OPTIONS}
                        placeholder="Select…"
                      />
                      <Input
                        label="Place of birth"
                        value={person.placeOfBirth ?? ''}
                        onChange={(e) => updatePerson(index, { placeOfBirth: e.target.value })}
                        placeholder="As shown in the passport"
                        maxLength={120}
                      />
                      <Input
                        label="Passport number"
                        value={person.passportNumber ?? ''}
                        onChange={(e) =>
                          updatePerson(index, {
                            passportNumber: e.target.value,
                          })
                        }
                        placeholder="e.g. C01X00T47"
                        maxLength={20}
                      />
                      <CustomDatePicker
                        label="Passport issue date"
                        value={isoToDisplayDate(person.passportIssueDate)}
                        onChange={(val) =>
                          updatePerson(index, {
                            passportIssueDate: displayToIsoDate(val),
                          })
                        }
                      />
                      <CustomDatePicker
                        label="Passport expiry date"
                        value={isoToDisplayDate(person.passportExpiryDate)}
                        onChange={(val) =>
                          updatePerson(index, {
                            passportExpiryDate: displayToIsoDate(val),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* 3 — Roles */}
                <div>
                  <p className="text-[15px] font-semibold text-tme-blue mb-2 sm:text-sm">
                    Roles in the company
                    <span className="text-tme-red ml-1" aria-hidden>*</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ROLE_DEFS.map((role) => {
                      const active = person.roles[role.key];
                      const blockedReason = companySetupRoleBlockedReason(
                        persons,
                        index,
                        role.key
                      );
                      return (
                        <button
                          key={role.key}
                          type="button"
                          disabled={!!blockedReason}
                          title={blockedReason ?? undefined}
                          onClick={() => updateRoles(index, role.key, !active)}
                          aria-pressed={active}
                          className={`min-h-11 px-4 py-2 rounded-full text-[15px] font-medium border-2 transition-colors duration-200 tme-btn-focus sm:text-[13px] sm:min-h-8 sm:px-3 sm:py-1 ${
                            active
                              ? 'bg-tme-blue border-tme-blue text-white'
                              : blockedReason
                                ? 'border-tme-blue/25 text-tme-blue opacity-50 cursor-not-allowed'
                                : 'border-tme-blue/25 text-tme-blue hover:bg-blue-50'
                          }`}
                        >
                          {role.label}
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const reasons = ROLE_DEFS.map((role) =>
                      companySetupRoleBlockedReason(persons, index, role.key)
                    ).filter((r): r is string => !!r);
                    return reasons.length > 0 ? (
                      <p className="text-sm text-gray-600 mt-2 sm:text-[13px]">{reasons.join(' ')}</p>
                    ) : null;
                  })()}
                  {person.roles.shareholder && (
                    <div className="max-w-[200px] mt-4">
                      <Input
                        label="Shareholding %"
                        required
                        type="number"
                        min={0.01}
                        max={100}
                        step="0.01"
                        value={person.shareholdingPct ?? ''}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n) || n <= 0) {
                            updatePerson(index, { shareholdingPct: undefined });
                            return;
                          }
                          // Clamp to the 0.01..100 window the server enforces.
                          updatePerson(index, {
                            shareholdingPct: Math.min(Math.max(n, 0.01), 100),
                          });
                        }}
                        placeholder="e.g. 50"
                      />
                    </div>
                  )}
                </div>

                {/* 4 — Background, family and contact */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CustomDropdown
                    label="Educational qualification"
                    required
                    value={person.educationalQualification ?? ''}
                    onChange={(val) => updatePerson(index, { educationalQualification: val })}
                    options={EDUCATIONAL_QUALIFICATIONS.map((q) => ({
                      value: q,
                      label: q,
                    }))}
                    placeholder="Select…"
                  />
                  {/* Same picker TME uses internally. The contract carries one
                      comma-separated string, so the list is split on the way in
                      and joined on the way out; allowCustom keeps a language
                      outside the list typeable. */}
                  <MultiSelectDropdown
                    label="Languages spoken"
                    required
                    value={splitLanguages(person.languagesSpoken)}
                    onChange={(val) => updatePerson(index, { languagesSpoken: val.join(', ') })}
                    options={SORTED_LANGUAGES.map((l) => ({
                      value: l,
                      label: l,
                    }))}
                    placeholder="Select languages"
                    searchable
                    allowCustom
                  />
                  <CustomDropdown
                    label="Religion"
                    required
                    // A stored value IFZA does not offer shows as "needs selection".
                    value={companySetupReligionValue(person.religion)}
                    onChange={(val) => updatePerson(index, { religion: val })}
                    options={SORTED_RELIGIONS.map((r) => ({
                      value: r,
                      label: r,
                    }))}
                    placeholder="Select…"
                  />
                  <CustomDropdown
                    label="Marital status"
                    required
                    value={person.maritalStatus ?? ''}
                    onChange={(val) =>
                      // Leaving Married also drops the spouse name. The field
                      // is hidden below, but a value left behind would still be
                      // submitted and reach the authority application.
                      updatePerson(index, {
                        maritalStatus: val,
                        ...(val === 'Married' ? {} : { spouseFullName: undefined }),
                      })
                    }
                    options={MARITAL_STATUS_OPTIONS.map((m) => ({
                      value: m,
                      label: m,
                    }))}
                    placeholder="Select…"
                  />
                  {person.maritalStatus === 'Married' && (
                    <Input
                      label="Spouse's full name"
                      value={person.spouseFullName ?? ''}
                      onChange={(e) => updatePerson(index, { spouseFullName: e.target.value })}
                      maxLength={120}
                    />
                  )}
                  <Input
                    label="Father's full name"
                    required
                    value={person.fatherFullName ?? ''}
                    onChange={(e) => updatePerson(index, { fatherFullName: e.target.value })}
                    maxLength={120}
                  />
                  <Input
                    label="Mother's full name"
                    required
                    value={person.motherFullName ?? ''}
                    onChange={(e) => updatePerson(index, { motherFullName: e.target.value })}
                    maxLength={120}
                  />
                  <Input
                    label="Email address"
                    type="email"
                    required
                    value={person.email ?? ''}
                    onChange={(e) => updatePerson(index, { email: e.target.value })}
                    placeholder="name@example.com"
                    maxLength={120}
                  />
                  <PhoneInput
                    label="Mobile number"
                    required
                    value={person.mobile || undefined}
                    onChange={(val) => updatePerson(index, { mobile: val ?? '' })}
                  />
                </div>


                {/* 5 — UAE history, employer, other entities */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CustomDropdown
                    label="Has this person visited or resided in the UAE?"
                    required
                    value={
                      person.visitedOrResidedUAE === undefined
                        ? ''
                        : person.visitedOrResidedUAE
                          ? 'yes'
                          : 'no'
                    }
                    onChange={(val) =>
                      updatePerson(index, {
                        visitedOrResidedUAE: val === 'yes',
                      })
                    }
                    options={YES_NO_OPTIONS}
                    placeholder="Select…"
                  />
                  <CustomDropdown
                    label="Current or previous UAE EID / residence visa?"
                    required
                    value={person.currentOrPastEidVisa ?? ''}
                    onChange={(val) =>
                      updatePerson(index, {
                        currentOrPastEidVisa: val as CompanySetupPerson['currentOrPastEidVisa'],
                      })
                    }
                    options={EID_VISA_OPTIONS}
                    placeholder="Select…"
                  />
                </div>

                <div>
                  <p className="text-[15px] font-semibold text-tme-blue mb-2 sm:text-sm">
                    Current or previous employer (if any)
                  </p>
                  {/* A company name or an address is often longer than one
                      line: a single-line input just scrolls the text out of
                      sight, so these grow downwards instead. The position is
                      short and stays a plain input. */}
                  <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
                    <div className="lg:col-span-3">
                      <GrowingField
                        label="Employer name"
                        value={person.previousEmployer?.name ?? ''}
                        onChange={(value) =>
                          updatePerson(index, {
                            previousEmployer: {
                              ...person.previousEmployer,
                              name: value,
                            },
                          })
                        }
                        maxLength={200}
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <GrowingField
                        label="Employer address"
                        value={person.previousEmployer?.address ?? ''}
                        onChange={(value) =>
                          updatePerson(index, {
                            previousEmployer: {
                              ...person.previousEmployer,
                              address: value,
                            },
                          })
                        }
                        maxLength={300}
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <Input
                        label="Position"
                        value={person.previousEmployer?.position ?? ''}
                        onChange={(e) =>
                          updatePerson(index, {
                            previousEmployer: {
                              ...person.previousEmployer,
                              position: e.target.value,
                            },
                          })
                        }
                        maxLength={120}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CustomDropdown
                    label="Shareholder in any other entity worldwide?"
                    required
                    value={
                      person.otherEntityShareholder === undefined
                        ? ''
                        : person.otherEntityShareholder
                          ? 'yes'
                          : 'no'
                    }
                    onChange={(val) =>
                      updatePerson(index, {
                        otherEntityShareholder: val === 'yes',
                        otherEntityCount: val === 'yes' ? person.otherEntityCount : undefined,
                      })
                    }
                    options={YES_NO_OPTIONS}
                    placeholder="Select…"
                  />
                  {person.otherEntityShareholder && (
                    <Input
                      label="In how many entities?"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT}
                      step={1}
                      maxLength={2}
                      value={person.otherEntityCount ?? ''}
                      onChange={(e) => {
                        // Digits only (no "01", no "-3", no "1e5"), clamped to
                        // the same 1..50 window the server enforces.
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
                        if (digits === '') {
                          updatePerson(index, { otherEntityCount: undefined });
                          return;
                        }
                        const n = Number(digits);
                        updatePerson(index, {
                          otherEntityCount:
                            n < 1 ? undefined : Math.min(n, COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT),
                        });
                      }}
                    />
                  )}
                </div>

                {/* 6 — Remaining documents */}
                <div>
                  <p className="text-[15px] font-semibold text-tme-blue mb-1 sm:text-sm">Documents</p>
                  <p className="text-sm text-gray-600 mb-3 sm:text-[13px]">
                    Please use a flatbed scanner, not phone photos.
                  </p>

                  {/* Proof of address, and the home address it proves, in one
                      place: the statement on the left, what the check found on
                      the right, and the address field underneath so the client
                      can copy the printed address straight across. */}
                  <div className="mb-4">
                    <UploadSlot
                      label="Proof of address: BANK STATEMENT ONLY"
                      required={needsPhotoAndAddress}
                      description={
                        needsPhotoAndAddress
                          ? 'Bank statement in your name, not older than 3 months. Current, savings or credit card.'
                          : 'Bank statement in your name, not older than 3 months. Only needed if this person wants a UAE visa (you choose this on the next page).'
                      }
                      file={null}
                      onUpload={(file) => handleAiUpload(index, 'proof_of_address', file, person)}
                      onRemove={() => removeAiDoc(index, 'proof_of_address')}
                      removable={!isStaffDoc('proof_of_address')}
                      providedByStaff={isStaffDoc('proof_of_address')}
                      staffDocReplaceable
                      messagesBeside
                      validated={false}
                      validating={!!proofState.validating}
                      error={proofState.error}
                      preview={previewFor(index, 'proof_of_address', docs.proof_of_address)}
                      needsReview={docs.proof_of_address?.needsReview === true}
                      // On a resumed draft the UI state is gone; the warnings
                      // that travelled with the ref are still there.
                      warnings={proofState.warnings ?? docs.proof_of_address?.validationErrors}
                      footer={
                        <>
                          {(proofState.warnings ?? docs.proof_of_address?.validationErrors ?? [])
                            .length > 0 && (
                            <p className="mt-2 text-sm text-gray-600 sm:text-[13px]">
                              Your file is saved. You can carry on, or replace it.
                            </p>
                          )}
                          {/* The address on the statement does not match the one
                              typed: without a way out the client edits the field,
                              re-uploads and gets the same warning again. Offer the
                              printed address as a one-click fix, right beside the
                              statement it came from. */}
                          <StatementAddressFix
                            statementAddress={statementAddressOf(docs.proof_of_address)}
                            typedAddress={person.fullAddress}
                            onUse={(address) => {
                              updatePerson(index, { fullAddress: address });
                              const kept = (
                                proofState.warnings ??
                                docs.proof_of_address?.validationErrors ??
                                []
                              ).filter((w) => w !== ADDRESS_MISMATCH_WARNING);
                              patchState(index, 'proof_of_address', {
                                warnings: kept.length > 0 ? kept : undefined,
                              });
                              const ref = docs.proof_of_address;
                              if (ref) {
                                onDocumentChange(index, 'proof_of_address', {
                                  ...ref,
                                  validationErrors: kept.length > 0 ? kept : undefined,
                                });
                              }
                            }}
                          />
                          {!docs.proof_of_address?.path &&
                            shouldOfferManualReview(proofState.strikes) &&
                            pendingUploads.current[stateKey(index, 'proof_of_address')] && (
                              <ManualReviewOffer
                                onAccept={() => submitForManualReview(index, 'proof_of_address')}
                              />
                            )}
                        </>
                      }
                    />
                  <div>
                    <label
                      htmlFor={`company-setup-home-address-${index}`}
                      className="block text-[15px] font-semibold mb-1.5 text-tme-blue sm:text-sm sm:font-medium"
                    >
                      Full home address
                    </label>
                    <textarea
                      id={`company-setup-home-address-${index}`}
                      value={person.fullAddress ?? ''}
                      onChange={(e) => updatePerson(index, { fullAddress: e.target.value })}
                      rows={2}
                      maxLength={400}
                      placeholder="Street, number, postcode, city, country"
                      className="w-full px-3.5 py-2.5 rounded-[10px] border-2 border-gray-200 focus:outline-none focus:border-tme-blue transition-colors duration-200 text-base sm:py-2 sm:border sm:border-gray-300 sm:rounded-lg sm:text-sm sm:focus:ring-2 sm:focus:ring-tme-blue/15"
                    />
                    <p className="text-sm text-gray-700 mt-1.5 flex items-start gap-1.5">
                      <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-tme-blue" aria-hidden />
                      Must match the address on the bank statement above.
                    </p>
                  </div>
                  </div>

                  <div className="space-y-3">
                    {person.currentOrPastEidVisa === 'current' && (
                      <>
                        <PlainDocSlot
                          label="Emirates ID: front"
                          description="Current Emirates ID, front side"
                          staffProvided={isStaffDoc('eid_front')}
                          onUpload={(file) => handlePlainUpload(index, 'eid_front', file)}
                          onRemove={() => onDocumentChange(index, 'eid_front', undefined)}
                          docRef={docs.eid_front}
                        />
                        <PlainDocSlot
                          label="Emirates ID: back"
                          description="Current Emirates ID, back side"
                          staffProvided={isStaffDoc('eid_back')}
                          onUpload={(file) => handlePlainUpload(index, 'eid_back', file)}
                          onRemove={() => onDocumentChange(index, 'eid_back', undefined)}
                          docRef={docs.eid_back}
                        />
                        <PlainDocSlot
                          label="Current UAE visa"
                          description="Copy of the current UAE residence visa"
                          staffProvided={isStaffDoc('visa_document')}
                          onUpload={(file) => handlePlainUpload(index, 'visa_document', file)}
                          onRemove={() => onDocumentChange(index, 'visa_document', undefined)}
                          docRef={docs.visa_document}
                        />
                      </>
                    )}
                    {person.currentOrPastEidVisa === 'past' && (
                      <PlainDocSlot
                        label="Previous UAE visa"
                        description="Copy of the previous UAE residence visa"
                        staffProvided={isStaffDoc('previous_visa_document')}
                        onUpload={(file) =>
                          handlePlainUpload(index, 'previous_visa_document', file)
                        }
                        onRemove={() =>
                          onDocumentChange(index, 'previous_visa_document', undefined)
                        }
                        docRef={docs.previous_visa_document}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {persons.length >= COMPANY_SETUP_MAX_PERSONS && (
        <p className="text-sm text-gray-600 sm:text-[13px]">
          You can add up to {COMPANY_SETUP_MAX_PERSONS} people.
        </p>
      )}
      {persons.length < COMPANY_SETUP_MAX_PERSONS && (
        <Button tone="secondary" onClick={addPerson}>
          <Plus className="w-4 h-4" aria-hidden />
          Add another person
        </Button>
      )}
    </div>
  );
}

/**
 * A plain (non-AI) document slot. Identical to FileUploadSlot, except that a
 * ref TME uploaded on the client's behalf renders as a filled, read-only row:
 * the client confirms it, they do not re-upload it, and they cannot delete a
 * file they never provided.
 */
export function PlainDocSlot({
  label,
  description,
  staffProvided,
  docRef,
  onUpload,
  onRemove,
}: {
  label: string;
  description: string;
  staffProvided: boolean;
  docRef: CompanySetupDocRef | undefined;
  onUpload: (file: File) => Promise<UploadResult | null>;
  onRemove: () => void;
}) {
  // The form asks the client to confirm our file is correct, so it also has to
  // let them say it is not: clearing the ref drops the card back to the normal
  // upload slot, and whatever they upload becomes their own file.
  if (staffProvided && docRef?.path) {
    return (
      <div className="border-2 border-blue-100 bg-blue-50/50 rounded-[10px] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-tme-blue" aria-hidden />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-gray-900 sm:text-sm">{label}</p>
            <p className="text-sm text-gray-700 break-words">
              Provided by TME. Please check it is correct
              {docRef.filename ? ` · ${docRef.filename}` : ''}
            </p>
          </div>
        </div>
        <Button tone="plain" onClick={onRemove} className="flex-shrink-0 w-full sm:w-auto">
          Not correct? Replace it
        </Button>
      </div>
    );
  }
  return (
    <FileUploadSlot
      label={label}
      description={description}
      onUpload={onUpload}
      onRemove={onRemove}
      uploaded={!!docRef?.path}
      filename={docRef?.filename}
    />
  );
}

/**
 * The bank statement is the proof of address, so the address on it IS the
 * answer. When we managed to read it and it is not what the client typed, the
 * form shows it and offers to copy it into the home address field: without
 * that, a mismatch is a dead end where they edit, re-upload and get the same
 * warning again.
 */
function StatementAddressFix({
  statementAddress,
  typedAddress,
  onUse,
}: {
  statementAddress: string | undefined;
  typedAddress: string | undefined;
  onUse: (address: string) => void;
}) {
  const address = statementAddress?.trim();
  const typed = (typedAddress ?? '').trim();
  if (!address) return null;
  if (address.toLowerCase() === typed.toLowerCase()) return null;
  return (
    <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 p-3.5">
      <p className="text-sm text-amber-900 mb-1">
        {typed
          ? 'This is the address printed on the statement you uploaded:'
          : 'We read this address from the statement you uploaded:'}
      </p>
      <p className="text-[15px] font-semibold text-amber-950 mb-3 break-words sm:text-sm">{address}</p>
      <Button tone="plain" onClick={() => onUse(address)} className="w-full sm:w-auto">
        Use this as the home address
      </Button>
      <p className="text-sm text-amber-900 mt-2">
        {typed
          ? 'This replaces the home address entered above, so both say the same thing.'
          : 'This fills in the home address above.'}
      </p>
    </div>
  );
}

/**
 * A single-line-looking field that grows downwards as the text gets longer, so
 * a long employer name or address stays readable instead of scrolling out of
 * the box. Matches the shared Input chrome (the shared AutoGrowText: 46px phone / 40px desktop start
 * height, same border and focus colour) so the row lines up with the plain inputs beside it.
 */
function GrowingField({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
        {label}
      </label>
      <AutoGrowText
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={textFieldClasses(false)}
      />
    </div>
  );
}

function ManualReviewOffer({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 p-3.5">
      <p className="text-sm text-amber-900 mb-3 flex items-start gap-1.5">
        <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden />
        Having trouble with the automatic check? You can send this file anyway and TME will check
        it by hand.
      </p>
      <Button tone="plain" onClick={onAccept} className="w-full sm:w-auto">
        Submit for manual review
      </Button>
    </div>
  );
}
