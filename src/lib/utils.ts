/**
 * Utility functions for staff onboarding
 */

import { DEFAULT_SALARY_BREAKDOWN } from './constants';

// ===================================================================
// DATE FORMATTING
// ===================================================================

/**
 * Format ISO date to dd.mm.yyyy display format
 */
export function formatDateDisplay(isoDate: string | undefined): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Parse dd.mm.yyyy display format to ISO date
 */
export function parseDateToISO(displayDate: string): string {
  const parts = displayDate.split('.');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Format date for input fields (YYYY-MM-DD)
 */
export function formatDateForInput(isoDate: string | undefined): string {
  if (!isoDate) return '';
  return isoDate.split('T')[0];
}

// ===================================================================
// SALARY CALCULATION
// ===================================================================

/**
 * Calculate salary breakdown from total using default percentages
 */
export function calculateSalaryBreakdown(total: number): {
  basic: number;
  accommodation: number;
  transport: number;
  food: number;
  other: number;
} {
  const basic = Math.round(total * DEFAULT_SALARY_BREAKDOWN.basic * 100) / 100;
  const accommodation = Math.round(total * DEFAULT_SALARY_BREAKDOWN.accommodation * 100) / 100;
  const transport = Math.round(total * DEFAULT_SALARY_BREAKDOWN.transport * 100) / 100;
  const food = 0;
  const other = 0;

  // Adjust for rounding - add remainder to basic
  const sum = basic + accommodation + transport + food + other;
  const adjustedBasic = basic + (total - sum);

  return {
    basic: Math.round(adjustedBasic * 100) / 100,
    accommodation,
    transport,
    food,
    other,
  };
}

/**
 * Validate salary breakdown sums to total
 */
export function validateSalaryBreakdown(
  total: number,
  basic: number,
  accommodation: number,
  transport: number,
  food: number = 0,
  other: number = 0
): { valid: boolean; difference: number } {
  const sum = basic + accommodation + transport + food + other;
  const difference = Math.abs(sum - total);
  return {
    valid: difference < 0.01,
    difference,
  };
}

// ===================================================================
// NAME FORMATTING
// ===================================================================

/**
 * Calculate full name from parts
 */
export function calculateFullName(
  firstName: string,
  middleName: string | undefined,
  lastName: string
): string {
  const parts = [firstName, middleName, lastName].filter(Boolean);
  return parts.join(' ');
}

// ===================================================================
// VALIDATION
// ===================================================================

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate UAE mobile number (starts with 05)
 */
export function isValidUAEMobile(number: string): boolean {
  const cleaned = number.replace(/\D/g, '');
  return cleaned.length === 10 && cleaned.startsWith('05');
}

/**
 * Validate IBAN format (basic check)
 */
export function isValidIBAN(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  // UAE IBAN is 23 characters: AE + 2 check digits + 3 bank code + 16 account
  return /^AE\d{21}$/.test(cleaned);
}

// ===================================================================
// CURRENCY FORMATTING
// ===================================================================

/**
 * Format number as currency
 */
export function formatCurrency(
  amount: number | undefined,
  currency: string = 'AED'
): string {
  if (amount === undefined || isNaN(amount)) return '';
  return `${currency} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ===================================================================
// CLASS NAME UTILITY
// ===================================================================

/**
 * Merge class names conditionally
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
