'use client';

import React, { useState, useEffect, useId } from 'react';
import { FieldError } from './FormBits';

interface CurrencyInputProps {
  label: string;
  value: number | string;
  onChange: (value: number) => void;
  currency?: string; // Optional currency label (e.g., "AED", "USD")
  placeholder?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  decimals?: number; // Number of decimal places (default: 2)
  /**
   * Opt-in upper bound. When set, a value above it is clamped down on blur so
   * the field can never hold a number the server would reject. Off by default
   * — existing call sites keep their unbounded behaviour.
   */
  max?: number;
}

/**
 * CurrencyInput - Number input with thousand separator formatting
 *
 * Features:
 * - Formats numbers with comma thousand separators (e.g., 1,000,000.00)
 * - Auto-formats on blur
 * - Allows raw number input during typing
 * - Optional currency display
 * - TME design standards
 *
 * @example
 * <CurrencyInput
 *   label="Share Capital"
 *   value={shareCapital}
 *   onChange={setShareCapital}
 *   currency="AED"
 *   decimals={2}
 * />
 */
export default function CurrencyInput({
  label,
  value,
  onChange,
  currency,
  placeholder,
  required = false,
  error,
  disabled = false,
  decimals = 2,
  max,
}: CurrencyInputProps) {
  // Set default placeholder based on decimals
  const defaultPlaceholder = placeholder || (decimals === 0 ? '0' : '0.00');
  const [displayValue, setDisplayValue] = useState('');
  const fieldId = useId();
  const [isFocused, setIsFocused] = useState(false);

  // Format number with thousand separators
  const formatNumber = (num: number | string): string => {
    if (num === '' || num === null || num === undefined) return '';

    const numValue = typeof num === 'string' ? parseFloat(num.replace(/,/g, '')) : num;
    if (isNaN(numValue)) return '';

    return numValue.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  // Update display value when prop value changes
  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatNumber(value));
    }
  }, [value, isFocused, decimals]);

  /**
   * Thousand separators WHILE typing. Dropping them during editing meant a
   * salary read "10000" the whole time it was being entered and only became
   * "10,000" after clicking away — the one moment the number is hard to read
   * is the moment it was shown unformatted.
   */
  const formatWhileTyping = (raw: string): string => {
    const cleaned = raw.replace(/,/g, '');
    if (cleaned === '') return '';
    const [intPart, ...rest] = cleaned.split('.');
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    // A trailing "." the user just typed is preserved, so "1000." keeps its dot.
    if (decimals === 0 || rest.length === 0) return grouped;
    return `${grouped}.${rest.join('').slice(0, decimals)}`;
  };

  const handleFocus = () => {
    setIsFocused(true);
    const numValue = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
    setDisplayValue(numValue === 0 || isNaN(numValue) ? '' : formatWhileTyping(String(numValue)));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    const rawValue = e.target.value.replace(/,/g, '');
    let numValue = parseFloat(rawValue);

    if (!isNaN(numValue)) {
      // Round to integer if decimals is 0
      if (decimals === 0) {
        numValue = Math.round(numValue);
      }
      if (typeof max === 'number' && numValue > max) {
        numValue = max;
      }
      onChange(numValue);
      setDisplayValue(formatNumber(numValue));
    } else {
      onChange(0);
      setDisplayValue('');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // Allow only numbers and commas (no decimals if decimals === 0)
    const regex = decimals === 0 ? /^[\d,]*$/ : /^[\d.,]*$/;
    if (!regex.test(inputValue)) return;

    setDisplayValue(formatWhileTyping(inputValue));
  };

  return (
    <div>
      <label htmlFor={fieldId} className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
        {label}
        {required && (
          <span className="text-tme-red ml-1" aria-hidden>
            *
          </span>
        )}
      </label>

      <div className="relative">
        <input
          id={fieldId}
          type="text"
          inputMode={decimals === 0 ? "numeric" : "decimal"}
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
          placeholder={defaultPlaceholder}
          aria-invalid={error ? true : undefined}
          className={`w-full h-[46px] pl-3.5 rounded-[10px] border-2 text-base transition-[color,border-color,box-shadow] duration-200 focus:outline-none placeholder:text-gray-500 sm:h-10 sm:pl-3 sm:rounded-lg sm:border md:text-sm sm:focus:ring-[3px] ${
            currency ? 'pr-16' : 'pr-3.5 sm:pr-3'
          } ${error ? 'border-tme-red focus:border-tme-red sm:focus:ring-tme-red/15' : 'border-gray-200 sm:border-gray-300 focus:border-tme-blue sm:focus:border-tme-blue sm:focus:ring-tme-blue/15'} ${
            disabled ? 'bg-gray-50 text-gray-600' : 'bg-white text-gray-900'
          }`}
          onFocus={() => handleFocus()}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => handleBlur(e)}
        />

        {/* Currency Label */}
        {currency && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-gray-600 sm:right-3 sm:text-[13px] sm:font-medium pointer-events-none">
            {currency}
          </div>
        )}
      </div>

      {/* Error Message */}
      <FieldError>{error}</FieldError>
    </div>
  );
}
