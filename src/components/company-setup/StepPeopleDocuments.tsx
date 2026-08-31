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

import React, { useRef, useState } from 'react';
import {
  TME_COLORS,
  NATIONALITIES,
  LANGUAGES,
  RELIGIONS,
  EDUCATIONAL_QUALIFICATIONS,
  MARITAL_STATUS_OPTIONS,
} from '@/lib/constants';
import {
  Input,
  CustomDropdown,
  CustomDatePicker,
  MultiSelectDropdown,
  PhoneInput,
} from '@/components/ui';
import { UploadSlot } from '@/components/UploadSlot';
import { FileUploadSlot } from '@/components/FileUploadSlot';
import {
  shouldOfferManualReview,
  passportAdditionalPageVariant,
  type PassportAdditionalPageVariant,
} from '@/lib/staff-form-logic';
import { compressImageForAI } from '@/lib/utils';
import { singlePagePdfError } from '@/lib/single-page-pdf';
import { renderPdfFirstPage } from '@/lib/pdf-thumbnail';
import {
  COMPANY_SETUP_MAX_SHAREHOLDERS,
  composeFullName,
  type CompanySetupDocRef,
  type CompanySetupDocuments,
  type CompanySetupPerson,
  type CompanySetupPersonDocuments,
} from '@/types/company-setup';
import { COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT } from '@/lib/company-setup-validation';
import {
  additionalPageDataOf,
  applyAdditionalPageExtraction,
  applyPassportExtraction,
  clearAppliedAdditionalPage,
  clearAppliedExtraction,
  emptyPerson,
  extractedDataOf,
  isoToDisplayDate,
  displayToIsoDate,
  roleTotals,
  type AdditionalPageExtractedFields,
  type AdditionalPageExtractionData,
  type PassportExtractedFields,
  type PassportExtractionData,
} from './draft';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  User,
  XCircle,
} from 'lucide-react';

type AiSlot = 'photo' | 'passport' | 'passport_additional' | 'proof_of_address';
type PlainSlot = 'eid_front' | 'eid_back' | 'visa_document' | 'previous_visa_document';
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
    label: 'Passport — issue-details page',
    description:
      'Syrian passports carry the date and place of issue, the expiry date and the national number on a separate page next to the data page. Please scan that page.',
  },
  india: {
    label: 'Passport — address / family-details page',
    description:
      'Indian passports carry the address and the parents’ / spouse’s names on the last page. Please scan that page.',
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
const SORTED_RELIGIONS = sortWithOtherLast(RELIGIONS);
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
  { value: 'none', label: 'No — never had a UAE EID or visa' },
  { value: 'current', label: 'Yes — currently holds a UAE EID / visa' },
  { value: 'past', label: 'Yes — held a UAE EID / visa in the past' },
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
    compute: (person: CompanySetupPerson) => CompanySetupPerson
  ) => void;
  /** Called BEFORE a person is removed so document refs can be re-keyed. */
  onRemovePerson: (index: number) => void;
  onDocumentChange: (
    personIndex: number,
    slot: DocSlot,
    ref: CompanySetupDocRef | undefined
  ) => void;
  uploadFile: (
    personIndex: number,
    slot: DocSlot,
    file: File
  ) => Promise<{ path: string; filename: string } | null>;
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
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
        ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
      }`}
    >
      {ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

/** Per-person completion: required fields + required documents all present. */
export function isPersonComplete(
  person: CompanySetupPerson,
  docs: CompanySetupPersonDocuments
): boolean {
  // nationality + date of birth are server-required at submit; keeping them
  // out of this check made a person show "Complete" and then fail the submit.
  if (
    !person.fullName.trim() ||
    !person.nationality ||
    !person.dateOfBirth ||
    !person.religion ||
    !person.currentOrPastEidVisa
  ) {
    return false;
  }
  if (
    person.roles.shareholder &&
    !(typeof person.shareholdingPct === 'number' && person.shareholdingPct > 0)
  ) {
    return false;
  }
  if (!docs.passport?.path || !docs.photo?.path || !docs.proof_of_address?.path) return false;
  // Indian / Syrian passports need their additional page too.
  if (passportAdditionalPageVariant(person.nationality) && !docs.passport_additional?.path) {
    return false;
  }
  if (person.currentOrPastEidVisa === 'current') {
    if (!docs.eid_front?.path || !docs.eid_back?.path || !docs.visa_document?.path) return false;
  }
  if (person.currentOrPastEidVisa === 'past' && !docs.previous_visa_document?.path) return false;
  return true;
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
    ref?: CompanySetupDocRef
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
    patch: Pick<Partial<CompanySetupPerson>, 'firstName' | 'middleName' | 'lastName'>
  ) => {
    const merged = { ...persons[index], ...patch };
    updatePerson(index, { ...patch, fullName: composeFullName(merged) });
  };

  const updateRoles = (index: number, key: keyof CompanySetupPerson['roles'], value: boolean) => {
    const person = persons[index];
    updatePerson(index, { roles: { ...person.roles, [key]: value } });
  };

  const addPerson = () => {
    if (persons.length >= COMPANY_SETUP_MAX_SHAREHOLDERS) return;
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
    ref: { path: string; filename: string; uploadedAt: string }
  ) => {
    patchState(personIndex, 'passport', { extracting: true });
    try {
      const res = await fetch(`/api/company-setup/${token}/extract-passport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: aiImage }),
      });
      const result = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: PassportExtractionData;
      } | null;

      // Abort if the client removed/replaced the passport while we read it.
      const current = documentsRef.current[String(personIndex)]?.passport;
      if (!current || current.path !== ref.path) return;

      if (res.ok && result?.success && result.data) {
        // Compute FIRST against the live person, then patch with a pure merge.
        const person = personsRef.current[personIndex];
        if (!person) return;
        const outcome = applyPassportExtraction(person, result.data, NATIONALITIES);
        const applied: PassportExtractedFields = outcome.applied;
        onPatchPerson(personIndex, () => outcome.person);
        const refWithData: CompanySetupDocRef = { ...current, extractedData: applied };
        onDocumentChange(personIndex, 'passport', refWithData);
        onExtractionApplied();
      }
      // Extraction failing is silent — the fields below stay manual.
    } catch {
      // Network failure — same silence, manual entry covers it.
    } finally {
      patchState(personIndex, 'passport', { extracting: false });
    }
  };

  /** Additional page (India / Syria): same fill-only flow as the data page. */
  const runAdditionalExtraction = async (
    personIndex: number,
    aiImage: string,
    ref: { path: string; filename: string; uploadedAt: string },
    nationality: string | undefined
  ) => {
    patchState(personIndex, 'passport_additional', { extracting: true });
    try {
      const res = await fetch(`/api/company-setup/${token}/extract-passport-additional`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: aiImage, nationality }),
      });
      const result = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: AdditionalPageExtractionData;
      } | null;

      // Abort if the client removed/replaced the page while we read it.
      const current = documentsRef.current[String(personIndex)]?.passport_additional;
      if (!current || current.path !== ref.path) return;

      if (res.ok && result?.success && result.data) {
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
    } catch {
      // Silent — the fields stay manual.
    } finally {
      patchState(personIndex, 'passport_additional', { extracting: false });
    }
  };

  // ---------- AI-validated slots (photo + passport) ----------
  const handleAiUpload = async (
    personIndex: number,
    slot: AiSlot,
    file: File,
    person: CompanySetupPerson
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
      patchState(personIndex, slot, { error: 'Could not read this file. Please try again.' });
      return false;
    }

    const uploaded = await uploadFile(personIndex, slot, file);
    if (!uploaded) {
      patchState(personIndex, slot, { error: 'Upload failed. Please try again.' });
      return false;
    }
    patchState(personIndex, slot, { preview: dataUrl, validating: true });

    // Vision check runs against an image: PDFs are flattened to page 1 first
    // (same approach as the staff onboarding forms).
    let aiImage = dataUrl;
    try {
      if (file.type === 'application/pdf') {
        aiImage = await renderPdfFirstPage(dataUrl);
      }
      aiImage = await compressImageForAI(aiImage);
    } catch {
      // Fall through with whatever we have — the route rejects if unusable.
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
        ? { image: aiImage }
        : slot === 'proof_of_address'
          ? {
              image: aiImage,
              expectedName: person.fullName?.trim() || undefined,
              expectedAddress: person.fullAddress?.trim() || undefined,
            }
          : {
              image: aiImage,
              nationality: person.nationality || undefined,
              expectedType: slot === 'passport_additional' ? 'ADDITIONAL_PAGE' : 'INSIDE_PAGES',
            };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));

      const infra = result?.infra === true || !res.ok;

      // Infra first: the proof-of-address route reports an unrunnable check as
      // valid=true + infra, so an accepted-before-infra order would file it as
      // verified when nothing was verified.
      if (infra) {
        // The check could not run — never strand the client on our
        // infrastructure: accept the upload flagged for manual review.
        onDocumentChange(personIndex, slot, {
          path: uploaded.path,
          filename: uploaded.filename,
          uploadedAt: new Date().toISOString(),
          needsReview: true,
          validationErrors: ['Automatic check unavailable — flagged for manual review.'],
        });
        patchState(personIndex, slot, {
          validating: false,
          error: undefined,
          warnings: undefined,
        });
        return true;
      }

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
        const newRef: CompanySetupDocRef =
          slot === 'proof_of_address'
            ? {
                path: uploaded.path,
                filename: uploaded.filename,
                uploadedAt: new Date().toISOString(),
                needsReview: true,
                ...(warnings.length > 0 ? { validationErrors: warnings } : {}),
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
    } catch {
      // Network failure mid-check — treat like infra.
      onDocumentChange(personIndex, slot, {
        path: uploaded.path,
        filename: uploaded.filename,
        uploadedAt: new Date().toISOString(),
        needsReview: true,
        validationErrors: ['Automatic check unavailable — flagged for manual review.'],
      });
      patchState(personIndex, slot, { validating: false, error: undefined });
      return true;
    }
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
        documentsRef.current[String(personIndex)]?.passport_additional
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
    file: File
  ): Promise<{ path: string; filename: string } | null> => {
    const uploaded = await uploadFile(personIndex, slot, file);
    if (!uploaded) return null;
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
      <p className="text-sm text-gray-600">
        Add every person involved in the company — shareholders, General Manager, Director and
        Secretary (up to {COMPANY_SETUP_MAX_SHAREHOLDERS} persons; one person can hold several
        roles). Start with the passport: we read the personal details from it for you.
      </p>

      {/* Live totals / constraints bar */}
      <div className="sticky top-[76px] z-30 bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-2">
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
        const additionalVariant = passportAdditionalPageVariant(person.nationality);
        // Staff-provided files render filled and read-only — the client is
        // asked to confirm them, never to re-upload them.
        const isStaffDoc = (slot: DocSlot) => docs[slot]?.source === 'staff';
        return (
          <div key={index} className="bg-white rounded-xl border border-gray-100 shadow-sm">
            {/* Card header */}
            <div className="flex items-center gap-3 p-4">
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? -1 : index)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${TME_COLORS.primary}12` }}
                >
                  <User className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-sm font-semibold truncate"
                    style={{ color: TME_COLORS.primary }}
                  >
                    {person.fullName.trim() || `Person ${index + 1}`}
                  </span>
                  <span className="block text-xs text-gray-500 truncate">
                    {ROLE_DEFS.filter((r) => person.roles[r.key])
                      .map((r) => r.label)
                      .join(' · ') || 'No roles selected yet'}
                    {person.roles.shareholder && typeof person.shareholdingPct === 'number'
                      ? ` · ${person.shareholdingPct}%`
                      : ''}
                  </span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
                    complete ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {complete ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" />
                      Complete
                    </>
                  ) : (
                    'Incomplete'
                  )}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={() => removePerson(index)}
                disabled={persons.length <= 1}
                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove this person"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {isOpen && (
              <div className="px-4 pb-5 space-y-6 border-t border-gray-50 pt-4">
                {/* 1 — Passport first: the scan fills the fields below. */}
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: TME_COLORS.primary }}>
                    Passport — data page (we read your details from it)
                  </p>
                  <p className="text-xs text-gray-500 mb-3">
                    This is the printed page inside the passport with the photo and the two
                    machine-readable lines. The portrait photo for the application is a separate
                    upload further down.
                  </p>
                  <div className="max-w-md">
                    <UploadSlot
                      label="Passport — data page"
                      description="Open the passport flat at the data page and scan the whole spread — the data page AND the page facing it."
                      expectedType="INSIDE_PAGES"
                      file={null}
                      onUpload={(file) => handleAiUpload(index, 'passport', file, person)}
                      onRemove={() => removeAiDoc(index, 'passport')}
                      removable={!isStaffDoc('passport')}
                      providedByStaff={isStaffDoc('passport')}
                      validated={!!docs.passport?.path && !docs.passport.needsReview}
                      validating={!!passportState.validating}
                      error={passportState.error}
                      preview={previewFor(index, 'passport', docs.passport)}
                      needsReview={docs.passport?.needsReview === true}
                    />
                  </div>
                  {!docs.passport?.path &&
                    shouldOfferManualReview(passportState.strikes) &&
                    pendingUploads.current[stateKey(index, 'passport')] && (
                      <ManualReviewOffer onAccept={() => submitForManualReview(index, 'passport')} />
                    )}

                  {/* Indian and Syrian passports carry a second required page. */}
                  {additionalVariant && (
                    <div className="mt-4">
                      <div className="max-w-md">
                        <UploadSlot
                          label={ADDITIONAL_PAGE_COPY[additionalVariant].label}
                          description={ADDITIONAL_PAGE_COPY[additionalVariant].description}
                          expectedType="ADDITIONAL_PAGE"
                          file={null}
                          onUpload={(file) =>
                            handleAiUpload(index, 'passport_additional', file, person)
                          }
                          onRemove={() => removeAiDoc(index, 'passport_additional')}
                          removable={!isStaffDoc('passport_additional')}
                          providedByStaff={isStaffDoc('passport_additional')}
                          validated={
                            !!docs.passport_additional?.path &&
                            !docs.passport_additional.needsReview
                          }
                          validating={!!additionalState.validating}
                          error={additionalState.error}
                          preview={previewFor(index, 'passport_additional', docs.passport_additional)}
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

                  {(passportState.extracting || additionalState.extracting) && (
                    <div className="mt-3 rounded-xl border-2 border-blue-100 bg-blue-50/50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
                        <div>
                          <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                            Reading passport data…
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Extracting the details from the passport. This may take a few seconds.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2 — Personal details (auto-filled from the passport when possible) */}
                <div>
                  <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>
                    Personal details
                  </p>
                  {wasAutoFilled && !passportState.extracting && !additionalState.extracting && (
                    <div
                      className="mb-3 rounded-lg p-3 flex items-start gap-2"
                      style={{ backgroundColor: 'rgba(36,63,123,0.06)' }}
                    >
                      <Sparkles
                        className="w-4 h-4 mt-0.5 flex-shrink-0"
                        style={{ color: TME_COLORS.primary }}
                      />
                      <p className="text-sm text-gray-700">
                        These details were auto-filled from your passport — please review and
                        correct if needed.
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
                        options={SORTED_NATIONALITIES.map((n) => ({ value: n, label: n }))}
                        placeholder="Select…"
                        searchable
                      />
                      <CustomDropdown
                        label="Second nationality (if any)"
                        value={person.otherNationality ?? ''}
                        onChange={(val) => updatePerson(index, { otherNationality: val })}
                        options={SORTED_NATIONALITIES.map((n) => ({ value: n, label: n }))}
                        placeholder="None"
                        searchable
                      />
                      <CustomDatePicker
                        label="Date of birth"
                        required
                        value={isoToDisplayDate(person.dateOfBirth)}
                        onChange={(val) => updatePerson(index, { dateOfBirth: displayToIsoDate(val) })}
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
                        onChange={(e) => updatePerson(index, { passportNumber: e.target.value })}
                        placeholder="e.g. C01X00T47"
                        maxLength={20}
                      />
                      <CustomDatePicker
                        label="Passport issue date"
                        value={isoToDisplayDate(person.passportIssueDate)}
                        onChange={(val) =>
                          updatePerson(index, { passportIssueDate: displayToIsoDate(val) })
                        }
                      />
                      <CustomDatePicker
                        label="Passport expiry date"
                        value={isoToDisplayDate(person.passportExpiryDate)}
                        onChange={(val) =>
                          updatePerson(index, { passportExpiryDate: displayToIsoDate(val) })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* 3 — Roles */}
                <div>
                  <label
                    className="block text-sm font-medium mb-2"
                    style={{ color: TME_COLORS.primary }}
                  >
                    Roles in the company<span className="text-red-500 ml-1">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ROLE_DEFS.map((role) => {
                      const active = person.roles[role.key];
                      return (
                        <button
                          key={role.key}
                          type="button"
                          onClick={() => updateRoles(index, role.key, !active)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-all duration-200 ${
                            active ? 'text-white' : 'hover:bg-gray-50'
                          }`}
                          style={
                            active
                              ? { backgroundColor: TME_COLORS.primary, borderColor: TME_COLORS.primary }
                              : { color: TME_COLORS.primary, borderColor: `${TME_COLORS.primary}40` }
                          }
                        >
                          {role.label}
                        </button>
                      );
                    })}
                  </div>
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
                    value={person.educationalQualification ?? ''}
                    onChange={(val) => updatePerson(index, { educationalQualification: val })}
                    options={EDUCATIONAL_QUALIFICATIONS.map((q) => ({ value: q, label: q }))}
                    placeholder="Select…"
                  />
                  {/* Same picker TME uses internally. The contract carries one
                      comma-separated string, so the list is split on the way in
                      and joined on the way out; allowCustom keeps a language
                      outside the list typeable. */}
                  <MultiSelectDropdown
                    label="Languages spoken"
                    value={splitLanguages(person.languagesSpoken)}
                    onChange={(val) =>
                      updatePerson(index, { languagesSpoken: val.join(', ') })
                    }
                    options={SORTED_LANGUAGES.map((l) => ({ value: l, label: l }))}
                    placeholder="Select languages"
                    searchable
                    allowCustom
                  />
                  <CustomDropdown
                    label="Religion"
                    required
                    value={person.religion ?? ''}
                    onChange={(val) => updatePerson(index, { religion: val })}
                    options={SORTED_RELIGIONS.map((r) => ({ value: r, label: r }))}
                    placeholder="Select…"
                  />
                  <CustomDropdown
                    label="Marital status"
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
                    options={MARITAL_STATUS_OPTIONS.map((m) => ({ value: m, label: m }))}
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
                    value={person.fatherFullName ?? ''}
                    onChange={(e) => updatePerson(index, { fatherFullName: e.target.value })}
                    maxLength={120}
                  />
                  <Input
                    label="Mother's full name"
                    value={person.motherFullName ?? ''}
                    onChange={(e) => updatePerson(index, { motherFullName: e.target.value })}
                    maxLength={120}
                  />
                  <Input
                    label="Email address"
                    type="email"
                    value={person.email ?? ''}
                    onChange={(e) => updatePerson(index, { email: e.target.value })}
                    placeholder="name@example.com"
                    maxLength={120}
                  />
                  <PhoneInput
                    label="Mobile number"
                    value={person.mobile || undefined}
                    onChange={(val) => updatePerson(index, { mobile: val ?? '' })}
                  />
                </div>

                <div>
                  <label
                    className="block text-sm font-medium mb-1"
                    style={{ color: TME_COLORS.primary }}
                  >
                    Full home address
                  </label>
                  <textarea
                    value={person.fullAddress ?? ''}
                    onChange={(e) => updatePerson(index, { fullAddress: e.target.value })}
                    rows={2}
                    maxLength={400}
                    placeholder="Street, number, postcode, city, country"
                    className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 text-sm"
                    onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
                  />
                  <p className="text-xs text-amber-700 mt-1">
                    The address must match the address on the bank statement you upload as proof of
                    address.
                  </p>
                </div>

                {/* 5 — UAE history, employer, other entities */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CustomDropdown
                    label="Has this person visited or resided in the UAE?"
                    value={
                      person.visitedOrResidedUAE === undefined
                        ? ''
                        : person.visitedOrResidedUAE
                        ? 'yes'
                        : 'no'
                    }
                    onChange={(val) => updatePerson(index, { visitedOrResidedUAE: val === 'yes' })}
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
                  <p className="text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>
                    Previous / current employer (if any)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Input
                      label="Employer name"
                      value={person.previousEmployer?.name ?? ''}
                      onChange={(e) =>
                        updatePerson(index, {
                          previousEmployer: { ...person.previousEmployer, name: e.target.value },
                        })
                      }
                      maxLength={200}
                    />
                    <Input
                      label="Employer address"
                      value={person.previousEmployer?.address ?? ''}
                      onChange={(e) =>
                        updatePerson(index, {
                          previousEmployer: { ...person.previousEmployer, address: e.target.value },
                        })
                      }
                      maxLength={300}
                    />
                    <Input
                      label="Position"
                      value={person.previousEmployer?.position ?? ''}
                      onChange={(e) =>
                        updatePerson(index, {
                          previousEmployer: { ...person.previousEmployer, position: e.target.value },
                        })
                      }
                      maxLength={120}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <CustomDropdown
                    label="Shareholder in any other entity worldwide?"
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
                            n < 1
                              ? undefined
                              : Math.min(n, COMPANY_SETUP_MAX_OTHER_ENTITY_COUNT),
                        });
                      }}
                    />
                  )}
                </div>

                {/* 6 — Remaining documents */}
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: TME_COLORS.primary }}>
                    Documents
                  </p>
                  <p className="text-xs text-gray-500 mb-3">
                    Scans must be flat, complete and readable — flatbed scanner quality, not phone
                    snapshots.
                  </p>

                  <div className="max-w-md mb-4">
                    <UploadSlot
                      label="Portrait photo (headshot)"
                      description="A recent digital headshot — plain light background, no glasses. This is the photo for the application, not a passport page."
                      file={null}
                      onUpload={(file) => handleAiUpload(index, 'photo', file, person)}
                      onRemove={() => removeAiDoc(index, 'photo')}
                      removable={!isStaffDoc('photo')}
                      providedByStaff={isStaffDoc('photo')}
                      validated={!!docs.photo?.path && !docs.photo.needsReview}
                      validating={!!photoState.validating}
                      error={photoState.error}
                      preview={previewFor(index, 'photo', docs.photo)}
                      needsReview={docs.photo?.needsReview === true}
                    />
                    {!docs.photo?.path &&
                      shouldOfferManualReview(photoState.strikes) &&
                      pendingUploads.current[stateKey(index, 'photo')] && (
                        <ManualReviewOffer onAccept={() => submitForManualReview(index, 'photo')} />
                      )}
                  </div>

                  <div className="space-y-3">
                    {person.currentOrPastEidVisa === 'current' && (
                      <>
                        <PlainDocSlot
                          label="Emirates ID — front"
                          description="Current Emirates ID, front side"
                          staffProvided={isStaffDoc('eid_front')}
                          onUpload={(file) => handlePlainUpload(index, 'eid_front', file)}
                          onRemove={() => onDocumentChange(index, 'eid_front', undefined)}
                          docRef={docs.eid_front}
                        />
                        <PlainDocSlot
                          label="Emirates ID — back"
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
                        onUpload={(file) => handlePlainUpload(index, 'previous_visa_document', file)}
                        onRemove={() => onDocumentChange(index, 'previous_visa_document', undefined)}
                        docRef={docs.previous_visa_document}
                      />
                    )}
                  </div>

                  {/* Proof of address gets the same AI treatment as the other
                      documents: is it really a bank statement, is it recent
                      enough, does it show this person's name and address. The
                      verdict never blocks beyond "not a bank statement" — the
                      ref always stays needsReview for a human. */}
                  <div className="max-w-md mt-4">
                    <UploadSlot
                      label="Proof of address — BANK STATEMENT ONLY"
                      description="A bank statement not older than 3 months, showing your name and home address. A current, savings or credit card statement is fine."
                      file={null}
                      onUpload={(file) => handleAiUpload(index, 'proof_of_address', file, person)}
                      onRemove={() => removeAiDoc(index, 'proof_of_address')}
                      removable={!isStaffDoc('proof_of_address')}
                      providedByStaff={isStaffDoc('proof_of_address')}
                      validated={false}
                      validating={!!proofState.validating}
                      error={proofState.error}
                      preview={previewFor(index, 'proof_of_address', docs.proof_of_address)}
                      needsReview={docs.proof_of_address?.needsReview === true}
                      // On a resumed draft the UI state is gone; the warnings
                      // that travelled with the ref are still there.
                      warnings={proofState.warnings ?? docs.proof_of_address?.validationErrors}
                      footer={
                        (proofState.warnings ?? docs.proof_of_address?.validationErrors ?? [])
                          .length > 0 ? (
                          <p className="mt-2 text-xs text-gray-500">
                            Your file has been kept — you can continue anyway and TME will check it,
                            or replace it with a more recent statement.
                          </p>
                        ) : undefined
                      }
                    />
                    {!docs.proof_of_address?.path &&
                      shouldOfferManualReview(proofState.strikes) &&
                      pendingUploads.current[stateKey(index, 'proof_of_address')] && (
                        <ManualReviewOffer
                          onAccept={() => submitForManualReview(index, 'proof_of_address')}
                        />
                      )}
                    <p className="text-xs text-amber-700 flex items-start gap-1 mt-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      Only a bank statement is accepted as proof of address (not older than 3
                      months). It can be a current, savings or credit card statement, but not a
                      utility bill, tenancy contract or bank reference letter. The address must
                      match the home address entered above. TME will review this document
                      manually.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {persons.length < COMPANY_SETUP_MAX_SHAREHOLDERS && (
        <button
          type="button"
          onClick={addPerson}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-sm"
          style={{ backgroundColor: '#f0f4ff', color: TME_COLORS.primary }}
        >
          <Plus className="w-4 h-4" />
          Add another person
        </button>
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
function PlainDocSlot({
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
  onUpload: (file: File) => Promise<{ path: string; filename: string } | null>;
  onRemove: () => void;
}) {
  if (staffProvided && docRef?.path) {
    return (
      <div
        className="border-2 rounded-lg p-4 flex items-center gap-3"
        style={{ borderColor: `${TME_COLORS.primary}30`, backgroundColor: 'rgba(36,63,123,0.04)' }}
      >
        <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: TME_COLORS.primary }} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700">{label}</p>
          <p className="text-xs truncate" style={{ color: TME_COLORS.primary }}>
            Provided by TME — please confirm
            {docRef.filename ? ` · ${docRef.filename}` : ''}
          </p>
        </div>
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

function ManualReviewOffer({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs text-amber-800 mb-2 flex items-start gap-1">
        <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        Having trouble with the automatic check? You can submit this file anyway — TME will verify
        it manually.
      </p>
      <button
        type="button"
        onClick={onAccept}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
      >
        Submit for manual review
      </button>
    </div>
  );
}
