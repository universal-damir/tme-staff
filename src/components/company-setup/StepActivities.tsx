'use client';

import React from 'react';
import { AutoGrowText, Button, textFieldClasses } from '@/components/ui';
import { InfoNote, WarningNote } from './chrome';
import type { DraftCompany } from './draft';
import {
  COMPANY_SETUP_INCLUDED_ACTIVITIES,
  COMPANY_SETUP_MAX_ACTIVITIES,
  IFZA_BUSINESS_ACTIVITIES_URL,
} from '@/types/company-setup';
import { Plus, Trash2, ExternalLink } from 'lucide-react';

// Text never cut (Damir 22.10): both boxes grow to more lines with a long entry.
const FIELD_CLASS = textFieldClasses(false, 'min-w-0');

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

  const extra = activities.length - COMPANY_SETUP_INCLUDED_ACTIVITIES;

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
        <p className="text-[15px] text-gray-700 leading-relaxed sm:text-sm">
          Please copy the exact wording of each activity from the official IFZA list:{' '}
          <a
            href={IFZA_BUSINESS_ACTIVITIES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline text-tme-blue"
          >
            Browse IFZA activities
            <ExternalLink className="w-4 h-4" aria-hidden />
          </a>
          . The activity code is optional. Copy it from the IFZA list when you know it.
        </p>
      </div>

      <div>
        <p className="block text-[15px] font-semibold mb-2 text-tme-blue sm:text-sm">
          Business activities ({activities.length} of {COMPANY_SETUP_MAX_ACTIVITIES})
          <span className="text-tme-red ml-1" aria-hidden>*</span>
        </p>
        <div className="space-y-3">
          {activities.map((activity, index) => (
            <div
              key={index}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_8.5rem_minmax(0,1fr)_auto] items-start gap-2"
            >
              <span className="w-7 h-7 mt-[9px] rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0 bg-blue-50 text-tme-blue sm:mt-1.5">
                {index + 1}
              </span>
              <AutoGrowText
                value={activity.code ?? ''}
                onChange={(e) => setActivity(index, { code: e.target.value })}
                placeholder="Code (optional)"
                aria-label={`Activity ${index + 1}: code (optional)`}
                maxLength={20}
                className={FIELD_CLASS}
              />
              <AutoGrowText
                value={activity.description}
                onChange={(e) => setActivity(index, { description: e.target.value })}
                placeholder={
                  index === 0 ? 'e.g. Management consultancy services' : 'Another activity'
                }
                aria-label={`Activity ${index + 1}: name`}
                maxLength={300}
                className={`${FIELD_CLASS} order-last col-span-3 sm:order-none sm:col-span-1`}
              />
              <Button
                tone="dangerGhost"
                onClick={() => removeActivity(index)}
                disabled={activities.length <= 1}
                aria-label={`Remove activity ${index + 1}`}
                className="size-11 !px-0 mt-px sm:size-9 sm:mt-0.5"
              >
                <Trash2 className="w-[18px] h-[18px]" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
        {activities.length < COMPANY_SETUP_MAX_ACTIVITIES && (
          <Button tone="secondary" onClick={addActivity} className="mt-3">
            <Plus className="w-4 h-4" aria-hidden />
            Add activity
          </Button>
        )}
        {extra > 0 && (
          <WarningNote className="mt-3">
            {extra} additional {extra === 1 ? 'activity' : 'activities'} beyond the included{' '}
            {COMPANY_SETUP_INCLUDED_ACTIVITIES}: AED {(extra * 2000).toLocaleString('en-US')} per
            year extra.
          </WarningNote>
        )}
      </div>

      {/* License type is no longer asked here (tester feedback 27.09.26). The
          data field stays optional in the contract so TME can still set it in
          the portal editor. */}

      <div>
        <label
          htmlFor="company-setup-business-description"
          className="block text-[15px] font-semibold mb-1.5 text-tme-blue sm:text-sm sm:font-medium"
        >
          Brief description of your intended business
        </label>
        <textarea
          id="company-setup-business-description"
          value={company.businessDescription ?? ''}
          onChange={(e) => onChange({ businessDescription: e.target.value })}
          rows={3}
          maxLength={1000}
          placeholder="In a few sentences: what will the company do, and for whom?"
          className="w-full px-3.5 py-2.5 rounded-[10px] border-2 border-gray-200 focus:outline-none focus:border-tme-blue transition-colors duration-200 text-base sm:py-2 sm:border sm:border-gray-300 sm:rounded-lg sm:text-sm sm:focus:ring-2 sm:focus:ring-tme-blue/15"
        />
      </div>
    </div>
  );
}
