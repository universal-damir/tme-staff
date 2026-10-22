'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getCountries,
  getCountryCallingCode,
  Country,
} from 'react-phone-number-input';
import { isValidPhoneNumber, parsePhoneNumber, AsYouType, getExampleNumber, CountryCode } from 'libphonenumber-js';
import examples from 'libphonenumber-js/mobile/examples';

// Get expected phone number length for a country (national number only, excluding country code)
const getExpectedLength = (countryCode: Country): { min: number; max: number } => {
  try {
    const example = getExampleNumber(countryCode as CountryCode, examples);
    if (example) {
      const nationalNumber = example.nationalNumber;
      const len = nationalNumber.length;
      // Allow some variance (±1 digit) for different number types
      return { min: len - 1, max: len + 2 };
    }
  } catch {
    // Fallback
  }
  // Default fallback
  return { min: 7, max: 15 };
};
import en from 'react-phone-number-input/locale/en';
import { FieldError } from './FormBits';
import { ChevronDown, Search } from 'lucide-react';

// Get country name from locale
const getCountryName = (countryCode: Country): string => {
  return en[countryCode] || countryCode;
};

// Get all countries sorted alphabetically by name
const getAllCountries = (): { code: Country; name: string; callingCode: string }[] => {
  const countries = getCountries();
  return countries
    .map((code) => ({
      code,
      name: getCountryName(code),
      callingCode: getCountryCallingCode(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

interface PhoneInputProps {
  label?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  defaultCountry?: Country;
  country?: Country; // Lock to specific country (hides selector)
  required?: boolean;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Optional: id of the number input, and its accessible name / description. */
  inputId?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  /** Red border without printing a message (the caller shows its own). */
  invalid?: boolean;
  /** The English "Valid number" / "Enter at least" lines under the input. Default: shown. */
  showValidation?: boolean;
  searchPlaceholder?: string;
  noOptionsText?: string;
}

/**
 * PhoneInput Component
 *
 * A phone number input with TME-styled country selector dropdown.
 *
 * Props:
 * - country: Lock to a specific country (e.g., 'AE' for UAE). Hides country selector.
 * - defaultCountry: Default country when nothing selected
 *
 * Output:
 * - E.164 format: +971581234567
 */
export function PhoneInput({
  label,
  value,
  onChange,
  defaultCountry = 'AE',
  country: lockedCountry,
  required = false,
  error,
  placeholder,
  disabled = false,
  inputId,
  ariaLabelledBy,
  ariaDescribedBy,
  invalid = false,
  showValidation: validationLines = true,
  searchPlaceholder,
  noOptionsText,
}: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState<Country>(
    lockedCountry || defaultCountry
  );
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const allCountries = getAllCountries();
  const isLocked = !!lockedCountry;

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Respond to defaultCountry prop changes (only if user hasn't entered a number)
  useEffect(() => {
    if (!lockedCountry && defaultCountry && !inputValue) {
      setSelectedCountry(defaultCountry);
    }
  }, [defaultCountry, lockedCountry, inputValue]);

  // Sync input value with external value
  useEffect(() => {
    if (value) {
      try {
        const parsed = parsePhoneNumber(value);
        if (parsed) {
          if (parsed.country) {
            setSelectedCountry(parsed.country);
          }
          // Format national number for display
          const raw = parsed.nationalNumber || '';
          setInputValue(formatNationalNumber(raw, parsed.country || selectedCountry));
        }
      } catch {
        // If parsing fails, just use the value as-is
        setInputValue((prev) => {
          const callingCode = getCountryCallingCode(selectedCountry);
          if (value.startsWith(`+${callingCode}`)) {
            return value.slice(callingCode.length + 1).replace(/\D/g, '');
          }
          return prev;
        });
      }
    } else {
      setInputValue('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Filter countries by search
  const filteredCountries = searchTerm
    ? allCountries.filter(
        (c) =>
          c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.callingCode.includes(searchTerm) ||
          c.code.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : allCountries;

  // Update dropdown position
  const updateDropdownPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      searchInputRef.current?.focus();

      const handleScroll = () => updateDropdownPosition();
      const handleResize = () => updateDropdownPosition();

      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.phone-dropdown-container') && !target.closest('.phone-dropdown-portal')) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Format national number for display using AsYouType
  const formatNationalNumber = (raw: string, country: Country): string => {
    if (!raw) return '';
    try {
      const callingCode = getCountryCallingCode(country);
      const formatter = new AsYouType(country);
      const formatted = formatter.input(`+${callingCode}${raw}`);
      // Strip country code prefix to get formatted national portion
      const prefixPattern = new RegExp(`^\\+${callingCode}\\s*`);
      return formatted.replace(prefixPattern, '');
    } catch {
      return raw;
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');

    // Limit input length based on country
    const expectedLength = getExpectedLength(selectedCountry);
    const maxDigits = expectedLength.max;

    // Don't allow more than max digits
    if (raw.length > maxDigits) {
      return;
    }

    // Format for display
    setInputValue(formatNationalNumber(raw, selectedCountry));

    // Build full E.164 number
    const callingCode = getCountryCallingCode(selectedCountry);
    const fullNumber = raw ? `+${callingCode}${raw}` : '';

    onChange(fullNumber || undefined);
  };

  // Handle country change
  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setIsOpen(false);
    setSearchTerm('');

    // Update the full number with new country code
    if (inputValue) {
      const callingCode = getCountryCallingCode(country);
      onChange(`+${callingCode}${inputValue.replace(/\D/g, '')}`);
    }

    inputRef.current?.focus();
  };

  // Validation
  const fullValue = value || '';
  const expectedLength = getExpectedLength(selectedCountry);
  const currentLength = inputValue.replace(/\D/g, '').length;

  // Determine validation state
  let validationState: 'none' | 'too_short' | 'valid' | 'invalid' = 'none';

  if (currentLength > 0) {
    if (currentLength < expectedLength.min) {
      validationState = 'too_short';
    } else if (isValidPhoneNumber(fullValue)) {
      validationState = 'valid';
    } else {
      // Has enough digits but still not valid according to libphonenumber
      validationState = 'invalid';
    }
  }

  const showValidation = validationLines && currentLength > 0;

  // Get current country info
  const currentCountry = allCountries.find((c) => c.code === selectedCountry);

  return (
    <div className="w-full phone-dropdown-container" ref={containerRef}>
      {label && (
        <label htmlFor={inputId} className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
          {label}
          {required && (
            <span className="text-tme-red ml-1" aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      <div
        className={`flex items-center h-[46px] rounded-[10px] border-2 bg-white transition-[color,border-color,box-shadow] duration-200 overflow-hidden sm:h-10 sm:rounded-lg sm:border sm:focus-within:ring-[3px] ${
          error || invalid ? 'border-tme-red sm:focus-within:ring-tme-red/15' : 'border-gray-200 sm:border-gray-300 focus-within:border-tme-blue sm:focus-within:border-tme-blue sm:focus-within:ring-tme-blue/15'
        }`}
      >
        {/* Country Selector */}
        <button
          type="button"
          onClick={() => !isLocked && !disabled && setIsOpen(!isOpen)}
          disabled={isLocked || disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={currentCountry ? `${currentCountry.name} +${currentCountry.callingCode}` : undefined}
          className={`flex items-center gap-1.5 px-3 sm:px-2.5 h-full border-r border-gray-200 bg-gray-50 focus:outline-none focus-visible:bg-blue-50 ${
            isLocked || disabled ? 'cursor-default' : 'cursor-pointer hover:bg-blue-50'
          }`}
          style={{ minWidth: isLocked ? 'auto' : '96px' }}
        >
          <span className="text-lg" aria-hidden>{getFlagEmoji(selectedCountry)}</span>
          <span className="text-base sm:text-sm text-gray-900">+{currentCountry?.callingCode}</span>
          {!isLocked && !disabled && (
            <ChevronDown className="w-4 h-4 text-tme-blue ml-auto" aria-hidden />
          )}
        </button>

        {/* Phone Number Input */}
        <input
          ref={inputRef}
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={error || invalid ? true : undefined}
          value={inputValue}
          onChange={handleInputChange}
          placeholder={placeholder || 'Enter phone number'}
          disabled={disabled}
          className="flex-1 min-w-0 h-full px-3.5 sm:px-3 outline-none text-base md:text-sm text-gray-900 bg-transparent placeholder:text-gray-500"
        />
      </div>

      {/* Error message */}
      <FieldError>{error}</FieldError>

      {/* Validation feedback */}
      {!error && showValidation && validationState === 'too_short' && (
        <p className="mt-1.5 text-sm text-amber-800 sm:mt-1 sm:text-[13px]">
          Enter at least {expectedLength.min} digits
        </p>
      )}
      {!error && showValidation && validationState === 'invalid' && (
        <p className="mt-1.5 text-sm text-amber-800 sm:mt-1 sm:text-[13px]">Invalid phone number</p>
      )}
      {!error && showValidation && validationState === 'valid' && (
        <p className="mt-1.5 text-sm text-green-800 sm:mt-1 sm:text-[13px]">Valid number</p>
      )}

      {/* Country Dropdown Portal */}
      {isMounted &&
        isOpen &&
        createPortal(
          <div
            className="phone-dropdown-portal fixed z-[9999] bg-white rounded-[10px] shadow-xl border-2 border-tme-blue overflow-hidden"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
              maxHeight: '300px',
            }}
          >
            {/* Search */}
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" aria-hidden />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder={searchPlaceholder || 'Search country...'}
                  className="w-full h-11 pl-9 pr-3 text-base border-2 border-gray-200 rounded-[10px] focus:outline-none focus:border-tme-blue sm:h-9 sm:border sm:border-gray-300 sm:rounded-lg md:text-sm sm:focus:border-tme-blue"
                />
              </div>
            </div>

            {/* Country List */}
            <div className="overflow-y-auto overscroll-contain" role="listbox" style={{ maxHeight: '240px' }}>
              <AnimatePresence>
                {filteredCountries.map((country) => (
                  <motion.button
                    key={country.code}
                    type="button"
                    onClick={() => handleCountrySelect(country.code)}
                    role="option"
                    aria-selected={selectedCountry === country.code}
                    className={`w-full min-h-11 sm:min-h-9 flex items-center gap-3 px-3.5 sm:px-3 py-2 sm:py-1.5 text-left hover:bg-blue-50 transition-colors ${
                      selectedCountry === country.code ? 'bg-blue-100' : ''
                    }`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="text-lg" aria-hidden>{getFlagEmoji(country.code)}</span>
                    <span className="flex-1 text-[15px] sm:text-sm text-gray-900">{country.name}</span>
                    <span className="text-[15px] sm:text-[13px] text-gray-600">+{country.callingCode}</span>
                  </motion.button>
                ))}
                {filteredCountries.length === 0 && (
                  <div className="px-3 py-4 text-[15px] sm:text-sm text-gray-600 text-center">
                    {noOptionsText || 'No countries found'}
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * Get flag emoji from country code
 */
function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Re-export validation helper
export { isValidPhoneNumber };
