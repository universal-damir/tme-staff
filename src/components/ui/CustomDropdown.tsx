'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { TME_COLORS, INPUT_HEIGHT } from '@/lib/constants';

interface DropdownOption {
  value: string;
  label: string;
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
    ? options.filter((opt) => opt.label.toLowerCase().includes(searchTerm.toLowerCase()))
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!searchable || !isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          handleSelect(filteredOptions[focusedIndex].value);
        }
        break;
      case 'Escape':
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
                {option.label}
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

        {error && (
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
              placeholder="Type to search..."
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
            onClick={() => !disabled && setIsOpen(!isOpen)}
            whileHover={!disabled ? { scale: 1.01 } : undefined}
            className={`w-full px-3 py-2 rounded-lg border-2 border-gray-200 transition-all duration-200 flex items-center justify-between ${
              disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'cursor-pointer'
            }`}
            style={{
              minHeight: `${INPUT_HEIGHT}px`,
              height: formatBrackets ? 'auto' : `${INPUT_HEIGHT}px`,
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
                <span className="truncate block">{displayLabel}</span>
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
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => searchable && setFocusedIndex(index)}
                  whileHover={{ backgroundColor: `${TME_COLORS.primary}10` }}
                  className={`px-3 py-2 cursor-pointer transition-colors text-sm ${
                    value === option.value ? 'font-semibold' : ''
                  } ${searchable && index === focusedIndex ? 'bg-blue-50' : ''}`}
                  style={{
                    backgroundColor: value === option.value ? `${TME_COLORS.primary}20` : undefined,
                    color: value === option.value ? TME_COLORS.primary : '#1f2937',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {option.label}
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
                No options found
              </div>
            )}
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {error && (
        <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
          {error}
        </p>
      )}
    </div>
  );
}
