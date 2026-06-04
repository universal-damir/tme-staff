import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SalaryBreakdown } from './SalaryBreakdown';

// Regression cover for the decimal-entry fix: the salary inputs used to snap
// every value back to the parsed number on each keystroke, so the parent
// re-render erased a just-typed decimal point. These tests drive the real
// component and assert the emitted numbers carry up to two decimals.

function renderBreakdown(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(
    <SalaryBreakdown
      currency="AED"
      total={undefined}
      basic={undefined}
      accommodation={undefined}
      transport={undefined}
      accommodationProvided="allowance"
      transportProvided="allowance"
      foodProvided="no"
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

/** Last patch the component emitted carrying a defined value for `key`. */
function lastValueFor(onChange: ReturnType<typeof vi.fn>, key: string) {
  for (let i = onChange.mock.calls.length - 1; i >= 0; i--) {
    const patch = onChange.mock.calls[i][0] as Record<string, unknown>;
    if (key in patch && patch[key] !== undefined) return patch[key];
  }
  return undefined;
}

describe('SalaryBreakdown decimal entry', () => {
  it('emits a 2-decimal value typed into the Basic field', () => {
    const { onChange } = renderBreakdown();
    // First textbox is Basic (the currency selector is a custom dropdown button).
    const basic = screen.getAllByRole('textbox')[0];
    fireEvent.change(basic, { target: { value: '4250.75' } });
    expect(lastValueFor(onChange, 'salary_basic')).toBe(4250.75);
  });

  it('caps to two decimals', () => {
    const { onChange } = renderBreakdown();
    const basic = screen.getAllByRole('textbox')[0];
    fireEvent.change(basic, { target: { value: '100.555' } });
    expect(lastValueFor(onChange, 'salary_basic')).toBe(100.55);
  });

  it('accepts thousand-separated decimal input on the Monthly Total', () => {
    const { onChange } = renderBreakdown();
    const total = screen.getByLabelText('Monthly salary total');
    fireEvent.change(total, { target: { value: '12,500.50' } });
    expect(lastValueFor(onChange, 'salary_total')).toBe(12500.5);
  });

  it('treats a trailing decimal point as the integer value', () => {
    const { onChange } = renderBreakdown();
    const basic = screen.getAllByRole('textbox')[0];
    fireEvent.change(basic, { target: { value: '4250.' } });
    expect(lastValueFor(onChange, 'salary_basic')).toBe(4250);
  });
});

describe('SalaryBreakdown provided-flag selection', () => {
  it('shows the "Select…" placeholder for each unselected provided flag', () => {
    // Accommodation / Transportation / Food all start unset ('').
    renderBreakdown({
      accommodationProvided: '',
      transportProvided: '',
      foodProvided: '',
    });
    expect(screen.getAllByText(/^Select/)).toHaveLength(3);
  });

  it('renders validation errors passed for unselected provided flags', () => {
    renderBreakdown({
      accommodationProvided: '',
      transportProvided: '',
      foodProvided: '',
      errors: { accommodationProvided: 'Please select' },
    });
    expect(screen.getByText('Please select')).toBeInTheDocument();
  });
});
