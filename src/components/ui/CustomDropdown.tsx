'use client';

import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { TME_COLORS, INPUT_HEIGHT } from '@/lib/constants';

interface DropdownOption {
  value: string;
  label: string;
  /** Optional second line under the label in the open list (e.g. a German translation). */
  sublabel?: string;
}

interface CustomDropdownProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  formatBrackets?: boolean;
  loading?: boolean;
  /** When set, shows a "use custom" option when search has no matches. Callback receives the typed text. */
  onCustomEntry?: (text: string) => void;
  /** Guidance text shown below the custom entry option */
  customEntryHint?: string;
  /** Let a long selected label wrap in the closed field instead of being cut off. */
  wrapLabel?: boolean;
  /** Accessible name of the field when the label is rendered outside (id of the label element). */
  ariaLabelledBy?: string;
  /** Placeholder of the search box (searchable only). Default 'Type to search...'. */
  searchPlaceholder?: string;
  /** Text when the search matches nothing. Default 'No options found'. */
  noOptionsText?: string;
}

export default function CustomDropdown({
  label,
  value,
  onChange,
  options,
  error,
  required = false,
  placeholder = 'Select option',
  disabled = false,
  searchable = false,
  formatBrackets = false,
  loading = false,
  onCustomEntry,
  customEntryHint,
  wrapLabel = false,
  ariaLabelledBy,
  searchPlaceholder = 'Type to search...',
  noOptionsText = 'No options found',
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  // top is set when the popup opens DOWNWARD (top edge anchored below the
  // trigger). bottom is set when it opens UPWARD (bottom edge anchored just
  // above the trigger) — anchoring by bottom keeps short popups visually
  // attached to the trigger instead of floating up to the max-height mark.
  const [dropdownPosition, setDropdownPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  }>({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const [isMounted, setIsMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile on mount
  useEffect(() => {
    setIsMounted(true);
    const checkMobile = () => {
      setIsMobile(
        'ontouchstart' in window &&
        window.innerWidth < 768
      );
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => {
      setIsMounted(false);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  // Filter options based on search term
  const filteredOptions = searchable && searchTerm
    ? options.filter((opt) =>
        `${opt.label} ${opt.sublabel ?? ''}`.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : options;

  // Update dropdown position (using viewport coordinates for fixed positioning)
  const updateDropdownPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const width = Math.min(rect.width, viewportWidth - 16);

      let left = rect.left;
      if (left + width > viewportWidth - 8) {
        left = Math.max(8, viewportWidth - width - 8);
      }
      if (left < 8) left = 8;

      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownMaxHeight = 240;

      // Open upward when there isn't enough room below AND there's more room
      // above. Anchor by `bottom` (distance from viewport bottom to the
      // trigger top) so the popup hugs the trigger regardless of how many
      // options it ends up rendering — fixes the "popup floats in the
      // middle" issue for short option lists.
      if (spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow) {
        const bottom = viewportHeight - rect.top + 4;
        setDropdownPosition({ bottom, left, width });
      } else {
        const top = rect.bottom + 4;
        setDropdownPosition({ top, left, width });
      }
    }
  };

  // Update position when dropdown opens or on scroll/resize
  useEffect(() => {
    if (isOpen && !isMobile) {
      updateDropdownPosition();
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen, isMobile]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (isMobile) return; // Native select handles its own closing
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobile]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
    setFocusedIndex(-1);
  };

  /** Open the list with the chosen option (or the first) active. */
  const openList = () => {
    const selected = options.findIndex((opt) => opt.value === value);
    setFocusedIndex(searchable ? -1 : Math.max(0, selected));
    setIsOpen(true);
  };

  /** After a keyboard pick or Escape, focus goes back to the closed field. */
  const refocusTrigger = () => {
    setTimeout(() => triggerRef.current?.focus(), 0);
  };

  // Keep the active option in view while moving with the arrow keys.
  useEffect(() => {
    if (!isOpen || focusedIndex < 0) return;
    const el = document.getElementById(optionId(focusedIndex));
    el?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId is stable per mount
  }, [isOpen, focusedIndex]);

  // Keyboard on the open list: arrows move, Enter (Space when not searching) picks, Escape / Tab close.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Home':
        if (searchable) break;
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        if (searchable) break;
        e.preventDefault();
        setFocusedIndex(filteredOptions.length - 1);
        break;
      case ' ':
        if (searchable) break;
      // falls through: Space picks like Enter on the closed-field list
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          handleSelect(filteredOptions[focusedIndex].value);
          refocusTrigger();
        } else if (!searchable) {
          setIsOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchTerm('');
        setFocusedIndex(-1);
        refocusTrigger();
        break;
      case 'Tab':
        setIsOpen(false);
        setSearchTerm('');
        setFocusedIndex(-1);
        break;
    }
  };

  const displayLabel = options.find((opt) => opt.value === value)?.label || placeholder;

  // --- MOBILE: Use native <select> for best UX (iOS picker wheel, Android native) ---
  if (isMobile) {
    return (
      <div ref={containerRef} className="relative">
        {label && (
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
          >
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}

        <div className="relative">
          <select
            aria-labelledby={ariaLabelledBy}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={`w-full px-3 py-2 text-sm rounded-lg border-2 transition-all duration-200 appearance-none bg-white ${
              disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''
            }`}
            style={{
              height: `${INPUT_HEIGHT}px`,
              borderColor: error ? '#ef4444' : '#e5e7eb',
              fontFamily: 'Inter, sans-serif',
              color: value ? '#111827' : '#9ca3af',
            }}
          >
            <option value="" disabled>
              {placeholder}
            </option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.sublabel ? `${option.label} / ${option.sublabel}` : option.label}
              </option>
            ))}
          </select>

          {/* Arrow icon overlay */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg
              className="w-5 h-5"
              style={{ color: TME_COLORS.primary }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {error && error.trim() && (
          <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  // --- DESKTOP: Custom dropdown with portal ---
  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label
          className="block text-sm font-medium mb-1"
          style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        {searchable && isOpen ? (
          <div className="relative">
            <motion.input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setSearchTerm(e.target.value);
                setFocusedIndex(e.target.value ? 0 : -1);
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
                setIsOpen(true);
                if (!error) e.target.style.borderColor = TME_COLORS.primary;
              }}
              onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                if (!isOpen) {
                  e.target.style.borderColor = '#e5e7eb';
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-labelledby={ariaLabelledBy}
              aria-activedescendant={focusedIndex >= 0 && focusedIndex < filteredOptions.length ? optionId(focusedIndex) : undefined}
              className="w-full px-3 py-2 text-sm rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200"
              style={{
                height: `${INPUT_HEIGHT}px`,
                borderColor: error ? '#ef4444' : TME_COLORS.primary,
                fontFamily: 'Inter, sans-serif',
              }}
              autoFocus
            />
            <div
              className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen(!isOpen);
                if (isOpen) setSearchTerm('');
              }}
            >
              <motion.svg
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="w-5 h-5"
                style={{ color: TME_COLORS.primary }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </motion.svg>
            </div>
          </div>
        ) : (
          <motion.div
            ref={triggerRef}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={isOpen ? listboxId : undefined}
            aria-labelledby={ariaLabelledBy}
            aria-activedescendant={
              isOpen && focusedIndex >= 0 && focusedIndex < filteredOptions.length ? optionId(focusedIndex) : undefined
            }
            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
              if (disabled) return;
              if (isOpen) {
                handleKeyDown(e);
                return;
              }
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                openList();
              }
            }}
            onClick={() => {
              if (disabled) return;
              if (isOpen) setIsOpen(false);
              else openList();
            }}
            whileHover={!disabled ? { scale: 1.01 } : undefined}
            className={`w-full px-3 py-2 rounded-lg border-2 border-gray-200 transition-all duration-200 flex items-center justify-between ${
              disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'cursor-pointer'
            }`}
            style={{
              minHeight: `${INPUT_HEIGHT}px`,
              height: formatBrackets || wrapLabel ? 'auto' : `${INPUT_HEIGHT}px`,
              borderColor: error ? '#ef4444' : isOpen ? TME_COLORS.primary : '#e5e7eb',
              fontFamily: 'Inter, sans-serif',
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
              if (!disabled && !isOpen && !error) e.currentTarget.style.borderColor = TME_COLORS.primary;
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
              if (!disabled && !isOpen && !error) e.currentTarget.style.borderColor = '#e5e7eb';
            }}
          >
            <div
              className={`text-sm flex-1 min-w-0 ${value ? 'text-gray-900' : 'text-gray-500'}`}
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              {formatBrackets && displayLabel.includes('(') ? (
                <>
                  <span className="truncate block">{displayLabel.split('(')[0].trim()}</span>
                  <span className="text-xs text-gray-500 truncate block">({displayLabel.split('(')[1]}</span>
                </>
              ) : (
                <span className={wrapLabel ? 'block py-0.5' : 'truncate block'}>{displayLabel}</span>
              )}
            </div>

            <div
              className={`flex-shrink-0 ${disabled ? '' : 'cursor-pointer'}`}
              onClick={(e) => {
                if (!disabled) {
                  e.stopPropagation();
                  setIsOpen(!isOpen);
                  if (isOpen) setSearchTerm('');
                }
              }}
            >
              <motion.svg
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="w-5 h-5"
                style={{ color: TME_COLORS.primary }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </motion.svg>
            </div>
          </motion.div>
        )}
      </div>

      {isMounted && isOpen && createPortal(
        <AnimatePresence>
          <motion.div
            ref={dropdownRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={ariaLabelledBy}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed bg-white border-2 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            style={{
              borderColor: TME_COLORS.primary,
              fontFamily: 'Inter, sans-serif',
              ...(dropdownPosition.top !== undefined ? { top: `${dropdownPosition.top}px` } : {}),
              ...(dropdownPosition.bottom !== undefined ? { bottom: `${dropdownPosition.bottom}px` } : {}),
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
              zIndex: 9999,
            }}
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => (
                <motion.div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={value === option.value}
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => setFocusedIndex(index)}
                  whileHover={{ backgroundColor: `${TME_COLORS.primary}10` }}
                  className={`px-3 py-2 cursor-pointer transition-colors text-sm ${
                    value === option.value ? 'font-semibold' : ''
                  } ${index === focusedIndex ? 'bg-blue-50 ring-2 ring-inset ring-[#243F7B]/40' : ''}`}
                  style={{
                    backgroundColor: value === option.value ? `${TME_COLORS.primary}20` : undefined,
                    color: value === option.value ? TME_COLORS.primary : '#1f2937',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {option.label}
                  {option.sublabel && (
                    <span className="block text-xs font-normal text-gray-500">
                      {option.sublabel}
                    </span>
                  )}
                </motion.div>
              ))
            ) : loading ? (
              <div className="px-3 py-4 text-center text-gray-400 text-sm">
                Loading...
              </div>
            ) : onCustomEntry && searchTerm.trim() ? (
              <div className="px-3 py-2">
                <motion.div
                  onClick={() => {
                    onCustomEntry(searchTerm.trim());
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                  whileHover={{ backgroundColor: `${TME_COLORS.primary}10` }}
                  className="px-3 py-2 cursor-pointer rounded-lg text-sm font-medium"
                  style={{ color: TME_COLORS.primary }}
                >
                  Use &ldquo;{searchTerm.trim()}&rdquo;
                </motion.div>
                {customEntryHint && (
                  <p className="px-3 py-2 text-xs text-gray-400 leading-relaxed">
                    {customEntryHint}
                  </p>
                )}
              </div>
            ) : (
              <div className="px-3 py-4 text-center text-gray-400 text-sm">
                {noOptionsText}
              </div>
            )}
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {error && error.trim() && (
        <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
          {error}
        </p>
      )}
    </div>
  );
}
