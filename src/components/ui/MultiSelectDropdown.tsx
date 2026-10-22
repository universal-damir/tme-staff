'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { FieldError, FieldHelp } from './FormBits';
import { ChevronDown, Search, X, Plus, Check } from 'lucide-react';
import { Button } from './Button';

interface SelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  label?: string;
  error?: string;
  helperText?: string;
  options: readonly (string | SelectOption)[];
  placeholder?: string;
  value: string[];
  onChange: (value: string[]) => void;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  allowCustom?: boolean;
  customPlaceholder?: string;
  sortAlphabetically?: boolean;
  className?: string;
  maxDisplay?: number;
}

export function MultiSelectDropdown({
  label,
  error,
  helperText,
  options,
  placeholder = 'Select...',
  value = [],
  onChange,
  required,
  disabled,
  searchable = true,
  allowCustom = false,
  customPlaceholder = 'Add custom...',
  sortAlphabetically = true,
  className = '',
  maxDisplay = 3,
}: MultiSelectDropdownProps) {
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

  // Get labels for selected values
  const selectedLabels = useMemo(() => {
    return value.map((v) => {
      const found = normalizedOptions.find((opt) => opt.value === v);
      return found ? found.label : v;
    });
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

  const handleToggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const handleRemove = (optionValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== optionValue));
  };

  const handleAddCustom = () => {
    if (customValue.trim() && !value.includes(customValue.trim())) {
      onChange([...value, customValue.trim()]);
      setCustomValue('');
    }
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  // Display text for selected items
  const displayText = useMemo(() => {
    if (selectedLabels.length === 0) return placeholder;
    if (selectedLabels.length <= maxDisplay) {
      return selectedLabels.join(', ');
    }
    return `${selectedLabels.slice(0, maxDisplay).join(', ')} +${selectedLabels.length - maxDisplay} more`;
  }, [selectedLabels, maxDisplay, placeholder]);

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <span className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
          {label}
          {required && (
            <span className="text-tme-red ml-1" aria-hidden>
              *
            </span>
          )}
        </span>
      )}

      <div className="relative" ref={dropdownRef}>
        {/* Trigger Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={label ? `${label}: ${displayText}` : undefined}
            className={`w-full pl-3.5 pr-24 py-2 rounded-[10px] border-2 transition-colors duration-200 min-h-[46px] bg-white text-left text-base flex items-center focus:outline-none sm:min-h-10 sm:py-1.5 sm:pl-3 sm:rounded-lg sm:border sm:text-sm ${
              error ? 'border-tme-red' : isOpen ? 'border-tme-blue' : 'border-gray-200 sm:border-gray-300 focus:border-tme-blue sm:focus:border-tme-blue'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'cursor-pointer hover:border-tme-blue sm:hover:border-tme-blue'}`}
          >
            <span className={value.length > 0 ? 'text-gray-900' : 'text-gray-500'}>{displayText}</span>
          </button>
          <div className="absolute right-1 top-0 h-[46px] sm:h-10 flex items-center gap-0.5 pointer-events-none">
            {value.length > 0 && !disabled && (
              <button
                type="button"
                onClick={handleClearAll}
                aria-label="Clear all"
                className="pointer-events-auto size-11 sm:size-8 inline-flex items-center justify-center rounded-full text-gray-600 hover:text-tme-red hover:bg-red-50 tme-btn-focus"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            )}
            <ChevronDown
              aria-hidden
              className={`w-5 h-5 mr-2 text-tme-blue transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </div>
        </div>

        {/* Selected Tags (show below input when there are selections) */}
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {selectedLabels.map((tagLabel, index) => (
              <span
                key={value[index]}
                className={`inline-flex items-center min-h-9 pl-3 text-sm font-medium rounded-full sm:min-h-7 sm:pl-2.5 sm:text-[13px] bg-blue-50 border border-blue-100 text-tme-blue ${
                  disabled ? 'pr-3' : 'pr-0'
                }`}
              >
                {tagLabel}
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => handleRemove(value[index], e)}
                    aria-label={`Remove ${tagLabel}`}
                    className="size-11 -my-1 sm:size-7 sm:my-0 inline-flex items-center justify-center rounded-full hover:text-tme-red tme-btn-focus"
                  >
                    <X className="w-4 h-4" aria-hidden />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border-2 border-tme-blue rounded-[10px] shadow-lg overflow-hidden" style={{ maxWidth: 'calc(100vw - 2rem)' }}>
            {/* Search Input */}
            {searchable && (
              <div className="p-2 border-b border-gray-100">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" aria-hidden />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search..."
                    className="w-full h-11 pl-9 pr-3 border-2 border-gray-200 rounded-[10px] text-base focus:outline-none focus:border-tme-blue sm:h-9 sm:border sm:border-gray-300 sm:rounded-lg md:text-sm sm:focus:border-tme-blue"
                  />
                </div>
              </div>
            )}

            {/* Options List */}
            <div className="overflow-y-auto max-h-60 overscroll-contain" role="listbox" aria-multiselectable="true">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => {
                  const isSelected = value.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleToggle(option.value)}
                      className={`w-full min-h-11 px-3.5 py-2.5 text-left text-[15px] sm:min-h-9 sm:px-3 sm:py-2 sm:text-sm hover:bg-blue-50 transition-colors flex items-center justify-between gap-2 ${
                        isSelected ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span className={isSelected ? 'text-tme-blue font-semibold sm:font-medium' : 'text-gray-900'}>
                        {option.label}
                      </span>
                      {isSelected && <Check className="w-4 h-4 flex-shrink-0 text-tme-blue" aria-hidden />}
                    </button>
                  );
                })
              ) : (
                <div className="px-3.5 py-3 text-[15px] sm:text-sm text-gray-600">No options found</div>
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
                    className="flex-1 min-w-0 h-11 px-3 border-2 border-gray-200 rounded-[10px] text-base focus:outline-none focus:border-tme-blue sm:h-9 sm:border sm:border-gray-300 sm:rounded-lg md:text-sm sm:focus:border-tme-blue"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustom();
                      }
                    }}
                  />
                  <Button tone="secondary" onClick={handleAddCustom} disabled={!customValue.trim()}>
                    <Plus className="w-4 h-4" aria-hidden />
                    Add
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error ? <FieldError>{error}</FieldError> : <FieldHelp>{helperText}</FieldHelp>}
    </div>
  );
}
