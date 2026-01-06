'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { TME_COLORS, INPUT_HEIGHT } from '@/lib/constants';

interface CustomDatePickerProps {
  label?: string;
  value: string; // Format: dd.mm.yyyy
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * CustomDatePicker - Reusable date picker component
 * Features:
 * - TME design standards (42px height, colors, fonts)
 * - Calendar popup with month/year navigation
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
}: CustomDatePickerProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

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

  const formatDisplayDate = (dateString: string) => {
    if (!dateString) return placeholder;
    // Value is already in dd.mm.yyyy format
    return dateString;
  };

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
        <motion.button
          type="button"
          onClick={() => !disabled && setIsCalendarOpen(!isCalendarOpen)}
          whileHover={!disabled ? { scale: 1.01 } : undefined}
          className={`w-full px-3 py-2 rounded-lg border-2 border-gray-200 transition-all duration-200 flex items-center justify-between text-left ${
            disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'cursor-pointer bg-white'
          }`}
          style={{
            height: `${INPUT_HEIGHT}px`,
            borderColor: error ? '#ef4444' : isCalendarOpen ? TME_COLORS.primary : '#e5e7eb',
            fontFamily: 'Inter, sans-serif',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled && !isCalendarOpen && !error) {
              e.currentTarget.style.borderColor = TME_COLORS.primary;
            }
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled && !isCalendarOpen && !error) {
              e.currentTarget.style.borderColor = '#e5e7eb';
            }
          }}
        >
          {/* Display value */}
          <span
            className={`text-sm ${value ? 'text-gray-900' : 'text-gray-500'}`}
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            {formatDisplayDate(value)}
          </span>

          {/* Calendar icon - clickable to toggle */}
          <div
            className={`flex-shrink-0 ${disabled ? '' : 'cursor-pointer'}`}
            onClick={(e) => {
              if (!disabled) {
                e.stopPropagation();
                setIsCalendarOpen(!isCalendarOpen);
              }
            }}
          >
            <Calendar className="w-5 h-5" style={{ color: TME_COLORS.primary }} />
          </div>
        </motion.button>
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
            className="absolute z-50 w-full mt-1 bg-white border-2 rounded-lg shadow-xl p-4 min-w-[320px]"
            style={{ borderColor: TME_COLORS.primary }}
          >
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4 gap-2">
              <motion.button
                type="button"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => navigateMonth('prev')}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-150 flex-shrink-0"
              >
                <ChevronLeft className="w-5 h-5" style={{ color: TME_COLORS.primary }} />
              </motion.button>

              <div className="flex items-center gap-2 flex-1">
                {/* Month Selector */}
                <select
                  value={currentMonth}
                  onChange={(e) => setCurrentMonth(Number(e.target.value))}
                  className="px-2 py-1 text-sm font-semibold rounded border transition-all cursor-pointer"
                  style={{
                    color: TME_COLORS.primary,
                    fontFamily: 'Inter, sans-serif',
                    borderColor: `${TME_COLORS.primary}80`,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = `${TME_COLORS.primary}80`)}
                  onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = `${TME_COLORS.primary}80`)}
                >
                  {monthNames.map((month, index) => (
                    <option key={month} value={index}>
                      {month}
                    </option>
                  ))}
                </select>

                {/* Year Selector */}
                <select
                  value={currentYear}
                  onChange={(e) => setCurrentYear(Number(e.target.value))}
                  className="px-2 py-1 text-sm font-semibold rounded border transition-all cursor-pointer"
                  style={{
                    color: TME_COLORS.primary,
                    fontFamily: 'Inter, sans-serif',
                    borderColor: `${TME_COLORS.primary}80`,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = `${TME_COLORS.primary}80`)}
                  onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = `${TME_COLORS.primary}80`)}
                >
                  {Array.from({ length: 111 }, (_, i) => today.getFullYear() - 100 + i).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => navigateMonth('next')}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-150 flex-shrink-0"
              >
                <ChevronRight className="w-5 h-5" style={{ color: TME_COLORS.primary }} />
              </motion.button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map((day, index) => (
                <div
                  key={`${day}-${index}`}
                  className="text-center text-sm font-semibold py-2 w-10 h-8 flex items-center justify-center"
                  style={{ color: TME_COLORS.primary }}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Days */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells for days before month starts */}
              {Array.from({ length: getFirstDayOfMonth(currentMonth, currentYear) }).map((_, index) => (
                <div key={`empty-${index}`} className="h-10 w-10" />
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
                  <motion.button
                    type="button"
                    key={day}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleDateSelect(day)}
                    className={`h-10 w-10 rounded-lg text-sm font-medium transition-all duration-150 flex items-center justify-center ${
                      isSelected
                        ? 'text-white shadow-md'
                        : isToday
                        ? 'text-white border-2'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    style={{
                      backgroundColor: isSelected ? TME_COLORS.primary : isToday ? TME_COLORS.secondary : 'transparent',
                      borderColor: isToday ? TME_COLORS.primary : 'transparent'
                    }}
                  >
                    {day}
                  </motion.button>
                );
              })}
            </div>

            {/* Calendar Footer */}
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-200">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  onChange('');
                  setIsCalendarOpen(false);
                }}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors duration-150"
              >
                Clear
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  const today = new Date();
                  setCurrentMonth(today.getMonth());
                  setCurrentYear(today.getFullYear());
                  handleDateSelect(today.getDate());
                }}
                className="px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150"
                style={{ backgroundColor: TME_COLORS.secondary, color: TME_COLORS.primary }}
              >
                Today
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error message */}
      {error && (
        <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter, sans-serif' }}>
          {error}
        </p>
      )}
    </div>
  );
}
