'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  TME_COLORS,
  SALARY_BREAKDOWN_EXPLANATION,
  PAYROLL_OTHER_TYPE_OPTIONS,
  type PayrollOtherType,
  type PayrollOtherBreakdownEntry,
} from '@/lib/constants';
import { CustomDropdown } from '@/components/ui';
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
}

function SalaryInput({ label, value, onChange, error, placeholder, required, disabled }: SalaryInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
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
        <label
          className="block text-sm font-medium mb-1 whitespace-nowrap"
          style={{ color: TME_COLORS.primary }}
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-3 py-2 rounded-lg border-2 transition-all duration-200 h-[42px] ${
          error ? 'border-red-500' : 'border-gray-200'
        } focus:outline-none focus:border-[#243F7B] ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
        style={{ fontFamily: 'Inter, sans-serif' }}
      />
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
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
          <span className="block text-sm font-medium mb-1 invisible select-none" aria-hidden="true">
            .
          </span>
          {showInfo ? (
            <div
              className="relative rounded-lg text-sm p-3 pr-9"
              style={{ backgroundColor: '#EBF4FF', color: TME_COLORS.primary }}
            >
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                className="absolute top-2.5 right-2.5 hover:opacity-70 transition-opacity"
                aria-label="Hide salary breakdown info"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{SALARY_BREAKDOWN_EXPLANATION}</span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowInfo(true)}
              className="flex items-center gap-2 text-sm hover:underline h-[42px]"
              style={{ color: TME_COLORS.primary }}
            >
              <Info className="w-4 h-4" />
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
              <span
                className="text-sm font-medium"
                style={{ color: TME_COLORS.primary }}
              >
                Other ({getPercentage(other)})
              </span>
              {(other ?? 0) > 0 && (
                <span className="text-xs text-gray-500">
                  {currency} {formatNumber(other)}
                </span>
              )}
            </div>

            {/* 4-column grid mirroring the Basic/Accommodation/Transport/Food
                row above: the allowance type spans the first 3 columns and the
                amount occupies the 4th, so it lines up exactly under Food. */}
            {visibleBreakdownRows.map((entry, index) => (
              <div key={index} className="grid grid-cols-4 gap-4 items-center">
                <div className="col-span-3">
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
                    />
                  </div>
                  {visibleBreakdownRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveBreakdownRow(index)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
                      title="Remove allowance"
                      aria-label="Remove allowance"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddBreakdownRow}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ backgroundColor: `${TME_COLORS.primary}10`, color: TME_COLORS.primary }}
            >
              <Plus className="w-3.5 h-3.5" />
              Add allowance
            </button>
          </div>

          {/* Row 3: Provided flags — Accommodation | Transport | Food | (empty).
              Labels are split into two lines (word / "Provided *") so all
              three line up consistently with breathing room between
              columns, instead of either bunching together (whitespace-nowrap)
              or wrapping unevenly (the longer labels wrap, "Food Provided"
              stays on one line). */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-1 leading-tight"
                style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
              >
                <span className="block">Accommodation</span>
                <span className="block">Provided<span className="text-red-500 ml-1">*</span></span>
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
                className="block text-sm font-medium mb-1 leading-tight"
                style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
              >
                <span className="block">Transportation</span>
                <span className="block">Provided<span className="text-red-500 ml-1">*</span></span>
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
                className="block text-sm font-medium mb-1 leading-tight"
                style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
              >
                <span className="block">Food</span>
                <span className="block">Provided<span className="text-red-500 ml-1">*</span></span>
              </label>
              <CustomDropdown
                value={foodProvided}
                onChange={(val) => handleProvidedChange('food_provided', val as ProvidedFlag)}
                options={PROVIDED_OPTIONS}
                placeholder="Select…"
                error={errors?.foodProvided}
              />
            </div>
            <div aria-hidden="true" />
          </div>

          {/* Monthly Total — normally the sum of every component above. Styled
              as a total, but editable: the employer can type a different figure
              for flexibility. Doing so leaves the breakdown untouched and shows
              the mismatch warning below. */}
          <div>
            <div
              className="flex items-center justify-between px-4 py-2.5 rounded-lg border-2"
              style={{
                borderColor: TME_COLORS.primary,
                backgroundColor: `${TME_COLORS.primary}0D`,
              }}
            >
              <span
                className="text-sm font-medium"
                style={{ color: TME_COLORS.primary }}
              >
                Monthly Salary (Total)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-lg font-semibold"
                  style={{ color: TME_COLORS.primary }}
                >
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
                  className="w-32 bg-transparent text-right text-lg font-semibold focus:outline-none"
                  style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
                />
              </div>
            </div>

            {hasDiscrepancy && (
              <div className="mt-2 flex items-start gap-2 px-1 text-sm text-amber-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
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
