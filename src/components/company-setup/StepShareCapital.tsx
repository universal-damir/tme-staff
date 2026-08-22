'use client';

import React from 'react';
import { TME_COLORS } from '@/lib/constants';
import { CurrencyInput } from '@/components/ui';
import { InfoNote } from './chrome';
import { deriveNumberOfShares, type DraftCompany } from './draft';

// Ported from the portal's cost-overview formatter
// (src/components/cost-overview/hooks/useFormattedInputs.tsx) — keep in sync.
const formatNumberWithSeparators = (value: string): string => {
  const cleaned = value.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.length > 1 ? parts.join('.') : parts[0];
};

interface StepShareCapitalProps {
  company: DraftCompany;
  onChange: (patch: Partial<DraftCompany>) => void;
}

/**
 * Share capital step: capital (AED) and value per share (AED) are entered;
 * the number of shares is ALWAYS auto-calculated (capital / value per share),
 * shown read-only and never overridable.
 */
export function StepShareCapital({ company, onChange }: StepShareCapitalProps) {
  const { shareCapitalAED, valuePerShareAED } = company;

  const apply = (patch: Partial<DraftCompany>) => {
    const capital =
      patch.shareCapitalAED !== undefined ? patch.shareCapitalAED : shareCapitalAED;
    const perShare =
      patch.valuePerShareAED !== undefined ? patch.valuePerShareAED : valuePerShareAED;
    onChange({ ...patch, numberOfShares: deriveNumberOfShares(capital, perShare) });
  };

  const numberOfShares = deriveNumberOfShares(shareCapitalAED, valuePerShareAED);

  return (
    <div className="space-y-6">
      <InfoNote title="Share capital">
        The standard IFZA share capital is AED 10,000 or more (e.g. AED 10,000 as 10,000 shares of
        AED 1 each, or 100 shares of AED 100 each). The share capital does not have to be paid
        into a bank account for the license to be issued. If you are unsure, leave the fields
        empty — your TME consultant will advise you.
      </InfoNote>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CurrencyInput
          label="Share capital"
          currency="AED"
          decimals={0}
          value={shareCapitalAED ?? ''}
          onChange={(v) => apply({ shareCapitalAED: v > 0 ? v : undefined })}
          placeholder="10,000"
        />
        <CurrencyInput
          label="Value per share"
          currency="AED"
          decimals={0}
          value={valuePerShareAED ?? ''}
          onChange={(v) => apply({ valuePerShareAED: v > 0 ? v : undefined })}
          placeholder="1"
        />
        <div>
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: TME_COLORS.primary, fontFamily: 'Inter, sans-serif' }}
          >
            Number of shares
          </label>
          <input
            type="text"
            value={
              numberOfShares !== undefined
                ? formatNumberWithSeparators(String(numberOfShares))
                : ''
            }
            readOnly
            tabIndex={-1}
            placeholder="Auto-calculated"
            className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 bg-gray-100 text-gray-600 cursor-not-allowed text-sm"
            style={{ height: 42, fontFamily: 'Inter, sans-serif' }}
          />
          <p className="text-xs text-gray-500 mt-1">
            Share capital / value per share — calculated automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
