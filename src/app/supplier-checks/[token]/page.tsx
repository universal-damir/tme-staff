'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  Clock,
  FileText,
  Loader2,
  Mail,
  PenLine,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  SVP_LIMITS,
  SVP_ROLE_KEYS,
  type SvpCompanyChanges,
  type SvpPerson,
  type SvpPolicyAnswers,
  type SvpPrefill,
  type SvpRoleKey,
} from '@/types/supplier-policy';
import {
  SVP_ROLE_LABELS,
  describeRoleVariant,
  normaliseName,
  roleVariant,
  sharedRoles,
  validateAnswers,
} from '@/lib/supplier-policy-validation';
import { DEMO_INTAKE, isDemoToken } from './demo';

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
type PersonField = keyof SvpPerson;

const EMPTY_PERSON: SvpPerson = { name: '', position: '', email: '' };

const NAVY = TME_COLORS.primary;
const GOLD = TME_COLORS.secondary;
const NAVY_TINT = 'rgba(36,63,123,0.06)';
const ERROR_TINT = 'rgba(239,68,68,0.06)';

// What each role does, in the words of the policy (template v1.3, section 5).
const ROLE_HINTS: Record<SvpRoleKey, string> = {
  implementer:
    'Collects the supplier documents, checks each purchase and fills in the supplier check form.',
  reviewer:
    'Reviews each completed check form, decides on warning signs and confirms which suppliers may be claimed in each VAT return.',
  supervisor:
    'Owns the policy and checks at least once a year that it is followed. The Supervisor signs the policy.',
};

// "Same person as ..." offers only the roles above this one, so the options
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

/** dd.mm.yy in Dubai time, or null for a missing / broken date. */
function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Two people match when name, position and email are the same (name loosely). */
function samePerson(a: SvpPerson, b: SvpPerson): boolean {
  const n = normaliseName(a.name);
  return (
    n !== '' &&
    n === normaliseName(b.name) &&
    a.position.trim().toLowerCase() === (b.position || '').trim().toLowerCase() &&
    a.email.trim().toLowerCase() === (b.email || '').trim().toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Problems -> fields
// ---------------------------------------------------------------------------
// validateAnswers (shared with the portal, do not change its wording here)
// returns plain sentences that start with the field they belong to, e.g.
// "Supervisor: the email is missing." We map each one to the input it is about,
// so the message can sit next to the field and the summary can link to it.

function fieldId(role: SvpRoleKey, field: PersonField): string {
  return `svp-${role}-${field}`;
}

const RECORDS_LOCATION_ID = 'svp-records-location';
const NOTE_ID = 'svp-note';
const PRICE_ID = 'svp-price-agreed';
const DUTY_ID = 'svp-duty-acknowledged';
const TRN_ID = 'svp-change-trn';
const VAT_PERIODS_ID = 'svp-change-vat-periods';
const ADDRESS_ID = 'svp-change-address';

interface FieldProblem {
  /** The full sentence, shown in the summary at the top. */
  message: string;
  /** The input it belongs to, or null when it has no single field. */
  target: string | null;
  /** The sentence without its "Role:" prefix, shown next to the field. */
  inline: string;
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function mapProblem(message: string): FieldProblem {
  const colon = message.indexOf(':');
  const prefix = colon > 0 ? message.slice(0, colon).trim() : '';
  const rest = colon > 0 ? message.slice(colon + 1).trim() : message;
  const inline = capitalise(rest);

  const role = SVP_ROLE_KEYS.find((r) => SVP_ROLE_LABELS[r] === prefix);
  if (role) {
    const field: PersonField | null = /^the name/i.test(rest)
      ? 'name'
      : /^the position/i.test(rest)
        ? 'position'
        : /^the email/i.test(rest)
          ? 'email'
          : null;
    return { message, target: field ? fieldId(role, field) : null, inline };
  }
  if (prefix === 'Records location') return { message, target: RECORDS_LOCATION_ID, inline };
  if (prefix === 'Note') return { message, target: NOTE_ID, inline };
  if (prefix === 'Price') return { message, target: PRICE_ID, inline };
  if (prefix === 'VAT number') return { message, target: TRN_ID, inline };
  if (prefix === 'VAT periods') return { message, target: VAT_PERIODS_ID, inline };
  if (prefix === 'Registered office') return { message, target: ADDRESS_ID, inline };
  return { message, target: null, inline: message };
}

// NOTE: every sub-component below is defined at MODULE scope (not inside the
// page component). Defining them inline would give them a new identity on
// every render, so React would remount the subtree on each keystroke and the
// inputs would lose focus after one character.

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center px-4 py-6 sm:py-10">
      <div
        className={`w-full ${wide ? 'max-w-[1100px]' : 'max-w-2xl'} bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-8 lg:p-10`}
      >
        {children}
      </div>
    </div>
  );
}

function Header({ companyName }: { companyName?: string | null }) {
  return (
    <div className="mb-6">
      <div
        className="text-xs font-semibold tracking-wide uppercase mb-2"
        style={{ color: GOLD }}
      >
        TME Services, VAT
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: NAVY }}>
        Supplier Verification Policy
      </h1>
      {companyName && <p className="text-gray-600 mt-1">{companyName}</p>}
    </div>
  );
}

function Step({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = `svp-step-${number}`;
  return (
    <section aria-labelledby={headingId} className="pt-8 mt-8 border-t border-gray-100">
      <div className="flex items-start gap-3 mb-4">
        <span
          aria-hidden="true"
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{ backgroundColor: NAVY }}
        >
          {number}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold leading-8" style={{ color: NAVY }}>
            <span className="sr-only">Step {number}: </span>
            {title}
          </h2>
          {hint && <p className="text-sm text-gray-500 leading-relaxed max-w-3xl">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Label, hint, error and input in the GOV.UK order: label, hint, error, field. */
function Field({
  id,
  label,
  optional,
  hint,
  error,
  split = false,
  headClassName = '',
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  /**
   * Render the label block and the input as two SIBLINGS (no wrapper), so a
   * parent CSS subgrid can put each in its own row and line the inputs up
   * across cards even when one hint wraps to two lines.
   */
  split?: boolean;
  headClassName?: string;
  children: (describedBy: string | undefined) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : '';
  const errorId = error ? `${id}-error` : '';
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const bar = error ? 'border-l-4 pl-3 -ml-1' : '';
  const barStyle = error ? { borderColor: TME_COLORS.error } : undefined;
  const head = (
    <>
      <label htmlFor={id} className="block text-sm font-medium" style={{ color: NAVY }}>
        {label}
        {optional && <span className="font-normal text-gray-500"> (optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-gray-500 mt-0.5">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium mt-1" style={{ color: TME_COLORS.error }}>
          <span className="sr-only">Error: </span>
          {error}
        </p>
      )}
    </>
  );
  if (split) {
    return (
      <>
        <div className={`${bar} ${headClassName}`} style={barStyle}>
          {head}
        </div>
        <div className={`${bar} pt-1`} style={barStyle}>
          {children(describedBy)}
        </div>
      </>
    );
  }
  return (
    <div className={`${bar} ${headClassName}`} style={barStyle}>
      {head}
      <div className="mt-1">{children(describedBy)}</div>
    </div>
  );
}

function TextInput({
  id,
  value,
  onChange,
  maxLength,
  disabled,
  type = 'text',
  autoComplete,
  hasError,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled?: boolean;
  type?: string;
  autoComplete?: string;
  hasError?: boolean;
  describedBy?: string;
}) {
  const rest = hasError ? TME_COLORS.error : TME_COLORS.border;
  return (
    <input
      id={id}
      type={type}
      value={value}
      maxLength={maxLength}
      disabled={disabled}
      autoComplete={autoComplete}
      aria-invalid={hasError || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg border-2 bg-white focus:outline-none transition-all duration-200 h-[42px] text-sm disabled:bg-gray-50"
      style={{ borderColor: rest, fontFamily: 'Inter, sans-serif' }}
      onFocus={(e) => (e.currentTarget.style.borderColor = NAVY)}
      onBlur={(e) => (e.currentTarget.style.borderColor = rest)}
    />
  );
}

/** "100492437700003" -> "10049 24377 00003". Anything but exactly 15 digits is shown as it is. */
function formatTrn(trn: string | null | undefined): string | null {
  if (!trn) return null;
  const digits = trn.replace(/\s+/g, '');
  if (!/^\d{15}$/.test(digits)) return trn;
  return `${digits.slice(0, 5)} ${digits.slice(5, 10)} ${digits.slice(10)}`;
}

/**
 * The portal sends the periods as one sentence ("A, B, C and D", month names
 * only). One period per line reads better; split on ", " and " and ".
 */
function splitVatPeriods(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/,\s+|\s+and\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Company details the client can correct (rare: new TRN, new periods, moved)
// ---------------------------------------------------------------------------

type ChangeKey = keyof SvpCompanyChanges;

/** The three UAE quarter patterns, worded exactly as the portal words stored periods. */
const QUARTER_OPTIONS = [
  'January to March, April to June, July to September and October to December',
  'February to April, May to July, August to October and November to January',
  'March to May, June to August, September to November and December to February',
];

function trnDigits(value: string | null | undefined): string {
  return (value || '').replace(/[\s-]+/g, '');
}

function looseText(value: string | null | undefined): string {
  return (value || '').replace(/[\s,.]+/g, ' ').trim().toLowerCase();
}

/** Same periods in any order ("A, B and C" vs "B, C and A"). */
function samePeriods(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (t: string | null | undefined) =>
    splitVatPeriods(t)
      .map((p) => p.toLowerCase())
      .sort()
      .join('|');
  return key(a) === key(b);
}

/** Only what really differs from our record goes to the portal. */
function changedDetails(changes: SvpCompanyChanges, prefill: SvpPrefill | null): SvpCompanyChanges {
  const out: SvpCompanyChanges = {};
  if (changes.trn !== undefined && trnDigits(changes.trn) !== trnDigits(prefill?.trn)) {
    out.trn = changes.trn.trim();
  }
  if (changes.vatPeriods !== undefined && !samePeriods(changes.vatPeriods, prefill?.vatPeriodsText)) {
    out.vatPeriods = changes.vatPeriods.trim();
  }
  if (
    changes.registeredAddress !== undefined &&
    looseText(changes.registeredAddress) !== looseText(prefill?.registeredAddress)
  ) {
    out.registeredAddress = changes.registeredAddress.trim();
  }
  return out;
}

function Fact({
  label,
  value,
  note,
  action,
}: {
  label: string;
  value: string | string[] | null | undefined;
  note?: string;
  /** A "Change" button under the value. */
  action?: React.ReactNode;
}) {
  const lines = (Array.isArray(value) ? value : value ? [value] : []).filter((v) => v && v.trim());
  const has = lines.length > 0;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`text-sm mt-0.5 break-words ${has ? 'text-gray-900 font-medium' : 'text-gray-400 italic'}`}>
        {!has ? (
          'Not on file'
        ) : lines.length === 1 ? (
          lines[0]
        ) : (
          <ul>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </dd>
      {has && note && <dd className="text-xs text-gray-500 mt-1">{note}</dd>}
      {action && <dd className="mt-1.5">{action}</dd>}
    </div>
  );
}

function TickBox({
  id,
  checked,
  onChange,
  disabled,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={error ? 'border-l-4 pl-3 -ml-1' : ''}
      style={error ? { borderColor: TME_COLORS.error } : undefined}
    >
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium mb-1.5" style={{ color: TME_COLORS.error }}>
          <span className="sr-only">Error: </span>
          {error}
        </p>
      )}
      <label
        htmlFor={id}
        className="flex items-start gap-3 rounded-lg border-2 p-3 cursor-pointer transition-colors"
        style={{
          borderColor: checked ? NAVY : error ? TME_COLORS.error : TME_COLORS.border,
          backgroundColor: checked ? NAVY_TINT : '#ffffff',
        }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={!!error || undefined}
          className="mt-0.5 w-5 h-5 shrink-0"
          style={{ accentColor: NAVY }}
        />
        <span className="text-sm text-gray-800">{children}</span>
      </label>
    </div>
  );
}

/**
 * One "fill with this person" option. A real button with aria-pressed: it is
 * pressed while the fields hold exactly this person, so typing in the fields
 * un-presses it on its own. Pressing it again clears the fields.
 */
function PersonOption({
  label,
  detail,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  detail?: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="w-full flex items-center gap-3 text-left rounded-lg border-2 px-3 py-2 transition-colors duration-150 hover:shadow-sm focus:outline-none focus-visible:ring-4 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        borderColor: pressed ? NAVY : TME_COLORS.border,
        backgroundColor: pressed ? NAVY_TINT : '#ffffff',
        // focus ring in TME gold
        ['--tw-ring-color' as string]: 'rgba(210,188,153,0.7)',
      }}
    >
      <span
        aria-hidden="true"
        className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
        style={{ borderColor: NAVY, backgroundColor: pressed ? NAVY : '#ffffff' }}
      >
        {pressed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-words" style={{ color: NAVY }}>
          {label}
        </span>
        {detail && <span className="block text-xs text-gray-500 break-words">{detail}</span>}
      </span>
      <span
        className="text-xs font-semibold shrink-0"
        style={{ color: pressed ? NAVY : '#6b7280' }}
      >
        {pressed ? 'Selected' : 'Use'}
      </span>
    </button>
  );
}

function RoleCard({
  role,
  person,
  people,
  officers,
  disabled,
  errors,
  onChange,
}: {
  role: SvpRoleKey;
  person: SvpPerson;
  people: People;
  officers: SvpPerson[];
  disabled: boolean;
  errors: Record<string, string>;
  onChange: (role: SvpRoleKey, next: SvpPerson) => void;
}) {
  const label = SVP_ROLE_LABELS[role];
  // "Same person as X" only when X is someone NOT already offered as an
  // officer (and not a repeat of an earlier copy option), so one person never
  // shows up twice and at most one option reads as selected.
  const copyFrom = COPY_FROM[role].filter(
    (other, i, list) =>
      people[other].name.trim() &&
      !officers.some((o) => samePerson(people[other], { ...EMPTY_PERSON, ...o })) &&
      !list.slice(0, i).some((earlier) => samePerson(people[earlier], people[other]))
  );
  const isSigner = role === 'supervisor';
  const hasOptions = copyFrom.length > 0 || officers.length > 0;
  const pick = (candidate: SvpPerson) => {
    // Pressing a selected option again clears the fields (toggle).
    onChange(role, samePerson(person, candidate) ? { ...EMPTY_PERSON } : { ...EMPTY_PERSON, ...candidate });
  };
  const set = (field: PersonField) => (value: string) => onChange(role, { ...person, [field]: value });
  // "Someone else" reads as selected whenever the fields hold nobody from the
  // list (empty or typed by hand). Pressing it clears the fields and puts the
  // cursor in Full name, so it is clear the list is not the only choice.
  const listed = [...copyFrom.map((other) => people[other]), ...officers.map((o) => ({ ...EMPTY_PERSON, ...o }))];
  const someoneElse = !listed.some((candidate) => samePerson(person, candidate));
  const pickSomeoneElse = () => {
    if (!someoneElse) onChange(role, { ...EMPTY_PERSON });
    setTimeout(() => document.getElementById(fieldId(role, 'name'))?.focus(), 0);
  };

  return (
    <div
      // Desktop: the card spans the 9 rows of the parent grid and shares them
      // (subgrid), so description, options, labels and inputs line up across
      // the three cards. Mobile: a plain column.
      className="rounded-xl border-2 p-4 sm:p-5 flex flex-col lg:grid lg:grid-rows-subgrid lg:row-span-9"
      style={{ borderColor: isSigner ? GOLD : TME_COLORS.border }}
      role="group"
      aria-labelledby={`svp-role-${role}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`svp-role-${role}`} className="text-base font-semibold" style={{ color: NAVY }}>
          {label}
        </h3>
        {isSigner && (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(210,188,153,0.3)', color: NAVY }}
          >
            <PenLine className="w-3 h-3" aria-hidden="true" />
            Signs the policy
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{ROLE_HINTS[role]}</p>

      {hasOptions ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-700 mb-1.5">
            Choose a person, or type the details below
          </p>
          <div className="space-y-2">
            {copyFrom.map((other) => (
              <PersonOption
                key={`copy-${other}`}
                label={`Same person as ${SVP_ROLE_LABELS[other]}`}
                detail={people[other].name}
                pressed={samePerson(person, people[other])}
                disabled={disabled}
                onClick={() => pick(people[other])}
              />
            ))}
            {officers.map((officer, i) => (
              <PersonOption
                key={`officer-${i}`}
                label={officer.name}
                detail={officer.position || undefined}
                pressed={samePerson(person, { ...EMPTY_PERSON, ...officer })}
                disabled={disabled}
                onClick={() => pick(officer)}
              />
            ))}
            <PersonOption
              label="Someone else"
              detail="Type the name, position and email below"
              pressed={someoneElse}
              disabled={disabled}
              onClick={pickSomeoneElse}
            />
          </div>
        </div>
      ) : (
        <div aria-hidden="true" />
      )}

        <Field
          split
          headClassName="mt-4"
          id={fieldId(role, 'name')}
          label="Full name"
          hint="In English letters, for example Anna Smith"
          error={errors[fieldId(role, 'name')]}
        >
          {(describedBy) => (
            <TextInput
              id={fieldId(role, 'name')}
              value={person.name}
              maxLength={SVP_LIMITS.name}
              disabled={disabled}
              autoComplete="off"
              hasError={!!errors[fieldId(role, 'name')]}
              describedBy={describedBy}
              onChange={set('name')}
            />
          )}
        </Field>
        <Field
          split
          headClassName="mt-3"
          id={fieldId(role, 'position')}
          label="Position"
          hint="Job title, for example Finance Manager"
          error={errors[fieldId(role, 'position')]}
        >
          {(describedBy) => (
            <TextInput
              id={fieldId(role, 'position')}
              value={person.position}
              maxLength={SVP_LIMITS.position}
              disabled={disabled}
              autoComplete="off"
              hasError={!!errors[fieldId(role, 'position')]}
              describedBy={describedBy}
              onChange={set('position')}
            />
          )}
        </Field>
        <Field
          split
          headClassName="mt-3"
          id={fieldId(role, 'email')}
          label="Email"
          optional={!isSigner}
          hint={
            isSigner
              ? 'We send the policy to this address for signature'
              : 'If you add it, we copy this person on the signing email'
          }
          error={errors[fieldId(role, 'email')]}
        >
          {(describedBy) => (
            <TextInput
              id={fieldId(role, 'email')}
              type="email"
              value={person.email}
              maxLength={SVP_LIMITS.email}
              disabled={disabled}
              autoComplete="off"
              hasError={!!errors[fieldId(role, 'email')]}
              describedBy={describedBy}
              onChange={set('email')}
            />
          )}
        </Field>
    </div>
  );
}

function VariantNote({ people }: { people: People }) {
  const SAME_PERSON_SIGN_OFFS =
    'Because the same person checks their own work, Section 5.1 of the policy asks them to sign each supplier file twice, on different days: first when the documents are collected, then when the supplier is approved.';
  const variant = roleVariant(people);
  const shared = sharedRoles(people).map((r) => SVP_ROLE_LABELS[r]);
  const text =
    variant === 'three'
      ? 'Three different people hold the three roles.'
      : variant === 'one'
        ? `One person holds all three roles. ${SAME_PERSON_SIGN_OFFS}`
        : `${describeRoleVariant(variant)} (${joinWords(shared)}). ${SAME_PERSON_SIGN_OFFS}`;
  return (
    <div className="rounded-xl p-4 flex gap-3 mt-4" style={{ backgroundColor: NAVY_TINT }} aria-live="polite">
      <Users className="w-5 h-5 shrink-0 mt-0.5" style={{ color: NAVY }} aria-hidden="true" />
      <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
    </div>
  );
}

function TextLink({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2 disabled:opacity-50"
      style={{ color: NAVY }}
    >
      {children}
    </button>
  );
}

function CompanyChangesPanel({
  changes,
  periodsOther,
  disabled,
  errors,
  onChange,
  onPeriodsOther,
  onKeep,
}: {
  changes: SvpCompanyChanges;
  periodsOther: boolean;
  disabled?: boolean;
  errors: Record<string, string>;
  onChange: (key: ChangeKey, value: string) => void;
  onPeriodsOther: (other: boolean) => void;
  onKeep: (key: ChangeKey) => void;
}) {
  const keep = (key: ChangeKey) => (
    <TextLink onClick={() => onKeep(key)} disabled={disabled}>
      Undo, keep your record
    </TextLink>
  );
  return (
    <div className="mt-4 rounded-xl border-2 p-4 sm:p-5 space-y-5" style={{ borderColor: NAVY }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: NAVY }}>
          Your correct details
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          Our Tax team checks the change and updates our records. If you have a new Tax
          Registration Certificate, please also reply to our email with it.
        </p>
      </div>

      {changes.trn !== undefined && (
        <div className="space-y-1.5">
          <Field id={TRN_ID} label="VAT number (TRN)" hint="15 digits" error={errors[TRN_ID]}>
            {(describedBy) => (
              <TextInput
                id={TRN_ID}
                value={changes.trn ?? ''}
                maxLength={SVP_LIMITS.trn}
                disabled={disabled}
                hasError={!!errors[TRN_ID]}
                describedBy={describedBy}
                onChange={(v) => onChange('trn', v)}
              />
            )}
          </Field>
          {keep('trn')}
        </div>
      )}

      {changes.vatPeriods !== undefined && (
        <div className="space-y-1.5">
          <fieldset aria-describedby={errors[VAT_PERIODS_ID] ? `${VAT_PERIODS_ID}-error` : undefined}>
            <legend className="block text-sm font-medium mb-2" style={{ color: NAVY }}>
              VAT periods
            </legend>
            {errors[VAT_PERIODS_ID] && (
              <p id={`${VAT_PERIODS_ID}-error`} className="text-sm font-medium mb-2" style={{ color: TME_COLORS.error }}>
                {errors[VAT_PERIODS_ID]}
              </p>
            )}
            <div className="space-y-2">
              {QUARTER_OPTIONS.map((option, i) => (
                <RadioCard
                  key={option}
                  name="svp-vat-periods"
                  id={i === 0 ? VAT_PERIODS_ID : undefined}
                  checked={!periodsOther && changes.vatPeriods === option}
                  disabled={disabled}
                  onChange={() => {
                    onPeriodsOther(false);
                    onChange('vatPeriods', option);
                  }}
                >
                  {splitVatPeriods(option).join(', ')}
                </RadioCard>
              ))}
              <RadioCard
                name="svp-vat-periods"
                checked={periodsOther}
                disabled={disabled}
                onChange={() => {
                  onPeriodsOther(true);
                  onChange('vatPeriods', '');
                }}
              >
                Other (for example monthly)
              </RadioCard>
              {periodsOther && (
                <TextInput
                  id={`${VAT_PERIODS_ID}-other`}
                  value={changes.vatPeriods ?? ''}
                  maxLength={SVP_LIMITS.vatPeriods}
                  disabled={disabled}
                  hasError={!!errors[VAT_PERIODS_ID]}
                  onChange={(v) => onChange('vatPeriods', v)}
                />
              )}
            </div>
          </fieldset>
          {keep('vatPeriods')}
        </div>
      )}

      {changes.registeredAddress !== undefined && (
        <div className="space-y-1.5">
          <Field
            id={ADDRESS_ID}
            label="Registered office"
            hint="As on your Tax Registration Certificate"
            error={errors[ADDRESS_ID]}
          >
            {(describedBy) => (
              <textarea
                id={ADDRESS_ID}
                value={changes.registeredAddress ?? ''}
                onChange={(e) => onChange('registeredAddress', e.target.value)}
                maxLength={SVP_LIMITS.registeredAddress}
                rows={2}
                disabled={disabled}
                aria-invalid={!!errors[ADDRESS_ID] || undefined}
                aria-describedby={describedBy}
                className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 text-sm"
                style={errors[ADDRESS_ID] ? { borderColor: TME_COLORS.error } : undefined}
                onFocus={(e) => (e.currentTarget.style.borderColor = NAVY)}
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = errors[ADDRESS_ID] ? TME_COLORS.error : TME_COLORS.border)
                }
              />
            )}
          </Field>
          {keep('registeredAddress')}
        </div>
      )}
    </div>
  );
}

function RadioCard({
  checked,
  onChange,
  disabled,
  name = 'records-location',
  id,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className="flex items-start gap-2.5 rounded-lg border-2 p-3 cursor-pointer transition-colors"
      style={{
        borderColor: checked ? NAVY : TME_COLORS.border,
        backgroundColor: checked ? NAVY_TINT : '#ffffff',
      }}
    >
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 w-4 h-4 shrink-0"
        style={{ accentColor: NAVY }}
      />
      <span className="text-sm text-gray-800">{children}</span>
    </label>
  );
}

const NEXT_STEPS: { icon: React.ElementType; text: string }[] = [
  { icon: FileText, text: 'Our Tax team prepares your policy.' },
  { icon: PenLine, text: 'The Supervisor gets the policy by email and signs it online.' },
  { icon: Mail, text: 'You get the invoice in a separate email.' },
];

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
  // A key is present while the client corrects that company detail.
  const [changes, setChanges] = useState<SvpCompanyChanges>({});
  const [periodsOther, setPeriodsOther] = useState(false);
  const [priceAgreed, setPriceAgreed] = useState(false);
  const [dutyAcknowledged, setDutyAcknowledged] = useState(false);
  const bothTicked = priceAgreed && dutyAcknowledged;
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverMessages, setServerMessages] = useState<string[]>([]);
  // Bumped on every failed submit so the error summary takes focus again.
  const [summaryFocus, setSummaryFocus] = useState(0);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let json: IntakeData;
        if (isDemoToken(token)) {
          json = DEMO_INTAKE;
        } else {
          const res = await fetch(`/api/supplier-checks/${token}`);
          if (cancelled) return;
          if (res.status === 404) return setState('not_found');
          if (res.status === 410) return setState('closed');
          if (!res.ok) return setState('error');
          json = await res.json();
        }
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

  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  const handlePersonChange = useCallback((role: SvpRoleKey, next: SvpPerson) => {
    setPeople((prev) => ({ ...prev, [role]: next }));
    setServerMessages([]);
  }, []);

  const companyChanges = useMemo(() => changedDetails(changes, data?.prefill ?? null), [changes, data]);

  const startChange = useCallback(
    (key: ChangeKey) => {
      const prefill = data?.prefill ?? null;
      setServerMessages([]);
      if (key === 'trn') setChanges((c) => ({ ...c, trn: formatTrn(prefill?.trn) ?? '' }));
      if (key === 'registeredAddress') {
        setChanges((c) => ({ ...c, registeredAddress: prefill?.registeredAddress ?? '' }));
      }
      if (key === 'vatPeriods') {
        const current = QUARTER_OPTIONS.find((o) => samePeriods(o, prefill?.vatPeriodsText));
        setPeriodsOther(!current && !!prefill?.vatPeriodsText);
        setChanges((c) => ({ ...c, vatPeriods: current ?? prefill?.vatPeriodsText ?? '' }));
      }
    },
    [data]
  );

  const editChange = useCallback((key: ChangeKey, value: string) => {
    setChanges((c) => ({ ...c, [key]: value }));
    setServerMessages([]);
  }, []);

  const keepRecord = useCallback((key: ChangeKey) => {
    setChanges((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    });
    if (key === 'vatPeriods') setPeriodsOther(false);
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
      ...(Object.keys(companyChanges).length > 0 ? { companyChanges } : {}),
    }),
    [people, atOffice, location, note, priceAgreed, companyChanges]
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
    if (submitting) return;
    if (problems.length > 0) {
      setSummaryFocus((n) => n + 1);
      return;
    }
    setSubmitting(true);
    if (isDemoToken(token)) {
      setState('success');
      return;
    }
    try {
      const res = await fetch(`/api/supplier-checks/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...answers, dutyAcknowledged, shownPriceAed: data?.priceAed ?? null }),
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
          setSummaryFocus((n) => n + 1);
        } else if (j?.error === 'duty_not_acknowledged') {
          setError('Please tick the box to confirm that checking suppliers stays with your company.');
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
  }, [answers, data, dutyAcknowledged, problems, submitting, token]);

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-16 text-gray-500" role="status">
          <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: NAVY }} aria-hidden="true" />
          Loading...
        </div>
      </Shell>
    );
  }

  if (state === 'not_found' || state === 'error') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-12 text-center">
          <XCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.error }} aria-hidden="true" />
          <h2 className="text-xl font-semibold mb-2" style={{ color: NAVY }}>
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
          <AlertTriangle className="w-12 h-12 mb-4" style={{ color: GOLD }} aria-hidden="true" />
          <h2 className="text-xl font-semibold mb-2" style={{ color: NAVY }}>
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
          <CheckCircle className="w-12 h-12 mb-4" style={{ color: TME_COLORS.success }} aria-hidden="true" />
          <h2 className="text-xl font-semibold mb-2" style={{ color: NAVY }}>
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
  const expires = formatShortDate(data?.expiresAt);
  const visibleProblems = (serverMessages.length > 0 ? serverMessages : showErrors ? problems : []).map(
    mapProblem
  );
  const fieldErrors: Record<string, string> = {};
  for (const p of visibleProblems) {
    if (p.target && !fieldErrors[p.target]) fieldErrors[p.target] = p.inline;
  }

  const focusField = (target: string) => (e: React.MouseEvent) => {
    const el = document.getElementById(target);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: 'center' });
    el.focus();
  };

  return (
    <Shell wide>
      <Header companyName={companyName} />

      {visibleProblems.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="svp-error-summary-title"
          className="mb-6 rounded-xl border-2 p-4 sm:p-5 focus:outline-none focus-visible:ring-4"
          style={{
            borderColor: TME_COLORS.error,
            backgroundColor: ERROR_TINT,
            ['--tw-ring-color' as string]: 'rgba(210,188,153,0.7)',
          }}
        >
          <h2 id="svp-error-summary-title" className="text-base font-semibold mb-2" style={{ color: NAVY }}>
            There is a problem. Please check:
          </h2>
          <ul className="space-y-1 text-sm">
            {visibleProblems.map((p) => (
              <li key={p.message}>
                {p.target ? (
                  <a
                    href={`#${p.target}`}
                    onClick={focusField(p.target)}
                    className="underline font-medium"
                    style={{ color: TME_COLORS.error }}
                  >
                    {p.message}
                  </a>
                ) : (
                  <span style={{ color: TME_COLORS.error }}>{p.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Purpose first: what this is, why, how long, what you need. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <p className="text-base text-gray-800 leading-relaxed">
            From 01.10.2026, FTA Decision No. 13 of 2026 requires every VAT registered business to
            check its suppliers and purchases before it claims input VAT, and to have a written
            supplier verification policy.
          </p>
          <p className="text-base text-gray-800 leading-relaxed mt-3">
            We have prepared this policy for your company. Please confirm who does the checks and
            where the records are kept, then agree to the price.
          </p>
        </div>
        <aside
          className="rounded-xl p-4 space-y-3 text-sm"
          style={{ backgroundColor: NAVY_TINT }}
          aria-label="Before you start"
        >
          <div className="flex gap-2.5">
            <Clock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: NAVY }} aria-hidden="true" />
            <span className="text-gray-700">It takes a few minutes.</span>
          </div>
          <div className="flex gap-2.5">
            <UserCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: NAVY }} aria-hidden="true" />
            <span className="text-gray-700">
              You need the names and positions of the people who do the checks, and the email of
              the person who signs.
            </span>
          </div>
          {expires && (
            <div className="flex gap-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: NAVY }} aria-hidden="true" />
              <span className="text-gray-700">This link works until {expires}.</span>
            </div>
          )}
        </aside>
      </div>

      <Step
        number={1}
        title="Check your company details"
        hint="From our records. If your VAT number, VAT periods or address changed, click Change next to it."
      >
        <dl className="rounded-xl bg-gray-50 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Fact label="Company" value={companyName} />
          <Fact
            label="VAT number (TRN)"
            value={formatTrn(prefill?.trn)}
            action={
              changes.trn === undefined && (
                <TextLink onClick={() => startChange('trn')} disabled={submitting} label="Change the VAT number">
                  <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
                  Change
                </TextLink>
              )
            }
          />
          <Fact
            label="VAT periods"
            value={splitVatPeriods(prefill?.vatPeriodsText)}
            action={
              changes.vatPeriods === undefined && (
                <TextLink onClick={() => startChange('vatPeriods')} disabled={submitting} label="Change the VAT periods">
                  <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
                  Change
                </TextLink>
              )
            }
          />
          <Fact
            label="Registered office"
            value={prefill?.registeredAddress}
            note="As on your Tax Registration Certificate"
            action={
              changes.registeredAddress === undefined && (
                <TextLink
                  onClick={() => startChange('registeredAddress')}
                  disabled={submitting}
                  label="Change the registered office"
                >
                  <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
                  Change
                </TextLink>
              )
            }
          />
        </dl>
        {Object.keys(changes).length > 0 && (
          <CompanyChangesPanel
            changes={changes}
            periodsOther={periodsOther}
            disabled={submitting}
            errors={fieldErrors}
            onChange={editChange}
            onPeriodsOther={setPeriodsOther}
            onKeep={keepRecord}
          />
        )}
      </Step>

      <Step
        number={2}
        title="Tell us who does the checks"
        hint="The policy names three roles. One person may hold more than one role. We filled in the manager we have on file. Choose another person or type over the details."
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-y-0">
          {SVP_ROLE_KEYS.map((role) => (
            <RoleCard
              key={role}
              role={role}
              person={people[role]}
              people={people}
              officers={officers}
              disabled={submitting}
              errors={fieldErrors}
              onChange={handlePersonChange}
            />
          ))}
        </div>
        <VariantNote people={people} />
      </Step>

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-10">
        <Step
          number={3}
          title="Where are the records kept?"
          hint="The supplier files, check forms and proof for each purchase. On paper or electronically."
        >
          <fieldset className="space-y-2">
            <legend className="sr-only">Where the records are kept</legend>
            <RadioCard checked={atOffice} onChange={() => setAtOffice(true)} disabled={submitting}>
              {companyChanges.registeredAddress || prefill?.registeredAddress || 'Our registered office'}
              <span className="block text-xs text-gray-500 mt-0.5">
                As on your Tax Registration Certificate
              </span>
            </RadioCard>
            <RadioCard checked={!atOffice} onChange={() => setAtOffice(false)} disabled={submitting}>
              Another place
            </RadioCard>
            {!atOffice && (
              <div className="pt-2">
                <Field
                  id={RECORDS_LOCATION_ID}
                  label="Where?"
                  hint="For example our warehouse in Al Quoz, or our cloud drive"
                  error={fieldErrors[RECORDS_LOCATION_ID]}
                >
                  {(describedBy) => (
                    <TextInput
                      id={RECORDS_LOCATION_ID}
                      value={location}
                      maxLength={SVP_LIMITS.recordsLocation}
                      disabled={submitting}
                      hasError={!!fieldErrors[RECORDS_LOCATION_ID]}
                      describedBy={describedBy}
                      onChange={setLocation}
                    />
                  )}
                </Field>
              </div>
            )}
          </fieldset>
        </Step>

        <Step number={4} title="Anything we should know?">
          <Field id={NOTE_ID} label="Your note" optional error={fieldErrors[NOTE_ID]}>
            {(describedBy) => (
              <textarea
                id={NOTE_ID}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={SVP_LIMITS.note}
                rows={4}
                disabled={submitting}
                aria-describedby={describedBy}
                className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 text-sm"
                onFocus={(e) => (e.currentTarget.style.borderColor = NAVY)}
                onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
              />
            )}
          </Field>
        </Step>
      </div>

      <Step number={5} title="Agree to the price and confirm">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            {price != null && (
              <div className="rounded-xl p-4 mb-3" style={{ backgroundColor: NAVY_TINT }}>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Supplier Verification Policy on your company letterhead
                </p>
                <p className="mt-1">
                  <span className="text-2xl font-bold" style={{ color: NAVY }}>
                    AED {formatAed(price)}
                  </span>{' '}
                  <span className="text-sm text-gray-600">plus 5% VAT</span>
                </p>
              </div>
            )}
            <div className="space-y-3">
              <TickBox
                id={PRICE_ID}
                checked={priceAgreed}
                onChange={setPriceAgreed}
                disabled={submitting}
                error={fieldErrors[PRICE_ID]}
              >
                {price != null ? (
                  <>
                    I agree to the price of{' '}
                    <strong style={{ color: NAVY }}>AED {formatAed(price)}</strong> (plus VAT) for
                    the Supplier Verification Policy. You get the invoice in a separate email.
                  </>
                ) : (
                  <>
                    I agree to the price in the TME email for the Supplier Verification Policy. You
                    get the invoice in a separate email.
                  </>
                )}
              </TickBox>
              <TickBox
                id={DUTY_ID}
                checked={dutyAcknowledged}
                onChange={setDutyAcknowledged}
                disabled={submitting}
              >
                I understand that TME Services does not check our suppliers or purchases and does
                not keep these documents. Checking suppliers and keeping the documents stays with
                our company.
              </TickBox>
            </div>
          </div>

          <div className="rounded-xl border-2 p-4" style={{ borderColor: TME_COLORS.border }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: NAVY }}>
              What happens next
            </h3>
            <ol className="space-y-3">
              {NEXT_STEPS.map(({ icon: Icon, text }, i) => (
                <li key={text} className="flex gap-3 text-sm text-gray-700">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: 'rgba(210,188,153,0.3)', color: NAVY }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="flex items-start gap-2">
                    <Icon className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
                    {text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 text-sm rounded-lg p-3"
            style={{ backgroundColor: ERROR_TINT, color: TME_COLORS.error }}
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !bothTicked}
            aria-disabled={submitting || !bothTicked}
            aria-describedby={!bothTicked ? 'svp-confirm-hint' : undefined}
            className={`w-full sm:w-auto px-8 py-3.5 rounded-lg text-base font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-4 flex items-center justify-center gap-2 ${
              bothTicked
                ? 'text-white hover:shadow-lg hover:brightness-110 disabled:opacity-60 disabled:cursor-wait'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
            style={{
              ...(bothTicked ? { backgroundColor: NAVY } : {}),
              ['--tw-ring-color' as string]: 'rgba(210,188,153,0.9)',
            }}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Submitting...' : 'Confirm my policy details'}
            {!submitting && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
          </button>
          <p id="svp-confirm-hint" className="text-xs text-gray-500">
            {bothTicked
              ? 'You can only send this once. Please check the names first.'
              : 'Tick both boxes to confirm.'}
          </p>
        </div>
      </Step>
    </Shell>
  );
}
