/**
 * Salary amount helpers.
 *
 * Salary fields (contract + payroll) carry up to two decimal places. These
 * helpers back the salary inputs in SalaryBreakdown so the employer can type
 * fractional amounts (e.g. 4250.75). The inputs previously snapped the value
 * back to the parsed number on every keystroke, which erased the decimal point
 * the moment it was typed (the parent re-render forced the controlled input
 * back to the dot-stripped string).
 */

/**
 * Display formatter: thousand separators, up to 2 decimals, no forced trailing
 * zeros. Used for read-only display and for seeding/re-syncing input display
 * state from a numeric value.
 */
export function formatSalaryAmount(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return '';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Parse a typed/formatted string to a number, or `undefined` when empty.
 * Strips everything except digits and a decimal point (so commas are removed).
 */
export function parseSalaryAmount(value: string): number | undefined {
  if (!value || value.trim() === '') return undefined;
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned || cleaned === '.') return undefined;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Live "as you type" formatter. Unlike {@link formatSalaryAmount} it works on
 * the raw string, so a trailing decimal point or trailing zero the user is
 * mid-typing ("100.", "100.50") is preserved instead of being snapped back to
 * the parsed number — otherwise the decimal point can never be entered. Caps
 * decimals at two, keeps only the first decimal point, and adds thousand
 * separators to the integer part.
 */
export function formatSalaryAmountInput(value: string): string {
  const clean = value.replace(/[^0-9.]/g, '');
  if (clean === '') return '';
  const firstDot = clean.indexOf('.');
  if (firstDot === -1) {
    return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const intPart = clean.slice(0, firstDot).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Collapse any extra dots the user pasted; keep at most two decimal digits.
  const decPart = clean.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
  return `${intPart}.${decPart}`;
}

/**
 * Process a raw input value for a salary field, returning both the string to
 * show in the input and the number to emit to state. Parsing the formatted
 * (capped) string guarantees the displayed value and the stored number always
 * agree — e.g. typing "100.555" shows "100.55" and emits 100.55, never 100.555.
 */
export function applySalaryInput(raw: string): {
  display: string;
  value: number | undefined;
} {
  const display = formatSalaryAmountInput(raw);
  return { display, value: parseSalaryAmount(display) };
}

/** Round a salary sum to 2 decimals, avoiding float artifacts (0.1 + 0.2). */
export function roundSalaryAmount(value: number): number {
  return Math.round(value * 100) / 100;
}
