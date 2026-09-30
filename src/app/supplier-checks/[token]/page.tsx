'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { Input } from '@/components/ui';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Info, Users } from 'lucide-react';
import {
  SVP_LIMITS,
  SVP_ROLE_KEYS,
  type SvpPerson,
  type SvpPolicyAnswers,
  type SvpPrefill,
  type SvpRoleKey,
} from '@/types/supplier-policy';
import {
  SVP_ROLE_LABELS,
  describeRoleVariant,
  roleVariant,
  sharedRoles,
  validateAnswers,
} from '@/lib/supplier-policy-validation';

type PageState =
  | 'loading'
  | 'form'
  | 'success'
  | 'already_submitted'
  | 'not_found'
  | 'closed' // cancelled / expired
  | 'error';

interface IntakeData {
  status: string;
  companyName: string | null;
  priceAed: number | null;
  prefill: SvpPrefill | null;
  submitted: Partial<SvpPolicyAnswers> | null;
  expiresAt: string | null;
}

type People = Record<SvpRoleKey, SvpPerson>;

const EMPTY_PERSON: SvpPerson = { name: '', position: '', email: '' };

// What each role does, in the words of the policy (template v1.3, section 5).
const ROLE_HINTS: Record<SvpRoleKey, string> = {
  implementer:
    'Collects the supplier documents, checks each purchase and fills in the supplier check form.',
  reviewer:
    'Reviews each completed check form, decides on warning signs and confirms which suppliers may be claimed in each VAT return.',
  supervisor:
    'Owns the policy and checks at least once a year that it is followed. The Supervisor signs the policy.',
};

// "Same person as ..." offers only the roles above this one, so the buttons
// read top-down: Reviewer copies the Implementer, Supervisor copies either.
const COPY_FROM: Record<SvpRoleKey, SvpRoleKey[]> = {
  implementer: [],
  reviewer: ['implementer'],
  supervisor: ['implementer', 'reviewer'],
};

function formatAed(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

// NOTE: Shell, Header, Section and RoleCard are defined at MODULE scope (not
// inside the page component). Defining them inline would give them a new
// identity on every render, so React would remount the subtree on each
// keystroke and the inputs would lose focus after one character.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
        {children}
      </div>
    </div>
  );
}

function Header({ companyName }: { companyName?: string | null }) {
  return (
    <div className="mb-8">
      <div
        className="text-xs font-semibold tracking-wide uppercase mb-2"
        style={{ color: TME_COLORS.secondary }}
      >
        TME Services, VAT
      </div>
      <h1 className="text-2xl font-bold" style={{ color: TME_COLORS.primary }}>
        Supplier Verification Policy
      </h1>
      {companyName && <p className="text-gray-600 mt-1">{companyName}</p>}
    </div>
  );
}

function Section({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-1" style={{ color: TME_COLORS.primary }}>
        {number}. {title}
      </h2>
      {hint && <p className="text-xs text-gray-500 mb-3 leading-relaxed">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4 py-2 border-b border-gray-100 last:border-b-0">
      <span className="text-sm text-gray-500 sm:w-40 shrink-0">{label}</span>
      <span className="text-sm text-gray-800">{value && value.trim() ? value : 'Not on file'}</span>
    </div>
  );
}

function ChipButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ borderColor: TME_COLORS.border, color: TME_COLORS.primary }}
    >
      {children}
    </button>
  );
}

function RoleCard({
  role,
  person,
  people,
  officers,
  disabled,
  onChange,
}: {
  role: SvpRoleKey;
  person: SvpPerson;
  people: People;
  officers: SvpPerson[];
  disabled: boolean;
  onChange: (role: SvpRoleKey, next: SvpPerson) => void;
}) {
  const label = SVP_ROLE_LABELS[role];
  const copyFrom = COPY_FROM[role].filter((other) => people[other].name.trim());
  return (
    <div className="rounded-xl border p-4 mb-4" style={{ borderColor: TME_COLORS.border }}>
      <p className="text-sm font-semibold" style={{ color: TME_COLORS.primary }}>
        {label}
      </p>
      <p className="text-xs text-gray-500 mt-0.5 mb-3 leading-relaxed">{ROLE_HINTS[role]}</p>

      {(copyFrom.length > 0 || officers.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {copyFrom.map((other) => (
            <ChipButton
              key={`copy-${other}`}
              disabled={disabled}
              onClick={() => onChange(role, { ...people[other] })}
            >
              Same person as {SVP_ROLE_LABELS[other]}
            </ChipButton>
          ))}
          {officers.map((officer, i) => (
            <ChipButton
              key={`officer-${i}`}
              disabled={disabled}
              onClick={() => onChange(role, { ...EMPTY_PERSON, ...officer })}
            >
              {officer.position ? `${officer.name} (${officer.position})` : officer.name}
            </ChipButton>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Full name"
          required
          value={person.name}
          maxLength={SVP_LIMITS.name}
          disabled={disabled}
          onChange={(e) => onChange(role, { ...person, name: e.target.value })}
        />
        <Input
          label="Position"
          required
          value={person.position}
          maxLength={SVP_LIMITS.position}
          placeholder="For example: Manager"
          disabled={disabled}
          onChange={(e) => onChange(role, { ...person, position: e.target.value })}
        />
        <div className="sm:col-span-2">
          <Input
            label={role === 'supervisor' ? 'Email (the signing link goes here)' : 'Email (optional)'}
            required={role === 'supervisor'}
            type="email"
            value={person.email}
            maxLength={SVP_LIMITS.email}
            disabled={disabled}
            onChange={(e) => onChange(role, { ...person, email: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function VariantNote({ people }: { people: People }) {
  const variant = roleVariant(people);
  const shared = sharedRoles(people).map((r) => SVP_ROLE_LABELS[r]);
  const text =
    variant === 'three'
      ? 'Three different people hold the three roles.'
      : variant === 'one'
        ? 'One person holds all three roles. The policy then asks for two dated sign-offs in each supplier file, made on different days: one when the documents are collected and one when the supplier is approved.'
        : `${describeRoleVariant(variant)} (${joinWords(shared)}). The policy then asks for two dated sign-offs in each supplier file, made on different days.`;
  return (
    <div className="rounded-xl p-4 flex gap-3" style={{ backgroundColor: 'rgba(36,63,123,0.06)' }}>
      <Users className="w-5 h-5 shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
      <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
    </div>
  );
}

function initialPeople(data: IntakeData): People {
  const from = data.submitted ?? null;
  const suggested = data.prefill?.suggested;
  const pick = (role: SvpRoleKey): SvpPerson => ({
    ...EMPTY_PERSON,
    ...(suggested?.[role] ?? {}),
    ...(from?.[role] ?? {}),
  });
  return {
    implementer: pick('implementer'),
    reviewer: pick('reviewer'),
    supervisor: pick('supervisor'),
  };
}

export default function SupplierPolicyIntakePage() {
  const params = useParams();
  const token = String(params?.token ?? '');

  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<IntakeData | null>(null);
  const [people, setPeople] = useState<People>({
    implementer: EMPTY_PERSON,
    reviewer: EMPTY_PERSON,
    supervisor: EMPTY_PERSON,
  });
  const [atOffice, setAtOffice] = useState(true);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [priceAgreed, setPriceAgreed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverMessages, setServerMessages] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/supplier-checks/${token}`);
        if (cancelled) return;
        if (res.status === 404) return setState('not_found');
        if (res.status === 410) return setState('closed');
        if (!res.ok) return setState('error');
        const json: IntakeData = await res.json();
        setData(json);
        setPeople(initialPeople(json));
        if (json.submitted) {
          setAtOffice(json.submitted.recordsLocationIsRegisteredOffice !== false);
          setLocation(json.submitted.recordsLocation ?? '');
          setNote(json.submitted.note ?? '');
        }
        if (json.status === 'submitted' || json.status === 'synced') {
          setState('already_submitted');
        } else {
          setState('form');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handlePersonChange = useCallback((role: SvpRoleKey, next: SvpPerson) => {
    setPeople((prev) => ({ ...prev, [role]: next }));
    setServerMessages([]);
  }, []);

  const answers = useMemo(
    () => ({
      implementer: people.implementer,
      reviewer: people.reviewer,
      supervisor: people.supervisor,
      recordsLocationIsRegisteredOffice: atOffice,
      recordsLocation: atOffice ? '' : location,
      priceAgreed,
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    [people, atOffice, location, note, priceAgreed]
  );

  // The same checks the server runs; shown once the client tries to submit.
  const problems = useMemo(
    () => validateAnswers(answers as Partial<SvpPolicyAnswers>, { requirePriceAgreed: true }),
    [answers]
  );

  const handleSubmit = useCallback(async () => {
    setShowErrors(true);
    setError(null);
    setServerMessages([]);
    if (problems.length > 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/supplier-checks/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...answers, shownPriceAed: data?.priceAed ?? null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 409 && j?.error === 'price_changed') {
          setError('The price was updated while this page was open. Please reload the page, check the price and submit again.');
          setSubmitting(false);
          return;
        }
        if (res.status === 409) {
          setState('already_submitted');
          return;
        }
        if (res.status === 410) {
          setState('closed');
          return;
        }
        if (j?.error === 'invalid_answers' && Array.isArray(j.messages)) {
          setServerMessages(j.messages as string[]);
          setError('Please check the details below.');
        } else if (j?.error === 'price_not_agreed') {
          setError('Please tick the box to agree to the price before you submit.');
        } else {
          setError('Could not submit. Please try again.');
        }
        setSubmitting(false);
        return;
      }
      setState('success');
    } catch {
      setError('Submission failed. Please check your connection and try again.');
      setSubmitting(false);
    }
  }, [answers, data, problems, submitting, token]);

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-16 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: TME_COLORS.primary }} />
          Loading...
        </div>
      </Shell>
    );
  }

  if (state === 'not_found' || state === 'error') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-12 text-center">
          <XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            {state === 'error' ? 'Something went wrong' : 'This link is not valid'}
          </h2>
          <p className="text-gray-600">
            {state === 'error'
              ? 'Please try again in a few minutes. If it still does not open, reply to the email we sent you.'
              : 'The link may be incorrect. Please use the link from your TME email, or reply to that email.'}
          </p>
        </div>
      </Shell>
    );
  }

  if (state === 'closed') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-12 text-center">
          <AlertTriangle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.secondary }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            This link is closed
          </h2>
          <p className="text-gray-600">
            Please reply to the email we sent you and we will send you a new link.
          </p>
        </div>
      </Shell>
    );
  }

  const companyName = data?.companyName ?? data?.prefill?.companyName ?? null;

  if (state === 'success' || state === 'already_submitted') {
    return (
      <Shell>
        <Header companyName={companyName} />
        <div className="flex flex-col items-center py-10 text-center">
          <CheckCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.success }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: TME_COLORS.primary }}>
            Thank you, we have received your details
          </h2>
          <p className="text-gray-600 max-w-md">
            Our Tax team now prepares your Supplier Verification Policy. You will receive the
            policy by email for electronic signature, and the invoice in a separate email. No
            further action is needed from you right now.
          </p>
        </div>
      </Shell>
    );
  }

  // ---------- Form ----------
  const prefill = data?.prefill ?? null;
  const officers = (prefill?.officers ?? []).filter((o) => o?.name?.trim());
  const price = data?.priceAed ?? null;
  const visibleProblems = serverMessages.length > 0 ? serverMessages : showErrors ? problems : [];

  return (
    <Shell>
      <Header companyName={companyName} />

      <p className="text-gray-600 mb-8 text-sm leading-relaxed">
        From 01.10.2026, FTA Decision No. 13 of 2026 requires every VAT registered business to
        check its suppliers and purchases before it claims input VAT, and to have a written
        supplier verification policy. We have prepared this policy for your company. Please
        confirm the details below. It takes a few minutes.
      </p>

      <Section number={1} title="Your company" hint="From our records. If something is wrong, reply to our email.">
        <div className="rounded-xl border px-4 py-1" style={{ borderColor: TME_COLORS.border }}>
          <ReadOnlyRow label="Company" value={companyName} />
          <ReadOnlyRow label="VAT number (TRN)" value={prefill?.trn} />
          <ReadOnlyRow label="VAT periods" value={prefill?.vatPeriodsText} />
        </div>
      </Section>

      <Section
        number={2}
        title="Who does the checks"
        hint="The policy names three roles. One person may hold more than one role. We have filled in the manager we have on file; you can change the names."
      >
        {SVP_ROLE_KEYS.map((role) => (
          <RoleCard
            key={role}
            role={role}
            person={people[role]}
            people={people}
            officers={officers}
            disabled={submitting}
            onChange={handlePersonChange}
          />
        ))}
        <VariantNote people={people} />
      </Section>

      <Section
        number={3}
        title="Where the records are kept"
        hint="The supplier files, check forms and proof for each purchase. On paper or electronically."
      >
        <div className="space-y-2">
          <label
            className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer"
            style={{ borderColor: atOffice ? TME_COLORS.primary : TME_COLORS.border }}
          >
            <input
              type="radio"
              name="records-location"
              checked={atOffice}
              onChange={() => setAtOffice(true)}
              disabled={submitting}
              className="mt-0.5 w-4 h-4 shrink-0"
              style={{ accentColor: TME_COLORS.primary }}
            />
            <span className="text-sm text-gray-700">
              Our registered office
              {prefill?.registeredAddress ? `: ${prefill.registeredAddress}` : ''}
            </span>
          </label>
          <label
            className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer"
            style={{ borderColor: !atOffice ? TME_COLORS.primary : TME_COLORS.border }}
          >
            <input
              type="radio"
              name="records-location"
              checked={!atOffice}
              onChange={() => setAtOffice(false)}
              disabled={submitting}
              className="mt-0.5 w-4 h-4 shrink-0"
              style={{ accentColor: TME_COLORS.primary }}
            />
            <span className="text-sm text-gray-700">Another place</span>
          </label>
          {!atOffice && (
            <Input
              value={location}
              maxLength={SVP_LIMITS.recordsLocation}
              placeholder="For example: our warehouse in Al Quoz, or our cloud drive"
              disabled={submitting}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}
        </div>
      </Section>

      <Section number={4} title="Anything we should know (optional)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={SVP_LIMITS.note}
          rows={3}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 text-sm"
          onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
          onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
        />
      </Section>

      <Section number={5} title="Price">
        {price != null && (
          <div
            className="rounded-xl p-4 mb-3 flex gap-3"
            style={{ backgroundColor: 'rgba(36,63,123,0.06)' }}
          >
            <Info className="w-5 h-5 shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
            <p className="text-sm text-gray-700">
              Supplier Verification Policy on your company letterhead:{' '}
              <strong style={{ color: TME_COLORS.primary }}>AED {formatAed(price)}</strong> plus 5%
              VAT.
            </p>
          </div>
        )}
        <label
          className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer"
          style={{ borderColor: TME_COLORS.border }}
        >
          <input
            type="checkbox"
            checked={priceAgreed}
            onChange={(e) => setPriceAgreed(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 w-4 h-4 shrink-0"
            style={{ accentColor: TME_COLORS.primary }}
          />
          <span className="text-sm text-gray-700">
            {price != null ? (
              <>
                I agree to the price of{' '}
                <strong style={{ color: TME_COLORS.primary }}>AED {formatAed(price)}</strong> (plus
                VAT) for the Supplier Verification Policy. The invoice is sent together with the
                policy.
              </>
            ) : (
              <>
                I agree to the price in the TME email for the Supplier Verification Policy. The
                invoice is sent together with the policy.
              </>
            )}
          </span>
        </label>
      </Section>

      {visibleProblems.length > 0 && (
        <div
          className="mb-4 text-sm rounded-lg p-3"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: TME_COLORS.error }}
        >
          <p className="font-semibold mb-1">Please check:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {visibleProblems.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {error && visibleProblems.length === 0 && (
        <div
          className="mb-4 text-sm rounded-lg p-3"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: TME_COLORS.error }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3 rounded-lg font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{ backgroundColor: TME_COLORS.primary }}
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? 'Submitting...' : 'Confirm my policy details'}
      </button>
    </Shell>
  );
}
