'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  TME_COLORS,
  SALARY_BREAKDOWN_EXPLANATION,
  DEFAULT_SALARY_BREAKDOWN,
  PAYROLL_OTHER_TYPE_OPTIONS,
  type PayrollOtherType,
  type PayrollOtherBreakdownEntry,
} from '@/lib/constants';
import { CustomDropdown } from '@/components/ui';
import { ChevronDown, ChevronUp, Info, AlertTriangle, Plus, X } from 'lucide-react';

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

// Helper functions for number formatting
const formatNumber = (value: number | undefined | null): string => {
  if (value === undefined || value === null || isNaN(value)) return '';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

const parseFormattedNumber = (value: string): number | undefined => {
  if (!value || value.trim() === '') return undefined;
  // Remove commas and parse
  const cleaned = value.replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? undefined : parsed;
};

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
  /** Recoverable advance shown below the breakdown. NOT part of salary_total. */
  variableAdvance?: number;
  accommodationProvided: ProvidedFlag;
  transportProvided: ProvidedFlag;
  foodProvided: ProvidedFlag;
  onChange: (values: {
    salary_currency: string;
    salary_total: number | undefined;
    salary_basic: number | undefined;
    salary_accommodation: number | undefined;
    salary_transport: number | undefined;
    salary_food?: number | undefined;
    salary_other?: number | undefined;
    salary_other_breakdown?: PayrollOtherBreakdownEntry[];
    salary_variable_advance?: number | undefined;
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
  const [displayValue, setDisplayValue] = useState(formatNumber(value));

  // Sync display value when external value changes
  useEffect(() => {
    setDisplayValue(formatNumber(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const inputValue = e.target.value;
    // Remove all non-numeric except decimal
    const cleaned = inputValue.replace(/[^0-9.]/g, '');

    // Parse and format with commas
    const parsed = parseFormattedNumber(cleaned);
    onChange(parsed);

    // Show formatted value immediately
    if (parsed !== undefined) {
      setDisplayValue(formatNumber(parsed));
    } else {
      setDisplayValue('');
    }
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
  variableAdvance,
  accommodationProvided,
  transportProvided,
  foodProvided,
  onChange,
  errors,
}: SalaryBreakdownProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showInfo, setShowInfo] = useState(true);

  const breakdownRows: PayrollOtherBreakdownEntry[] = otherBreakdown ?? [];
  const hasBreakdownRows = breakdownRows.length > 0;
  // When entries exist, "Other" is locked to the sum so the editor is the
  // single source of truth — matches tme-portal payroll behaviour.
  const otherIsLocked = hasBreakdownRows;

  // Calculate sum and discrepancy
  const sum = (basic || 0) + (accommodation || 0) + (transport || 0) + (food || 0) + (other || 0);
  const hasDiscrepancy = total !== undefined && total > 0 && Math.abs(sum - total) > 0.01;

  // Auto-expand if there's a discrepancy
  useEffect(() => {
    if (hasDiscrepancy) {
      setIsExpanded(true);
    }
  }, [hasDiscrepancy]);

  // Auto-calculate breakdown when total changes. Only allocate to fields whose
  // provided flag is 'allowance'; the rest are forced to 0 (their flag means
  // either company-provided in-kind, or not provided at all).
  const handleTotalChange = useCallback(
    (newTotal: number | undefined) => {
      if (newTotal === undefined || isNaN(newTotal)) {
        onChange({
          salary_currency: currency,
          salary_total: undefined,
          salary_basic: undefined,
          salary_accommodation: undefined,
          salary_transport: undefined,
          salary_food: undefined,
          salary_other: undefined,
        });
        return;
      }

      const accomPct = accommodationProvided === 'allowance' ? DEFAULT_SALARY_BREAKDOWN.accommodation : 0;
      const transportPct = transportProvided === 'allowance' ? DEFAULT_SALARY_BREAKDOWN.transport : 0;
      // Basic absorbs whatever is not allocated to accommodation/transport.
      const basicPct = 1 - accomPct - transportPct;

      const newAccommodation = Math.round(newTotal * accomPct * 100) / 100;
      const newTransport = Math.round(newTotal * transportPct * 100) / 100;
      const newBasic = Math.round(newTotal * basicPct * 100) / 100;
      const newFood = 0;
      const newOther = 0;

      // Adjust for rounding
      const calculatedSum = newBasic + newAccommodation + newTransport + newFood + newOther;
      const adjustedBasic = Math.round((newBasic + (newTotal - calculatedSum)) * 100) / 100;

      onChange({
        salary_currency: currency,
        salary_total: newTotal,
        salary_basic: adjustedBasic,
        salary_accommodation: newAccommodation,
        salary_transport: newTransport,
        salary_food: newFood,
        salary_other: newOther,
      });
    },
    [currency, onChange, accommodationProvided, transportProvided]
  );

  // Set total from sum
  const handleSetTotalFromSum = () => {
    onChange({
      salary_currency: currency,
      salary_total: Math.round(sum * 100) / 100,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: other,
    });
  };

  // Centralised handler for any breakdown amount change. After the field is
  // updated, total is recalculated as the sum of all amounts so the user
  // doesn't have to manually click "Set Total" — it tracks the breakdown.
  type BreakdownKey =
    | 'salary_basic'
    | 'salary_accommodation'
    | 'salary_transport'
    | 'salary_food'
    | 'salary_other';
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
    onChange({
      salary_currency: currency,
      salary_total: Math.round(newTotal * 100) / 100,
      ...nextValues,
    });
  };

  // When a provided flag flips to 'yes' or 'no', force the corresponding
  // amount to 0 so the breakdown stays self-consistent.
  const handleProvidedChange = (
    field: 'accommodation_provided' | 'transport_provided' | 'food_provided',
    val: ProvidedFlag,
  ) => {
    const zeroPatch: Partial<{
      salary_accommodation: number;
      salary_transport: number;
      salary_food: number;
    }> = {};
    if (val !== 'allowance') {
      if (field === 'accommodation_provided') zeroPatch.salary_accommodation = 0;
      if (field === 'transport_provided') zeroPatch.salary_transport = 0;
      if (field === 'food_provided') zeroPatch.salary_food = 0;
    }
    onChange({
      salary_currency: currency,
      salary_total: total,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: other,
      [field]: val,
      ...zeroPatch,
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
      salary_total: Math.round(newTotal * 100) / 100,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: sumOther,
      salary_other_breakdown: nextBreakdown,
    });
  };

  const handleAddBreakdownRow = () => {
    emitBreakdownUpdate([...breakdownRows, { type: 'other', amount: 0 }]);
  };

  const handleRemoveBreakdownRow = (index: number) => {
    emitBreakdownUpdate(breakdownRows.filter((_, i) => i !== index));
  };

  const handleBreakdownRowTypeChange = (index: number, value: PayrollOtherType) => {
    emitBreakdownUpdate(
      breakdownRows.map((e, i) => (i === index ? { ...e, type: value } : e)),
    );
  };

  const handleBreakdownRowAmountChange = (index: number, value: number | undefined) => {
    emitBreakdownUpdate(
      breakdownRows.map((e, i) => (i === index ? { ...e, amount: value ?? 0 } : e)),
    );
  };

  const handleVariableAdvanceChange = (value: number | undefined) => {
    onChange({
      salary_currency: currency,
      salary_total: total,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: other,
      salary_other_breakdown: otherBreakdown,
      salary_variable_advance: value,
    });
  };

  const getPercentage = (value: number | undefined) => {
    if (!total || !value) return '0%';
    return `${Math.round((value / total) * 100)}%`;
  };

  return (
    <div className="space-y-4">
      {/* Currency and Total */}
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4">
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

        <SalaryInput
          label="Monthly Salary (Total)"
          value={total}
          onChange={handleTotalChange}
          placeholder="Enter total monthly salary"
          error={errors?.total}
          required
        />
      </div>

      {/* Info Toggle */}
      <button
        type="button"
        onClick={() => setShowInfo(!showInfo)}
        className="flex items-center gap-2 text-sm hover:underline"
        style={{ color: TME_COLORS.primary }}
      >
        <Info className="w-4 h-4" />
        {showInfo ? 'Hide salary breakdown info' : 'About salary breakdown'}
      </button>

      {showInfo && (
        <div
          className="p-4 rounded-lg text-sm"
          style={{ backgroundColor: '#EBF4FF', color: TME_COLORS.primary }}
        >
          {SALARY_BREAKDOWN_EXPLANATION}
        </div>
      )}

      {/* Breakdown Toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm font-medium"
        style={{ color: TME_COLORS.primary }}
      >
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {isExpanded ? 'Hide breakdown' : 'Show breakdown'}
        {hasDiscrepancy && (
          <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Mismatch
          </span>
        )}
      </button>

      {/* Breakdown Fields. 4-column grid throughout: amounts in row 1
          (Basic/Accommodation/Transport/Food) and row 2 (Other + empty
          cells), then Provided flags in row 3 (with empty 4th cell) so
          the layout matches the portal's renewal preview. Amounts whose
          flag is not 'allowance' are disabled and force-zeroed. */}
      {isExpanded && (
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
              value={accommodationProvided === 'allowance' ? accommodation : 0}
              onChange={(val) => handleAmountChange('salary_accommodation', val)}
              error={errors?.accommodation}
              disabled={accommodationProvided !== 'allowance'}
            />
            <SalaryInput
              label={`Transport (${getPercentage(transport)})`}
              value={transportProvided === 'allowance' ? transport : 0}
              onChange={(val) => handleAmountChange('salary_transport', val)}
              error={errors?.transport}
              disabled={transportProvided !== 'allowance'}
            />
            <SalaryInput
              label={`Food (${getPercentage(food)})`}
              value={foodProvided === 'allowance' ? food : 0}
              onChange={(val) => handleAmountChange('salary_food', val)}
              disabled={foodProvided !== 'allowance'}
            />
          </div>

          {/* Row 2: Other | (empty) | (empty) | (empty) */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
            <SalaryInput
              label={`Other (${getPercentage(other)})`}
              value={other}
              onChange={(val) => handleAmountChange('salary_other', val)}
              disabled={otherIsLocked}
            />
            <div aria-hidden="true" />
            <div aria-hidden="true" />
            <div aria-hidden="true" />
          </div>

          {/* Typed "Other" allowance breakdown editor. Whenever the user adds
              entries, the plain "Other" field above is locked and reflects the
              sum so the editor remains the single source of truth. */}
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <span
                className="text-sm font-medium"
                style={{ color: TME_COLORS.primary }}
              >
                Other Breakdown
              </span>
              {otherIsLocked && (
                <span className="text-xs text-gray-500 italic">
                  Other field locked — sum of entries below
                </span>
              )}
            </div>

            {breakdownRows.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <CustomDropdown
                    value={entry.type}
                    onChange={(v) => handleBreakdownRowTypeChange(index, v as PayrollOtherType)}
                    options={PAYROLL_OTHER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                </div>
                <div className="w-40">
                  <SalaryInput
                    value={entry.amount}
                    onChange={(val) => handleBreakdownRowAmountChange(index, val)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveBreakdownRow(index)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Remove allowance"
                  aria-label="Remove allowance"
                >
                  <X className="w-4 h-4" />
                </button>
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

            <div className="pt-3 border-t border-gray-100">
              <SalaryInput
                label="Variable salary advance"
                value={variableAdvance}
                onChange={handleVariableAdvanceChange}
              />
              <p className="mt-1 text-xs italic text-gray-500">
                Recoverable advance, not part of monthly allowances.
              </p>
            </div>
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
              />
            </div>
            <div aria-hidden="true" />
          </div>

          {/* Discrepancy Warning */}
          {hasDiscrepancy && (() => {
            const difference = sum - (total || 0);
            return (
              <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <span className="text-sm">
                      Sum ({currency} {formatNumber(sum)}) does not match total ({currency} {formatNumber(total)})
                    </span>
                    <span className="block text-xs mt-0.5 font-medium">
                      Difference: {currency} {difference > 0 ? '+' : ''}{formatNumber(difference)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSetTotalFromSum}
                  className="px-3 py-1 text-sm font-medium text-white rounded flex-shrink-0"
                  style={{ backgroundColor: TME_COLORS.primary }}
                >
                  Set Total to {currency} {formatNumber(sum)}
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
