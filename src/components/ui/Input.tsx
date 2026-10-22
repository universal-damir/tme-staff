'use client';

import React, { forwardRef, useId } from 'react';
import { FieldError, FieldHelp } from './FormBits';
import { AutoGrowText, type AutoGrowKind } from './AutoGrowText';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  /** Keep a plain one-line <input> (no growing). Only for values that are short by nature. */
  singleLine?: boolean;
}

/**
 * The TME text field look, for a field that may grow (min-h, not h): phone 46px, 16px text,
 * 2px grey border; desktop (>=640px) 40px, 1px gray-300 border, radius 8px, focus ring. Text
 * drops to 14px only from md (768px): below that iOS zooms on inputs under 16px.
 * Paddings are set so one line sits exactly at 46 / 40 / 40px (line-height 24 / 24 / 20).
 */
export function textFieldClasses(error?: boolean, extra = ''): string {
  return `w-full min-h-[46px] px-3.5 py-[9px] rounded-[10px] border-2 bg-white text-base leading-6 text-gray-900 placeholder:text-gray-500 transition-[color,border-color,box-shadow] duration-200 focus:outline-none disabled:bg-gray-50 disabled:text-gray-600 read-only:cursor-default sm:min-h-10 sm:px-3 sm:py-[7px] sm:rounded-lg sm:border md:text-sm md:leading-5 md:py-[9px] sm:focus:ring-[3px] ${
    error
      ? 'border-tme-red focus:border-tme-red sm:focus:ring-tme-red/15'
      : 'border-gray-200 sm:border-gray-300 focus:border-tme-blue sm:focus:border-tme-blue sm:focus:ring-tme-blue/15'
  } ${extra}`;
}

const GROW_TYPES = new Set<string>(['text', 'email', 'search', 'url']);
const NUMERIC_MODES = new Set<string>(['numeric', 'decimal', 'tel']);

/**
 * Text input (TME look, 22.10.2026). Text-like fields (text/email/search/url without a
 * numeric keyboard or pattern) render the auto-growing AutoGrowText, so a long value wraps
 * to more lines instead of being cut (Damir 22.10). Other types stay a plain 46/40px <input>.
 * TME blue border on focus, red border + FieldError on error.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', id, singleLine, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const msgId = `${inputId}-msg`;
    const type = props.type ?? 'text';
    const grow =
      !singleLine && GROW_TYPES.has(type) && !props.pattern && !props.list && !NUMERIC_MODES.has(String(props.inputMode ?? ''));
    const describedBy = [ariaDescribedBy, error || helperText ? msgId : undefined].filter(Boolean).join(' ') || undefined;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
            {label}
            {props.required && (
              <span className="text-tme-red ml-1" aria-hidden>
                *
              </span>
            )}
          </label>
        )}
        {grow ? (
          (() => {
            // Input-only attributes have no meaning on a textarea; the rest passes through.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { type: _t, size: _s, min: _min, max: _max, step: _step, multiple: _m, accept: _a, capture: _c, ...rest } = props;
            return (
              <AutoGrowText
                {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
                kind={type as AutoGrowKind}
                ref={ref as unknown as React.Ref<HTMLTextAreaElement>}
                id={inputId}
                aria-invalid={error ? true : ariaInvalid}
                aria-describedby={describedBy}
                className={textFieldClasses(!!error, className)}
              />
            );
          })()
        ) : (
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : ariaInvalid}
            aria-describedby={describedBy}
            className={`w-full h-[46px] px-3.5 rounded-[10px] border-2 bg-white text-base text-gray-900 placeholder:text-gray-500 transition-[color,border-color,box-shadow] duration-200 focus:outline-none disabled:bg-gray-50 disabled:text-gray-600 sm:h-10 sm:px-3 sm:rounded-lg sm:border md:text-sm sm:focus:ring-[3px] ${
              error
                ? 'border-tme-red focus:border-tme-red sm:focus:ring-tme-red/15'
                : 'border-gray-200 sm:border-gray-300 focus:border-tme-blue sm:focus:border-tme-blue sm:focus:ring-tme-blue/15'
            } ${className}`}
            {...props}
          />
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
