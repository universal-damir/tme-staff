'use client';

import React from 'react';
import { AlertCircle, FileText, Pencil } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import {
  EKYC_DOCUMENT_SLOTS,
  ekycSplitLines,
  getEkycValue,
  isEkycFieldVisible,
  type EkycFieldDef,
  type EkycGroupDef,
  type EkycOption,
  type EkycText,
  type IndividualKycData,
} from '@/types/ekyc';
import { ekycRowHeading, isoToPickerDate, type EkycFormData } from '@/lib/ekyc-form';
import type { EkycStepDef } from '@/lib/ekyc-steps';
import type { EkycClientDocuments } from '@/lib/ekyc-token';
import { Bi, BiLabel, BiTitle, useEkycBilingual } from './Bi';
import { ekycNumberedLabel } from './EkycField';
import { EKYC_UI } from './texts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows differ per group
type AnyGroup = EkycGroupDef<EkycFormData, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any row shape
type AnyField = EkycFieldDef<any, any>;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

function optionText(options: readonly EkycOption[] | undefined, value: string): EkycText {
  const o = options?.find((x) => x.value === value);
  return o ?? { en: value, de: value };
}

/** The answer as the client sees it: option labels (not stored values), dates dd.mm.yyyy. */
function Answer({
  field,
  value,
  options,
  missing,
}: {
  field: AnyField;
  value: unknown;
  options?: readonly EkycOption[];
  missing: boolean;
}) {
  if (field.kind !== 'signature' && isBlank(value)) {
    return missing ? (
      <span className="inline-flex items-center gap-1 font-medium text-red-600">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <Bi text={EKYC_UI.missingAnswer} variant="inline" />
      </span>
    ) : (
      <Bi text={EKYC_UI.notAnswered} className="text-gray-400" />
    );
  }
  const list = options ?? field.options;
  switch (field.kind) {
    case 'select':
    case 'yesno':
      return <Bi text={optionText(list, String(value))} />;
    case 'multiselect':
      return (
        <ul className="space-y-1">
          {(value as string[]).map((v) => (
            <li key={v}>
              <Bi text={optionText(list, v)} />
            </li>
          ))}
        </ul>
      );
    case 'lines':
      // A list (main activities): one per line, numbered like the boxes.
      return (
        <ol className="list-decimal space-y-1 pl-5">
          {ekycSplitLines(value).map((line, i) => (
            <li key={i} className="break-words">
              {line}
            </li>
          ))}
        </ol>
      );
    case 'countries':
      return <span>{(value as string[]).join(', ')}</span>;
    case 'date':
      return <span>{isoToPickerDate(String(value)) || String(value)}</span>;
    case 'percent':
      return <span>{String(value)} %</span>;
    case 'signature':
      return typeof value === 'string' && value.startsWith('data:image/') ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise
        <img src={value} alt={field.label.en} className="h-16 max-w-[220px] rounded border border-gray-200 bg-white object-contain" />
      ) : missing ? (
        <span className="inline-flex items-center gap-1 font-medium text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <Bi text={EKYC_UI.missingAnswer} variant="inline" />
        </span>
      ) : (
        <Bi text={EKYC_UI.notAnswered} className="text-gray-400" />
      );
    default:
      return <span className="whitespace-pre-line break-words">{String(value)}</span>;
  }
}

function Row({ label, children }: { label: EkycText; children: React.ReactNode }) {
  return (
    <dl className="py-2.5 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6">
      <dt>
        <BiLabel text={label} size="sm" />
      </dt>
      <dd className="mt-1 text-sm text-gray-900 sm:mt-0">{children}</dd>
    </dl>
  );
}

export interface EkycReviewProps {
  steps: readonly EkycStepDef[];
  data: EkycFormData;
  fieldsById: Map<string, AnyField>;
  groupsById: Map<string, AnyGroup>;
  documents: EkycClientDocuments;
  /** Paths with a missing or wrong answer (shown as "Missing"). */
  errorPaths: Set<string>;
  /** A group's own problem (for example "add at least one UBO"), by group id. */
  groupErrors?: Record<string, EkycText>;
  /** Steps with a problem get a marker. */
  stepHasErrors: (index: number) => boolean;
  /** Absent in the read-only view after submit. */
  onChange?: (stepIndex: number) => void;
}

/** "Check your answers": every visible answer, per step, with a Change link back to the step. */
export function EkycReview({
  steps,
  data,
  fieldsById,
  groupsById,
  documents,
  errorPaths,
  groupErrors,
  stepHasErrors,
  onChange,
}: EkycReviewProps) {
  const bilingual = useEkycBilingual();
  return (
    <div className="space-y-4">
      {steps.map((step, index) => {
        const rows: React.ReactNode[] = [];
        for (const id of step.items) {
          const group = groupsById.get(id);
          if (group) {
            const list = (getEkycValue(data, group.id) as Record<string, unknown>[]) ?? [];
            list.forEach((row, rowIndex) => {
              rows.push(
                <div key={`${id}-${rowIndex}`} className="py-2.5">
                  <div className="text-[15px] font-semibold" style={{ color: TME_COLORS.primary }}>
                    <BiTitle text={ekycRowHeading(group.rowLabel, rowIndex + 1)} size="section" />
                  </div>
                  <div className="divide-y divide-gray-100">
                    {group.fields.map((field) => {
                      if (!isEkycFieldVisible(field, data, row)) return null;
                      const path = `${group.id}.${rowIndex}.${field.id}`;
                      return (
                        <Row key={field.id} label={field.label}>
                          <Answer
                            field={field}
                            value={getEkycValue(row, field.id)}
                            options={field.optionsFor ? field.optionsFor(data, row) : undefined}
                            missing={errorPaths.has(path)}
                          />
                        </Row>
                      );
                    })}
                  </div>
                </div>
              );
            });
            const groupError = groupErrors?.[group.id];
            if (groupError) {
              rows.push(
                <div key={`${id}-error`} className="flex items-start gap-1.5 py-2.5 text-sm font-medium text-red-600">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <Bi text={groupError} deClassName="!text-red-500" />
                </div>
              );
            }
            continue;
          }
          const field = fieldsById.get(id);
          if (!field || !isEkycFieldVisible(field, data, data)) continue;
          rows.push(
            <Row key={id} label={ekycNumberedLabel(field)}>
              <Answer
                field={field}
                value={getEkycValue(data, id)}
                options={field.optionsFor ? field.optionsFor(data, data) : undefined}
                missing={errorPaths.has(id)}
              />
            </Row>
          );
        }
        if (step.documents) {
          for (const def of EKYC_DOCUMENT_SLOTS.filter((d) => d.requiredWhen(data as IndividualKycData))) {
            const doc = documents[def.slot];
            rows.push(
              <Row key={def.slot} label={def.label}>
                {doc ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="truncate">{doc.filename}</span>
                  </span>
                ) : errorPaths.has(`documents.${def.slot}`) ? (
                  <span className="inline-flex items-center gap-1 font-medium text-red-600">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <Bi text={EKYC_UI.missingAnswer} variant="inline" />
                  </span>
                ) : (
                  <Bi text={EKYC_UI.noFile} className="text-gray-400" />
                )}
              </Row>
            );
          }
        }
        const problem = stepHasErrors(index);
        return (
          <section
            key={step.id}
            className="rounded-xl border bg-white px-4 py-3 sm:px-5"
            style={{ borderColor: problem ? '#fecaca' : TME_COLORS.border }}
            aria-labelledby={`ekyc-review-${step.id}`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2.5">
              <h3 id={`ekyc-review-${step.id}`} className="text-base font-semibold" style={{ color: TME_COLORS.primary }}>
                <BiTitle text={step.title} size="section" />
              </h3>
              {onChange && (
                <button
                  type="button"
                  onClick={() => onChange(index)}
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium underline-offset-2 hover:underline"
                  style={{ color: TME_COLORS.primary }}
                  aria-label={`${EKYC_UI.change.en}: ${step.title.en}${bilingual && step.title.de ? ` / ${step.title.de}` : ''}`}
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                  <Bi text={EKYC_UI.change} variant="inline" />
                </button>
              )}
            </div>
            <div className="divide-y divide-gray-100">{rows}</div>
          </section>
        );
      })}
    </div>
  );
}
