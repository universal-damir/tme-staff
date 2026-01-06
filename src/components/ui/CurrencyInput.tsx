'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TME_COLORS, INPUT_HEIGHT } from '@/lib/constants';

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
}: CurrencyInputProps) {
  // Set default placeholder based on decimals
  const defaultPlaceholder = placeholder || (decimals === 0 ? '0' : '0.00');
  const [displayValue, setDisplayValue] = useState('');
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

  const handleFocus = () => {
    setIsFocused(true);
    // Show raw number without formatting during editing
    const numValue = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
    setDisplayValue(numValue === 0 || isNaN(numValue) ? '' : String(numValue));
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

    setDisplayValue(inputValue);
  };

  return (
    <div>
      <label
        className="block text-sm font-medium mb-1"
        style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
      >
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <div className="relative">
        <motion.input
          type="text"
          inputMode={decimals === 0 ? "numeric" : "decimal"}
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
          placeholder={defaultPlaceholder}
          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 text-sm"
          style={{
            height: INPUT_HEIGHT,
            fontFamily: 'Inter, sans-serif',
            paddingRight: currency ? '4rem' : '0.75rem',
            backgroundColor: disabled ? '#f9fafb' : 'white',
            color: disabled ? '#9ca3af' : 'inherit',
          }}
          onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
            handleFocus();
            e.target.style.borderColor = TME_COLORS.primary;
          }}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            handleBlur(e);
            e.target.style.borderColor = error ? '#ef4444' : '#e5e7eb';
          }}
          whileFocus={{ scale: 1.01 }}
        />

        {/* Currency Label */}
        {currency && (
          <div
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm font-medium text-gray-500 pointer-events-none"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            {currency}
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
          {error}
        </p>
      )}
    </div>
  );
}
