'use client';

import React, { useState } from 'react';
import { AutoGrowText, Button, FieldError, textFieldClasses } from '@/components/ui';
import { InfoNote } from './chrome';
import type { DraftCompany } from './draft';
import {
  validateCompanyName,
  checkNameActivityFit,
  exampleNameFromActivities,
  COMPANY_NAME_RULES,
  NAME_ACTIVITY_RULE,
} from '@/lib/company-setup-name-validation';
import {
  COMPANY_SETUP_NAME_OPTIONS_REQUIRED,
  type CompanySetupPrefillData,
} from '@/types/company-setup';
import { AlertTriangle, CheckCircle, ListChecks, Sparkles, X, XCircle } from 'lucide-react';

export interface AiNameIssue {
  name: string;
  issues: string[];
}

interface StepNamesProps {
  company: DraftCompany;
  /** Staff pre-fill: used to mark which options TME suggested. */
  prefill: CompanySetupPrefillData | null;
  onChange: (patch: Partial<DraftCompany>) => void;
  /** AI warnings from the last validate-names call (never blocking). */
  aiIssues: AiNameIssue[];
  /** Calls the suggest-names endpoint; resolves to the suggestions, a failure
   *  with its plain message, or null when there are none. */
  onSuggest: () => Promise<string[] | { error: string } | null>;
  /**
   * False when there is not a single business activity yet: suggestions are
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
  // The client's own activity wording: the names must reflect at least one.
  const activityTexts = company.activities
    .map((a) => a.description.trim())
    .filter((d) => d.length > 0);
  const ownExample = exampleNameFromActivities(activityTexts);
  const staffNames = prefill?.company?.nameOptions ?? [];
  const anyStaffSuggestion = staffNames.some((o) => (o?.name ?? '').trim().length > 0);
  const allFilled = names.every((o) => o.name.trim().length > 0);

  // The authority reads the options as first / second / third choice, so the
  // same name twice throws a choice away. `duplicateAt` maps an option index to
  // the earlier option it repeats; `usedNames` is what the chips check against.
  const usedNames = new Set(
    names.map((o) => o.name.trim().toLowerCase()).filter(Boolean)
  );
  const duplicateAt = new Map<number, number>();
  const firstSeenAt = new Map<string, number>();
  names.forEach((o, index) => {
    const key = o.name.trim().toLowerCase();
    if (!key) return;
    const first = firstSeenAt.get(key);
    if (first === undefined) firstSeenAt.set(key, index);
    else duplicateAt.set(index, first);
  });

  const setName = (index: number, name: string) => {
    onChange({ nameOptions: names.map((o, i) => (i === index ? { name } : o)) });
  };

  const applySuggestion = (name: string) => {
    // Fill the first empty slot. When all three are filled, nothing is
    // overwritten: silently replacing option 3 destroyed a name the client
    // had typed. A name already on another line is never filled in twice.
    // The chips are disabled in both states.
    if (usedNames.has(name.trim().toLowerCase())) return;
    const emptyIndex = names.findIndex((o) => !o.name.trim());
    if (emptyIndex === -1) return;
    setName(emptyIndex, name);
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const result = await onSuggest();
      if (Array.isArray(result) && result.length > 0) {
        setSuggestions(result);
      } else if (result && !Array.isArray(result)) {
        setSuggestError(result.error);
      } else {
        setSuggestError('We could not generate suggestions right now. Please try again.');
      }
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-gray-700 leading-relaxed sm:text-sm">
        Please give {COMPANY_SETUP_NAME_OPTIONS_REQUIRED} company name options in your order of
        preference. The authority checks them in this order and registers the first one that is
        available and approved.
      </p>

      {/* The full IFZA name rules, always visible on this step (PM requirement:
          a clearly displayed checklist, never a tooltip). */}
      <div className="rounded-[10px] border border-gray-200 bg-gray-50/60 p-4">
        <div className="flex items-center gap-2 mb-2">
          <ListChecks className="w-5 h-5 text-tme-blue" aria-hidden />
          <p className="text-[15px] font-semibold text-tme-blue sm:text-sm">IFZA company name rules</p>
        </div>
        <ul className="space-y-1.5">
          {COMPANY_NAME_RULES.map((rule, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-tme-blue" aria-hidden />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Tester feedback: the activity rule needs an example, not only a line
          in the checklist. Built from the client's own first activity when
          possible. */}
      <InfoNote title="Your name must show your business activity">
        <p>{NAME_ACTIVITY_RULE}</p>
        {ownExample && (
          <p className="mt-1">
            With your activities, a name such as <strong>&quot;{ownExample}&quot;</strong> works.
          </p>
        )}
      </InfoNote>

      {anyStaffSuggestion && (
        <p className="text-sm text-gray-600 -mt-2 sm:text-[13px]">
          Your TME consultant suggested these names. You can change or clear any of them.
        </p>
      )}

      <div className="space-y-5">
        {names.map((option, index) => {
          const trimmed = option.name.trim();
          const result = trimmed ? validateCompanyName(trimmed) : null;
          const duplicateOf = duplicateAt.get(index);
          const isDuplicate = duplicateOf !== undefined;
          const showsError = isDuplicate || (result !== null && !result.valid);
          const ai = aiIssues.find((i) => i.name === trimmed && i.issues.length > 0);
          // Soft check only (never blocks): the activity word may be hidden in
          // a word our simple matching does not recognise.
          const activityFit =
            result && result.valid && !isDuplicate
              ? checkNameActivityFit(trimmed, activityTexts)
              : null;
          const staffName = (staffNames[index]?.name ?? '').trim();
          const isStaffSuggestion = staffName.length > 0 && staffName === trimmed;
          const inputId = `company-name-option-${index + 1}`;
          const warnings: React.ReactNode[] = [];
          if (result && result.valid && !isDuplicate) warnings.push(...result.warnings);
          if (activityFit && !activityFit.hasActivityWord) {
            warnings.push(
              'This name does not seem to include one of your business activities. Please add an activity word (see the example above).'
            );
          }
          if (activityFit && activityFit.hasActivityWord && activityFit.unrelatedWords.length > 0) {
            warnings.push(
              `${activityFit.unrelatedWords.map((w) => `"${w}"`).join(', ')} ${
                activityFit.unrelatedWords.length === 1 ? 'does' : 'do'
              } not match your business activities. The authority may reject it.`
            );
          }
          if (ai) warnings.push(...ai.issues);
          return (
            <div key={index}>
              <label
                htmlFor={inputId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold mb-1.5 text-tme-blue sm:text-sm sm:font-medium"
              >
                <span>
                  Name option {index + 1}
                  <span className="text-tme-red ml-1" aria-hidden>*</span>
                </span>
                {index === 0 && <span className="text-sm font-normal text-gray-600 sm:text-[13px]">(your first choice)</span>}
                {isStaffSuggestion && (
                  <span className="text-[13px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-tme-blue">
                    Suggested by TME
                  </span>
                )}
              </label>
              <div className="relative">
                <AutoGrowText
                  id={inputId}
                  value={option.name}
                  onChange={(e) => setName(index, e.target.value)}
                  placeholder="e.g. Horizon Trade (without FZCO at the end)"
                  maxLength={120}
                  aria-invalid={showsError || undefined}
                  className={textFieldClasses(!!showsError, '!pr-20')}
                />
                <span className="absolute right-1 top-0 h-[46px] flex items-center sm:h-10">
                  {trimmed.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setName(index, '')}
                      className="size-11 inline-flex items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 transition-colors tme-btn-focus sm:size-9"
                      aria-label={`Clear name option ${index + 1}`}
                    >
                      <X className="w-[18px] h-[18px]" aria-hidden />
                    </button>
                  )}
                  {result &&
                    (result.valid && !isDuplicate ? (
                      <CheckCircle className="w-5 h-5 mr-2 text-green-600" aria-label="Name looks fine" />
                    ) : (
                      <XCircle className="w-5 h-5 mr-2 text-tme-red" aria-label="Name has a problem" />
                    ))}
                </span>
              </div>
              {isDuplicate && (
                <FieldError>
                  This is the same name as option {(duplicateOf ?? 0) + 1}. Please give{' '}
                  {COMPANY_SETUP_NAME_OPTIONS_REQUIRED} different names.
                </FieldError>
              )}
              {result && result.errors.map((error, i) => <FieldError key={i}>{error}</FieldError>)}
              {warnings.map((warning, i) => (
                <p key={`w-${i}`} className="mt-1.5 flex items-start gap-1.5 text-sm leading-snug text-amber-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden />
                  <span>{warning}</span>
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {/* AI name suggester */}
      <div className="border-t border-gray-200 pt-5">
        <Button tone="secondary" onClick={handleSuggest} disabled={!canSuggest} busy={suggesting}>
          {!suggesting && <Sparkles className="w-4 h-4" aria-hidden />}
          {suggesting ? 'Finding name ideas…' : 'Suggest names'}
        </Button>
        <p className="text-sm text-gray-600 mt-2 sm:text-[13px]">
          {canSuggest
            ? 'Suggestions are based on your business activities. The authority still has to approve the final company name.'
            : 'Add at least one business activity first. Suggestions are based on it.'}
        </p>
        {suggestError && <FieldError>{suggestError}</FieldError>}
        {suggestions && suggestions.length > 0 && (
          <div className="mt-3">
            <InfoNote title={allFilled ? 'Suggested names' : 'Suggested names: tap one to use it'}>
              <div className="flex flex-wrap gap-2 mt-1">
                {suggestions.map((name) => {
                  const alreadyUsed = usedNames.has(name.trim().toLowerCase());
                  const disabled = alreadyUsed || allFilled;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => applySuggestion(name)}
                      disabled={disabled}
                      aria-label={alreadyUsed ? `${name} (you are already using this name)` : undefined}
                      className="min-h-11 px-4 py-2 rounded-full text-[15px] font-medium bg-white border border-blue-200 text-tme-blue transition-colors duration-200 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white tme-btn-focus sm:text-[13px] sm:min-h-8 sm:px-3 sm:py-1"
                    >
                      {name}
                      {alreadyUsed && <span className="ml-1.5 text-sm text-gray-600 sm:text-[13px]">(in use)</span>}
                    </button>
                  );
                })}
              </div>
              {allFilled && (
                <p className="text-sm text-gray-700 mt-2">
                  All three options are filled. Clear one to use a suggestion.
                </p>
              )}
            </InfoNote>
          </div>
        )}
      </div>
    </div>
  );
}
