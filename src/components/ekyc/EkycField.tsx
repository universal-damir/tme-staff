'use client';

import React, { useLayoutEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import { CustomDatePicker, CustomDropdown, MultiSelectDropdown } from '@/components/ui';
import { SignaturePad } from '@/components/SignatureCanvas';
import {
  EKYC_COUNTRY_OPTIONS,
  EKYC_LATIN_NAME_HINT,
  EKYC_PREFILLED_FIELD_MARK,
  ekycToLatinName,
  type EkycFieldDef,
  type EkycOption,
  type EkycText,
} from '@/types/ekyc';
import { isoToPickerDate, pickerDateToIso } from '@/lib/ekyc-form';
import type { Country } from 'react-phone-number-input';
import { Bi, BiHelp, BiLabel, biInline, useEkycBilingual } from './Bi';
import { EkycPhoneInput, LinesInput, MoneyInput } from './EkycInputs';
import { EKYC_MONTHS, EKYC_UI } from './texts';

/** A single choice with this many options or more is a dropdown; fewer are buttons side by side. */
const DROPDOWN_MIN_OPTIONS = 3;
/** Hints longer than this fold away behind "More information". */
const LONG_HINT_CHARS = 220;

const inputClass =
  'w-full px-3 py-2 rounded-lg border-2 bg-white text-gray-900 transition-colors duration-200 focus:outline-none focus:border-[#243F7B] disabled:bg-gray-50 disabled:text-gray-700';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any row shape
type AnyFieldDef = EkycFieldDef<any, any>;

/** Small tag under a pre-filled field's input (PrefilledSlot); the full sentence is the tooltip. */
export function PrefilledTag() {
  const bilingual = useEkycBilingual();
  const title = biInline(EKYC_PREFILLED_FIELD_MARK, bilingual);
  return (
    <span
      className="inline-flex shrink-0 items-center rounded px-1.5 py-px text-[11px] font-medium leading-4"
      style={{ backgroundColor: 'rgba(210,188,153,0.3)', color: '#6b5a3a' }}
      title={title}
    >
      {biInline(EKYC_UI.prefilledTag, bilingual)}
      <span className="sr-only">: {title}</span>
    </span>
  );
}

/** Height of the tag slot under an input: the tag's own height (11px text, 16px line, 1px padding). */
export const PREFILLED_SLOT_CLASS = 'mt-1.5 flex h-[18px] items-center';

/**
 * The fixed slot under an input: 6px below it, always 18px high, the tag on
 * the left. Rendered when the field is pre-filled, and empty when another
 * field of the same row is, so every field of the row keeps the same height.
 */
export function PrefilledSlot({ prefilled, reserve }: { prefilled?: boolean; reserve?: boolean }) {
  if (!prefilled && !reserve) return null;
  return (
    <div className={PREFILLED_SLOT_CLASS} data-ekyc-tag-slot="" aria-hidden={prefilled ? undefined : true}>
      {prefilled && <PrefilledTag />}
    </div>
  );
}

export function FieldError({ message, id }: { message: EkycText | undefined; id?: string }) {
  if (!message) return null;
  return (
    <div id={id} className="mt-1.5 text-sm text-red-600">
      <Bi text={message} deClassName="!text-red-500" />
    </div>
  );
}

/**
 * A question: English (15px, semibold, navy) and in a bilingual form the
 * German under it (13px, slate). Styles live in Bi.tsx (EKYC_TYPE).
 */
export function FieldLabel({
  field,
  id,
  htmlFor,
}: {
  field: Pick<AnyFieldDef, 'label' | 'required'>;
  id: string;
  /** Only for a native input / textarea; the other controls point aria-labelledby at `id`. */
  htmlFor?: string;
}) {
  const bilingual = useEkycBilingual();
  // Question numbers stay off the screen: they come from the paper form and
  // only the PDF prints them. No star either: the optional fields say so.
  // "(Optional)" sits on a small line under the label, so the label keeps the
  // full width. The pre-filled tag sits under the INPUT (PrefilledSlot).
  return (
    <label id={id} htmlFor={htmlFor} className="block">
      <BiLabel text={field.label} />
      {!field.required && (
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-normal text-slate-500">({biInline(EKYC_UI.optional, bilingual)})</span>
        </span>
      )}
    </label>
  );
}

/**
 * A field's help under the label: an info icon, the English (13px slate-600)
 * and the German (12px italic slate-400) in one indent. A long one folds away.
 */
export function FieldHint({ text, id }: { text: EkycText | undefined; id?: string }) {
  if (!text) return null;
  if (text.en.length > LONG_HINT_CHARS) {
    return (
      <details id={id} className="group mt-1.5">
        <summary
          className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[13px] font-medium underline-offset-2 hover:underline"
          style={{ color: TME_COLORS.primary }}
        >
          <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <Bi text={EKYC_UI.moreInfo} variant="inline" />
        </summary>
        <BiHelp text={text} icon={false} paragraphs className="mt-1.5 pl-5" />
      </details>
    );
  }
  return <BiHelp text={text} id={id} className="mt-1.5" />;
}

function CheckboxList({
  labelledBy,
  options,
  value,
  disabled,
  onChange,
}: {
  labelledBy: string;
  options: readonly EkycOption[];
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-labelledby={labelledBy}>
      {options.map((option) => {
        const checked = value.includes(option.value);
        return (
          <label
            key={option.value}
            className={`flex min-h-[44px] items-start gap-3 rounded-lg border-2 px-3 py-2 transition-colors ${
              disabled ? 'cursor-default' : 'cursor-pointer hover:border-[#243F7B]/50'
            }`}
            style={{
              borderColor: checked ? TME_COLORS.primary : TME_COLORS.border,
              backgroundColor: checked ? 'rgba(36,63,123,0.04)' : '#fff',
            }}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#243F7B]"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(checked ? value.filter((v) => v !== option.value) : [...value, option.value])}
            />
            <Bi text={option} className="text-sm text-gray-800" />
          </label>
        );
      })}
    </div>
  );
}

/** Two or so answers as buttons side by side (Yes / No, Mainland / Freezone). */
function Segmented({
  labelledBy,
  describedBy,
  options,
  value,
  disabled,
  onChange,
}: {
  labelledBy: string;
  describedBy?: string;
  options: readonly EkycOption[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border-2 bg-white p-0.5"
      style={{ borderColor: TME_COLORS.border }}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-[40px] min-w-[72px] rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-default ${
              checked ? '' : 'hover:bg-gray-50'
            }`}
            style={{
              backgroundColor: checked ? TME_COLORS.primary : 'transparent',
              color: checked ? '#fff' : '#374151',
            }}
          >
            <Bi text={option} variant="inline" className="items-center" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * D8: a person-name input. Converts as the client types (Müller = Mueller,
 * ekycToLatinName) and keeps the caret where it was, trims on blur.
 */
function LatinNameInput({
  id,
  value,
  disabled,
  className,
  style,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  className: string;
  style: React.CSSProperties;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  // After the converted value is rendered, put the caret back where it belongs.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) {
      const pos = Math.min(caret.current, el.value.length);
      el.setSelectionRange(pos, pos);
    }
    caret.current = null;
  }, [value]);

  return (
    <input
      ref={ref}
      id={id}
      type="text"
      autoComplete="off"
      spellCheck={false}
      className={className}
      style={style}
      value={value}
      disabled={disabled}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(e) => {
        const raw = e.target.value;
        const at = e.target.selectionStart ?? raw.length;
        const converted = ekycToLatinName(raw);
        // The text before the caret converts the same way, so its new length is the new caret.
        caret.current = converted === raw ? null : ekycToLatinName(raw.slice(0, at)).length;
        onChange(converted);
      }}
      onBlur={(e) => {
        const trimmed = e.target.value.trim();
        if (trimmed !== e.target.value) onChange(trimmed);
      }}
    />
  );
}

/** Does this field take the full row of the two-column grid? */
export function ekycFieldIsWide(field: AnyFieldDef, options?: readonly EkycOption[]): boolean {
  switch (field.kind) {
    case 'textarea':
    case 'lines':
    case 'multiselect':
    case 'countries':
    case 'signature':
    case 'yesno':
      return true;
    case 'select': {
      const list = options ?? field.options ?? [];
      if (list.length < DROPDOWN_MIN_OPTIONS) return false;
      return list.some((o) => o.en.length > 48);
    }
    case 'text':
    case 'phone':
      return field.label.en.length > 80;
    default:
      return false;
  }
}

export interface EkycFieldProps {
  field: AnyFieldDef;
  /** Full path, used for ids and scrolling to the error. */
  path: string;
  value: unknown;
  /** Options after `optionsFor` (dependent dropdowns). */
  options?: readonly EkycOption[];
  onChange: (value: unknown) => void;
  error?: EkycText;
  prefilled?: boolean;
  readOnly?: boolean;
  /** D8: the Latin-name rule applies to this field here (isEkycLatinNameField). */
  latinName?: boolean;
  /**
   * 'row': a Yes / No question as one line of a list, the question left and
   * the answer right (stacked on a phone).
   * 'cell': one field of a row of fields. The field is a subgrid of two rows
   * (label + hint, then the input), so the inputs of a row line up even when
   * the labels and hints differ in height.
   */
  layout?: 'stack' | 'row' | 'cell';
  /** Extra classes on the field's outer element (column span in a row). */
  className?: string;
  /** Kind 'phone': the country the picker starts on (ISO). Default: UAE. */
  phoneCountry?: Country;
  /** Another field of the same row is pre-filled: keep the empty tag slot so the row lines up. */
  tagSlot?: boolean;
}

/** Native inputs carry the label by `htmlFor`; every other control by aria-labelledby. */
const NATIVE_KINDS = new Set(['text', 'email', 'phone', 'money', 'url', 'textarea', 'lines', 'percent']);

export function EkycField({
  field,
  path,
  value,
  options,
  onChange,
  error,
  prefilled,
  readOnly = false,
  latinName = false,
  layout = 'stack',
  className = '',
  phoneCountry,
  tagSlot = false,
}: EkycFieldProps) {
  const bilingual = useEkycBilingual();
  const inputId = `ekyc-${path.replace(/\./g, '-')}`;
  const labelId = `${inputId}-label`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const latinHintId = `${inputId}-latin`;
  const borderStyle = { borderColor: error ? TME_COLORS.error : TME_COLORS.border };
  const choiceOptions = options ?? field.options ?? [];
  const placeholder = biInline(EKYC_UI.select, bilingual);
  const searchPlaceholder = biInline(EKYC_UI.typeToSearch, bilingual);
  const noOptionsText = biInline(EKYC_UI.noOptions, bilingual);
  const showLatinHint = latinName && !readOnly && field.kind === 'text';
  const describedBy =
    [field.hint ? hintId : null, error ? errorId : null, showLatinHint ? latinHintId : null].filter(Boolean).join(' ') ||
    undefined;

  let control: React.ReactNode;
  switch (field.kind) {
    case 'textarea':
      control = (
        <textarea
          id={inputId}
          rows={3}
          className={inputClass}
          style={borderStyle}
          value={String(value ?? '')}
          disabled={readOnly}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'lines':
      control = (
        <LinesInput
          inputId={inputId}
          labelledBy={labelId}
          describedBy={describedBy}
          value={String(value ?? '')}
          disabled={readOnly}
          invalid={!!error}
          onChange={(v) => onChange(v)}
        />
      );
      break;
    case 'date':
      control = (
        <CustomDatePicker
          value={isoToPickerDate(String(value ?? ''))}
          onChange={(display) => onChange(pickerDateToIso(display))}
          disabled={readOnly}
          placeholder={biInline(EKYC_UI.datePlaceholder, bilingual)}
          texts={
            bilingual
              ? {
                  monthNames: EKYC_MONTHS.map((m) => biInline(m, true)),
                  today: <Bi text={EKYC_UI.dateToday} variant="inline" className="items-center" />,
                  clear: <Bi text={EKYC_UI.dateClear} variant="inline" className="items-center" />,
                }
              : undefined
          }
          ariaLabelledBy={labelId}
          ariaDescribedBy={describedBy}
        />
      );
      break;
    case 'country':
      control = (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          <CustomDropdown
            value={String(value ?? '')}
            onChange={(v) => onChange(v)}
            options={EKYC_COUNTRY_OPTIONS.map((o) => ({ value: o.value, label: o.en }))}
            placeholder={placeholder}
            searchable
            disabled={readOnly}
            error={error ? ' ' : undefined}
            ariaLabelledBy={labelId}
            searchPlaceholder={searchPlaceholder}
            noOptionsText={noOptionsText}
          />
        </div>
      );
      break;
    case 'countries':
      control = (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          <MultiSelectDropdown
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(v) => onChange(v)}
            options={EKYC_COUNTRY_OPTIONS.map((o) => ({ value: o.value, label: o.en }))}
            placeholder={biInline(EKYC_UI.selectCountries, bilingual)}
            searchable
            disabled={readOnly}
            maxDisplay={4}
          />
        </div>
      );
      break;
    case 'select':
      control =
        choiceOptions.length < DROPDOWN_MIN_OPTIONS ? (
          <Segmented
            labelledBy={labelId}
            describedBy={describedBy}
            options={choiceOptions}
            value={String(value ?? '')}
            disabled={readOnly}
            onChange={(v) => onChange(v)}
          />
        ) : (
          <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
            <CustomDropdown
              value={String(value ?? '')}
              onChange={(v) => onChange(v)}
              options={choiceOptions.map((o) => {
                const de = bilingual && o.de && o.de !== o.en ? o.de : undefined;
                return { value: o.value, label: o.en, ...(de ? { sublabel: de } : {}) };
              })}
              placeholder={placeholder}
              searchable={choiceOptions.length > 8}
              disabled={readOnly}
              wrapLabel
              error={error ? ' ' : undefined}
              ariaLabelledBy={labelId}
              searchPlaceholder={searchPlaceholder}
              noOptionsText={noOptionsText}
            />
          </div>
        );
      break;
    case 'multiselect':
      control = (
        <CheckboxList
          labelledBy={labelId}
          options={choiceOptions}
          value={Array.isArray(value) ? (value as string[]) : []}
          disabled={readOnly}
          onChange={(v) => onChange(v)}
        />
      );
      break;
    case 'yesno':
      control = (
        <Segmented
          labelledBy={labelId}
          describedBy={describedBy}
          options={choiceOptions}
          value={String(value ?? '')}
          disabled={readOnly}
          onChange={(v) => onChange(v)}
        />
      );
      break;
    case 'percent':
      control = (
        <div className="relative max-w-[180px]">
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="any"
            className={`${inputClass} h-11 pr-8`}
            style={borderStyle}
            value={typeof value === 'number' ? String(value) : ''}
            disabled={readOnly}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            onChange={(e) => {
              const raw = e.target.value;
              const n = raw === '' ? null : Number(raw);
              onChange(n !== null && Number.isFinite(n) ? n : null);
            }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
        </div>
      );
      break;
    case 'phone':
      control = (
        <div className="max-w-[420px]">
          <EkycPhoneInput
            inputId={inputId}
            labelledBy={labelId}
            describedBy={describedBy}
            value={String(value ?? '')}
            defaultCountry={phoneCountry ?? 'AE'}
            disabled={readOnly}
            invalid={!!error}
            onChange={(v) => onChange(v)}
          />
        </div>
      );
      break;
    case 'money':
      control = (
        <div className="max-w-[360px]">
          <MoneyInput
            inputId={inputId}
            labelledBy={labelId}
            describedBy={describedBy}
            value={String(value ?? '')}
            disabled={readOnly}
            invalid={!!error}
            onChange={(v) => onChange(v)}
          />
        </div>
      );
      break;
    case 'signature':
      control = readOnly ? (
        typeof value === 'string' && value.startsWith('data:image/') ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise
          <img
            src={value}
            alt={field.label.en}
            aria-labelledby={labelId}
            className="h-[150px] w-full max-w-md object-contain rounded-lg border-2 bg-white"
            style={borderStyle}
          />
        ) : null
      ) : (
        <SignaturePad
          label={<BiLabel text={field.label} className="inline-block align-top" />}
          labelId={labelId}
          initialValue={typeof value === 'string' && value ? value : null}
          onSignatureChange={(dataUrl) => onChange(dataUrl ?? '')}
          texts={{
            draw: <Bi text={EKYC_UI.signDraw} variant="inline" />,
            saved: <Bi text={EKYC_UI.signSaved} variant="inline" />,
            edit: <Bi text={EKYC_UI.signEdit} variant="inline" className="items-center" />,
            undo: <Bi text={EKYC_UI.signUndo} variant="inline" className="items-center" />,
            clear: <Bi text={EKYC_UI.signClear} variant="inline" className="items-center" />,
            undoHint: false,
          }}
        />
      );
      break;
    default: {
      if (latinName && field.kind === 'text') {
        control = (
          <LatinNameInput
            id={inputId}
            value={String(value ?? '')}
            disabled={readOnly}
            className={`${inputClass} h-11`}
            style={borderStyle}
            invalid={!!error}
            describedBy={describedBy}
            onChange={(v) => onChange(v)}
          />
        );
        break;
      }
      const type = field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text';
      control = (
        <input
          id={inputId}
          type={type}
          inputMode={field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : undefined}
          autoComplete="off"
          className={`${inputClass} h-11`}
          style={borderStyle}
          value={String(value ?? '')}
          disabled={readOnly}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }

  const latinHint = showLatinHint && <BiHelp text={EKYC_LATIN_NAME_HINT} id={latinHintId} className="mt-1.5" />;
  const tag = <PrefilledSlot prefilled={prefilled} reserve={tagSlot} />;

  if (layout === 'row') {
    // One line of a question list: question (and hint) left, answer right.
    return (
      <div id={`${inputId}-field`} className={`scroll-mt-28 py-3.5 ${className}`}>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1">
            <FieldLabel field={field} id={labelId} />
            <FieldHint text={field.hint} id={hintId} />
          </div>
          <div className="shrink-0">
            {control}
            {tag}
          </div>
        </div>
        <FieldError message={error} id={errorId} />
      </div>
    );
  }

  // The signature pad prints its own label (with the same id).
  const head = (
    <>
      {field.kind !== 'signature' || readOnly ? (
        <FieldLabel
          field={field}
          id={labelId}
          htmlFor={NATIVE_KINDS.has(field.kind) ? inputId : undefined}
        />
      ) : null}
      <FieldHint text={field.hint} id={hintId} />
    </>
  );

  if (layout === 'cell') {
    return (
      <div id={`${inputId}-field`} className={`scroll-mt-28 row-span-2 grid grid-rows-subgrid gap-y-1.5 ${className}`}>
        <div className="min-w-0">{head}</div>
        <div className="min-w-0">
          {control}
          {tag}
          {latinHint}
          <FieldError message={error} id={errorId} />
        </div>
      </div>
    );
  }

  return (
    <div id={`${inputId}-field`} className={`scroll-mt-28 ${className}`}>
      {head}
      <div className="mt-1.5">{control}</div>
      {tag}
      {latinHint}
      <FieldError message={error} id={errorId} />
    </div>
  );
}
