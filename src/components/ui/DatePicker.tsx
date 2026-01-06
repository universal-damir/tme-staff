'use client';

import React, { forwardRef, useState, useEffect, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Calendar } from 'lucide-react';

interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string;
  error?: string;
  helperText?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Convert ISO (YYYY-MM-DD) to display format (dd.mm.yyyy)
const formatDateForDisplay = (isoDate: string | undefined): string => {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
};

// Convert display format (dd.mm.yyyy) to ISO (YYYY-MM-DD)
const parseDisplayDate = (displayDate: string): string => {
  if (!displayDate) return '';
  const parts = displayDate.split('.');
  if (parts.length !== 3) return displayDate;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
};

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ label, error, helperText, className = '', value, defaultValue, onChange, ...props }, ref) => {
    const hiddenInputRef = useRef<HTMLInputElement>(null);
    const [displayValue, setDisplayValue] = useState(() => {
      const initial = (value as string) || (defaultValue as string) || '';
      return formatDateForDisplay(initial);
    });

    // Sync display value when external value changes
    useEffect(() => {
      if (value !== undefined) {
        setDisplayValue(formatDateForDisplay(value as string));
      }
    }, [value]);

    const handleDisplayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let input = e.target.value;

      // Auto-format as user types
      const digits = input.replace(/\D/g, '');
      if (digits.length <= 2) {
        input = digits;
      } else if (digits.length <= 4) {
        input = `${digits.slice(0, 2)}.${digits.slice(2)}`;
      } else {
        input = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 8)}`;
      }

      setDisplayValue(input);

      // If we have a complete date, convert and call onChange
      if (digits.length === 8) {
        const isoDate = parseDisplayDate(input);
        if (onChange && hiddenInputRef.current) {
          hiddenInputRef.current.value = isoDate;
          const syntheticEvent = {
            target: hiddenInputRef.current,
            currentTarget: hiddenInputRef.current,
          } as React.ChangeEvent<HTMLInputElement>;
          onChange(syntheticEvent);
        }
      }
    };

    const handleCalendarClick = () => {
      // Create a temporary date input to use native picker
      const tempInput = document.createElement('input');
      tempInput.type = 'date';
      tempInput.style.position = 'absolute';
      tempInput.style.opacity = '0';
      tempInput.style.pointerEvents = 'none';
      tempInput.value = parseDisplayDate(displayValue) || '';
      document.body.appendChild(tempInput);

      tempInput.addEventListener('change', () => {
        const newValue = tempInput.value;
        setDisplayValue(formatDateForDisplay(newValue));
        if (onChange && hiddenInputRef.current) {
          hiddenInputRef.current.value = newValue;
          const syntheticEvent = {
            target: hiddenInputRef.current,
            currentTarget: hiddenInputRef.current,
          } as React.ChangeEvent<HTMLInputElement>;
          onChange(syntheticEvent);
        }
        document.body.removeChild(tempInput);
      });

      tempInput.showPicker?.();
    };

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
        {/* Hidden input for form submission with ISO format */}
        <input
          ref={(node) => {
            // Handle both refs
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
            (hiddenInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          type="hidden"
          value={parseDisplayDate(displayValue)}
          {...props}
        />
        <div className="relative">
          <input
            type="text"
            value={displayValue}
            onChange={handleDisplayChange}
            placeholder="dd.mm.yyyy"
            maxLength={10}
            className={`w-full px-3 py-2 rounded-lg border-2 transition-all duration-200 h-[42px] ${
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
          />
          <button
            type="button"
            onClick={handleCalendarClick}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <Calendar className="w-5 h-5" />
          </button>
        </div>
        {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        {helperText && !error && (
          <p className="mt-1 text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    );
  }
);

DatePicker.displayName = 'DatePicker';
