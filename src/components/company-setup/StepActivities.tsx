'use client';

import React from 'react';
import { TME_COLORS } from '@/lib/constants';
import { CustomDropdown } from '@/components/ui';
import { InfoNote } from './chrome';
import type { DraftCompany } from './draft';
import {
  COMPANY_SETUP_INCLUDED_ACTIVITIES,
  COMPANY_SETUP_MAX_ACTIVITIES,
  IFZA_BUSINESS_ACTIVITIES_URL,
  type CompanySetupLicenseType,
} from '@/types/company-setup';
import { Plus, Trash2, ExternalLink } from 'lucide-react';

const LICENSE_OPTIONS: { value: CompanySetupLicenseType; label: string }[] = [
  { value: 'Commercial', label: 'Commercial' },
  { value: 'Professional', label: 'Professional' },
  { value: 'Both', label: 'Both (Commercial + Professional)' },
];

interface StepActivitiesProps {
  company: DraftCompany;
  onChange: (patch: Partial<DraftCompany>) => void;
}

export function StepActivities({ company, onChange }: StepActivitiesProps) {
  const activities = company.activities;

  const setActivity = (
    index: number,
    patch: Partial<{ code: string; description: string }>
  ) => {
    const next = activities.map((a, i) => {
      if (i !== index) return a;
      const merged = { ...a, ...patch };
      const code = merged.code?.trim() ? merged.code : undefined;
      return { ...(code !== undefined ? { code: merged.code } : {}), description: merged.description ?? '' };
    });
    onChange({ activities: next });
  };

  const addActivity = () => {
    if (activities.length >= COMPANY_SETUP_MAX_ACTIVITIES) return;
    onChange({ activities: [...activities, { description: '' }] });
  };

  const removeActivity = (index: number) => {
    if (activities.length <= 1) return;
    onChange({ activities: activities.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <InfoNote title="Good to know">
          <ul className="list-disc pl-4 space-y-1">
            <li>
              {COMPANY_SETUP_INCLUDED_ACTIVITIES} business activities are included in the license
              package. Every additional activity costs AED 2,000 per year.
            </li>
            <li>
              Combining Commercial and Professional activities on one license costs AED 2,000 per
              year.
            </li>
          </ul>
        </InfoNote>
        <p className="text-sm text-gray-600">
          Describe each activity in your own words, or pick the exact wording from the official
          IFZA list:{' '}
          <a
            href={IFZA_BUSINESS_ACTIVITIES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium underline"
            style={{ color: TME_COLORS.primary }}
          >
            Browse IFZA activities
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          . The activity code is optional — copy it from the IFZA list when known.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: TME_COLORS.primary }}>
          Business activities ({activities.length}/{COMPANY_SETUP_MAX_ACTIVITIES})
          <span className="text-red-500 ml-1">*</span>
        </label>
        <div className="space-y-2">
          {activities.map((activity, index) => (
            <div key={index} className="flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: `${TME_COLORS.primary}12`, color: TME_COLORS.primary }}
              >
                {index + 1}
              </span>
              <input
                type="text"
                value={activity.code ?? ''}
                onChange={(e) => setActivity(index, { code: e.target.value })}
                placeholder="Code (optional)"
                maxLength={20}
                className="px-3 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 flex-shrink-0"
                style={{ height: 42, width: '8.5rem' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
                onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
              />
              <input
                type="text"
                value={activity.description}
                onChange={(e) => setActivity(index, { description: e.target.value })}
                placeholder={
                  index === 0 ? 'e.g. Management consultancy services' : 'Another activity'
                }
                maxLength={300}
                className="flex-1 px-3 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200"
                style={{ height: 42 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
                onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
              />
              <button
                type="button"
                onClick={() => removeActivity(index)}
                disabled={activities.length <= 1}
                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove this activity"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        {activities.length < COMPANY_SETUP_MAX_ACTIVITIES && (
          <button
            type="button"
            onClick={addActivity}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-sm"
            style={{ backgroundColor: '#f0f4ff', color: TME_COLORS.primary }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add activity
          </button>
        )}
        {activities.length > COMPANY_SETUP_INCLUDED_ACTIVITIES && (
          <p className="text-xs text-amber-700 mt-2">
            {activities.length - COMPANY_SETUP_INCLUDED_ACTIVITIES} additional{' '}
            {activities.length - COMPANY_SETUP_INCLUDED_ACTIVITIES === 1
              ? 'activity'
              : 'activities'}{' '}
            beyond the included {COMPANY_SETUP_INCLUDED_ACTIVITIES} — AED{' '}
            {((activities.length - COMPANY_SETUP_INCLUDED_ACTIVITIES) * 2000).toLocaleString(
              'en-US'
            )}{' '}
            per year extra.
          </p>
        )}
      </div>

      <div className="max-w-sm">
        <CustomDropdown
          label="License type"
          required
          value={company.licenseType ?? ''}
          onChange={(val) => onChange({ licenseType: val as CompanySetupLicenseType })}
          options={LICENSE_OPTIONS}
          placeholder="Select…"
        />
        {company.licenseType === 'Both' && (
          <p className="text-xs text-amber-700 mt-1">
            Combining Commercial and Professional activities costs AED 2,000 per year.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: TME_COLORS.primary }}>
          Brief description of your intended business
        </label>
        <textarea
          value={company.businessDescription ?? ''}
          onChange={(e) => onChange({ businessDescription: e.target.value })}
          rows={3}
          maxLength={1000}
          placeholder="In a few sentences: what will the company do, and for whom?"
          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:outline-none transition-all duration-200 text-sm"
          onFocus={(e) => (e.currentTarget.style.borderColor = TME_COLORS.primary)}
          onBlur={(e) => (e.currentTarget.style.borderColor = TME_COLORS.border)}
        />
      </div>
    </div>
  );
}
