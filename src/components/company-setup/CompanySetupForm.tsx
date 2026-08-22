'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TME_COLORS } from '@/lib/constants';
import {
  FormSection,
  StepNavButtons,
  StepProgress,
  InfoNote,
} from './chrome';
import { StepActivities } from './StepActivities';
import { StepNames, type AiNameIssue } from './StepNames';
import { StepShareCapital } from './StepShareCapital';
import { StepPeopleDocuments, type DocSlot } from './StepPeopleDocuments';
import { StepVisaFacility } from './StepVisaFacility';
import {
  buildDraft,
  rekeyDocumentsAfterRemove,
  roleTotals,
  isoToDisplayDate,
  type CompanySetupDraft,
  type DraftCompany,
} from './draft';
import { validateCompanyName } from '@/lib/company-setup-name-validation';
import {
  COMPANY_SETUP_NAME_OPTIONS_REQUIRED,
  COMPANY_SETUP_MAX_SHAREHOLDERS,
  COMPANY_SETUP_MAX_ACTIVITIES,
  type CompanySetupDocRef,
  type CompanySetupDocuments,
  type CompanySetupPerson,
  type CompanySetupPrefillData,
  type CompanySetupSubmittedData,
} from '@/types/company-setup';
import {
  Briefcase,
  Building2,
  CheckCircle,
  ClipboardList,
  FileText,
  Landmark,
  PenLine,
  Users,
} from 'lucide-react';

const STEP_LABELS = [
  'Welcome',
  'Business Activities',
  'Company Names',
  'Share Capital',
  'People & Documents',
  'Visa & Facility',
  'Review & Submit',
];
const TOTAL_STEPS = STEP_LABELS.length;
const AUTOSAVE_DEBOUNCE_MS = 2500;

interface CompanySetupFormProps {
  token: string;
  prefill: CompanySetupPrefillData | null;
  savedData: Partial<CompanySetupSubmittedData> | null;
  savedDocuments: CompanySetupDocuments | null;
  onSubmitted: () => void;
}

export function CompanySetupForm({
  token,
  prefill,
  savedData,
  savedDocuments,
  onSubmitted,
}: CompanySetupFormProps) {
  const [draft, setDraft] = useState<CompanySetupDraft>(() => buildDraft(prefill, savedData));
  const [documents, setDocuments] = useState<CompanySetupDocuments>(savedDocuments ?? {});
  const [currentStep, setCurrentStep] = useState(1); // furthest unlocked step
  const [viewingStep, setViewingStep] = useState(1);
  const [aiIssues, setAiIssues] = useState<AiNameIssue[]>([]);
  const [aiChecked, setAiChecked] = useState(false); // names AI check ran for current values
  const [checkingNames, setCheckingNames] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // ---------- Autosave ----------
  const latestPayload = useRef<{ draft: CompanySetupDraft; documents: CompanySetupDocuments }>({
    draft,
    documents,
  });
  latestPayload.current = { draft, documents };
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState('saving');
    try {
      const { draft: d, documents: docs } = latestPayload.current;
      const res = await fetch(`/api/company-setup/${token}/autosave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submittedData: { company: d.company, persons: d.persons },
          documents: docs,
        }),
      });
      setSaveState(res.ok ? 'saved' : 'idle');
    } catch {
      setSaveState('idle');
    }
  }, [token]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), AUTOSAVE_DEBOUNCE_MS);
  }, [saveNow]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // ---------- State updaters ----------
  const updateCompany = useCallback(
    (patch: Partial<DraftCompany>) => {
      setDraft((prev) => ({ ...prev, company: { ...prev.company, ...patch } }));
      if (patch.nameOptions) setAiChecked(false);
      scheduleSave();
    },
    [scheduleSave]
  );

  const updatePersons = useCallback(
    (persons: CompanySetupPerson[]) => {
      setDraft((prev) => ({ ...prev, persons }));
      scheduleSave();
    },
    [scheduleSave]
  );

  // Functional single-person patch — the passport extraction applies its
  // prefill asynchronously, so it must compute against the CURRENT person
  // (the client may have typed while the scan was being read).
  const patchPerson = useCallback(
    (index: number, compute: (person: CompanySetupPerson) => CompanySetupPerson) => {
      setDraft((prev) => ({
        ...prev,
        persons: prev.persons.map((p, i) => (i === index ? compute(p) : p)),
      }));
      scheduleSave();
    },
    [scheduleSave]
  );

  // Autosave immediately after an extraction prefill lands (short delay lets
  // the state commit so latestPayload carries the filled fields).
  const flushSaveSoon = useCallback(() => {
    setTimeout(() => void saveNow(), 150);
  }, [saveNow]);

  const handleRemovePerson = useCallback(
    (index: number) => {
      setDocuments((prev) => rekeyDocumentsAfterRemove(prev, index));
      scheduleSave();
    },
    [scheduleSave]
  );

  const handleDocumentChange = useCallback(
    (personIndex: number, slot: DocSlot, ref: CompanySetupDocRef | undefined) => {
      setDocuments((prev) => {
        const key = String(personIndex);
        const personDocs = { ...(prev[key] ?? {}) };
        if (ref) personDocs[slot] = ref;
        else delete personDocs[slot];
        return { ...prev, [key]: personDocs };
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  const uploadFile = useCallback(
    async (
      personIndex: number,
      slot: DocSlot,
      file: File
    ): Promise<{ path: string; filename: string } | null> => {
      try {
        const fd = new FormData();
        fd.append('personIndex', String(personIndex));
        fd.append('slot', slot);
        fd.append('file', file);
        const res = await fetch(`/api/company-setup/${token}/upload`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) return null;
        const j = (await res.json()) as { path?: string; filename?: string };
        if (!j.path) return null;
        return { path: j.path, filename: j.filename ?? file.name };
      } catch {
        return null;
      }
    },
    [token]
  );

  // ---------- AI name endpoints ----------
  const runNamesAiCheck = useCallback(async (): Promise<boolean> => {
    const names = draft.company.nameOptions.map((o) => o.name.trim()).filter(Boolean);
    if (names.length !== COMPANY_SETUP_NAME_OPTIONS_REQUIRED) return false;
    setCheckingNames(true);
    try {
      const res = await fetch(`/api/company-setup/${token}/validate-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) {
        // Advisory check — an infra failure never blocks.
        setAiIssues([]);
        setAiChecked(true);
        return true;
      }
      const j = (await res.json()) as {
        results?: Array<{ name: string; ok: boolean; issues: string[] }>;
      };
      const issues = (j.results ?? [])
        .filter((r) => !r.ok && r.issues.length > 0)
        .map((r) => ({ name: r.name, issues: r.issues }));
      setAiIssues(issues);
      setAiChecked(true);
      return issues.length === 0;
    } catch {
      setAiIssues([]);
      setAiChecked(true);
      return true;
    } finally {
      setCheckingNames(false);
    }
  }, [draft.company.nameOptions, token]);

  const suggestNames = useCallback(async (): Promise<string[] | null> => {
    try {
      const activities = draft.company.activities
        .map((a) => a.description.trim())
        .filter(Boolean);
      const res = await fetch(`/api/company-setup/${token}/suggest-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activities: activities.length > 0 ? activities : ['General trading and services'],
          preferences: draft.company.businessDescription?.trim() || undefined,
        }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { suggestions?: string[] };
      return j.suggestions ?? null;
    } catch {
      return null;
    }
  }, [draft.company.activities, draft.company.businessDescription, token]);

  // ---------- Step gates ----------
  const totals = useMemo(() => roleTotals(draft.persons), [draft.persons]);

  const activitiesOk =
    draft.company.activities.length >= 1 &&
    draft.company.activities.length <= COMPANY_SETUP_MAX_ACTIVITIES &&
    draft.company.activities.every((a) => a.description.trim().length > 0) &&
    !!draft.company.licenseType;

  const namesDeterministicOk = draft.company.nameOptions.every(
    (o) => o.name.trim().length > 0 && validateCompanyName(o.name.trim()).valid
  );

  const peopleOk =
    draft.persons.length >= 1 &&
    draft.persons.length <= COMPANY_SETUP_MAX_SHAREHOLDERS &&
    draft.persons.every(
      (p) => p.fullName.trim().length > 0 && !!p.religion && !!p.currentOrPastEidVisa
    ) &&
    totals.gmCount === 1 &&
    totals.secretaryCount === 1 &&
    totals.directorCount >= 1 &&
    totals.shareholderCount >= 1 &&
    Math.abs(totals.shareholdingSum - 100) <= 0.01 &&
    draft.persons.every(
      (p) =>
        !p.roles.shareholder ||
        (typeof p.shareholdingPct === 'number' && p.shareholdingPct > 0)
    );

  const documentsOk = draft.persons.every((person, index) => {
    const docs = documents[String(index)] ?? {};
    if (!docs.passport?.path || !docs.photo?.path || !docs.proof_of_address?.path) return false;
    if (person.currentOrPastEidVisa === 'current') {
      if (!docs.eid_front?.path || !docs.eid_back?.path || !docs.visa_document?.path) return false;
    }
    if (person.currentOrPastEidVisa === 'past' && !docs.previous_visa_document?.path) return false;
    return true;
  });

  const visaFacilityOk = draft.persons.every(
    (p) =>
      !p.visa.visaRequired ||
      (!!p.visa.jobTitle?.trim() &&
        typeof p.visa.basicMonthlySalaryAED === 'number' &&
        p.visa.basicMonthlySalaryAED > 0)
  );

  // ---------- Navigation ----------
  const goToStep = (step: number) => {
    setViewingStep(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const continueFrom = async (step: number) => {
    // Names step: run the AI check once per set of values; AI warnings never
    // block (the button relabels to "Continue anyway"), deterministic errors do.
    if (step === 3 && !aiChecked) {
      const clean = await runNamesAiCheck();
      if (!clean) return; // show the warnings; the client clicks again to proceed
    }
    void saveNow(); // autosave on every step transition
    const next = Math.min(step + 1, TOTAL_STEPS);
    setCurrentStep((prev) => Math.max(prev, next));
    goToStep(next);
  };

  // ---------- Submit ----------
  const handleSubmit = async () => {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const submittedData = {
        company: draft.company,
        persons: draft.persons,
        confirmedAt: new Date().toISOString(), // server overwrites with its own stamp
      } as CompanySetupSubmittedData;
      const res = await fetch(`/api/company-setup/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submittedData, documents, confirmed: true }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          errors?: string[];
          missingDocuments?: string[];
        };
        const details = [...(j.errors ?? []), ...(j.missingDocuments ?? [])];
        setSubmitError(
          details.length > 0
            ? `Please fix the following before submitting: ${details.join(' · ')}`
            : 'Could not submit — please check your entries and try again.'
        );
        setSubmitting(false);
        return;
      }
      onSubmitted();
    } catch {
      setSubmitError('Submission failed — please check your connection and try again.');
      setSubmitting(false);
    }
  };

  // ---------- Render ----------
  const contact = prefill?.contact;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StepProgress
        currentStep={currentStep}
        viewingStep={viewingStep}
        stepLabels={STEP_LABELS}
        onStepClick={goToStep}
      />

      <div className="flex justify-end -mt-1 mb-1 pr-1 h-4">
        {saveState === 'saving' && <span className="text-xs text-gray-400">Saving…</span>}
        {saveState === 'saved' && (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-green-500" /> Saved
          </span>
        )}
      </div>

      {viewingStep === 1 && (
        <FormSection
          title="Welcome"
          icon={<Building2 className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={1}
        >
          <div className="space-y-5">
            <p className="text-sm text-gray-600 leading-relaxed">
              {contact?.name ? `Dear ${contact.name}, welcome` : 'Welcome'} to the TME Services
              company setup form for your new IFZA (International Free Zone Authority) company.
              This form collects everything the authority needs to start the incorporation. You
              can pause at any time — your progress is saved automatically.
            </p>

            {contact && (
              <div className="rounded-xl border border-gray-100 p-4">
                <p className="text-sm font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
                  Your contact details
                </p>
                <div className="text-sm text-gray-700 space-y-1">
                  <p>{contact.name}</p>
                  <p>{contact.email}</p>
                  {contact.mobile && <p>{contact.mobile}</p>}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Not correct? Please contact your TME consultant before continuing.
                </p>
              </div>
            )}

            {prefill?.notesForClient && (
              <InfoNote title="A note from your TME consultant">
                <p className="whitespace-pre-wrap">{prefill.notesForClient}</p>
              </InfoNote>
            )}

            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
                What you will need — for every shareholder, manager, director and secretary
              </p>
              <ul className="space-y-2">
                {[
                  'Passport copy — a proper flatbed scan of the data page (not a phone photo).',
                  'A digital passport photo — plain light background, no glasses.',
                  'Proof of address — a BANK STATEMENT not older than 3 months (no utility bills).',
                  'Emirates ID and UAE visa copies, if the person currently holds or previously held them.',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle
                      className="w-4 h-4 mt-0.5 flex-shrink-0"
                      style={{ color: TME_COLORS.primary }}
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <StepNavButtons enabled onContinue={() => void continueFrom(1)} showBack={false} label="Start" />
        </FormSection>
      )}

      {viewingStep === 2 && (
        <FormSection
          title="Business Activities"
          icon={<Briefcase className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={2}
        >
          <StepActivities company={draft.company} onChange={updateCompany} />
          <StepNavButtons
            enabled={activitiesOk}
            onContinue={() => void continueFrom(2)}
            onBack={() => goToStep(1)}
          />
        </FormSection>
      )}

      {viewingStep === 3 && (
        <FormSection
          title="Company Names"
          icon={<PenLine className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={3}
        >
          <StepNames
            company={draft.company}
            onChange={updateCompany}
            aiIssues={aiIssues}
            onSuggest={suggestNames}
          />
          {aiChecked && aiIssues.length > 0 && (
            <p className="mt-4 text-xs text-amber-700">
              Our automatic check flagged possible issues above. You can adjust the names, or
              continue anyway — the final decision rests with the authority.
            </p>
          )}
          <StepNavButtons
            enabled={namesDeterministicOk}
            onContinue={() => void continueFrom(3)}
            onBack={() => goToStep(2)}
            busy={checkingNames}
            label={aiChecked && aiIssues.length > 0 ? 'Continue anyway' : 'Continue'}
          />
        </FormSection>
      )}

      {viewingStep === 4 && (
        <FormSection
          title="Share Capital"
          icon={<Landmark className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={4}
        >
          <StepShareCapital company={draft.company} onChange={updateCompany} />
          <StepNavButtons enabled onContinue={() => void continueFrom(4)} onBack={() => goToStep(3)} />
        </FormSection>
      )}

      {viewingStep === 5 && (
        <FormSection
          title="People & Documents"
          icon={<Users className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={5}
        >
          <StepPeopleDocuments
            token={token}
            persons={draft.persons}
            documents={documents}
            onChange={updatePersons}
            onPatchPerson={patchPerson}
            onRemovePerson={handleRemovePerson}
            onDocumentChange={handleDocumentChange}
            uploadFile={uploadFile}
            onExtractionApplied={flushSaveSoon}
          />
          {!(peopleOk && documentsOk) && (
            <p className="mt-3 text-xs text-gray-500">
              To continue: every person needs a full name, religion and EID/visa answer plus the
              required documents (passport, photo, bank statement, and EID/visa copies where
              applicable); roles must satisfy the constraints above; and shareholdings must total
              100%.
            </p>
          )}
          <StepNavButtons
            enabled={peopleOk && documentsOk}
            onContinue={() => void continueFrom(5)}
            onBack={() => goToStep(4)}
          />
        </FormSection>
      )}

      {viewingStep === 6 && (
        <FormSection
          title="Visa & Facility"
          icon={<ClipboardList className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={6}
        >
          <StepVisaFacility
            company={draft.company}
            persons={draft.persons}
            onCompanyChange={updateCompany}
            onPersonsChange={updatePersons}
          />
          <StepNavButtons
            enabled={visaFacilityOk}
            onContinue={() => void continueFrom(6)}
            onBack={() => goToStep(5)}
          />
        </FormSection>
      )}

      {viewingStep === 7 && (
        <FormSection
          title="Review & Submit"
          icon={<FileText className="w-5 h-5" style={{ color: TME_COLORS.primary }} />}
          stepNumber={7}
        >
          <ReviewSummary draft={draft} documents={documents} />

          <label
            className="mt-6 flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer"
            style={{ borderColor: TME_COLORS.border }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0"
              style={{ accentColor: TME_COLORS.primary }}
            />
            <span className="text-sm text-gray-700">
              I confirm the details are true and complete.
            </span>
          </label>

          {submitError && (
            <div
              className="mt-4 text-sm rounded-lg p-3"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: TME_COLORS.error }}
            >
              {submitError}
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button
              type="button"
              onClick={() => goToStep(6)}
              className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border-2 hover:bg-gray-50"
              style={{ color: TME_COLORS.primary, borderColor: TME_COLORS.primary }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!confirmed || submitting}
              className="px-8 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </FormSection>
      )}
    </div>
  );
}

// ---------- Review summary ----------

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-gray-500 w-44 flex-shrink-0">{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  );
}

const FACILITY_LABELS: Record<string, string> = {
  virtual_office: 'Virtual Office',
  office: 'Office',
  warehouse: 'Warehouse',
};

function ReviewSummary({
  draft,
  documents,
}: {
  draft: CompanySetupDraft;
  documents: CompanySetupDocuments;
}) {
  const { company, persons } = draft;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
          Company
        </p>
        <div className="space-y-1.5">
          <SummaryRow
            label="Name options"
            value={company.nameOptions.map((o, i) => `${i + 1}. ${o.name}`).join('  ·  ')}
          />
          <SummaryRow
            label="Activities"
            value={company.activities
              .map((a) => `${a.code ? `[${a.code}] ` : ''}${a.description}`)
              .join('; ')}
          />
          <SummaryRow label="License type" value={company.licenseType} />
          <SummaryRow label="Business description" value={company.businessDescription} />
          <SummaryRow
            label="Share capital"
            value={
              company.shareCapitalAED
                ? `AED ${company.shareCapitalAED.toLocaleString('en-US')}`
                : undefined
            }
          />
          <SummaryRow
            label="Value per share"
            value={
              company.valuePerShareAED
                ? `AED ${company.valuePerShareAED.toLocaleString('en-US')}`
                : undefined
            }
          />
          <SummaryRow
            label="Number of shares"
            value={company.numberOfShares?.toLocaleString('en-US')}
          />
          <SummaryRow label="Visas required" value={company.visaCount} />
          <SummaryRow
            label="Facility"
            value={
              company.facilityType
                ? `${FACILITY_LABELS[company.facilityType] ?? company.facilityType}${
                    company.facilitySize && company.facilitySize !== 'n/a'
                      ? ` (${company.facilitySize})`
                      : ''
                  }`
                : undefined
            }
          />
        </div>
      </div>

      {persons.map((person, index) => {
        const docs = documents[String(index)] ?? {};
        const roles = [
          person.roles.shareholder
            ? `Shareholder${person.shareholdingPct ? ` ${person.shareholdingPct}%` : ''}`
            : null,
          person.roles.generalManager ? 'General Manager' : null,
          person.roles.director ? 'Director' : null,
          person.roles.secretary ? 'Secretary' : null,
        ].filter(Boolean);
        const uploadedDocs = Object.entries(docs)
          .filter(([, ref]) => ref?.path)
          .map(([slot]) => slot.replace(/_/g, ' '));
        return (
          <div key={index} className="border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
              {person.fullName || `Person ${index + 1}`}
            </p>
            <div className="space-y-1.5">
              <SummaryRow label="Roles" value={roles.join(' · ')} />
              <SummaryRow label="Nationality" value={person.nationality} />
              <SummaryRow label="Date of birth" value={isoToDisplayDate(person.dateOfBirth)} />
              <SummaryRow
                label="Gender"
                value={
                  person.gender ? person.gender.charAt(0).toUpperCase() + person.gender.slice(1) : undefined
                }
              />
              <SummaryRow label="Place of birth" value={person.placeOfBirth} />
              <SummaryRow label="Passport number" value={person.passportNumber} />
              <SummaryRow
                label="Passport issue date"
                value={isoToDisplayDate(person.passportIssueDate)}
              />
              <SummaryRow
                label="Passport expiry date"
                value={isoToDisplayDate(person.passportExpiryDate)}
              />
              <SummaryRow label="Religion" value={person.religion} />
              <SummaryRow label="Email" value={person.email} />
              <SummaryRow label="Mobile" value={person.mobile} />
              <SummaryRow label="Address" value={person.fullAddress} />
              <SummaryRow
                label="Visa"
                value={
                  person.visa.visaRequired
                    ? `Yes — ${person.visa.jobTitle ?? ''}${
                        person.visa.basicMonthlySalaryAED
                          ? `, basic AED ${person.visa.basicMonthlySalaryAED.toLocaleString('en-US')}/month`
                          : ''
                      }${person.visa.vipStamping ? ', VIP stamping' : ''}`
                    : 'No'
                }
              />
              <SummaryRow label="Documents" value={uploadedDocs.join(', ')} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
