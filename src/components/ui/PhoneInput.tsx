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
import { TME_COLORS, INPUT_HEIGHT } from '@/lib/constants';
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
}: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState<Country>(
    lockedCountry || defaultCountry
  );
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [focused, setFocused] = useState(false);
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

  // Sync input value with external value
  useEffect(() => {
    if (value) {
      try {
        const parsed = parsePhoneNumber(value);
        if (parsed) {
          if (parsed.country) {
            setSelectedCountry(parsed.country);
          }
          // Show national number without country code
          setInputValue(parsed.nationalNumber || '');
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

    setInputValue(raw);

    // Build full number
    const callingCode = getCountryCallingCode(selectedCountry);
    const fullNumber = raw ? `+${callingCode}${raw}` : '';

    // Format as user types
    try {
      const formatter = new AsYouType(selectedCountry);
      formatter.input(fullNumber);
    } catch {
      // Ignore formatting errors
    }

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
      onChange(`+${callingCode}${inputValue}`);
    }

    inputRef.current?.focus();
  };

  // Validation
  const fullValue = value || '';
  const expectedLength = getExpectedLength(selectedCountry);
  const currentLength = inputValue.length;

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

  const showValidation = currentLength > 0;

  // Get current country info
  const currentCountry = allCountries.find((c) => c.code === selectedCountry);

  return (
    <div className="w-full phone-dropdown-container" ref={containerRef}>
      {label && (
        <label
          className="block text-sm font-medium mb-1"
          style={{ color: TME_COLORS.primary }}
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div
        className={`flex items-center rounded-lg border-2 transition-all duration-200 overflow-hidden ${
          error ? 'border-red-500' : focused ? '' : 'border-gray-200'
        }`}
        style={{
          height: INPUT_HEIGHT,
          borderColor: error ? undefined : focused ? TME_COLORS.primary : undefined,
        }}
      >
        {/* Country Selector */}
        <button
          type="button"
          onClick={() => !isLocked && !disabled && setIsOpen(!isOpen)}
          disabled={isLocked || disabled}
          className={`flex items-center gap-1 px-3 h-full border-r border-gray-200 bg-gray-50 ${
            isLocked || disabled ? 'cursor-default' : 'cursor-pointer hover:bg-gray-100'
          }`}
          style={{ minWidth: isLocked ? 'auto' : '90px' }}
        >
          <span className="text-base">{getFlagEmoji(selectedCountry)}</span>
          <span className="text-sm text-gray-700">+{currentCountry?.callingCode}</span>
          {!isLocked && !disabled && (
            <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />
          )}
        </button>

        {/* Phone Number Input */}
        <input
          ref={inputRef}
          type="tel"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder || 'Enter phone number'}
          disabled={disabled}
          className="flex-1 h-full px-3 outline-none text-sm bg-transparent"
          style={{ fontFamily: 'Inter, sans-serif' }}
        />
      </div>

      {/* Error message */}
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}

      {/* Validation feedback */}
      {!error && showValidation && validationState === 'too_short' && (
        <p className="mt-1 text-sm text-amber-600">
          Enter at least {expectedLength.min} digits
        </p>
      )}
      {!error && showValidation && validationState === 'invalid' && (
        <p className="mt-1 text-sm text-amber-600">Invalid phone number</p>
      )}
      {!error && showValidation && validationState === 'valid' && (
        <p className="mt-1 text-sm text-green-600">Valid number</p>
      )}

      {/* Country Dropdown Portal */}
      {isMounted &&
        isOpen &&
        createPortal(
          <div
            className="phone-dropdown-portal fixed z-[9999] bg-white rounded-lg shadow-xl border border-gray-200"
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search country..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                />
              </div>
            </div>

            {/* Country List */}
            <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
              <AnimatePresence>
                {filteredCountries.map((country) => (
                  <motion.button
                    key={country.code}
                    type="button"
                    onClick={() => handleCountrySelect(country.code)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                      selectedCountry === country.code ? 'bg-blue-50' : ''
                    }`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="text-lg">{getFlagEmoji(country.code)}</span>
                    <span className="flex-1 text-sm text-gray-900">{country.name}</span>
                    <span className="text-sm text-gray-500">+{country.callingCode}</span>
                  </motion.button>
                ))}
                {filteredCountries.length === 0 && (
                  <div className="px-3 py-4 text-sm text-gray-500 text-center">
                    No countries found
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
