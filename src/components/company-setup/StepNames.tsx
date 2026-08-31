'use client';

import React, { useState } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { InfoNote } from './chrome';
import type { DraftCompany } from './draft';
import {
  validateCompanyName,
  COMPANY_NAME_RULES,
} from '@/lib/company-setup-name-validation';
import {
  COMPANY_SETUP_NAME_OPTIONS_REQUIRED,
  type CompanySetupPrefillData,
} from '@/types/company-setup';
import { AlertTriangle, CheckCircle, ListChecks, Loader2, Sparkles, X, XCircle } from 'lucide-react';

export interface AiNameIssue {
  name: string;
  issues: string[];
}

interface StepNamesProps {
  company: DraftCompany;
  /** Staff pre-fill — used to mark which options TME suggested. */
  prefill: CompanySetupPrefillData | null;
  onChange: (patch: Partial<DraftCompany>) => void;
  /** AI warnings from the last validate-names call (never blocking). */
  aiIssues: AiNameIssue[];
  /** Calls the suggest-names endpoint; resolves to the suggestions (or null on failure). */
  onSuggest: () => Promise<string[] | null>;
  /**
   * False when there is not a single business activity yet — suggestions are
   * generated FROM the activities, so without them the button is disabled
   * rather than producing names about a business we know nothing about.
   */
  canSuggest: boolean;
}

export function StepNames({
  company,
  prefill,
  onChange,
  aiIssues,
  onSuggest,
  canSuggest,
}: StepNamesProps) {
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const names = company.nameOptions;
  const staffNames = prefill?.company?.nameOptions ?? [];
  const anyStaffSuggestion = staffNames.some((o) => (o?.name ?? '').trim().length > 0);
  const allFilled = names.every((o) => o.name.trim().length > 0);

  const setName = (index: number, name: string) => {
    onChange({ nameOptions: names.map((o, i) => (i === index ? { name } : o)) });
  };

  const applySuggestion = (name: string) => {
    // Fill the first empty slot. When all three are filled, nothing is
    // overwritten — silently replacing option 3 destroyed a name the client
    // had typed. The chips are disabled in that state.
    const emptyIndex = names.findIndex((o) => !o.name.trim());
    if (emptyIndex === -1) return;
    setName(emptyIndex, name);
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const result = await onSuggest();
      if (result && result.length > 0) {
        setSuggestions(result);
      } else {
        setSuggestError('We could not generate suggestions right now. Please try again.');
      }
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Please provide {COMPANY_SETUP_NAME_OPTIONS_REQUIRED} company name options in your order of
        preference. The authority checks them in this order and registers the first one that is
        available and approved.
      </p>

      {/* The full IFZA name rules — always visible on this step (PM requirement:
          a clearly displayed checklist, never a tooltip). */}
      <div
        className="rounded-xl border-2 p-4"
        style={{ borderColor: `${TME_COLORS.primary}25`, backgroundColor: 'rgba(36,63,123,0.04)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <ListChecks className="w-5 h-5" style={{ color: TME_COLORS.primary }} />
          <p className="text-sm font-semibold" style={{ color: TME_COLORS.primary }}>
            IFZA company name rules
          </p>
        </div>
        <ul className="space-y-1.5">
          {COMPANY_NAME_RULES.map((rule, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle
                className="w-4 h-4 mt-0.5 flex-shrink-0"
                style={{ color: TME_COLORS.primary }}
              />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      {anyStaffSuggestion && (
        <p className="text-sm text-gray-600 -mt-2">
          Your TME consultant suggested these names. You can change or clear any of them.
        </p>
      )}

      <div className="space-y-4">
        {names.map((option, index) => {
          const trimmed = option.name.trim();
          const result = trimmed ? validateCompanyName(trimmed) : null;
          const ai = aiIssues.find((i) => i.name === trimmed && i.issues.length > 0);
          const staffName = (staffNames[index]?.name ?? '').trim();
          const isStaffSuggestion = staffName.length > 0 && staffName === trimmed;
          return (
            <div key={index}>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: TME_COLORS.primary }}
              >
                Name option {index + 1}
                <span className="text-red-500 ml-1">*</span>
                {index === 0 && <span className="ml-2 text-xs text-gray-400">(preferred)</span>}
                {isStaffSuggestion && (
                  <span
                    className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full align-middle"
                    style={{
                      backgroundColor: `${TME_COLORS.primary}12`,
                      color: TME_COLORS.primary,
                    }}
                  >
                    Suggested by TME
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={option.name}
                  onChange={(e) => setName(index, e.target.value)}
                  placeholder="e.g. Horizon Trade FZCO — type the name without the suffix"
                  maxLength={120}
                  className={`w-full px-3 pr-16 rounded-lg border-2 focus:outline-none transition-all duration-200 ${
                    result && !result.valid ? 'border-red-400' : 'border-gray-200'
                  }`}
                  style={{ height: 42 }}
                  onFocus={(e) => {
                    if (!(result && !result.valid))
                      e.currentTarget.style.borderColor = TME_COLORS.primary;
                  }}
                  onBlur={(e) => {
                    if (!(result && !result.valid))
                      e.currentTarget.style.borderColor = TME_COLORS.border;
                  }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {trimmed.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setName(index, '')}
                      className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                      title="Clear this name"
                      aria-label={`Clear name option ${index + 1}`}
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  )}
                  {result &&
                    (result.valid ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    ))}
                </span>
              </div>
              {result &&
                result.errors.map((error, i) => (
                  <p key={i} className="mt-1 text-xs text-red-500">
                    {error}
                  </p>
                ))}
              {result &&
                result.valid &&
                result.warnings.map((warning, i) => (
                  <p key={i} className="mt-1 text-xs text-amber-700 flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    {warning}
                  </p>
                ))}
              {ai &&
                ai.issues.map((issue, i) => (
                  <p key={`ai-${i}`} className="mt-1 text-xs text-amber-700 flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    {issue}
                  </p>
                ))}
            </div>
          );
        })}
      </div>

      {/* AI name suggester */}
      <div className="border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting || !canSuggest}
          title={
            canSuggest
              ? undefined
              : 'Add at least one business activity first — suggestions are based on it.'
          }
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#f0f4ff', color: TME_COLORS.primary }}
        >
          {suggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {suggesting ? 'Generating suggestions…' : 'Suggest names'}
        </button>
        <p className="text-xs text-gray-500 mt-1.5">
          {canSuggest
            ? 'Suggestions are based on your business activities. Final company name approval remains subject to authority approval.'
            : 'Add at least one business activity first — suggestions are based on it.'}
        </p>
        {suggestError && <p className="text-xs text-red-500 mt-2">{suggestError}</p>}
        {suggestions && suggestions.length > 0 && (
          <div className="mt-3">
            <InfoNote
              title={
                allFilled
                  ? 'Suggested names'
                  : 'Suggested names — click one to use it'
              }
            >
              <div className="flex flex-wrap gap-2 mt-1">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applySuggestion(name)}
                    disabled={allFilled}
                    title={
                      allFilled
                        ? 'All three options are filled — clear one to use a suggestion.'
                        : undefined
                    }
                    className="px-3 py-1.5 rounded-full text-sm font-medium bg-white border transition-all duration-200 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                    style={{ borderColor: `${TME_COLORS.primary}40`, color: TME_COLORS.primary }}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {allFilled && (
                <p className="text-xs text-gray-500 mt-2">
                  All three options are filled — clear one to use a suggestion.
                </p>
              )}
            </InfoNote>
          </div>
        )}
      </div>
    </div>
  );
}
