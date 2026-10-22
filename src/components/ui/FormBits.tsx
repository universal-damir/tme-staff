'use client';

/**
 * Small shared form pieces (TME look, 22.10.2026).
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';

/** Error under a field: red #B42318, alert icon, announced to screen readers. Renders nothing when empty. */
export function FieldError({ children, id, className }: { children?: React.ReactNode; id?: string; className?: string }) {
  if (children == null || children === false || children === '') return null;
  return (
    <p
      id={id}
      role="alert"
      className={`mt-1.5 flex items-start gap-1.5 text-sm font-medium leading-snug text-tme-red sm:mt-1 sm:text-[13px] ${className ?? ''}`}
    >
      <AlertCircle className="w-[18px] h-[18px] shrink-0 mt-px sm:w-4 sm:h-4" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Help line under a field (gray-600: 14px phone, 13px desktop). */
export function FieldHelp({ children, id, className }: { children?: React.ReactNode; id?: string; className?: string }) {
  if (children == null || children === false || children === '') return null;
  return <p id={id} className={`mt-1.5 text-sm leading-snug text-gray-600 sm:mt-1 sm:text-[13px] ${className ?? ''}`}>{children}</p>;
}

/**
 * Footer row: [left: secondary] ... [children: Back, primary LAST].
 * On phones (<640px) everything stacks full width with the LAST child (primary) on top.
 * Pass fullWidthOnMobile on the Buttons, or rely on the w-full the stack gives direct children.
 */
export function FormFooter({
  left,
  children,
  className,
}: {
  left?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto ${className ?? ''}`}
    >
      {left != null && <div className="flex flex-col-reverse gap-3 sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">{left}</div>}
      <span className="hidden sm:block sm:flex-1" aria-hidden />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
        {children}
      </div>
    </div>
  );
}

export type StatusChipTone = 'amber' | 'green' | 'blue' | 'grey' | 'red';

const CHIP_TONE: Record<StatusChipTone, string> = {
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-tme-blue',
  grey: 'bg-gray-100 text-gray-700',
  red: 'bg-red-100 text-tme-red',
};

/** Status pill: phone 28px 13px semibold; desktop 24px 12px medium. Text says the status; colour only supports it. */
export function StatusChip({
  tone = 'grey',
  icon,
  children,
  className,
}: {
  tone?: StatusChipTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold leading-none sm:h-6 sm:px-2 sm:text-xs sm:font-medium whitespace-nowrap ${CHIP_TONE[tone]} ${className ?? ''}`}
    >
      {icon}
      {children}
    </span>
  );
}
