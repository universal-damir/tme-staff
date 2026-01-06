'use client';

import React, { forwardRef, useMemo, useState, useRef, useEffect } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { ChevronDown, Search, X } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
}

interface EnhancedDropdownProps {
  label?: string;
  error?: string;
  helperText?: string;
  options: readonly (string | SelectOption)[];
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  allowCustom?: boolean;
  customPlaceholder?: string;
  sortAlphabetically?: boolean;
  className?: string;
  name?: string;
}

export const EnhancedDropdown = forwardRef<HTMLDivElement, EnhancedDropdownProps>(
  (
    {
      label,
      error,
      helperText,
      options,
      placeholder = 'Select...',
      value = '',
      onChange,
      required,
      disabled,
      searchable = false,
      allowCustom = false,
      customPlaceholder = 'Add custom...',
      sortAlphabetically = true,
      className = '',
      name,
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [customValue, setCustomValue] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Normalize options to SelectOption format
    const normalizedOptions = useMemo(() => {
      const opts = options.map((option) => {
        if (typeof option === 'string') {
          return { value: option, label: option };
        }
        return option;
      });

      // Sort alphabetically by label if enabled
      if (sortAlphabetically) {
        return [...opts].sort((a, b) => {
          // Keep "Other" at the end
          if (a.value === 'Other' || a.label === 'Other') return 1;
          if (b.value === 'Other' || b.label === 'Other') return -1;
          return a.label.localeCompare(b.label);
        });
      }

      return opts;
    }, [options, sortAlphabetically]);

    // Filter options based on search term
    const filteredOptions = useMemo(() => {
      if (!searchTerm) return normalizedOptions;
      const lowerSearch = searchTerm.toLowerCase();
      return normalizedOptions.filter(
        (opt) =>
          opt.label.toLowerCase().includes(lowerSearch) ||
          opt.value.toLowerCase().includes(lowerSearch)
      );
    }, [normalizedOptions, searchTerm]);

    // Get selected option label
    const selectedLabel = useMemo(() => {
      const found = normalizedOptions.find((opt) => opt.value === value);
      return found ? found.label : '';
    }, [normalizedOptions, value]);

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
          setSearchTerm('');
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Focus search input when dropdown opens
    useEffect(() => {
      if (isOpen && searchable && inputRef.current) {
        inputRef.current.focus();
      }
    }, [isOpen, searchable]);

    const handleSelect = (optionValue: string) => {
      onChange?.(optionValue);
      setIsOpen(false);
      setSearchTerm('');
    };

    const handleAddCustom = () => {
      if (customValue.trim()) {
        onChange?.(customValue.trim());
        setCustomValue('');
        setIsOpen(false);
      }
    };

    const handleClear = () => {
      onChange?.('');
      setSearchTerm('');
    };

    return (
      <div className={`w-full ${className}`} ref={ref}>
        {label && (
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: TME_COLORS.primary }}
          >
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}

        <div className="relative" ref={dropdownRef}>
          {/* Hidden input for form submission */}
          {name && <input type="hidden" name={name} value={value} />}

          {/* Trigger Button */}
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className={`w-full px-3 py-2 rounded-lg border-2 transition-all duration-200 h-[42px] bg-white text-left flex items-center justify-between ${
              error ? 'border-red-500' : isOpen ? 'border-[#243F7B]' : 'border-gray-200'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'cursor-pointer hover:border-gray-300'}`}
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            <span className={value ? 'text-gray-900' : 'text-gray-400'}>
              {selectedLabel || placeholder}
            </span>
            <div className="flex items-center gap-1">
              {value && !disabled && (
                <X
                  className="w-4 h-4 text-gray-400 hover:text-gray-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                />
              )}
              <ChevronDown
                className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </div>
          </button>

          {/* Dropdown Menu */}
          {isOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden">
              {/* Search Input */}
              {searchable && (
                <div className="p-2 border-b border-gray-100">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      ref={inputRef}
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search..."
                      className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-[#243F7B]"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    />
                  </div>
                </div>
              )}

              {/* Options List */}
              <div className="overflow-y-auto max-h-48">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors ${
                        option.value === value ? 'bg-blue-50 text-[#243F7B] font-medium' : 'text-gray-700'
                      }`}
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      {option.label}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm text-gray-500">No options found</div>
                )}
              </div>

              {/* Add Custom Option */}
              {allowCustom && (
                <div className="p-2 border-t border-gray-100">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      placeholder={customPlaceholder}
                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-[#243F7B]"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustom();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddCustom}
                      disabled={!customValue.trim()}
                      className="px-3 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-50"
                      style={{ backgroundColor: TME_COLORS.primary }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        {helperText && !error && <p className="mt-1 text-sm text-gray-500">{helperText}</p>}
      </div>
    );
  }
);

EnhancedDropdown.displayName = 'EnhancedDropdown';
