'use client';

import React from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Check } from 'lucide-react';

interface FormProgressProps {
  currentStep: 'employer' | 'employee' | 'complete';
  isSamePerson: boolean;
}

export function FormProgress({ currentStep, isSamePerson }: FormProgressProps) {
  const steps = isSamePerson
    ? [
        { id: 'combined', label: 'Complete Form', description: 'All information' },
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

  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-center">
        {steps.map((step, index) => {
          const status = getStepStatus(step.id);
          const isLast = index === steps.length - 1;

          return (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center">
                {/* Circle */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    status === 'complete'
                      ? 'bg-green-500 border-green-500'
                      : status === 'current'
                      ? 'border-2'
                      : 'border-gray-300 bg-white'
                  }`}
                  style={
                    status === 'current'
                      ? { borderColor: TME_COLORS.primary, backgroundColor: 'white' }
                      : {}
                  }
                >
                  {status === 'complete' ? (
                    <Check className="w-5 h-5 text-white" />
                  ) : (
                    <span
                      className={`text-sm font-semibold ${
                        status === 'current' ? '' : 'text-gray-400'
                      }`}
                      style={status === 'current' ? { color: TME_COLORS.primary } : {}}
                    >
                      {index + 1}
                    </span>
                  )}
                </div>

                {/* Label */}
                <div className="mt-2 text-center">
                  <p
                    className={`text-sm font-medium ${
                      status === 'upcoming' ? 'text-gray-400' : ''
                    }`}
                    style={
                      status === 'current' || status === 'complete'
                        ? { color: TME_COLORS.primary }
                        : {}
                    }
                  >
                    {step.label}
                  </p>
                  <p className="text-xs text-gray-400 hidden md:block">{step.description}</p>
                </div>
              </div>

              {/* Connector */}
              {!isLast && (
                <div
                  className={`w-16 md:w-24 h-0.5 mx-2 mt-[-28px] ${
                    getStepStatus(steps[index + 1].id) !== 'upcoming'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
