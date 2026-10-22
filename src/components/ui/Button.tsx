'use client';

/**
 * The TME grain button (port of the portal GrainButton, 22.10.2026).
 * Colours come from the --tme-* tokens and .tme-btn-* classes in globals.css.
 *
 * Tones:
 *  - primary:     deep TME blue with film grain. ONE per screen / section.
 *  - secondary:   light blue grain wash, blue text ("Save and finish later", "Upload file", "Answer")
 *  - plain:       white, thin grey line, blue text (Back, Cancel, Close)
 *  - ghost:       no background, blue text (in-row actions: Replace, View)
 *  - danger:      red with film grain (the final destructive step only)
 *  - dangerGhost: no background, red text (in-row Remove)
 *
 * Sizes (phone / desktop >=640px): md = 44/40px (default), sm = 40/36px (dense rows), lg = 48/44px.
 *
 * Old props still work: variant primary|secondary|outline (outline = plain),
 * loading (= busy).
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { GRAIN_NOISE } from './grain-gradient';

export type ButtonTone = 'primary' | 'secondary' | 'plain' | 'ghost' | 'danger' | 'dangerGhost';
export type ButtonSize = 'sm' | 'md' | 'lg';
/** @deprecated use `tone` */
export type ButtonVariant = 'primary' | 'secondary' | 'outline';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const GRAIN_OPACITY: Record<ButtonTone, number> = {
  primary: 0.35,
  secondary: 0.5,
  plain: 0,
  ghost: 0,
  danger: 0.3,
  dangerGhost: 0,
};

const TONE_CLASS: Record<ButtonTone, string> = {
  primary: 'tme-btn-primary',
  secondary: 'tme-btn-secondary',
  plain: 'tme-btn-plain',
  ghost: 'tme-btn-ghost',
  danger: 'tme-btn-danger',
  dangerGhost: 'tme-btn-danger-ghost',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  // Phone first (44px tap targets); from sm (>=640px) the calm desktop scale.
  sm: 'min-h-10 px-3.5 text-sm sm:min-h-9 sm:px-3 sm:text-[13px]',
  md: 'min-h-11 px-[18px] text-[15px] sm:min-h-10 sm:px-4 sm:text-sm',
  lg: 'min-h-12 px-5 text-base sm:min-h-11 sm:px-[18px] sm:text-[15px]',
};

const VARIANT_TO_TONE: Record<ButtonVariant, ButtonTone> = {
  primary: 'primary',
  secondary: 'secondary',
  outline: 'plain',
};

const BASE_CLASS =
  'relative overflow-hidden inline-flex items-center justify-center py-2 rounded-[var(--btn-radius)] font-semibold leading-tight text-center transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed tme-btn-focus';

/** The shared class string, for an element that cannot be a Button (e.g. a Next <Link>). */
export function buttonClasses({
  tone = 'primary',
  size = 'md',
  fullWidthOnMobile = false,
  className,
}: {
  tone?: ButtonTone;
  size?: ButtonSize;
  fullWidthOnMobile?: boolean;
  className?: string;
} = {}): string {
  return cx(
    BASE_CLASS,
    SIZE_CLASS[size],
    TONE_CLASS[tone],
    (tone === 'ghost' || tone === 'dangerGhost') && 'px-3 sm:px-2.5',
    fullWidthOnMobile && 'w-full sm:w-auto',
    className,
  );
}

function Inner({ tone, busy, children }: { tone: ButtonTone; busy: boolean; children: React.ReactNode }) {
  return (
    <>
      {GRAIN_OPACITY[tone] > 0 && (
        <span
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: GRAIN_NOISE,
            backgroundSize: '128px 128px',
            mixBlendMode: 'overlay',
            opacity: GRAIN_OPACITY[tone],
          }}
        />
      )}
      <span className="relative inline-flex items-center justify-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />}
        {children}
      </span>
    </>
  );
}

type MotionClash =
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'children'
  | 'type';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, MotionClash> {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Spinner in front of the label; blocks the button. */
  busy?: boolean;
  /** Full width below 640px, natural width above. */
  fullWidthOnMobile?: boolean;
  /** @deprecated use `tone` (outline = plain) */
  variant?: ButtonVariant;
  /** @deprecated use `busy` */
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  children: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone,
    variant,
    size = 'md',
    busy,
    loading,
    fullWidthOnMobile = false,
    disabled,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const t: ButtonTone = tone ?? (variant ? VARIANT_TO_TONE[variant] : 'primary');
  const isBusy = !!(busy ?? loading);
  const off = !!disabled || isBusy;
  return (
    <motion.button
      {...rest}
      ref={ref}
      type={type}
      disabled={off}
      aria-busy={isBusy || undefined}
      whileHover={off ? undefined : { scale: 1.02 }}
      whileTap={off ? undefined : { scale: 0.97 }}
      className={buttonClasses({ tone: t, size, fullWidthOnMobile, className })}
    >
      <Inner tone={t} busy={isBusy}>
        {children}
      </Inner>
    </motion.button>
  );
});

export interface ButtonLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, MotionClash> {
  href: string;
  tone?: ButtonTone;
  size?: ButtonSize;
  fullWidthOnMobile?: boolean;
  children: React.ReactNode;
}

/** An <a> (download, open in new tab, mailto) with the Button look. */
export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { tone = 'plain', size = 'md', fullWidthOnMobile = false, className, children, ...rest },
  ref,
) {
  return (
    <motion.a
      {...rest}
      ref={ref}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={buttonClasses({ tone, size, fullWidthOnMobile, className })}
    >
      <Inner tone={tone} busy={false}>
        {children}
      </Inner>
    </motion.a>
  );
});

export default Button;
