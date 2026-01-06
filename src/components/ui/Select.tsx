'use client';

import React, { forwardRef, useMemo } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { ChevronDown } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  helperText?: string;
  options: readonly (string | SelectOption)[];
  placeholder?: string;
  sortAlphabetically?: boolean; // Default true - sorts options A-Z
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, options, placeholder = 'Select...', sortAlphabetically = true, className = '', ...props }, ref) => {
    // Sort options alphabetically (keeping "Other" at the end)
    const sortedOptions = useMemo(() => {
      if (!sortAlphabetically) return options;

      return [...options].sort((a, b) => {
        const labelA = typeof a === 'string' ? a : a.label;
        const labelB = typeof b === 'string' ? b : b.label;

        // Keep "Other" at the end
        if (labelA === 'Other') return 1;
        if (labelB === 'Other') return -1;

        return labelA.localeCompare(labelB);
      });
    }, [options, sortAlphabetically]);

    return (
      <div className="w-full">
        {label && (
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: TME_COLORS.primary }}
          >
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            className={`w-full px-3 py-2 rounded-lg border-2 transition-all duration-200 h-[42px] appearance-none bg-white ${
              error ? 'border-red-500' : 'border-gray-200'
            } focus:outline-none pr-10 ${className}`}
            style={{ fontFamily: 'Inter, sans-serif' }}
            onFocus={(e) => {
              if (!error) {
                e.target.style.borderColor = TME_COLORS.primary;
              }
            }}
            onBlur={(e) => {
              if (!error) {
                e.target.style.borderColor = '#e5e7eb';
              }
            }}
            {...props}
          >
            <option value="">{placeholder}</option>
            {sortedOptions.map((option) => {
              const value = typeof option === 'string' ? option : option.value;
              const optionLabel = typeof option === 'string' ? option : option.label;
              return (
                <option key={value} value={value}>
                  {optionLabel}
                </option>
              );
            })}
          </select>
          <ChevronDown
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
          />
        </div>
        {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        {helperText && !error && (
          <p className="mt-1 text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
