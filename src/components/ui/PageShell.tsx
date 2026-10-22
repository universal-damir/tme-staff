'use client';

/**
 * Page frame for every client page (approved mockup "A. Cloud band", 22.10.2026).
 *
 *   <ClientPageHeader eyebrow="Employee onboarding" title="Your passport"
 *     subtitle="For Sample Trading LLC" progress={{ current: 2, total: 6, label: 'Passport' }} />
 *   <PageBody> ...cards... </PageBody>
 */

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { GrainGradient } from './grain-gradient';
import { ButtonLink } from './Button';

const WASH = '#3B82F6';
const DEFAULT_MAX = 'max-w-[880px]';
const INNER_PAD = 'mx-auto w-full px-4 sm:px-10';

export interface PageProgress {
  /** 1-based current step */
  current: number;
  total: number;
  /** Step name: renders "Step 2 of 6: Passport" */
  label?: string;
  /** e.g. "Saved 2 minutes ago" or a spinner; shown at the right of the step text */
  saveState?: React.ReactNode;
}

function StepBar({ progress }: { progress: PageProgress }) {
  const { current, total, label, saveState } = progress;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[15px] leading-snug sm:text-sm">
        <span className="font-semibold text-tme-blue">
          Step {current} of {total}
          {label ? `: ${label}` : ''}
        </span>
        {saveState != null && <span className="font-medium text-gray-600 sm:font-normal sm:text-[13px]">{saveState}</span>}
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-label={`Step ${current} of ${total}${label ? `: ${label}` : ''}`}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-[3px] ${i < current ? 'bg-tme-blue' : 'bg-tme-line'}`}
          />
        ))}
      </div>
    </div>
  );
}

export interface ClientPageHeaderProps {
  title: React.ReactNode;
  /** Area name above the title ("Employee onboarding"); sentence case, not uppercase. */
  eyebrow?: React.ReactNode;
  /** Company name, period, time needed ... (gray-600: 16px phone, 15px desktop) */
  subtitle?: React.ReactNode;
  /** Adds a ghost "Help" link at the top right. */
  helpHref?: string;
  /** Multi-step forms: step text + segmented bar inside the band. */
  progress?: PageProgress;
  /** Extra content at the bottom of the band (tabs, a notice ...). */
  children?: React.ReactNode;
  /** Tailwind max-width class for the inner column (default 'max-w-[880px]'). */
  maxWidth?: string;
  /** Long forms: keep only the step bar stuck to the top while scrolling. Needs `progress`. */
  sticky?: boolean;
}

export function ClientPageHeader({
  title,
  eyebrow,
  subtitle,
  helpHref,
  progress,
  children,
  maxWidth = DEFAULT_MAX,
  sticky = false,
}: ClientPageHeaderProps) {
  const splitBar = sticky && !!progress;
  return (
    <>
      <GrainGradient
        as="header"
        color={WASH}
        seed="tme-staff-page-header"
        grainOpacity={0.5}
        className={splitBar ? '' : 'border-b border-gray-200'}
      >
        <div
          className={`${INNER_PAD} ${maxWidth} pt-[18px] sm:pt-6 ${splitBar ? 'pb-3' : 'pb-5 sm:pb-6'} flex flex-col gap-5 sm:gap-4`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-extrabold leading-none tracking-[-0.01em] text-tme-blue">TME Services</div>
              <div className="mt-1.5 h-[3px] w-7 rounded-sm bg-tme-beige" aria-hidden />
            </div>
            {helpHref && (
              <ButtonLink href={helpHref} tone="ghost" target="_blank" rel="noopener noreferrer">
                <HelpCircle className="w-[18px] h-[18px]" aria-hidden />
                Help
              </ButtonLink>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {eyebrow && <p className="text-[15px] font-semibold leading-snug text-tme-blue sm:text-sm sm:font-medium">{eyebrow}</p>}
            <h1 className="text-[26px] sm:text-[28px] font-bold leading-tight tracking-[-0.01em] text-tme-blue">
              {title}
            </h1>
            {subtitle && <p className="text-base leading-normal text-gray-600 sm:text-[15px]">{subtitle}</p>}
          </div>
          {progress && !splitBar && <StepBar progress={progress} />}
          {children}
        </div>
      </GrainGradient>
      {splitBar && progress && (
        <GrainGradient
          color={WASH}
          seed="tme-staff-page-header-bar"
          grainOpacity={0.5}
          className="sticky top-0 z-30 border-b border-gray-200"
          style={{ position: 'sticky' }}
        >
          <div className={`${INNER_PAD} ${maxWidth} py-3`}>
            <StepBar progress={progress} />
          </div>
        </GrainGradient>
      )}
    </>
  );
}

export interface PageBodyProps {
  children: React.ReactNode;
  /** Same max-width class as the header (default 'max-w-[880px]'). */
  maxWidth?: string;
  className?: string;
  /** Element (default 'main'); use 'div' if the page already has a <main>. */
  as?: 'main' | 'div';
}

/** Centred page column under the header: cards stacked with 20px gaps. */
export function PageBody({ children, maxWidth = DEFAULT_MAX, className, as: Tag = 'main' }: PageBodyProps) {
  return <Tag className={`${INNER_PAD} ${maxWidth} py-6 sm:py-8 space-y-5 sm:space-y-4 ${className ?? ''}`}>{children}</Tag>;
}
