'use client';

/**
 * The composite inputs of the eKYC form: a phone number (the shared
 * PhoneInput, E.164 with a country picker), an amount with currency (share
 * capital, contract kind 'money') and a list with one box per line (main
 * activities, contract kind 'lines').
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Country } from 'react-phone-number-input';
import enCountryNames from 'react-phone-number-input/locale/en';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { Plus, X } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import { CustomDropdown } from '@/components/ui';
import { PhoneInput } from '@/components/ui/PhoneInput';
import {
  EKYC_CURRENCY_OPTIONS,
  EKYC_DEFAULT_CURRENCY,
  ekycJoinLines,
  ekycSplitLines,
  formatEkycMoney,
  parseEkycMoney,
  type EkycText,
} from '@/types/ekyc';
import { Bi, biInline, useEkycBilingual } from './Bi';
import { EKYC_UI } from './texts';

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/** EKYC_COUNTRIES names that the phone library spells differently. */
const COUNTRY_ALIASES: Record<string, Country> = {
  'british virgin islands': 'VG',
  brunei: 'BN',
  'cabo verde': 'CV',
  'congo (democratic republic)': 'CD',
  'congo (republic)': 'CG',
  curacao: 'CW',
  eswatini: 'SZ',
  'ivory coast': 'CI',
  micronesia: 'FM',
  'u.s. virgin islands': 'VI',
  'vatican city': 'VA',
};

let countryByName: Map<string, Country> | null = null;

/** ISO code of an EKYC_COUNTRIES name ('Germany' -> 'DE'); undefined when unknown or empty. */
export function ekycCountryIso(name: string | undefined | null): Country | undefined {
  const key = (name ?? '').trim().toLowerCase();
  if (!key) return undefined;
  if (!countryByName) {
    countryByName = new Map(
      Object.entries(enCountryNames as Record<string, string>)
        .filter(([code]) => /^[A-Z]{2}$/.test(code))
        .map(([code, label]) => [label.toLowerCase(), code as Country])
    );
  }
  return COUNTRY_ALIASES[key] ?? countryByName.get(key);
}

/**
 * The stored phone value as PhoneInput can show it. An E.164 value passes
 * through; an older free-form value ('+49 (151) 1234 5678', '050 123 4567')
 * is read with the field's country and shown as E.164 (nothing is saved until
 * the client edits). `unreadable` is set when the number cannot be read at all.
 */
export function ekycPhoneForDisplay(
  value: string,
  country: Country
): { e164: string | undefined; unreadable: boolean } {
  const raw = value.trim();
  if (!raw) return { e164: undefined, unreadable: false };
  const parsed = parsePhoneNumberFromString(raw, country as CountryCode);
  if (parsed) return { e164: parsed.number, unreadable: false };
  return { e164: undefined, unreadable: true };
}

export function EkycPhoneInput({
  inputId,
  labelledBy,
  describedBy,
  value,
  defaultCountry,
  disabled,
  invalid,
  onChange,
}: {
  inputId: string;
  labelledBy: string;
  describedBy?: string;
  value: string;
  /** ISO country the picker starts on (UAE for a UAE number, the home country for a home number). */
  defaultCountry: Country;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const bilingual = useEkycBilingual();
  const { e164, unreadable } = ekycPhoneForDisplay(value, defaultCountry);
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <PhoneInput
        value={e164}
        onChange={(v) => onChange(v ?? '')}
        defaultCountry={defaultCountry}
        disabled={disabled}
        invalid={invalid}
        showValidation={false}
        inputId={inputId}
        ariaLabelledBy={labelledBy}
        ariaDescribedBy={describedBy}
        placeholder={biInline(EKYC_UI.phonePlaceholder, bilingual)}
        searchPlaceholder={biInline(EKYC_UI.searchCountry, bilingual)}
        noOptionsText={biInline(EKYC_UI.noCountries, bilingual)}
      />
      {unreadable && (
        <p className="mt-1 text-[13px] text-amber-700">
          {biInline(EKYC_UI.phoneSavedAs, bilingual).replace(/\{value\}/g, value.trim())}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Comma thousands: "1234567" -> "1,234,567". */
function groupAmount(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * What the client typed in the amount box as plain digits (Damir 02.10:
 * digits only, no decimals). Everything that is not a digit is dropped, so a
 * German "50.000" and an English "50,000" are both 50000. Leading zeros go
 * ("007" = "7", "000" = "0"). '' when there is no digit.
 */
export function normalizeEkycAmount(typed: string): string {
  const digits = (typed ?? '').replace(/\D/g, '');
  if (digits === '') return '';
  return digits.replace(/^0+(?=\d)/, '');
}

/**
 * The amount box text while typing: digits grouped with commas ("100000" ->
 * "100,000"), plus where the caret goes so it stays after the same digit.
 * `caret` is the caret in `typed`; the result's caret is in `text`.
 */
export function formatAmountTyping(typed: string, caret: number): { text: string; caret: number } {
  const digits = normalizeEkycAmount(typed);
  const text = groupAmount(digits);
  // Digits before the caret, less the leading zeros that were dropped.
  const leadingZeros = (typed.replace(/\D/g, '').match(/^0+(?=\d)/)?.[0].length) ?? 0;
  let before = typed.slice(0, caret).replace(/\D/g, '').length - leadingZeros;
  if (before <= 0) return { text, caret: 0 };
  let pos = 0;
  while (pos < text.length && before > 0) {
    if (/\d/.test(text[pos])) before -= 1;
    pos += 1;
  }
  return { text, caret: pos };
}

/** The amount box text for a stored value: "AED 50,000" -> "50,000" (an old value with decimals shows the whole units). */
function amountFromValue(value: string): { currency: string; amount: string } {
  const parsed = parseEkycMoney(value);
  if (parsed) return { currency: parsed.currency, amount: groupAmount(parsed.amount.split('.')[0]) };
  // Not readable (an old free text): show its digits, the check names it.
  return { currency: EKYC_DEFAULT_CURRENCY, amount: groupAmount(normalizeEkycAmount(value)) };
}

/** The stored value for a currency and what was typed: ("AED", "50.000") -> "AED 50,000". */
export function ekycMoneyFromTyped(currency: string, typed: string): string {
  return formatEkycMoney(currency, normalizeEkycAmount(typed));
}

/** "AED (UAE Dirham)" -> "UAE Dirham". */
function currencyName(label: string, code: string): string {
  const m = new RegExp(`^${code}\\s*\\((.*)\\)$`).exec(label.trim());
  return m ? m[1] : label;
}

export function MoneyInput({
  inputId,
  labelledBy,
  describedBy,
  value,
  disabled,
  invalid,
  onChange,
}: {
  inputId: string;
  labelledBy: string;
  describedBy?: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const bilingual = useEkycBilingual();
  const initial = amountFromValue(value);
  const [currency, setCurrency] = useState(initial.currency);
  const [amount, setAmount] = useState(initial.amount);
  const focused = useRef(false);
  const lastWritten = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  // After the grouped text is rendered, put the caret back after the same digit.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && caret.current !== null && document.activeElement === el) {
      const pos = Math.min(caret.current, el.value.length);
      el.setSelectionRange(pos, pos);
    }
    caret.current = null;
  }, [amount]);

  // A value from outside (draft load, pre-fill): read it again. Our own writes are skipped.
  useEffect(() => {
    if (value === lastWritten.current || focused.current) return;
    lastWritten.current = value;
    if (!value.trim()) {
      setAmount('');
      return;
    }
    const next = amountFromValue(value);
    setCurrency(next.currency);
    setAmount(next.amount);
  }, [value]);

  const write = (code: string, typed: string) => {
    const next = ekycMoneyFromTyped(code, typed);
    lastWritten.current = next;
    onChange(next);
    return next;
  };

  const options = useMemo(
    () =>
      EKYC_CURRENCY_OPTIONS.map((o) => {
        const en = currencyName(o.en, o.value);
        const de = currencyName(o.de || o.en, o.value);
        return { value: o.value, label: o.value, sublabel: bilingual && de !== en ? `${en} / ${de}` : en };
      }),
    [bilingual]
  );
  const currencyLabelId = `${inputId}-currency`;
  const borderColor = invalid ? TME_COLORS.error : TME_COLORS.border;

  return (
    <div className="flex items-start gap-2" role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <span id={currencyLabelId} className="sr-only">
        {biInline(EKYC_UI.currency, bilingual)}
      </span>
      <div className="w-[110px] shrink-0 sm:w-[120px]" data-ekyc-currency="">
        <CustomDropdown
          value={currency}
          onChange={(code) => {
            setCurrency(code);
            if (amount.trim()) write(code, amount);
          }}
          options={options}
          searchable
          disabled={disabled}
          error={invalid ? ' ' : undefined}
          ariaLabelledBy={`${labelledBy} ${currencyLabelId}`}
          searchPlaceholder={biInline(EKYC_UI.typeToSearch, bilingual)}
          noOptionsText={biInline(EKYC_UI.noOptions, bilingual)}
        />
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        aria-label={biInline(EKYC_UI.amount, bilingual)}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="h-11 min-w-0 flex-1 rounded-lg border-2 bg-white px-3 py-2 text-gray-900 transition-colors duration-200 focus:outline-none focus:border-[#243F7B] disabled:bg-gray-50 disabled:text-gray-700"
        style={{ borderColor }}
        value={amount}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          // Digits only, commas added as the client types (also on paste:
          // "50.000" becomes "50,000"). The caret stays after the same digit.
          const typed = e.target.value;
          const next = formatAmountTyping(typed, e.target.selectionStart ?? typed.length);
          caret.current = next.caret;
          setAmount(next.text);
          write(currency, next.text);
        }}
        onBlur={() => {
          focused.current = false;
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lines (one box per activity)
// ---------------------------------------------------------------------------

/** The boxes for a stored list value: one per line, at least one (empty) box. */
export function ekycLinesFromValue(value: string): string[] {
  const lines = ekycSplitLines(value);
  return lines.length > 0 ? lines : [''];
}

/**
 * Pasted text in box `index`: the selection [from, to) is replaced by the
 * first pasted line, every further line gets a box of its own below (empty
 * lines dropped). The text after the selection stays on the last pasted line.
 * Returns the boxes and the box to focus (the last pasted one).
 */
export function ekycPasteLines(
  rows: readonly string[],
  index: number,
  from: number,
  to: number,
  pasted: string
): { rows: string[]; focus: number } {
  const lines = ekycSplitLines(pasted);
  if (lines.length === 0) return { rows: [...rows], focus: index };
  const current = rows[index] ?? '';
  const before = current.slice(0, from);
  const after = current.slice(to);
  const inserted = lines.map((line, i) => (i === 0 ? before + line : line));
  inserted[inserted.length - 1] += after;
  const next = [...rows.slice(0, index), ...inserted, ...rows.slice(index + 1)];
  return { rows: next, focus: index + inserted.length - 1 };
}

let lineKeySeed = 0;
const newLineKey = () => {
  lineKeySeed += 1;
  return `l${lineKeySeed}`;
};

/**
 * A list as one text box per line (main activities). The stored value stays
 * ONE string, the lines joined with a line break, empty lines dropped
 * (ekycJoinLines), so pre-fill, PDF and older drafts read it as before.
 * Enter adds a box below and moves there; pasting several lines fills one box
 * per line; x removes a box (at least one stays).
 */
export function LinesInput({
  inputId,
  labelledBy,
  describedBy,
  value,
  disabled,
  invalid,
  onChange,
}: {
  inputId: string;
  labelledBy: string;
  describedBy?: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const bilingual = useEkycBilingual();
  const [rows, setRows] = useState<string[]>(() => ekycLinesFromValue(value));
  const [keys, setKeys] = useState<string[]>(() => ekycLinesFromValue(value).map(newLineKey));
  const lastWritten = useRef(value);
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAfter = useRef<{ index: number; caret?: number } | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  // A value from outside (draft load, pre-fill): read it again, unless the client is typing here.
  useEffect(() => {
    if (value === lastWritten.current) return;
    if (groupRef.current?.contains(document.activeElement)) return;
    lastWritten.current = value;
    const next = ekycLinesFromValue(value);
    setRows(next);
    setKeys(next.map(newLineKey));
  }, [value]);

  // Move to the box asked for after the rows rendered (Enter, paste, add, remove).
  useLayoutEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    const el = boxRefs.current[want.index];
    if (!el) return;
    el.focus();
    const pos = want.caret ?? el.value.length;
    el.setSelectionRange(pos, pos);
  });

  const commit = (nextRows: string[], nextKeys: string[], focus?: { index: number; caret?: number }) => {
    setRows(nextRows);
    setKeys(nextKeys);
    if (focus) focusAfter.current = focus;
    const stored = ekycJoinLines(nextRows);
    if (stored !== lastWritten.current) {
      lastWritten.current = stored;
      onChange(stored);
    }
  };

  const addAfter = (index: number) => {
    const nextRows = [...rows.slice(0, index + 1), '', ...rows.slice(index + 1)];
    const nextKeys = [...keys.slice(0, index + 1), newLineKey(), ...keys.slice(index + 1)];
    commit(nextRows, nextKeys, { index: index + 1, caret: 0 });
  };

  const remove = (index: number) => {
    if (rows.length <= 1) return;
    const nextRows = rows.filter((_, i) => i !== index);
    const nextKeys = keys.filter((_, i) => i !== index);
    commit(nextRows, nextKeys, { index: Math.max(0, index - 1) });
  };

  const label = (template: EkycText, n: number) => biInline(template, bilingual).replace(/\{n\}/g, String(n));
  const borderColor = invalid ? TME_COLORS.error : TME_COLORS.border;

  return (
    <div ref={groupRef} role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <ol className="space-y-2">
        {rows.map((row, index) => (
          <li key={keys[index]} className="flex items-center gap-2">
            <span aria-hidden="true" className="w-5 shrink-0 text-right text-sm tabular-nums text-slate-400">
              {index + 1}.
            </span>
            <input
              ref={(el) => {
                boxRefs.current[index] = el;
              }}
              id={index === 0 ? inputId : `${inputId}-${index}`}
              type="text"
              autoComplete="off"
              aria-label={index === 0 ? undefined : label(EKYC_UI.lineLabel, index + 1)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className="h-11 min-w-0 flex-1 rounded-lg border-2 bg-white px-3 py-2 text-gray-900 transition-colors duration-200 focus:outline-none focus:border-[#243F7B] disabled:bg-gray-50 disabled:text-gray-700"
              style={{ borderColor }}
              value={row}
              disabled={disabled}
              onChange={(e) => {
                const nextRows = rows.map((r, i) => (i === index ? e.target.value : r));
                commit(nextRows, keys);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addAfter(index);
                } else if (e.key === 'Backspace' && row === '' && rows.length > 1) {
                  e.preventDefault();
                  remove(index);
                }
              }}
              onPaste={(e) => {
                const text = e.clipboardData?.getData('text') ?? '';
                if (!/[\r\n]/.test(text)) return; // one line: the browser pastes it as usual
                e.preventDefault();
                const el = e.currentTarget;
                const from = el.selectionStart ?? row.length;
                const to = el.selectionEnd ?? from;
                const pasted = ekycPasteLines(rows, index, from, to, text);
                const added = pasted.rows.length - rows.length;
                const nextKeys = [
                  ...keys.slice(0, index + 1),
                  ...Array.from({ length: added }, newLineKey),
                  ...keys.slice(index + 1),
                ];
                commit(pasted.rows, nextKeys, { index: pasted.focus });
              }}
            />
            {!disabled && rows.length > 1 && (
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={label(EKYC_UI.removeLine, index + 1)}
                title={label(EKYC_UI.removeLine, index + 1)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ol>
      {!disabled && (
        <button
          type="button"
          onClick={() => addAfter(rows.length - 1)}
          className="mt-2 ml-7 inline-flex min-h-[40px] items-center gap-2 rounded-lg border-2 border-dashed px-3 text-sm font-medium transition-colors hover:bg-gray-50"
          style={{ borderColor: TME_COLORS.primary, color: TME_COLORS.primary }}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <Bi text={EKYC_UI.addLine} variant="inline" />
        </button>
      )}
    </div>
  );
}
