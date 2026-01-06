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
  searchable?: boolean; // Enable search functionality
  formatBrackets?: boolean; // Display bracketed text on new line with smaller font
}

/**
 * CustomDropdown - Reusable styled dropdown component
 * Features:
 * - TME design standards (42px height, colors, fonts)
 * - Clickable arrow to toggle
 * - Optional search functionality (searchable prop)
 * - Keyboard navigation (when searchable)
 * - Framer Motion animations
 */
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
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Track mount state for portal
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Filter options based on search term
  const filteredOptions = searchable && searchTerm
    ? options.filter((opt) => opt.label.toLowerCase().includes(searchTerm.toLowerCase()))
    : options;

  // Update dropdown position (using viewport coordinates for fixed positioning)
  const updateDropdownPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4, // 4px gap - use viewport coordinates directly for fixed position
        left: rect.left,
        width: rect.width,
      });
    }
  };

  // Update position when dropdown opens or on scroll/resize
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is outside both container AND dropdown menu
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
  }, []);

  // Handle selection
  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
    setFocusedIndex(-1);
  };

  // Handle keyboard navigation (for searchable mode)
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

  // Get display label for current value
  const displayLabel = options.find((opt) => opt.value === value)?.label || placeholder;

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

      {/* Display / Toggle */}
      <div className="relative">
        {searchable && isOpen ? (
          /* Search input for searchable mode when open */
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
            {/* Dropdown arrow for search input */}
            <div
              className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen(!isOpen);
                if (isOpen) {
                  setSearchTerm('');
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
          </div>
        ) : (
          /* Regular display div for non-searchable or when closed */
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
              if (!disabled && !isOpen && !error) {
                e.currentTarget.style.borderColor = TME_COLORS.primary;
              }
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
              if (!disabled && !isOpen && !error) {
                e.currentTarget.style.borderColor = '#e5e7eb';
              }
            }}
          >
            {/* Display value */}
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

            {/* Dropdown arrow - clickable to toggle */}
            <div
              className={`flex-shrink-0 ${disabled ? '' : 'cursor-pointer'}`}
              onClick={(e) => {
                if (!disabled) {
                  e.stopPropagation();
                  setIsOpen(!isOpen);
                  if (isOpen) {
                    setSearchTerm('');
                  }
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

      {/* Dropdown menu - rendered via portal */}
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
              top: `${dropdownPosition.top}px`,
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
            ) : (
              <div className="px-3 py-4 text-center text-gray-500 text-sm">
                No options found
              </div>
            )}
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Error message */}
      {error && (
        <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
          {error}
        </p>
      )}
    </div>
  );
}
