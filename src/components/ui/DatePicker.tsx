'use client';

import React, { forwardRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Calendar } from 'lucide-react';

interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
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
          <input
            ref={ref}
            type="date"
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
            {...props}
          />
          <Calendar
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

DatePicker.displayName = 'DatePicker';
