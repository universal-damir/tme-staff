'use client';

import React from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Input, CustomDropdown, CurrencyInput } from '@/components/ui';
import { InfoNote } from './chrome';
import type { DraftCompany } from './draft';
import type { CompanySetupFacilityType, CompanySetupPerson } from '@/types/company-setup';
import {
  COMPANY_SETUP_MAX_MONTHLY_SALARY_AED,
  COMPANY_SETUP_MAX_VISA_COUNT,
} from '@/lib/company-setup-validation';

const FACILITY_OPTIONS: { value: CompanySetupFacilityType; label: string }[] = [
  { value: 'virtual_office', label: 'Virtual Office' },
  { value: 'office', label: 'Office' },
  { value: 'warehouse', label: 'Warehouse' },
];

interface StepVisaFacilityProps {
  company: DraftCompany;
  persons: CompanySetupPerson[];
  onCompanyChange: (patch: Partial<DraftCompany>) => void;
  onPersonsChange: (persons: CompanySetupPerson[]) => void;
}

export function StepVisaFacility({
  company,
  persons,
  onCompanyChange,
  onPersonsChange,
}: StepVisaFacilityProps) {
  const updateVisa = (index: number, patch: Partial<CompanySetupPerson['visa']>) => {
    onPersonsChange(
      persons.map((p, i) => (i === index ? { ...p, visa: { ...p.visa, ...patch } } : p))
    );
  };

  const visaPersonCount = persons.filter((p) => p.visa.visaRequired).length;

  return (
    <div className="space-y-6">
      <InfoNote title="Residence visas">
        The number of visas under the license affects the license fee. Tick each person below who
        needs a UAE residence visa through the new company. Additional employment visas (for staff
        hired later) can be included in the count.
      </InfoNote>

      <div className="space-y-3">
        <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
          Who needs a residence visa?
        </p>
        {persons.map((person, index) => (
          <div key={index} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={person.visa.visaRequired}
                onChange={(e) => updateVisa(index, { visaRequired: e.target.checked })}
                className="mt-0.5 w-4 h-4 shrink-0"
                style={{ accentColor: TME_COLORS.primary }}
              />
              <span className="text-sm text-gray-700 font-medium">
                {person.fullName.trim() || `Person ${index + 1}`}
              </span>
            </label>

            {person.visa.visaRequired && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Job title on the visa"
                  required
                  value={person.visa.jobTitle ?? ''}
                  onChange={(e) => updateVisa(index, { jobTitle: e.target.value })}
                  placeholder="e.g. General Manager"
                  maxLength={120}
                />
                <CurrencyInput
                  label="Basic monthly salary"
                  currency="AED"
                  decimals={0}
                  required
                  max={COMPANY_SETUP_MAX_MONTHLY_SALARY_AED}
                  value={person.visa.basicMonthlySalaryAED ?? ''}
                  onChange={(v) =>
                    updateVisa(index, { basicMonthlySalaryAED: v > 0 ? v : undefined })
                  }
                  placeholder="e.g. 10,000"
                />
                <div className="sm:col-span-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={person.visa.vipStamping === true}
                      onChange={(e) => updateVisa(index, { vipStamping: e.target.checked })}
                      className="mt-0.5 w-4 h-4 shrink-0"
                      style={{ accentColor: TME_COLORS.primary }}
                    />
                    <span className="text-sm text-gray-700">
                      VIP (express) visa stamping — AED 1,500 extra per visa
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="max-w-sm">
        <Input
          label="Total number of visas required under the license"
          type="number"
          inputMode="numeric"
          min={0}
          max={COMPANY_SETUP_MAX_VISA_COUNT}
          step={1}
          maxLength={3}
          value={company.visaCount ?? ''}
          onChange={(e) => {
            // Strip anything that is not a digit (kills "007", "1e9", "-3"),
            // then clamp to the same 0..100 window the server enforces.
            const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
            if (digits === '') {
              onCompanyChange({ visaCount: undefined });
              return;
            }
            const n = Math.min(Number(digits), COMPANY_SETUP_MAX_VISA_COUNT);
            onCompanyChange({ visaCount: n });
          }}
          helperText={
            visaPersonCount > 0
              ? `${visaPersonCount} of the persons above ${visaPersonCount === 1 ? 'needs' : 'need'} a visa. Add extra employment visas to the total if you plan to hire.`
              : 'Include employment visas for staff you plan to hire.'
          }
        />
      </div>

      <div className="border-t border-gray-100 pt-5 space-y-4">
        <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
          Facility
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <CustomDropdown
            label="Type of facility required"
            value={company.facilityType ?? ''}
            onChange={(val) => {
              const facilityType = val as CompanySetupFacilityType;
              onCompanyChange({
                facilityType,
                facilitySize: facilityType === 'virtual_office' ? 'n/a' : company.facilitySize === 'n/a' ? '' : company.facilitySize,
              });
            }}
            options={FACILITY_OPTIONS}
            placeholder="Select…"
          />
          {company.facilityType && company.facilityType !== 'virtual_office' && (
            <Input
              label="Approximate size"
              value={company.facilitySize ?? ''}
              onChange={(e) => onCompanyChange({ facilitySize: e.target.value })}
              placeholder="e.g. 25 sqm office / 200 sqm warehouse"
              maxLength={120}
            />
          )}
        </div>
        {company.facilityType === 'virtual_office' && (
          <p className="text-xs text-gray-500">
            A Virtual Office is included in the standard IFZA package — no physical space needed.
          </p>
        )}
      </div>
    </div>
  );
}
