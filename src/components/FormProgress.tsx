'use client';

import React from 'react';
import { Check } from 'lucide-react';

interface FormProgressProps {
  currentStep: 'employer' | 'employee' | 'complete';
  isSamePerson: boolean;
}

export function FormProgress({ currentStep, isSamePerson }: FormProgressProps) {
  const steps = isSamePerson
    ? [
        { id: 'combined', label: 'Complete form', description: 'All information' },
        { id: 'complete', label: 'Done', description: 'Submitted' },
      ]
    : [
        { id: 'employer', label: 'Employer', description: 'Employment details' },
        { id: 'employee', label: 'Employee', description: 'Personal details' },
        { id: 'complete', label: 'Done', description: 'Submitted' },
      ];

  const getStepStatus = (stepId: string) => {
    const step = currentStep as string; // Avoid TypeScript narrowing issues

    if (isSamePerson) {
      if (step === 'complete') return 'complete';
      if (stepId === 'complete') return 'upcoming';
      return 'current';
    }

    if (step === 'complete') return 'complete';
    if (stepId === step) return 'current';
    if (stepId === 'employer' && step !== 'employer') return 'complete';
    if (stepId === 'employee' && step === 'complete') return 'complete';
    return 'upcoming';
  };

  // Sits inside the cloudy page header band: a compact row of stages
  // (who fills in which part). Done = TME blue with a tick, current = blue
  // outline, still to come = grey (gray-600 text, readable on the band).
  return (
    <ol className="flex items-start gap-2 sm:gap-3" aria-label="Form stages">
      {steps.map((step, index) => {
        const status = getStepStatus(step.id);
        const isLast = index === steps.length - 1;

        return (
          <React.Fragment key={step.id}>
            <li
              className="flex items-start gap-2 min-w-0"
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span
                className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center border-2 text-sm font-semibold ${
                  status === 'complete'
                    ? 'bg-tme-blue border-tme-blue text-white'
                    : status === 'current'
                    ? 'bg-white border-tme-blue text-tme-blue'
                    : 'bg-white border-tme-line text-gray-600'
                }`}
                aria-hidden
              >
                {status === 'complete' ? <Check className="w-4 h-4" /> : index + 1}
              </span>
              <span className="min-w-0 pt-0.5">
                <span
                  className={`block text-[15px] leading-snug sm:text-sm ${
                    status === 'upcoming' ? 'font-medium text-gray-600' : 'font-semibold text-tme-blue'
                  }`}
                >
                  {step.label}
                  <span className="sr-only">
                    {status === 'complete' ? ' (done)' : status === 'current' ? ' (current)' : ' (to come)'}
                  </span>
                </span>
                <span className="hidden sm:block text-sm leading-snug text-gray-600 sm:text-[13px]">{step.description}</span>
              </span>
            </li>

            {/* Connector */}
            {!isLast && (
              <li
                aria-hidden
                className={`flex-1 min-w-4 h-0.5 mt-3.5 rounded-full ${
                  getStepStatus(steps[index + 1].id) !== 'upcoming' ? 'bg-tme-blue' : 'bg-tme-line'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
