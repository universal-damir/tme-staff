'use client';

/**
 * Step chrome for the Company Setup Intake form: FormSection, StepNavButtons,
 * StepProgress, InfoNote, WarningNote. Same look as the EmployeeForm /
 * DependentForm chrome (TME "cloud band" redesign, 22.10.2026), with the step
 * labels passed in instead of a module constant.
 */

import React from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, FormFooter, GrainGradient } from '@/components/ui';

interface FormSectionProps {
  title: string;
  /** Optional small icon (18px, text-tme-blue) shown before the title. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function FormSection({ title, icon, children }: FormSectionProps) {
  return (
    <Card
      seed={`company-setup-${title}`}
      title={
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
      }
    >
      {children}
    </Card>
  );
}

export function StepNavButtons({
  enabled,
  onContinue,
  onBack,
  showBack = true,
  label,
  busy = false,
}: {
  enabled: boolean;
  onContinue: () => void;
  onBack?: () => void;
  showBack?: boolean;
  label?: string;
  busy?: boolean;
}) {
  return (
    <FormFooter className="mt-6">
      {showBack && onBack && (
        <Button tone="plain" onClick={onBack}>
          <ChevronLeft className="w-[18px] h-[18px]" aria-hidden />
          Back
        </Button>
      )}
      <Button tone="primary" onClick={onContinue} disabled={!enabled} busy={busy}>
        {busy ? 'Checking…' : label || 'Continue'}
        {!busy && <ChevronRight className="w-[18px] h-[18px]" aria-hidden />}
      </Button>
    </FormFooter>
  );
}

/**
 * The ONE sticky element of the form: step text, prev/next arrows and the
 * clickable step bar, on the cloud wash. Rendered full width under the page header.
 */
export function StepProgress({
  currentStep,
  viewingStep,
  stepLabels,
  onStepClick,
  saveState,
  maxWidth = 'max-w-5xl',
}: {
  currentStep: number;
  viewingStep: number;
  /** Display labels, index 0 = step 1. All steps are always visible. */
  stepLabels: string[];
  onStepClick: (step: number) => void;
  /** Autosave state shown at the right of the step text. */
  saveState?: React.ReactNode;
  /** Same max-width class as the page column. */
  maxWidth?: string;
}) {
  const total = stepLabels.length;
  const prevStep = Math.max(1, viewingStep - 1);
  const nextStep = Math.min(total, viewingStep + 1);
  const label = stepLabels[viewingStep - 1] || '';
  return (
    <div className="sticky top-0 z-30">
      <GrainGradient color="#3B82F6" seed="company-setup-step-bar" grainOpacity={0.5} className="border-b border-gray-200">
        <div className={`mx-auto w-full px-4 sm:px-10 ${maxWidth} py-2 sm:py-3`}>
          <div className="flex items-center gap-1 -ml-3">
            <button
              type="button"
              onClick={() => onStepClick(prevStep)}
              disabled={viewingStep <= 1}
              aria-label="Previous step"
              className="relative z-10 size-11 shrink-0 inline-flex items-center justify-center rounded-[var(--btn-radius)] text-tme-blue hover:bg-[#eef2fa] disabled:opacity-30 disabled:cursor-not-allowed tme-btn-focus sm:size-9"
            >
              <ChevronLeft className="w-5 h-5 sm:w-[18px] sm:h-[18px]" aria-hidden />
            </button>
            <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-tme-blue sm:text-sm">
              Step {viewingStep} of {total}
              {label ? `: ${label}` : ''}
            </span>
            {saveState != null && (
              <span className="hidden sm:inline-flex items-center text-sm font-medium text-gray-600 text-right">
                {saveState}
              </span>
            )}
            <button
              type="button"
              onClick={() => onStepClick(nextStep)}
              disabled={nextStep === viewingStep || nextStep > currentStep}
              aria-label="Next step"
              className="relative z-10 size-11 shrink-0 inline-flex items-center justify-center rounded-[var(--btn-radius)] text-tme-blue hover:bg-[#eef2fa] disabled:opacity-30 disabled:cursor-not-allowed tme-btn-focus sm:size-9"
            >
              <ChevronRight className="w-5 h-5 sm:w-[18px] sm:h-[18px]" aria-hidden />
            </button>
          </div>
          {saveState != null && (
            <div className="sm:hidden flex items-center text-sm font-medium text-gray-600 pb-1">{saveState}</div>
          )}
          <div className="flex items-stretch gap-1.5">
            {stepLabels.map((stepLabel, i) => {
              const step = i + 1;
              const isDone = step < currentStep;
              const isViewing = step === viewingStep;
              const isClickable = step <= currentStep;
              const fill = isViewing || isDone ? 'bg-tme-blue' : step === currentStep ? 'bg-tme-blue/40' : 'bg-tme-line';
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => isClickable && onStepClick(step)}
                  disabled={!isClickable}
                  aria-label={`Go to step ${step}: ${stepLabel}`}
                  aria-current={isViewing ? 'step' : undefined}
                  className={`flex-1 min-h-11 flex items-center -my-3 tme-btn-focus rounded-sm sm:min-h-9 ${
                    isClickable ? 'cursor-pointer group' : 'cursor-not-allowed'
                  }`}
                >
                  <span
                    className={`block w-full rounded-[3px] transition-all duration-200 ${fill} ${
                      isViewing ? 'h-2' : 'h-1.5 group-hover:opacity-80'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </GrainGradient>
    </div>
  );
}

/** Blue info box (TME style). */
export function InfoNote({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-blue-100 bg-blue-50/70 p-4">
      {title && <p className="text-[15px] font-semibold mb-1 text-tme-blue sm:text-sm">{title}</p>}
      <div className="text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

/** Amber warning box: readable 14px text, amber icon (never beige). */
export function WarningNote({
  title,
  children,
  className,
}: {
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 p-3.5 ${className ?? ''}`}>
      <AlertTriangle className="w-[18px] h-[18px] shrink-0 mt-px text-amber-700" aria-hidden />
      <div className="min-w-0 text-sm leading-snug text-amber-900">
        {title && <p className="font-semibold mb-1">{title}</p>}
        {children}
      </div>
    </div>
  );
}
