'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { TME_COLORS, SALARY_CURRENCIES, SALARY_BREAKDOWN_EXPLANATION, DEFAULT_SALARY_BREAKDOWN } from '@/lib/constants';
import { Select, Input } from '@/components/ui';
import { ChevronDown, ChevronUp, Info, AlertTriangle } from 'lucide-react';

interface SalaryBreakdownProps {
  currency: string;
  total: number | undefined;
  basic: number | undefined;
  accommodation: number | undefined;
  transport: number | undefined;
  food?: number | undefined;
  other?: number | undefined;
  onChange: (values: {
    salary_currency: string;
    salary_total: number | undefined;
    salary_basic: number | undefined;
    salary_accommodation: number | undefined;
    salary_transport: number | undefined;
    salary_food?: number | undefined;
    salary_other?: number | undefined;
  }) => void;
  errors?: {
    currency?: string;
    total?: string;
    basic?: string;
    accommodation?: string;
    transport?: string;
  };
}

export function SalaryBreakdown({
  currency,
  total,
  basic,
  accommodation,
  transport,
  food = 0,
  other = 0,
  onChange,
  errors,
}: SalaryBreakdownProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // Calculate sum and discrepancy
  const sum = (basic || 0) + (accommodation || 0) + (transport || 0) + (food || 0) + (other || 0);
  const hasDiscrepancy = total !== undefined && Math.abs(sum - total) > 0.01;

  // Auto-expand if there's a discrepancy
  useEffect(() => {
    if (hasDiscrepancy) {
      setIsExpanded(true);
    }
  }, [hasDiscrepancy]);

  // Auto-calculate breakdown when total changes
  const handleTotalChange = useCallback(
    (newTotal: number | undefined) => {
      if (newTotal === undefined || isNaN(newTotal)) {
        onChange({
          salary_currency: currency,
          salary_total: undefined,
          salary_basic: undefined,
          salary_accommodation: undefined,
          salary_transport: undefined,
          salary_food: undefined,
          salary_other: undefined,
        });
        return;
      }

      // Calculate breakdown using default percentages
      const newBasic = Math.round(newTotal * DEFAULT_SALARY_BREAKDOWN.basic * 100) / 100;
      const newAccommodation = Math.round(newTotal * DEFAULT_SALARY_BREAKDOWN.accommodation * 100) / 100;
      const newTransport = Math.round(newTotal * DEFAULT_SALARY_BREAKDOWN.transport * 100) / 100;
      const newFood = 0;
      const newOther = 0;

      // Adjust for rounding
      const calculatedSum = newBasic + newAccommodation + newTransport + newFood + newOther;
      const adjustedBasic = Math.round((newBasic + (newTotal - calculatedSum)) * 100) / 100;

      onChange({
        salary_currency: currency,
        salary_total: newTotal,
        salary_basic: adjustedBasic,
        salary_accommodation: newAccommodation,
        salary_transport: newTransport,
        salary_food: newFood,
        salary_other: newOther,
      });
    },
    [currency, onChange]
  );

  // Set total from sum
  const handleSetTotalFromSum = () => {
    onChange({
      salary_currency: currency,
      salary_total: Math.round(sum * 100) / 100,
      salary_basic: basic,
      salary_accommodation: accommodation,
      salary_transport: transport,
      salary_food: food,
      salary_other: other,
    });
  };

  const getPercentage = (value: number | undefined) => {
    if (!total || !value) return '0%';
    return `${Math.round((value / total) * 100)}%`;
  };

  return (
    <div className="space-y-4">
      {/* Currency and Total */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Select
          label="Currency"
          value={currency}
          onChange={(e) =>
            onChange({
              salary_currency: e.target.value,
              salary_total: total,
              salary_basic: basic,
              salary_accommodation: accommodation,
              salary_transport: transport,
              salary_food: food,
              salary_other: other,
            })
          }
          options={SALARY_CURRENCIES}
          error={errors?.currency}
          required
        />

        <div className="md:col-span-2">
          <Input
            label="Monthly Salary (Total)"
            type="number"
            value={total ?? ''}
            onChange={(e) =>
              handleTotalChange(e.target.value ? parseFloat(e.target.value) : undefined)
            }
            placeholder="Enter total monthly salary"
            error={errors?.total}
            required
          />
        </div>
      </div>

      {/* Info Toggle */}
      <button
        type="button"
        onClick={() => setShowInfo(!showInfo)}
        className="flex items-center gap-2 text-sm hover:underline"
        style={{ color: TME_COLORS.primary }}
      >
        <Info className="w-4 h-4" />
        {showInfo ? 'Hide salary breakdown info' : 'About salary breakdown'}
      </button>

      {showInfo && (
        <div
          className="p-4 rounded-lg text-sm"
          style={{ backgroundColor: '#EBF4FF', color: TME_COLORS.primary }}
        >
          {SALARY_BREAKDOWN_EXPLANATION}
        </div>
      )}

      {/* Breakdown Toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm font-medium"
        style={{ color: TME_COLORS.primary }}
      >
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {isExpanded ? 'Hide breakdown' : 'Show breakdown'}
        {hasDiscrepancy && (
          <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Mismatch
          </span>
        )}
      </button>

      {/* Breakdown Fields */}
      {isExpanded && (
        <div className="space-y-4 pt-2 border-t border-gray-200">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <Input
                label={`Basic (${getPercentage(basic)})`}
                type="number"
                value={basic ?? ''}
                onChange={(e) =>
                  onChange({
                    salary_currency: currency,
                    salary_total: total,
                    salary_basic: e.target.value ? parseFloat(e.target.value) : undefined,
                    salary_accommodation: accommodation,
                    salary_transport: transport,
                    salary_food: food,
                    salary_other: other,
                  })
                }
                error={errors?.basic}
              />
            </div>

            <div>
              <Input
                label={`Housing (${getPercentage(accommodation)})`}
                type="number"
                value={accommodation ?? ''}
                onChange={(e) =>
                  onChange({
                    salary_currency: currency,
                    salary_total: total,
                    salary_basic: basic,
                    salary_accommodation: e.target.value ? parseFloat(e.target.value) : undefined,
                    salary_transport: transport,
                    salary_food: food,
                    salary_other: other,
                  })
                }
                error={errors?.accommodation}
              />
            </div>

            <div>
              <Input
                label={`Transport (${getPercentage(transport)})`}
                type="number"
                value={transport ?? ''}
                onChange={(e) =>
                  onChange({
                    salary_currency: currency,
                    salary_total: total,
                    salary_basic: basic,
                    salary_accommodation: accommodation,
                    salary_transport: e.target.value ? parseFloat(e.target.value) : undefined,
                    salary_food: food,
                    salary_other: other,
                  })
                }
                error={errors?.transport}
              />
            </div>

            <div>
              <Input
                label={`Food (${getPercentage(food)})`}
                type="number"
                value={food ?? ''}
                onChange={(e) =>
                  onChange({
                    salary_currency: currency,
                    salary_total: total,
                    salary_basic: basic,
                    salary_accommodation: accommodation,
                    salary_transport: transport,
                    salary_food: e.target.value ? parseFloat(e.target.value) : undefined,
                    salary_other: other,
                  })
                }
              />
            </div>

            <div>
              <Input
                label={`Other (${getPercentage(other)})`}
                type="number"
                value={other ?? ''}
                onChange={(e) =>
                  onChange({
                    salary_currency: currency,
                    salary_total: total,
                    salary_basic: basic,
                    salary_accommodation: accommodation,
                    salary_transport: transport,
                    salary_food: food,
                    salary_other: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
              />
            </div>
          </div>

          {/* Discrepancy Warning */}
          {hasDiscrepancy && (
            <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                <span className="text-sm">
                  Sum ({currency} {sum.toFixed(2)}) does not match total ({currency} {total?.toFixed(2)})
                </span>
              </div>
              <button
                type="button"
                onClick={handleSetTotalFromSum}
                className="px-3 py-1 text-sm font-medium text-white rounded"
                style={{ backgroundColor: TME_COLORS.primary }}
              >
                Set Total to {currency} {sum.toFixed(2)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
