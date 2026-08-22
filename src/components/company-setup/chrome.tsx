'use client';

/**
 * Step chrome for the Company Setup Intake form — FormSection, StepNavButtons,
 * StepProgress, RevealSection. Cloned from the module-private components in
 * DependentForm.tsx (they are not exported there; the staff flows stay
 * untouched), with the step labels passed in instead of a module constant.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TME_COLORS } from '@/lib/constants';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface FormSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  stepNumber?: number;
}

export function FormSection({ title, icon, children, stepNumber }: FormSectionProps) {
  return (
    <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        {stepNumber !== undefined && (
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ backgroundColor: TME_COLORS.primary }}
          >
            {stepNumber}
          </span>
        )}
        {icon}
        <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
          {title}
        </h2>
      </div>
      {children}
    </div>
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
    <div className={`flex ${showBack && onBack ? 'justify-between' : 'justify-end'} mt-4`}>
      {showBack && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border-2 hover:bg-gray-50"
          style={{ color: TME_COLORS.primary, borderColor: TME_COLORS.primary }}
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onContinue}
        disabled={!enabled || busy}
        className={`px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 flex items-center gap-2 ${
          enabled && !busy ? 'hover:opacity-90 cursor-pointer' : 'opacity-40 cursor-not-allowed'
        }`}
        style={{ backgroundColor: TME_COLORS.primary }}
      >
        {busy ? 'Checking…' : label || 'Continue'}
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

export function StepProgress({
  currentStep,
  viewingStep,
  stepLabels,
  onStepClick,
}: {
  currentStep: number;
  viewingStep: number;
  /** Display labels, index 0 = step 1. All steps are always visible. */
  stepLabels: string[];
  onStepClick: (step: number) => void;
}) {
  const total = stepLabels.length;
  const prevStep = Math.max(1, viewingStep - 1);
  const nextStep = Math.min(total, viewingStep + 1);
  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-sm mb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStepClick(prevStep)}
            disabled={viewingStep <= 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: TME_COLORS.primary }}
          >
            Step {viewingStep} of {total}
          </span>
          <button
            type="button"
            onClick={() => onStepClick(nextStep)}
            disabled={nextStep === viewingStep || nextStep > currentStep}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
          </button>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${TME_COLORS.primary}15`, color: TME_COLORS.primary }}
        >
          {stepLabels[viewingStep - 1] || ''}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        {stepLabels.map((label, i) => {
          const step = i + 1;
          const isCompleted = step < currentStep;
          const isCurrent = step === currentStep;
          const isViewing = step === viewingStep;
          const isClickable = step <= currentStep;
          return (
            <button
              key={step}
              type="button"
              onClick={() => isClickable && onStepClick(step)}
              disabled={!isClickable}
              className={`h-2 flex-1 rounded-full transition-all duration-200 ${
                isViewing ? '' : isCompleted ? 'bg-green-400' : isCurrent ? '' : 'bg-gray-200'
              } ${isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed'}`}
              style={
                isViewing
                  ? { backgroundColor: TME_COLORS.primary }
                  : isCurrent && !isViewing
                  ? { backgroundColor: `${TME_COLORS.primary}60` }
                  : undefined
              }
              title={label}
            />
          );
        })}
      </div>
    </div>
  );
}

const revealVariants = {
  hidden: { opacity: 0, y: 30, height: 0, marginBottom: 0 },
  visible: { opacity: 1, y: 0, height: 'auto', marginBottom: 24 },
  exit: { opacity: 0, y: -20, height: 0, marginBottom: 0 },
};

export function RevealSection({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={revealVariants}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Reusable info note box in the TME style (blue-tinted, Info-icon left). */
export function InfoNote({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(36,63,123,0.06)' }}>
      {title && (
        <p className="text-sm font-semibold mb-1" style={{ color: TME_COLORS.primary }}>
          {title}
        </p>
      )}
      <div className="text-sm text-gray-600 leading-relaxed">{children}</div>
    </div>
  );
}
