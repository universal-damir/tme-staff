'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { TME_COLORS, SALARY_BREAKDOWN_EXPLANATION, DEFAULT_SALARY_BREAKDOWN } from '@/lib/constants';
import { CustomDropdown } from '@/components/ui';
import { ChevronDown, ChevronUp, Info, AlertTriangle } from 'lucide-react';

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
  onChange: (values: {
    salary_currency: string;
    salary_total: number | undefined;
    salary_basic: number | undefined;
    salary_accommodation: number | undefined;
    salary_transport: number | undefined;
    salary_food?: number | undefined;
    salary_other?: number | undefined;
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
}

function SalaryInput({ label, value, onChange, error, placeholder, required }: SalaryInputProps) {
  const [displayValue, setDisplayValue] = useState(formatNumber(value));

  // Sync display value when external value changes
  useEffect(() => {
    setDisplayValue(formatNumber(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        className={`w-full px-3 py-2 rounded-lg border-2 transition-all duration-200 h-[42px] ${
          error ? 'border-red-500' : 'border-gray-200'
        } focus:outline-none focus:border-[#243F7B]`}
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
  onChange,
  errors,
}: SalaryBreakdownProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // Calculate sum and discrepancy
  const sum = (basic || 0) + (accommodation || 0) + (transport || 0) + (food || 0) + (other || 0);
  const hasDiscrepancy = total !== undefined && total > 0 && Math.abs(sum - total) > 0.01;

  // Auto-expand if there's a discrepancy
  useEffect(() => {
    if (hasDiscrepancy) {
      setIsExpanded(true);
    }
  }, [hasDiscrepancy]);

  // Auto-calculate breakdown when total changes
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

      // Calculate breakdown using default percentages
      const newBasic = Math.round(newTotal * DEFAULT_SALARY_BREAKDOWN.basic * 100) / 100;
      const newAccommodation = Math.round(newTotal * DEFAULT_SALARY_BREAKDOWN.accommodation * 100) / 100;
      const newTransport = Math.round(newTotal * DEFAULT_SALARY_BREAKDOWN.transport * 100) / 100;
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
    [currency, onChange]
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

  const getPercentage = (value: number | undefined) => {
    if (!total || !value) return '0%';
    return `${Math.round((value / total) * 100)}%`;
  };

  return (
    <div className="space-y-4">
      {/* Currency and Total */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        <div className="md:col-span-2">
          <SalaryInput
            label="Monthly Salary (Total)"
            value={total}
            onChange={handleTotalChange}
            placeholder="Enter total monthly salary"
            error={errors?.total}
            required
          />
        </div>
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

      {/* Breakdown Fields */}
      {isExpanded && (
        <div className="space-y-4 pt-2 border-t border-gray-200">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <SalaryInput
              label={`Basic (${getPercentage(basic)})`}
              value={basic}
              onChange={(val) =>
                onChange({
                  salary_currency: currency,
                  salary_total: total,
                  salary_basic: val,
                  salary_accommodation: accommodation,
                  salary_transport: transport,
                  salary_food: food,
                  salary_other: other,
                })
              }
              error={errors?.basic}
            />

            <SalaryInput
              label={`Accom. (${getPercentage(accommodation)})`}
              value={accommodation}
              onChange={(val) =>
                onChange({
                  salary_currency: currency,
                  salary_total: total,
                  salary_basic: basic,
                  salary_accommodation: val,
                  salary_transport: transport,
                  salary_food: food,
                  salary_other: other,
                })
              }
              error={errors?.accommodation}
            />

            <SalaryInput
              label={`Transport (${getPercentage(transport)})`}
              value={transport}
              onChange={(val) =>
                onChange({
                  salary_currency: currency,
                  salary_total: total,
                  salary_basic: basic,
                  salary_accommodation: accommodation,
                  salary_transport: val,
                  salary_food: food,
                  salary_other: other,
                })
              }
              error={errors?.transport}
            />

            <SalaryInput
              label={`Food (${getPercentage(food)})`}
              value={food}
              onChange={(val) =>
                onChange({
                  salary_currency: currency,
                  salary_total: total,
                  salary_basic: basic,
                  salary_accommodation: accommodation,
                  salary_transport: transport,
                  salary_food: val,
                  salary_other: other,
                })
              }
            />

            <SalaryInput
              label={`Other (${getPercentage(other)})`}
              value={other}
              onChange={(val) =>
                onChange({
                  salary_currency: currency,
                  salary_total: total,
                  salary_basic: basic,
                  salary_accommodation: accommodation,
                  salary_transport: transport,
                  salary_food: food,
                  salary_other: val,
                })
              }
            />
          </div>

          {/* Discrepancy Warning */}
          {hasDiscrepancy && (
            <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                <span className="text-sm">
                  Sum ({currency} {formatNumber(sum)}) does not match total ({currency} {formatNumber(total)})
                </span>
              </div>
              <button
                type="button"
                onClick={handleSetTotalFromSum}
                className="px-3 py-1 text-sm font-medium text-white rounded"
                style={{ backgroundColor: TME_COLORS.primary }}
              >
                Set Total to {currency} {formatNumber(sum)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
