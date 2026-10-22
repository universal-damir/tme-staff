'use client';

import React from 'react';
import { CurrencyInput } from '@/components/ui';
import { InfoNote } from './chrome';
import { deriveNumberOfShares, shareCapitalErrors, type DraftCompany } from './draft';
import {
  COMPANY_SETUP_MAX_SHARE_CAPITAL_AED,
  COMPANY_SETUP_MAX_VALUE_PER_SHARE_AED,
} from '@/lib/company-setup-validation';

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
  const errors = shareCapitalErrors(company);

  return (
    <div className="space-y-6">
      <InfoNote title="Share capital">
        IFZA requires a minimum share capital of AED 10,000. The minimum value of each share is AED
        10. Most commonly, the share capital is divided into 100 shares (e.g. AED 10,000 as 100
        shares of AED 100 each). If you are unsure how to structure it, feel free to leave these
        fields blank and your TME consultant will guide you.
      </InfoNote>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CurrencyInput
          label="Share capital"
          currency="AED"
          decimals={0}
          max={COMPANY_SETUP_MAX_SHARE_CAPITAL_AED}
          value={shareCapitalAED ?? ''}
          onChange={(v) => apply({ shareCapitalAED: v > 0 ? v : undefined })}
          placeholder="10,000"
          error={errors.capital}
        />
        <CurrencyInput
          label="Value per share"
          currency="AED"
          decimals={0}
          max={COMPANY_SETUP_MAX_VALUE_PER_SHARE_AED}
          value={valuePerShareAED ?? ''}
          onChange={(v) => apply({ valuePerShareAED: v > 0 ? v : undefined })}
          placeholder="100"
          error={errors.perShare}
        />
        <div>
          <label
            htmlFor="company-setup-number-of-shares"
            className="block text-[15px] font-semibold mb-1.5 text-tme-blue sm:text-sm sm:font-medium"
          >
            Number of shares
          </label>
          <input
            id="company-setup-number-of-shares"
            type="text"
            value={
              numberOfShares !== undefined
                ? formatNumberWithSeparators(String(numberOfShares))
                : ''
            }
            readOnly
            tabIndex={-1}
            placeholder="Calculated for you"
            className="w-full h-[46px] px-3.5 rounded-[10px] border-2 border-gray-200 bg-gray-100 text-gray-700 cursor-not-allowed text-base sm:h-10 sm:border sm:border-gray-300 sm:rounded-lg sm:text-sm"
          />
          <p className="text-sm text-gray-600 mt-1.5 sm:text-[13px]">
            Calculated for you: share capital divided by the value per share.
          </p>
        </div>
      </div>
    </div>
  );
}
