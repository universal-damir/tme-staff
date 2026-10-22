'use client';

import React, { useState, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { FieldError } from './FormBits';

interface CustomDatePickerProps {
  label?: string;
  value: string; // Format: dd.mm.yyyy
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Optional screen texts (the eKYC bilingual form). Missing ones keep the
   * English defaults, so every other caller is unchanged.
   */
  texts?: {
    /** 12 month names, January first. */
    monthNames?: readonly string[];
    today?: React.ReactNode;
    clear?: React.ReactNode;
  };
  /** id of the element that labels the field (aria-labelledby on the toggle). */
  ariaLabelledBy?: string;
  /** id of the error text (aria-describedby on the toggle). */
  ariaDescribedBy?: string;
}

/**
 * CustomDatePicker - Reusable date picker component
 * Features:
 * - TME design standards (46px height, 16px text, 2px border, blue focus)
 * - Calendar popup with month/year navigation (month and year pickers are
 *   button grids, never a native <select>)
 * - Date format: dd.mm.yyyy (display and value)
 * - Clickable calendar icon to toggle
 * - Consistent with CustomDropdown and other components
 */
export default function CustomDatePicker({
  label,
  value,
  onChange,
  error,
  required = false,
  placeholder = 'dd.mm.yyyy',
  disabled = false,
  texts,
  ariaLabelledBy,
  ariaDescribedBy,
}: CustomDatePickerProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  // Which grid the open calendar shows: the days of a month, the 12 months,
  // or the list of years.
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const yearListRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const labelId = `${autoId}-label`;
  const labelledBy = ariaLabelledBy ?? (label ? labelId : undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const today = new Date();

  // Parse initial month/year from value (dd.mm.yyyy) or fallback to today
  const parseValueDate = () => {
    if (value && /^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
      const [, mm, yyyy] = value.split('.');
      return { month: parseInt(mm, 10) - 1, year: parseInt(yyyy, 10) };
    }
    return { month: today.getMonth(), year: today.getFullYear() };
  };

  const initialDate = parseValueDate();
  const [currentMonth, setCurrentMonth] = useState(initialDate.month);
  const [currentYear, setCurrentYear] = useState(initialDate.year);

  const defaultMonthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthNames = texts?.monthNames?.length === 12 ? texts.monthNames : defaultMonthNames;

  const dayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll calendar into view when opened
  useEffect(() => {
    if (isCalendarOpen && calendarRef.current) {
      setTimeout(() => {
        calendarRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 100);
    }
  }, [isCalendarOpen]);

  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month: number, year: number) => {
    const firstDay = new Date(year, month, 1).getDay();
    return firstDay === 0 ? 6 : firstDay - 1;
  };

  const handleDateSelect = (day: number) => {
    const date = new Date(currentYear, currentMonth, day);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayStr = String(date.getDate()).padStart(2, '0');
    const formattedDate = `${dayStr}.${month}.${year}`;
    onChange(formattedDate);
    setIsCalendarOpen(false);
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };

  // Every open starts on the day grid.
  useEffect(() => {
    if (!isCalendarOpen) setView('days');
  }, [isCalendarOpen]);

  // Year list: start scrolled to the year being shown.
  useEffect(() => {
    if (view !== 'years') return;
    const el = yearListRef.current?.querySelector('[data-current-year="true"]');
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'center' });
  }, [view]);

  const years = Array.from({ length: 111 }, (_, i) => today.getFullYear() - 100 + i);

  const toggleCalendar = () => {
    if (disabled) return;
    if (!isCalendarOpen) {
      // Navigate to value's month/year when opening
      const d = parseValueDate();
      setCurrentMonth(d.month);
      setCurrentYear(d.year);
    }
    setIsCalendarOpen(!isCalendarOpen);
  };

  const formatDisplayDate = (dateString: string) => {
    if (!dateString) return placeholder;
    // Value is already in dd.mm.yyyy format
    return dateString;
  };

  const navBtn =
    'size-11 sm:size-9 inline-flex items-center justify-center rounded-full text-tme-blue hover:bg-blue-50 transition-colors duration-150 flex-shrink-0 tme-btn-focus';
  const headerBtn =
    'min-h-11 sm:min-h-9 px-2.5 inline-flex items-center gap-1 rounded-[10px] sm:rounded-lg text-[15px] sm:text-sm font-semibold text-tme-blue border-2 border-transparent hover:border-tme-line hover:bg-blue-50 transition-colors tme-btn-focus';
  const gridBtn = (active: boolean) =>
    `min-h-11 sm:min-h-9 rounded-[10px] sm:rounded-lg text-[15px] sm:text-sm font-medium transition-colors tme-btn-focus ${
      active ? 'bg-tme-blue text-white' : 'text-gray-800 hover:bg-blue-50'
    }`;

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

      {/* Display / Toggle */}
      <div className="relative">
        <button
          type="button"
          aria-labelledby={labelledBy}
          aria-describedby={ariaDescribedBy}
          aria-expanded={isCalendarOpen}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          onClick={toggleCalendar}
          className={`w-full h-[46px] pl-3.5 pr-2 rounded-[10px] border-2 transition-colors duration-200 flex items-center justify-between gap-2 text-left focus:outline-none sm:h-10 sm:pl-3 sm:pr-1.5 sm:rounded-lg sm:border ${
            error
              ? 'border-tme-red'
              : isCalendarOpen
                ? 'border-tme-blue'
                : 'border-gray-200 sm:border-gray-300 hover:border-tme-blue sm:hover:border-tme-blue focus:border-tme-blue sm:focus:border-tme-blue'
          } ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50' : 'cursor-pointer bg-white'}`}
        >
          {/* Display value */}
          <span className={`text-base sm:text-sm ${value ? 'text-gray-900' : 'text-gray-500'}`}>
            {formatDisplayDate(value)}
          </span>
          <span className="flex-shrink-0 inline-flex items-center justify-center size-8" aria-hidden>
            <Calendar className="w-5 h-5 sm:w-[18px] sm:h-[18px] text-tme-blue" />
          </span>
        </button>
      </div>

      {/* Calendar Popup */}
      <AnimatePresence>
        {isCalendarOpen && (
          <motion.div
            ref={calendarRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute z-50 w-full mt-1 bg-white border-2 border-tme-blue rounded-[10px] shadow-xl p-3 sm:p-4 min-w-[300px]"
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            style={{ maxWidth: 'calc(100vw - 2rem)' }}
          >
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-3 gap-1">
              <button
                type="button"
                onClick={() => navigateMonth('prev')}
                className={`${navBtn} ${view === 'days' ? '' : 'invisible'}`}
                aria-label="Previous month"
                tabIndex={view === 'days' ? 0 : -1}
              >
                <ChevronLeft className="w-5 h-5" aria-hidden />
              </button>

              <div className="flex items-center justify-center gap-1 flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setView(view === 'months' ? 'days' : 'months')}
                  aria-expanded={view === 'months'}
                  aria-label={`Month: ${monthNames[currentMonth]}. Choose a month`}
                  className={`${headerBtn} ${view === 'months' ? 'border-tme-blue' : ''}`}
                >
                  <span className="truncate">{monthNames[currentMonth]}</span>
                  <ChevronDown className="w-4 h-4 flex-shrink-0" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setView(view === 'years' ? 'days' : 'years')}
                  aria-expanded={view === 'years'}
                  aria-label={`Year: ${currentYear}. Choose a year`}
                  className={`${headerBtn} ${view === 'years' ? 'border-tme-blue' : ''}`}
                >
                  {currentYear}
                  <ChevronDown className="w-4 h-4 flex-shrink-0" aria-hidden />
                </button>
              </div>

              <button
                type="button"
                onClick={() => navigateMonth('next')}
                className={`${navBtn} ${view === 'days' ? '' : 'invisible'}`}
                aria-label="Next month"
                tabIndex={view === 'days' ? 0 : -1}
              >
                <ChevronRight className="w-5 h-5" aria-hidden />
              </button>
            </div>

            {view === 'months' && (
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Choose a month">
                {monthNames.map((month, index) => (
                  <button
                    type="button"
                    key={index}
                    aria-pressed={index === currentMonth}
                    onClick={() => {
                      setCurrentMonth(index);
                      setView('days');
                    }}
                    className={gridBtn(index === currentMonth)}
                  >
                    {month}
                  </button>
                ))}
              </div>
            )}

            {view === 'years' && (
              <div
                ref={yearListRef}
                className="grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto overscroll-contain pr-1"
                role="group"
                aria-label="Choose a year"
              >
                {years.map((year) => (
                  <button
                    type="button"
                    key={year}
                    data-current-year={year === currentYear ? 'true' : undefined}
                    aria-pressed={year === currentYear}
                    onClick={() => {
                      setCurrentYear(year);
                      setView('days');
                    }}
                    className={gridBtn(year === currentYear)}
                  >
                    {year}
                  </button>
                ))}
              </div>
            )}

            {view === 'days' && (
              <>
                {/* Day Headers */}
                <div className="grid grid-cols-7 gap-1 mb-1" aria-hidden>
                  {dayNames.map((day, index) => (
                    <div
                      key={`${day}-${index}`}
                      className="text-center text-sm sm:text-[13px] font-semibold sm:font-medium h-8 flex items-center justify-center text-tme-blue"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 gap-1">
                  {/* Empty cells for days before month starts */}
                  {Array.from({ length: getFirstDayOfMonth(currentMonth, currentYear) }).map((_, index) => (
                    <div key={`empty-${index}`} className="h-11 sm:h-9" />
                  ))}

                  {/* Days of the month */}
                  {Array.from({ length: getDaysInMonth(currentMonth, currentYear) }).map((_, index) => {
                    const day = index + 1;
                    const date = new Date(currentYear, currentMonth, day);
                    const dateString = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
                    const isSelected = value === dateString;
                    const isToday =
                      new Date().getDate() === day &&
                      new Date().getMonth() === currentMonth &&
                      new Date().getFullYear() === currentYear;

                    return (
                      <button
                        type="button"
                        key={day}
                        aria-label={dateString}
                        aria-pressed={isSelected}
                        aria-current={isToday ? 'date' : undefined}
                        onClick={() => handleDateSelect(day)}
                        className={`h-11 sm:h-9 w-full rounded-[10px] sm:rounded-lg text-[15px] sm:text-sm font-medium transition-colors duration-150 flex items-center justify-center tme-btn-focus ${
                          isSelected
                            ? 'bg-tme-blue text-white shadow-md'
                            : isToday
                              ? 'border-2 border-tme-blue text-tme-blue font-semibold hover:bg-blue-50'
                              : 'text-gray-800 hover:bg-blue-50'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Calendar Footer */}
            <div className="flex justify-between items-center gap-2 mt-3 pt-3 border-t border-gray-200">
              <Button
                tone="plain"
                onClick={() => {
                  onChange('');
                  setIsCalendarOpen(false);
                }}
              >
                {texts?.clear ?? 'Clear'}
              </Button>

              <Button
                tone="secondary"
                onClick={() => {
                  const now = new Date();
                  setCurrentMonth(now.getMonth());
                  setCurrentYear(now.getFullYear());
                  const formatted = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
                  onChange(formatted);
                  setIsCalendarOpen(false);
                }}
              >
                {texts?.today ?? 'Today'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
      <FieldError>{error}</FieldError>
    </div>
  );
}
