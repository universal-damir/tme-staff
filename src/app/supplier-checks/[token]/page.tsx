'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AutoGrowText, Button, Card, ClientPageHeader, PageBody, StatusChip, textFieldClasses } from '@/components/ui';
import {
  AlertCircle,
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
import { requestJson, failureMessage, FAILURE_MESSAGES } from '@/lib/request-outcome';

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

const PAGE_TITLE = 'Supplier Verification Policy';
const WIDE = 'max-w-[1100px]';

/** Page frame: cloud header band + page column. `wide` gives the three role cards room. */
function Shell({
  children,
  wide = false,
  title = PAGE_TITLE,
  companyName,
}: {
  children: React.ReactNode;
  wide?: boolean;
  title?: string;
  companyName?: string | null;
}) {
  return (
    <div className="min-h-screen bg-tme-page">
      <ClientPageHeader
        eyebrow="Supplier checks"
        title={title}
        subtitle={companyName || undefined}
        maxWidth={wide ? WIDE : undefined}
      />
      <PageBody maxWidth={wide ? WIDE : undefined}>{children}</PageBody>
    </div>
  );
}

/** One centred message (loading, link problems, thank you). */
function StatusCard({
  icon,
  heading,
  children,
}: {
  icon: React.ReactNode;
  heading?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center py-8 text-center">
        {icon}
        {heading && <h2 className="text-xl font-semibold mb-2 text-tme-blue sm:text-lg">{heading}</h2>}
        {children}
      </div>
    </Card>
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
  return (
    <Card
      seed={`svp-step-${number}`}
      title={
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-7 rounded-full flex items-center justify-center text-sm font-bold text-white bg-tme-blue shrink-0 sm:size-6 sm:text-xs sm:font-semibold"
          >
            {number}
          </span>
          <span>
            <span className="sr-only">Step {number}: </span>
            {title}
          </span>
        </span>
      }
      description={hint}
    >
      {children}
    </Card>
  );
}

/** Error text next to a field: red, alert icon, read out as "Error: ...". */
function InlineError({ id, children, className = '' }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <p id={id} className={`flex items-start gap-1.5 text-sm font-medium leading-snug text-tme-red sm:text-[13px] ${className}`}>
      <span className="sr-only">Error: </span>
      <AlertCircle className="w-[18px] h-[18px] shrink-0 mt-px" aria-hidden="true" />
      {children}
    </p>
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
  const bar = error ? 'border-l-4 border-tme-red pl-3 -ml-1' : '';
  const head = (
    <>
      <label htmlFor={id} className="block text-[15px] font-semibold leading-snug text-tme-blue sm:text-sm sm:font-medium">
        {label}
        {optional && <span className="font-normal text-gray-600"> (optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-gray-600 mt-0.5 sm:text-[13px]">
          {hint}
        </p>
      )}
      {error && (
        <InlineError id={errorId} className="mt-1">
          {error}
        </InlineError>
      )}
    </>
  );
  if (split) {
    return (
      <>
        <div className={`${bar} ${headClassName}`}>{head}</div>
        <div className={`${bar} pt-1.5`}>{children(describedBy)}</div>
      </>
    );
  }
  return (
    <div className={`${bar} ${headClassName}`}>
      {head}
      <div className="mt-1.5">{children(describedBy)}</div>
    </div>
  );
}

/** The shared input look (46px, 16px text, blue border on focus). */
const INPUT_CLASS =
  'w-full px-3.5 rounded-[10px] border-2 bg-white text-base text-gray-900 placeholder:text-gray-500 focus:outline-none transition-colors duration-200 disabled:bg-gray-50 disabled:text-gray-600 sm:px-3 sm:rounded-lg sm:border sm:text-sm sm:focus:ring-2 sm:focus:ring-tme-blue/15';

function inputBorder(hasError?: boolean): string {
  return hasError ? 'border-tme-red focus:border-tme-red' : 'border-gray-200 sm:border-gray-300 focus:border-tme-blue';
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
  inputMode,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled?: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  hasError?: boolean;
  describedBy?: string;
  ariaLabel?: string;
}) {
  // Text never cut (Damir 22.10): free text grows to more lines; numbers stay one plain line.
  if (inputMode === 'numeric' || inputMode === 'decimal' || inputMode === 'tel') {
    return (
      <input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} h-[46px] sm:h-10 ${inputBorder(hasError)}`}
      />
    );
  }
  return (
    <AutoGrowText
      id={id}
      kind={type === 'email' || type === 'url' || type === 'search' ? type : 'text'}
      value={value}
      maxLength={maxLength}
      disabled={disabled}
      autoComplete={autoComplete}
      inputMode={inputMode}
      aria-invalid={hasError || undefined}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={textFieldClasses(hasError)}
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

/** What the TRN box lets through: digits only, at most 15, shown in groups of 5. */
function typedTrn(value: string): string {
  const digits = value.replace(/\D+/g, '').slice(0, 15);
  return digits.replace(/(\d{5})(?=\d)/g, '$1 ');
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
      <dt className="text-sm font-medium text-gray-600 sm:text-[13px] sm:font-normal">{label}</dt>
      <dd className={`text-[15px] mt-0.5 break-words sm:text-sm ${has ? 'text-gray-900 font-medium' : 'text-gray-600 italic'}`}>
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
      {has && note && <dd className="text-sm text-gray-600 mt-1 sm:text-[13px]">{note}</dd>}
      {action && <dd className="mt-1">{action}</dd>}
    </div>
  );
}

/** Border + background of a tick box / radio card. */
function choiceClass(checked: boolean, hasError?: boolean): string {
  return checked
    ? 'border-tme-blue bg-blue-50/60'
    : hasError
      ? 'border-tme-red bg-white'
      : 'border-gray-200 bg-white hover:border-gray-300 sm:border-gray-300 sm:hover:border-gray-400';
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
    <div className={error ? 'border-l-4 border-tme-red pl-3 -ml-1' : ''}>
      {error && (
        <InlineError id={`${id}-error`} className="mb-1.5">
          {error}
        </InlineError>
      )}
      <label
        htmlFor={id}
        className={`flex items-start gap-3 rounded-[10px] border-2 p-3.5 cursor-pointer transition-colors sm:gap-2.5 sm:rounded-lg sm:border sm:p-3 ${choiceClass(checked, !!error)}`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={!!error || undefined}
          className="mt-0.5 w-5 h-5 shrink-0 accent-tme-blue sm:w-4 sm:h-4"
        />
        <span className="text-[15px] leading-snug text-gray-800 sm:text-sm">{children}</span>
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
      className={`w-full min-h-11 flex items-center gap-3 text-left rounded-[10px] border-2 px-3 py-2 transition-colors duration-150 tme-btn-focus disabled:opacity-50 disabled:cursor-not-allowed sm:min-h-10 sm:gap-2.5 sm:rounded-lg sm:border sm:py-1.5 ${choiceClass(pressed)}`}
    >
      <span
        aria-hidden="true"
        className={`w-5 h-5 rounded-full border-2 border-tme-blue flex items-center justify-center shrink-0 ${pressed ? 'bg-tme-blue' : 'bg-white'}`}
      >
        {pressed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug break-words text-tme-blue sm:text-sm">{label}</span>
        {detail && <span className="block text-sm text-gray-600 break-words sm:text-[13px]">{detail}</span>}
      </span>
      <span className={`text-sm font-semibold shrink-0 sm:text-[13px] sm:font-medium ${pressed ? 'text-tme-blue' : 'text-gray-600'}`}>
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
      className={`rounded-xl border-2 p-4 sm:p-5 flex flex-col lg:grid lg:grid-rows-subgrid lg:row-span-9 ${
        isSigner ? 'border-tme-blue/40' : 'border-gray-200'
      }`}
      role="group"
      aria-labelledby={`svp-role-${role}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`svp-role-${role}`} className="text-[17px] font-semibold text-tme-blue sm:text-[15px]">
          {label}
        </h3>
        {isSigner && (
          <StatusChip tone="blue" icon={<PenLine className="w-3.5 h-3.5" aria-hidden="true" />}>
            Signs the policy
          </StatusChip>
        )}
      </div>
      <p className="text-sm text-gray-600 mt-1 leading-relaxed sm:text-[13px]">{ROLE_HINTS[role]}</p>

      {hasOptions ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-gray-700 mb-1.5 sm:font-medium">
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
    <div className="rounded-xl p-4 flex gap-3 mt-4 bg-blue-50/60 border border-blue-100" aria-live="polite">
      <Users className="w-5 h-5 shrink-0 mt-0.5 text-tme-blue" aria-hidden="true" />
      <p className="text-[15px] text-gray-700 leading-relaxed sm:text-sm">{text}</p>
    </div>
  );
}

/** A small in-row action ("Change", "Undo"): ghost button, 44px tall. */
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
    <Button tone="ghost" onClick={onClick} disabled={disabled} aria-label={label} className="-ml-3 underline underline-offset-2">
      {children}
    </Button>
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
    <div className="mt-4 rounded-xl border-2 border-tme-blue/40 p-4 sm:p-5 space-y-5">
      <div>
        <p className="text-[15px] font-semibold text-tme-blue">Your correct details</p>
        <p className="text-sm text-gray-600 mt-0.5 sm:text-[13px]">
          Our Tax team checks the change and updates our records. If you have a new Tax
          Registration Certificate, please also reply to our email with it.
        </p>
      </div>

      {changes.trn !== undefined && (
        <div className="space-y-1">
          <Field
            id={TRN_ID}
            label="Tax registration number (TRN)"
            hint="15 digits, numbers only"
            error={errors[TRN_ID]}
          >
            {(describedBy) => (
              <TextInput
                id={TRN_ID}
                value={changes.trn ?? ''}
                maxLength={17}
                inputMode="numeric"
                autoComplete="off"
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
        <div className="space-y-1">
          <fieldset
            aria-describedby={errors[VAT_PERIODS_ID] ? `${VAT_PERIODS_ID}-error` : undefined}
            className={errors[VAT_PERIODS_ID] ? 'border-l-4 border-tme-red pl-3 -ml-1' : ''}
          >
            <legend className="block text-[15px] font-semibold text-tme-blue mb-2 sm:text-sm sm:font-medium">VAT periods</legend>
            {errors[VAT_PERIODS_ID] && (
              <InlineError id={`${VAT_PERIODS_ID}-error`} className="mb-2">
                {errors[VAT_PERIODS_ID]}
              </InlineError>
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
                  ariaLabel="Your VAT periods"
                  onChange={(v) => onChange('vatPeriods', v)}
                />
              )}
            </div>
          </fieldset>
          {keep('vatPeriods')}
        </div>
      )}

      {changes.registeredAddress !== undefined && (
        <div className="space-y-1">
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
                className={`${INPUT_CLASS} py-2.5 min-h-[46px] sm:py-2 sm:min-h-10 ${inputBorder(!!errors[ADDRESS_ID])}`}
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
      className={`flex items-start gap-3 rounded-[10px] border-2 p-3.5 cursor-pointer transition-colors sm:gap-2.5 sm:rounded-lg sm:border sm:p-3 ${choiceClass(checked)}`}
    >
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 w-5 h-5 shrink-0 accent-tme-blue sm:w-4 sm:h-4"
      />
      <span className="text-[15px] leading-snug text-gray-800 sm:text-sm">{children}</span>
    </label>
  );
}

const NEXT_STEPS: { icon: React.ElementType; text: string }[] = [
  { icon: FileText, text: 'Our Tax team prepares your policy.' },
  { icon: PenLine, text: 'The Supervisor gets the policy by email and signs it online.' },
  { icon: Mail, text: 'You get the invoice in a separate email.' },
];

/** A TME Group company: the portal sends price 0 (no price step, no invoice). */
const NEXT_STEPS_NO_CHARGE = NEXT_STEPS.slice(0, 2);

function isNoCharge(priceAed: number | null | undefined): boolean {
  return priceAed === 0;
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
  // A key is present while the client corrects that company detail.
  const [changes, setChanges] = useState<SvpCompanyChanges>({});
  const [periodsOther, setPeriodsOther] = useState(false);
  const [priceTicked, setPriceTicked] = useState(false);
  const [dutyTicked, setDutyAcknowledged] = useState(false);
  // No charge (TME Group): no tick boxes at all. Nothing to agree to, and the
  // duty box makes no sense for our own companies (Damir 02.10.2026).
  const noCharge = isNoCharge(data?.priceAed);
  const priceAgreed = noCharge || priceTicked;
  const dutyAcknowledged = noCharge || dutyTicked;
  const bothTicked = priceAgreed && dutyAcknowledged;
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why the form could not be loaded (offline, server error, ...).
  const [loadError, setLoadError] = useState<string | null>(null);
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
          const outcome = await requestJson<IntakeData>(
            `/api/supplier-checks/${token}`,
            {},
            { form: 'supplier-checks', action: 'load', ref: token }
          );
          if (cancelled) return;
          if (!outcome.ok) {
            if (outcome.status === 404) return setState('not_found');
            if (outcome.status === 410) return setState('closed');
            setLoadError(failureMessage(outcome));
            return setState('error');
          }
          json = outcome.data;
        }
        setData(json);
        setPeople(initialPeople(json));
        if (json.submitted) {
          setAtOffice(json.submitted.recordsLocationIsRegisteredOffice !== false);
          setLocation(json.submitted.recordsLocation ?? '');
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
      if (key === 'trn') setChanges((c) => ({ ...c, trn: typedTrn(prefill?.trn ?? '') }));
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
    setChanges((c) => ({ ...c, [key]: key === 'trn' ? typedTrn(value) : value }));
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
      ...(Object.keys(companyChanges).length > 0 ? { companyChanges } : {}),
    }),
    [people, atOffice, location, priceAgreed, companyChanges]
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
      const outcome = await requestJson(
        `/api/supplier-checks/${token}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...answers, dutyAcknowledged, shownPriceAed: data?.priceAed ?? null }),
        },
        { form: 'supplier-checks', action: 'submit', ref: token }
      );
      if (!outcome.ok) {
        const failure = outcome;
        const messages = Array.isArray(failure.body?.messages)
          ? failure.body.messages.filter((m): m is string => typeof m === 'string')
          : null;
        if (failure.status === 409 && failure.code === 'price_changed') {
          setError('The price was updated while this page was open. Please reload the page, check the price and submit again.');
          setSubmitting(false);
          return;
        }
        if (failure.status === 409) {
          setState('already_submitted');
          return;
        }
        if (failure.status === 410) {
          setState('closed');
          return;
        }
        if (failure.code === 'invalid_answers' && messages) {
          setServerMessages(messages);
          setSummaryFocus((n) => n + 1);
        } else if (failure.code === 'duty_not_acknowledged') {
          setError('Please tick the box to confirm that checking suppliers stays with your company.');
        } else if (failure.code === 'price_not_agreed') {
          setError('Please tick the box to agree to the price before you submit.');
        } else {
          setError(`Could not submit. ${failureMessage(failure)}`);
        }
        setSubmitting(false);
        return;
      }
      setState('success');
    } catch {
      setError(`Could not submit. ${FAILURE_MESSAGES.server_error}`);
      setSubmitting(false);
    }
  }, [answers, data, dutyAcknowledged, problems, submitting, token]);

  if (state === 'loading') {
    // Not the page title here: the form is not open yet.
    return (
      <Shell title="Opening your form">
        <Card>
          <div className="flex flex-col items-center py-12 text-base text-gray-600 sm:text-sm" role="status">
            <Loader2 className="w-8 h-8 animate-spin mb-3 text-tme-blue" aria-hidden="true" />
            Loading…
          </div>
        </Card>
      </Shell>
    );
  }

  if (state === 'not_found' || state === 'error') {
    return (
      <Shell>
        <StatusCard
          icon={<XCircle className="w-12 h-12 mb-4 text-tme-red" aria-hidden="true" />}
          heading={state === 'error' ? 'We could not open the form' : 'This link is not valid'}
        >
          <p className="text-base text-gray-600 sm:text-[15px]">
            {state === 'error'
              ? loadError
              : 'The link may be incorrect. Please use the link from your TME email, or reply to that email.'}
          </p>
        </StatusCard>
      </Shell>
    );
  }

  if (state === 'closed') {
    return (
      <Shell>
        <StatusCard
          icon={<AlertTriangle className="w-12 h-12 mb-4 text-amber-600" aria-hidden="true" />}
          heading="This link is closed"
        >
          <p className="text-base text-gray-600 sm:text-[15px]">
            Please reply to the email we sent you and we will send you a new link.
          </p>
        </StatusCard>
      </Shell>
    );
  }

  const companyName = data?.companyName ?? data?.prefill?.companyName ?? null;

  if (state === 'success' || state === 'already_submitted') {
    return (
      <Shell companyName={companyName}>
        <StatusCard
          icon={<CheckCircle className="w-12 h-12 mb-4 text-green-700" aria-hidden="true" />}
          heading="Thank you, we have received your details"
        >
          <p className="text-base text-gray-600 max-w-md leading-relaxed sm:text-[15px]">
            Our Tax team now prepares your Supplier Verification Policy. You will receive the
            policy by email for electronic signature
            {isNoCharge(data?.priceAed) ? '' : ', and the invoice in a separate email'}. No further
            action is needed from you right now.
          </p>
        </StatusCard>
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
    <Shell wide companyName={companyName}>
      {visibleProblems.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="svp-error-summary-title"
          className="rounded-[14px] border-2 border-tme-red bg-red-50 p-4 sm:p-5 tme-btn-focus focus:outline-none"
        >
          <h2
            id="svp-error-summary-title"
            className="flex items-center gap-2 text-[17px] font-semibold mb-2 text-tme-red sm:text-[15px]"
          >
            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
            There is a problem. Please check:
          </h2>
          <ul className="space-y-1.5 text-[15px] sm:text-sm">
            {visibleProblems.map((p) => (
              <li key={p.message}>
                {p.target ? (
                  <a
                    href={`#${p.target}`}
                    onClick={focusField(p.target)}
                    className="underline underline-offset-2 font-medium text-tme-red"
                  >
                    {p.message}
                  </a>
                ) : (
                  <span className="text-tme-red">{p.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Purpose first: what this is, why, how long, what you need. */}
      <Card>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <p className="text-base text-gray-800 leading-relaxed sm:text-sm">
              From 01.10.2026, FTA Decision No. 13 of 2026 requires every VAT registered business to
              check its suppliers and purchases before it claims input VAT, and to have a written
              supplier verification policy.
            </p>
            <p className="text-base text-gray-800 leading-relaxed mt-3 sm:text-sm">
              We have prepared this policy for your company. Please confirm who does the checks and
              where the records are kept{noCharge ? '.' : ', then agree to the price.'}
            </p>
          </div>
          <aside
            className="rounded-xl p-4 space-y-3 text-[15px] bg-blue-50/60 border border-blue-100 sm:text-[13px] sm:space-y-2.5"
            aria-label="Before you start"
          >
            <div className="flex gap-2.5">
              <Clock className="w-[18px] h-[18px] mt-0.5 shrink-0 text-tme-blue" aria-hidden="true" />
              <span className="text-gray-700">It takes a few minutes.</span>
            </div>
            <div className="flex gap-2.5">
              <UserCheck className="w-[18px] h-[18px] mt-0.5 shrink-0 text-tme-blue" aria-hidden="true" />
              <span className="text-gray-700">
                You need the names and positions of the people who do the checks, and the email of
                the person who signs.
              </span>
            </div>
            {expires && (
              <div className="flex gap-2.5">
                <AlertTriangle className="w-[18px] h-[18px] mt-0.5 shrink-0 text-tme-blue" aria-hidden="true" />
                <span className="text-gray-700">This link works until {expires}.</span>
              </div>
            )}
          </aside>
        </div>
      </Card>

      <Step
        number={1}
        title="Check your company details"
        hint="From our records. If your tax registration number (TRN), VAT periods or address changed, click Change next to it."
      >
        <dl className="rounded-xl bg-gray-50 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Fact label="Company" value={companyName} />
          <Fact
            label="Tax registration number (TRN)"
            value={formatTrn(prefill?.trn)}
            action={
              changes.trn === undefined && (
                <TextLink
                  onClick={() => startChange('trn')}
                  disabled={submitting}
                  label="Change the tax registration number (TRN)"
                >
                  <PenLine className="w-4 h-4" aria-hidden="true" />
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
                  <PenLine className="w-4 h-4" aria-hidden="true" />
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
                  <PenLine className="w-4 h-4" aria-hidden="true" />
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

      <Step
        number={3}
        title="Where are the records kept?"
        hint="The supplier files, check forms and proof for each purchase. On paper or electronically."
      >
        <fieldset className="space-y-2">
          <legend className="sr-only">Where the records are kept</legend>
          <RadioCard checked={atOffice} onChange={() => setAtOffice(true)} disabled={submitting}>
            {companyChanges.registeredAddress || prefill?.registeredAddress || 'Our registered office'}
            <span className="block text-sm text-gray-600 mt-0.5 sm:text-[13px]">
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

      <Step number={4} title={noCharge ? 'Confirm' : 'Agree to the price and confirm'}>
        <div className={`grid grid-cols-1 gap-6 ${noCharge ? '' : 'lg:grid-cols-2'}`}>
          {!noCharge && (
            <div>
              {price != null && (
                <div className="rounded-xl p-4 mb-3 bg-blue-50/60 border border-blue-100">
                  <p className="text-sm font-medium text-gray-600 sm:text-[13px]">
                    Supplier Verification Policy on your company letterhead
                  </p>
                  <p className="mt-1">
                    <span className="text-2xl font-bold text-tme-blue sm:text-xl sm:font-semibold">AED {formatAed(price)}</span>{' '}
                    <span className="text-sm text-gray-600 sm:text-[13px]">plus 5% VAT</span>
                  </p>
                </div>
              )}
              <div className="space-y-3">
                <TickBox
                  id={PRICE_ID}
                  checked={priceAgreed}
                  onChange={setPriceTicked}
                  disabled={submitting}
                  error={fieldErrors[PRICE_ID]}
                >
                  {price != null ? (
                    <>
                      I agree to the price of{' '}
                      <strong className="text-tme-blue">AED {formatAed(price)}</strong> (plus VAT) for
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
                  I understand that TME Services does not check your suppliers or purchases and does
                  not keep these documents. Checking suppliers and keeping all purchase documents
                  stays with your company.
                </TickBox>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="text-[15px] font-semibold mb-3 text-tme-blue">What happens next</h3>
            <ol className="space-y-3">
              {(noCharge ? NEXT_STEPS_NO_CHARGE : NEXT_STEPS).map(({ icon: Icon, text }, i) => (
                <li key={text} className="flex gap-3 text-[15px] text-gray-700 sm:text-sm">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 bg-tme-blue text-white sm:w-5 sm:h-5 sm:text-xs sm:font-semibold"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="flex items-start gap-2">
                    <Icon className="w-4 h-4 mt-1 shrink-0 text-tme-blue" aria-hidden="true" />
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
            className="mt-6 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm font-medium text-tme-red sm:text-[13px]"
          >
            <AlertCircle className="w-[18px] h-[18px] shrink-0 mt-px" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Phone: button on top, hint under it. Desktop: hint left, button far right. */}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <p id="svp-confirm-hint" className="text-sm text-gray-600 sm:text-[13px]">
            {bothTicked
              ? 'You can only send this once. Please check the names first.'
              : 'Tick both boxes to confirm.'}
          </p>
          <Button
            tone="primary"
            size="lg"
            fullWidthOnMobile
            onClick={handleSubmit}
            disabled={!bothTicked}
            busy={submitting}
            aria-disabled={submitting || !bothTicked}
            aria-describedby={!bothTicked ? 'svp-confirm-hint' : undefined}
          >
            {submitting ? 'Submitting…' : 'Confirm my policy details'}
            {!submitting && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
          </Button>
        </div>
      </Step>
    </Shell>
  );
}
