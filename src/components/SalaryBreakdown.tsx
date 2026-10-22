'use client';

import React, { useState, useEffect, useRef, useId } from 'react';
import {
  SALARY_BREAKDOWN_EXPLANATION,
  PAYROLL_OTHER_TYPE_OPTIONS,
  type PayrollOtherType,
  type PayrollOtherBreakdownEntry,
} from '@/lib/constants';
import { CustomDropdown } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { FieldError } from '@/components/ui/FormBits';
import { Info, Plus, X, AlertTriangle } from 'lucide-react';

type ProvidedFlag = 'yes' | 'no' | 'allowance';

const PROVIDED_OPTIONS: { value: ProvidedFlag; label: string }[] = [
  { value: 'allowance', label: 'Allowance' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

// Abbreviated currency options
const CURRENCY_OPTIONS = [
  { value: 'AED', label: 'AED' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'CHF', label: 'CHF' },
];

// Number formatting helpers — salary amounts allow up to 2 decimals.
// `formatNumber` is the display formatter; `applySalaryInput` processes raw
// keystrokes (preserving a mid-typed "100." / "100.50").
import {
  formatSalaryAmount as formatNumber,
  applySalaryInput,
} from '@/lib/salary-amount';

interface SalaryBreakdownProps {
  currency: string;
  total: number | undefined;
  basic: number | undefined;
  accommodation: number | undefined;
  transport: number | undefined;
  food?: number | undefined;
  other?: number | undefined;
  /** Typed allowance breakdown — when at least one entry exists, the plain
   *  "Other" input becomes read-only and reflects the sum. */
  otherBreakdown?: PayrollOtherBreakdownEntry[];
  // '' = not yet chosen (renders the "Select…" placeholder). The employer must
  // pick a value before submitting; EmployerForm validates this.
  accommodationProvided: ProvidedFlag | '';
  transportProvided: ProvidedFlag | '';
  foodProvided: ProvidedFlag | '';
  onChange: (values: {
    salary_currency: string;
    salary_total: number | undefined;
    salary_basic: number | undefined;
    salary_accommodation: number | undefined;
    salary_transport: number | undefined;
    salary_food?: number | undefined;
    salary_other?: number | undefined;
    salary_other_breakdown?: PayrollOtherBreakdownEntry[];
    accommodation_provided?: ProvidedFlag;
    transport_provided?: ProvidedFlag;
    food_provided?: ProvidedFlag;
  }) => void;
  errors?: {
    currency?: string;
    total?: string;
    basic?: string;
    accommodation?: string;
    transport?: string;
    accommodationProvided?: string;
    transportProvided?: string;
    foodProvided?: string;
  };
}

// Custom input component for salary fields (no steppers, comma formatting)
interface SalaryInputProps {
  label?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Screen-reader name when there is no visible label. */
  ariaLabel?: string;
}

function SalaryInput({ label, value, onChange, error, placeholder, required, disabled, ariaLabel }: SalaryInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [displayValue, setDisplayValue] = useState(formatNumber(value));

  // Re-sync from the external value only while the field is unfocused. While
  // the user is typing, the parent re-renders on every change; if we resynced
  // unconditionally it would snap a mid-typed decimal ("100." / "100.50") back
  // to the parsed number and the decimal point could never be entered.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDisplayValue(formatNumber(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    // Preserve what the user typed (incl. a trailing "." / zero) in the display
    // while emitting the parsed number — see applySalaryInput.
    const { display, value: parsed } = applySalaryInput(e.target.value);
    setDisplayValue(display);
    onChange(parsed);
  };

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
          {label}
          {required && <span className="text-tme-red ml-1" aria-hidden>*</span>}
        </label>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        className={`w-full px-3.5 rounded-[10px] border-2 bg-white text-base text-gray-900 transition-[color,border-color,box-shadow] duration-200 h-[46px] sm:h-10 sm:px-3 sm:rounded-lg sm:border md:text-sm sm:focus:ring-[3px] ${
          error ? 'border-tme-red focus:border-tme-red sm:focus:ring-tme-red/15' : 'border-gray-200 sm:border-gray-300 focus:border-tme-blue sm:focus:border-tme-blue sm:focus:ring-tme-blue/15'
        } focus:outline-none ${disabled ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : ''}`}
      />
      <FieldError>{error}</FieldError>
    </div>
  );
}

export function SalaryBreakdown({
  currency,
  total,
  basic,
  accommodation,
  transport,
  food,
  other,
  otherBreakdown,
  accommodationProvided,
  transportProvided,
  foodProvided,
  onChange,
  errors,
}: SalaryBreakdownProps) {
  // Expanded by default; the explanation renders in the right cell beside the
  // Currency selector and can be collapsed to a compact link.
  const [showInfo, setShowInfo] = useState(true);

  const breakdownRows: PayrollOtherBreakdownEntry[] = otherBreakdown ?? [];
  const hasBreakdownRows = breakdownRows.length > 0;
  // Always render at least one row in the editor so the user can immediately
  // see and use the "Other" structure without first having to discover an
  // "Add allowance" button. The phantom row carries any legacy `other` value
  // so historical data is still visible until the user changes it.
  const visibleBreakdownRows: PayrollOtherBreakdownEntry[] = hasBreakdownRows
    ? breakdownRows
    : [{ type: 'other', amount: other ?? 0 }];

  // The monthly total is normally the sum of every component the employer
  // enters (bottom-up). It is shown editable at the bottom: by default it
  // tracks this sum, but the employer may type a different total for
  // flexibility. Once they do, the total is "pinned" — editing components no
  // longer moves it (only editing the total field does), and a warning flags
  // the mismatch. The breakdown itself is never auto-adjusted.
  const sum = (basic || 0) + (accommodation || 0) + (transport || 0) + (food || 0) + (other || 0);

  // Latch: has the employer manually overridden the total? Derived on mount so
  // a loaded record whose stored total already differs from its components is
  // treated as overridden (we won't silently snap it back to the sum).
  const [totalOverridden, setTotalOverridden] = useState<boolean>(
    () => total !== undefined && total !== null && Math.abs(total - sum) > 0.01,
  );

  // While tracking, total follows the component sum. While overridden, the
  // employer's typed total is preserved.
  const resolvedTotal = (newSum: number): number => (totalOverridden ? (total ?? newSum) : newSum);

  const [totalDisplay, setTotalDisplay] = useState(formatNumber(total));
  useEffect(() => {
    setTotalDisplay(formatNumber(total));
  }, [total]);

  const hasDiscrepancy =
    total !== undefined && total !== null && Math.abs(sum - total) > 0.01;

  // Editing the total pins it — only the total moves, the breakdown is left
  // exactly as entered.
  const handleTotalChange = (newTotal: number | undefined) => {
    setTotalOverridden(true);
    onChange({
      salary_currency: currency,
      salary_total: newTotal,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: other,
    });
  };

  // Centralised handler for any breakdown amount change. While tracking, total
  // follows the new sum; once the employer has pinned a total, it is preserved.
  type BreakdownKey =
    | 'salary_basic'
    | 'salary_accommodation'
    | 'salary_transport'
    | 'salary_food'
    | 'salary_other';
  // When a value > 0 is typed into accommodation/transport/food while the
  // corresponding flag is 'no', flip the flag to 'allowance' — "no" + money
  // is nonsensical (company doesn't provide it but pays for it = allowance).
  const handleAmountChange = (field: BreakdownKey, val: number | undefined) => {
    const nextValues: Record<BreakdownKey, number | undefined> = {
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: other,
    };
    nextValues[field] = val;
    const newTotal =
      (nextValues.salary_basic || 0) +
      (nextValues.salary_accommodation || 0) +
      (nextValues.salary_transport || 0) +
      (nextValues.salary_food || 0) +
      (nextValues.salary_other || 0);

    const flagPatch: {
      accommodation_provided?: ProvidedFlag;
      transport_provided?: ProvidedFlag;
      food_provided?: ProvidedFlag;
    } = {};
    const hasAmount = val !== undefined && val > 0;
    if (hasAmount) {
      if (field === 'salary_accommodation' && accommodationProvided === 'no') {
        flagPatch.accommodation_provided = 'allowance';
      } else if (field === 'salary_transport' && transportProvided === 'no') {
        flagPatch.transport_provided = 'allowance';
      } else if (field === 'salary_food' && foodProvided === 'no') {
        flagPatch.food_provided = 'allowance';
      }
    }

    onChange({
      salary_currency: currency,
      salary_total: Math.round(resolvedTotal(newTotal) * 100) / 100,
      ...nextValues,
      ...flagPatch,
    });
  };

  // Flip a provided flag. Amount is left alone — user may want to keep an
  // allowance value on record even when flipping to 'yes' (in-kind plus cash)
  // or clear it manually after flipping to 'no'.
  const handleProvidedChange = (
    field: 'accommodation_provided' | 'transport_provided' | 'food_provided',
    val: ProvidedFlag,
  ) => {
    onChange({
      salary_currency: currency,
      salary_total: total,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: other,
      [field]: val,
    });
  };

  // Typed "Other" breakdown helpers. After every edit we recompute
  // salary_other (= sum of entries) and salary_total so the parent never has
  // to reconcile them. Variable advance is separate and never feeds total.
  const emitBreakdownUpdate = (nextBreakdown: PayrollOtherBreakdownEntry[]) => {
    const sumOther = nextBreakdown.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const newTotal =
      (basic || 0) +
      (accommodation || 0) +
      (transport || 0) +
      (food || 0) +
      sumOther;
    onChange({
      salary_currency: currency,
      salary_total: Math.round(resolvedTotal(newTotal) * 100) / 100,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: sumOther,
      salary_other_breakdown: nextBreakdown,
    });
  };

  const handleAddBreakdownRow = () => {
    emitBreakdownUpdate([...visibleBreakdownRows, { type: 'other', amount: 0 }]);
  };

  const handleRemoveBreakdownRow = (index: number) => {
    emitBreakdownUpdate(visibleBreakdownRows.filter((_, i) => i !== index));
  };

  const handleBreakdownRowTypeChange = (index: number, value: PayrollOtherType) => {
    emitBreakdownUpdate(
      visibleBreakdownRows.map((e, i) => (i === index ? { ...e, type: value } : e)),
    );
  };

  const handleBreakdownRowAmountChange = (index: number, value: number | undefined) => {
    emitBreakdownUpdate(
      visibleBreakdownRows.map((e, i) => (i === index ? { ...e, amount: value ?? 0 } : e)),
    );
  };

  const getPercentage = (value: number | undefined) => {
    if (!sum || !value) return '0%';
    return `${Math.round((value / sum) * 100)}%`;
  };

  return (
    <div className="space-y-4">
      {/* Currency selector. The monthly total is no longer typed here — the
          employer enters each component below and the total is summed for them
          at the bottom of the section. */}
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 items-start">
        <CustomDropdown
          label="Currency"
          value={currency}
          onChange={(val) =>
            onChange({
              salary_currency: val,
              salary_total: total,
              salary_basic: basic,
              salary_accommodation: accommodation,
              salary_transport: transport,
              salary_food: food,
              salary_other: other,
            })
          }
          options={CURRENCY_OPTIONS}
          error={errors?.currency}
          required
        />
        {/* Salary breakdown info — lives in the right cell beside the Currency
            selector, expanded by default and collapsible to a compact link. The
            invisible label spacer top-aligns it with the dropdown. */}
        <div>
          <span className="hidden md:block text-[15px] font-semibold leading-snug mb-1.5 sm:text-sm sm:font-medium sm:mb-1 invisible select-none" aria-hidden="true">
            .
          </span>
          {showInfo ? (
            <div className="relative rounded-[10px] text-sm leading-snug p-3 pr-12 sm:text-[13px] sm:pr-10 bg-blue-50 border border-blue-100 text-tme-blue">
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                className="absolute top-0.5 right-0.5 size-11 sm:size-9 inline-flex items-center justify-center rounded-full hover:bg-blue-100 transition-colors tme-btn-focus"
                aria-label="Hide salary breakdown info"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
                <span>{SALARY_BREAKDOWN_EXPLANATION}</span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowInfo(true)}
              className="flex items-center gap-2 text-sm font-semibold sm:font-medium text-tme-blue hover:underline min-h-[46px] sm:min-h-10 tme-btn-focus rounded-[10px]"
            >
              <Info className="w-4 h-4" aria-hidden />
              About salary breakdown
            </button>
          )}
        </div>
      </div>

      {/* Breakdown Fields — always visible since they are the primary inputs.
          4-column grid throughout: amounts in row 1
          (Basic/Accommodation/Transport/Food), then the Other editor, then
          Provided flags. Amounts whose flag is not 'allowance' are disabled
          and force-zeroed. */}
      {(
        <div className="space-y-4 pt-2 border-t border-gray-200">
          {/* Row 1: Basic | Accommodation | Transport | Food */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
            <SalaryInput
              label={`Basic (${getPercentage(basic)})`}
              value={basic}
              onChange={(val) => handleAmountChange('salary_basic', val)}
              error={errors?.basic}
            />
            <SalaryInput
              label={`Accommodation (${getPercentage(accommodation)})`}
              value={accommodation}
              onChange={(val) => handleAmountChange('salary_accommodation', val)}
              error={errors?.accommodation}
            />
            <SalaryInput
              label={`Transport (${getPercentage(transport)})`}
              value={transport}
              onChange={(val) => handleAmountChange('salary_transport', val)}
              error={errors?.transport}
            />
            <SalaryInput
              label={`Food (${getPercentage(food)})`}
              value={food}
              onChange={(val) => handleAmountChange('salary_food', val)}
            />
          </div>

          {/* "Other" allowances — itemized editor only. The old standalone
              "Other" number field was removed: it duplicated the section
              below, and once the user added a row it locked silently. Now
              there's a single, always-visible editor; the (X%) label tracks
              the sum so it still slots into the breakdown grid above. */}
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-tme-blue sm:text-sm sm:font-medium">
                Other ({getPercentage(other)})
              </span>
              {(other ?? 0) > 0 && (
                <span className="text-sm sm:text-[13px] text-gray-600">
                  {currency} {formatNumber(other)}
                </span>
              )}
            </div>

            {/* 4-column grid mirroring the Basic/Accommodation/Transport/Food
                row above: the allowance type spans the first 3 columns and the
                amount occupies the 4th, so it lines up exactly under Food. */}
            {visibleBreakdownRows.map((entry, index) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-4 items-center">
                <div className="sm:col-span-3">
                  <CustomDropdown
                    value={entry.type}
                    onChange={(v) => handleBreakdownRowTypeChange(index, v as PayrollOtherType)}
                    options={PAYROLL_OTHER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <SalaryInput
                      // Show empty (not "0") for an unfilled row, matching the
                      // other breakdown inputs whose value is undefined.
                      value={entry.amount || undefined}
                      onChange={(val) => handleBreakdownRowAmountChange(index, val)}
                      ariaLabel={`Allowance ${index + 1} amount`}
                    />
                  </div>
                  {visibleBreakdownRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveBreakdownRow(index)}
                      className="size-11 sm:size-9 inline-flex items-center justify-center rounded-full text-gray-600 hover:text-tme-red hover:bg-red-50 transition-colors flex-shrink-0 tme-btn-focus"
                      aria-label="Remove allowance"
                    >
                      <X className="w-5 h-5" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            ))}

            <Button tone="secondary" fullWidthOnMobile onClick={handleAddBreakdownRow}>
              <Plus className="w-4 h-4" aria-hidden />
              Add allowance
            </Button>
          </div>

          {/* Row 3: Provided flags — Accommodation | Transport | Food | (empty).
              Labels are split into two lines (word / "Provided *") so all
              three line up consistently with breathing room between
              columns, instead of either bunching together (whitespace-nowrap)
              or wrapping unevenly (the longer labels wrap, "Food Provided"
              stays on one line). */}
          <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
            <div>
              <label
                className="block text-[15px] font-semibold mb-1.5 leading-tight text-tme-blue sm:text-sm sm:font-medium sm:mb-1"
              >
                <span className="sm:block">Accommodation</span>
                <span className="sm:block"> Provided<span className="text-tme-red ml-1" aria-hidden>*</span></span>
              </label>
              <CustomDropdown
                value={accommodationProvided}
                onChange={(val) => handleProvidedChange('accommodation_provided', val as ProvidedFlag)}
                options={PROVIDED_OPTIONS}
                placeholder="Select…"
                error={errors?.accommodationProvided}
              />
            </div>
            <div>
              <label
                className="block text-[15px] font-semibold mb-1.5 leading-tight text-tme-blue sm:text-sm sm:font-medium sm:mb-1"
              >
                <span className="sm:block">Transportation</span>
                <span className="sm:block"> Provided<span className="text-tme-red ml-1" aria-hidden>*</span></span>
              </label>
              <CustomDropdown
                value={transportProvided}
                onChange={(val) => handleProvidedChange('transport_provided', val as ProvidedFlag)}
                options={PROVIDED_OPTIONS}
                placeholder="Select…"
                error={errors?.transportProvided}
              />
            </div>
            <div>
              <label
                className="block text-[15px] font-semibold mb-1.5 leading-tight text-tme-blue sm:text-sm sm:font-medium sm:mb-1"
              >
                <span className="sm:block">Food</span>
                <span className="sm:block"> Provided<span className="text-tme-red ml-1" aria-hidden>*</span></span>
              </label>
              <CustomDropdown
                value={foodProvided}
                onChange={(val) => handleProvidedChange('food_provided', val as ProvidedFlag)}
                options={PROVIDED_OPTIONS}
                placeholder="Select…"
                error={errors?.foodProvided}
              />
            </div>
            <div aria-hidden="true" className="hidden sm:block" />
          </div>

          {/* Monthly Total — normally the sum of every component above. Styled
              as a total, but editable: the employer can type a different figure
              for flexibility. Doing so leaves the breakdown untouched and shows
              the mismatch warning below. */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 rounded-[10px] border-2 border-tme-blue bg-blue-50/60 focus-within:ring-2 focus-within:ring-tme-blue/30">
              <span className="text-[15px] font-semibold text-tme-blue sm:text-sm">
                Monthly salary (total)
              </span>
              <div className="flex items-baseline gap-1.5 text-tme-blue">
                <span className="text-lg font-semibold">
                  {currency}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={totalDisplay}
                  onChange={(e) => {
                    const { display, value } = applySalaryInput(e.target.value);
                    handleTotalChange(value);
                    setTotalDisplay(display);
                  }}
                  placeholder="0"
                  aria-label="Monthly salary total"
                  className="w-32 min-h-11 bg-transparent text-right text-lg font-semibold text-tme-blue focus:outline-none"
                />
              </div>
            </div>

            {hasDiscrepancy && (
              <div className="mt-2 flex items-start gap-2 px-1 text-sm text-amber-800 sm:text-[13px]">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
                <span>
                  This total differs from the sum of the components ({currency}{' '}
                  {formatNumber(sum)}).
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
