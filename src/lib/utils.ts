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
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Conservative person-name casing normalizer (mirrors the tme-portal sync-side
 * helper so typed names and document-extracted names end up cased the same way).
 *
 * Rule:
 *   - A word that is entirely UPPERCASE or entirely lowercase is re-cased to
 *     Title Case ("ANITTA DAVIS" / "anitta davis" -> "Anitta Davis").
 *   - A word that already has mixed case is left untouched, so deliberately
 *     cased names survive: "McDonald", "al-Rashid", "O'Brien".
 *   - Accidental double/leading/trailing whitespace is collapsed (also repairs
 *     a trailing space in the first name, which produced "ANITTA  DAVIS").
 */
export function normalizePersonName(raw?: string | null): string {
  const collapsed = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return collapsed;

  return collapsed
    .split(' ')
    .map((token) => {
      const isAllUpper = token === token.toUpperCase();
      const isAllLower = token === token.toLowerCase();
      if (!isAllUpper && !isAllLower) return token;
      return token
        .toLowerCase()
        .replace(/(^|[-'.’])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
    })
    .join(' ');
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

// ===================================================================
// IMAGE COMPRESSION
// ===================================================================

/**
 * Compress image to fit within Claude API limits (5MB base64 = ~3.5MB raw)
 * Resizes to max 1500px and compresses to JPEG
 */
export async function compressImageForAI(base64Image: string): Promise<string> {
  // PDFs can't be decoded by an <img> element, so the resize path below would
  // throw (or hit the decode timeout). The backend accepts PDFs directly via
  // Claude's `document` content block (see passport-page-validation.ts), so
  // pass them through untouched rather than failing validation/extraction.
  if (base64Image.startsWith('data:application/pdf')) {
    return base64Image;
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    // Belt-and-braces: if the browser can't decode the data URL (e.g. a PDF
    // or HEIC/AVIF that snuck past the file picker), neither onload nor
    // onerror may fire reliably. Time-bound so the caller can surface an
    // error instead of leaving the UI stuck on "validating".
    const timer = setTimeout(() => {
      finish(() => reject(new Error('Image decode timed out')));
    }, 15000);
    img.onload = () => finish(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      // Max dimension 1500px (enough for AI to analyze)
      const maxDim = 1500;
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (height / width) * maxDim;
          width = maxDim;
        } else {
          width = (width / height) * maxDim;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Compress to JPEG at 80% quality
      const compressed = canvas.toDataURL('image/jpeg', 0.8);
      resolve(compressed);
    });
    img.onerror = () => finish(() => reject(new Error('Image could not be decoded')));
    img.src = base64Image;
  });
}

/**
 * Deterministic top-edge clipping check for passport photos.
 *
 * A compliant photo has light background above the head, so the topmost rows
 * of the image are near-white. When hair is cut off by the frame, hair-dark
 * pixels sit directly on the top border. Vision-model judgment on edge
 * contact proved unstable run-to-run, so this is decided in pixels instead:
 * measured 0.00 dark-fraction on compliant photos vs 0.37 on a clipped one —
 * threshold 0.10 splits them with wide margin. Light-blond hair on a white
 * background can evade this; the AI validator still gets its shot after.
 *
 * Returns true when the top edge looks clipped. Returns false on any decode
 * problem — this is a pre-filter, never a blocker of its own.
 */
export async function topEdgeLooksClipped(imageDataUrl: string): Promise<boolean> {
  if (imageDataUrl.startsWith('data:application/pdf')) return false;
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 10000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(false);
        canvas.width = img.width;
        canvas.height = Math.min(3, img.height);
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let dark = 0;
        const total = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          // Rec. 601 luminance
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum < 120) dark++;
        }
        resolve(dark / total > 0.1);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = imageDataUrl;
  });
}
