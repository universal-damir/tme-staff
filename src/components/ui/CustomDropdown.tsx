'use client';

import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FieldError } from './FormBits';

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

  const labelId = `${listboxId}-label`;
  const labelledBy = ariaLabelledBy ?? (label ? labelId : undefined);

  // Phones: the list opens as a bottom sheet (no native <select>), so lock
  // the page behind it while it is open.
  useEffect(() => {
    if (!isOpen || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen, isMobile]);

  const closeList = () => {
    setIsOpen(false);
    setSearchTerm('');
    setFocusedIndex(-1);
  };

  const chevron = (
    <motion.svg
      animate={{ rotate: isOpen ? 180 : 0 }}
      transition={{ duration: 0.2 }}
      className="w-5 h-5 sm:w-[18px] sm:h-[18px] text-tme-blue"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </motion.svg>
  );

  const optionRows =
    filteredOptions.length > 0 ? (
      filteredOptions.map((option, index) => {
        const selected = value === option.value;
        return (
          <div
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={selected}
            onClick={() => handleSelect(option.value)}
            onMouseEnter={() => setFocusedIndex(index)}
            className={`flex flex-col justify-center min-h-11 px-3.5 py-2.5 cursor-pointer transition-colors text-[15px] leading-snug md:min-h-9 md:px-3 md:py-2 md:text-sm ${
              selected ? 'font-semibold md:font-medium text-tme-blue bg-blue-100' : 'text-gray-900 hover:bg-blue-50'
            } ${index === focusedIndex ? 'bg-blue-50 ring-2 ring-inset ring-tme-blue/40' : ''}`}
          >
            {option.label}
            {option.sublabel && (
              <span className="block text-sm md:text-[13px] font-normal text-gray-600">{option.sublabel}</span>
            )}
          </div>
        );
      })
    ) : loading ? (
      <div className="px-3.5 py-4 text-center text-gray-600 text-[15px] md:text-sm">Loading...</div>
    ) : onCustomEntry && searchTerm.trim() ? (
      <div className="px-2 py-2">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            onCustomEntry(searchTerm.trim());
            setIsOpen(false);
            setSearchTerm('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onCustomEntry(searchTerm.trim());
              setIsOpen(false);
              setSearchTerm('');
            }
          }}
          className="flex items-center min-h-11 px-3 cursor-pointer rounded-[10px] text-[15px] font-semibold text-tme-blue md:min-h-9 md:rounded-lg md:text-sm md:font-medium hover:bg-blue-50"
        >
          Use &ldquo;{searchTerm.trim()}&rdquo;
        </div>
        {customEntryHint && (
          <p className="px-3 py-2 text-sm md:text-[13px] text-gray-600 leading-relaxed">{customEntryHint}</p>
        )}
      </div>
    ) : (
      <div className="px-3.5 py-4 text-center text-gray-600 text-[15px] md:text-sm">{noOptionsText}</div>
    );

  const searchBoxProps = {
    value: searchTerm,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
      setFocusedIndex(e.target.value ? 0 : -1);
      if (!isOpen) setIsOpen(true);
    },
    onKeyDown: handleKeyDown,
    placeholder: searchPlaceholder,
    role: 'combobox' as const,
    'aria-expanded': isOpen,
    'aria-controls': listboxId,
    'aria-autocomplete': 'list' as const,
    'aria-labelledby': labelledBy,
    'aria-activedescendant':
      focusedIndex >= 0 && focusedIndex < filteredOptions.length ? optionId(focusedIndex) : undefined,
  };

  // Desktop: the list opens under (or over) the field. Phones: a bottom sheet
  // with 44px rows. Never a native <select>.
  const borderClass = error
    ? 'border-tme-red'
    : isOpen
      ? 'border-tme-blue'
      : 'border-gray-200 sm:border-gray-300 hover:border-tme-blue sm:hover:border-tme-blue focus:border-tme-blue sm:focus:border-tme-blue';

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label id={labelId} className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
          {label}
          {required && (
            <span className="text-tme-red ml-1" aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      <div className="relative">
        {searchable && isOpen && !isMobile ? (
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              {...searchBoxProps}
              onFocus={() => setIsOpen(true)}
              className={`w-full h-[46px] pl-3.5 pr-11 text-base text-gray-900 bg-white rounded-[10px] border-2 focus:outline-none transition-colors duration-200 placeholder:text-gray-500 sm:h-10 sm:pl-3 sm:pr-10 sm:rounded-lg sm:border md:text-sm sm:ring-[3px] ${
                error ? 'border-tme-red sm:ring-tme-red/15' : 'border-tme-blue sm:ring-tme-blue/15'
              }`}
              autoFocus
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close list"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 size-11 sm:size-9 inline-flex items-center justify-center"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeList();
              }}
            >
              {chevron}
            </button>
          </div>
        ) : (
          <motion.div
            ref={triggerRef}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={isOpen ? listboxId : undefined}
            aria-labelledby={labelledBy}
            aria-disabled={disabled || undefined}
            aria-invalid={error ? true : undefined}
            aria-activedescendant={
              isOpen && !isMobile && focusedIndex >= 0 && focusedIndex < filteredOptions.length
                ? optionId(focusedIndex)
                : undefined
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
              if (isOpen) closeList();
              else openList();
            }}
            className={`w-full min-h-[46px] pl-3.5 pr-2 rounded-[10px] border-2 bg-white transition-colors duration-200 flex items-center justify-between gap-2 focus:outline-none sm:min-h-10 sm:pl-3 sm:pr-1.5 sm:rounded-lg sm:border ${borderClass} py-1.5 sm:py-1 ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50' : 'cursor-pointer'}`}
          >
            <div className={`text-base sm:text-sm flex-1 min-w-0 ${value ? 'text-gray-900' : 'text-gray-500'}`}>
              {formatBrackets && displayLabel.includes('(') ? (
                <>
                  <span className="block break-words">{displayLabel.split('(')[0].trim()}</span>
                  <span className="text-sm sm:text-[13px] text-gray-600 block break-words">({displayLabel.split('(')[1]}</span>
                </>
              ) : (
                <span className="block py-0.5 break-words">{displayLabel}</span>
              )}
            </div>
            <span className="flex-shrink-0 inline-flex items-center justify-center size-8">{chevron}</span>
          </motion.div>
        )}
      </div>

      {isMounted &&
        isOpen &&
        createPortal(
          <AnimatePresence>
            {isMobile ? (
              <div className="fixed inset-0 z-[9999] flex flex-col justify-end">
                <motion.div
                  aria-hidden
                  className="absolute inset-0 bg-black/40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={closeList}
                />
                <motion.div
                  ref={dropdownRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={labelledBy}
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="relative bg-white rounded-t-[14px] shadow-2xl max-h-[75dvh] flex flex-col"
                  style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                >
                  <div className="flex items-center justify-between gap-2 pl-4 pr-1.5 py-1.5 border-b border-gray-200">
                    <span className="text-[17px] font-semibold text-tme-blue truncate">
                      {label || placeholder}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        closeList();
                        refocusTrigger();
                      }}
                      aria-label="Close list"
                      className="size-11 inline-flex items-center justify-center rounded-full text-tme-blue hover:bg-blue-50 tme-btn-focus"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {searchable && (
                    <div className="px-3 pt-3 pb-2">
                      <input
                        ref={inputRef}
                        type="text"
                        {...searchBoxProps}
                        className="w-full h-[46px] px-3.5 text-base text-gray-900 bg-white rounded-[10px] border-2 border-gray-200 focus:border-tme-blue focus:outline-none placeholder:text-gray-500"
                      />
                    </div>
                  )}
                  <div id={listboxId} role="listbox" aria-labelledby={labelledBy} className="overflow-y-auto overscroll-contain py-1">
                    {optionRows}
                  </div>
                </motion.div>
              </div>
            ) : (
              <motion.div
                ref={dropdownRef}
                id={listboxId}
                role="listbox"
                aria-labelledby={labelledBy}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="fixed bg-white border-2 border-tme-blue rounded-[10px] shadow-lg max-h-60 sm:border sm:rounded-lg overflow-y-auto py-1"
                style={{
                  ...(dropdownPosition.top !== undefined ? { top: `${dropdownPosition.top}px` } : {}),
                  ...(dropdownPosition.bottom !== undefined ? { bottom: `${dropdownPosition.bottom}px` } : {}),
                  left: `${dropdownPosition.left}px`,
                  width: `${dropdownPosition.width}px`,
                  zIndex: 9999,
                }}
              >
                {optionRows}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {error && error.trim() && <FieldError>{error}</FieldError>}
    </div>
  );
}
