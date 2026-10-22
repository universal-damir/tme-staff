'use client';

/**
 * White card with an optional cloudy title strip (like the portal SectionHeaderBar).
 *
 *   <Card title="Passport details" description="Use your name exactly as in your passport.">
 *     ...fields...
 *   </Card>
 */

import React from 'react';
import { GrainGradient } from './grain-gradient';

export interface CardProps {
  /** Title in the cloudy strip (h2, semibold blue: 17px phone, 15px desktop). No title = no strip. */
  title?: React.ReactNode;
  /** Right side of the strip (count, chip, small button); wraps under the title on phones. */
  titleRight?: React.ReactNode;
  /** Intro line at the top of the body (gray-600: 15px phone, 14px desktop). */
  description?: React.ReactNode;
  /** Body padding p-5 (default true). false = rows edge to edge. */
  padded?: boolean;
  /** Stable seed for the wash (default: the title text). */
  seed?: string;
  className?: string;
  /** Extra classes on the body wrapper. */
  bodyClassName?: string;
  id?: string;
  children?: React.ReactNode;
}

export function Card({
  title,
  titleRight,
  description,
  padded = true,
  seed,
  className,
  bodyClassName,
  id,
  children,
}: CardProps) {
  const washSeed = seed ?? (typeof title === 'string' ? title : 'card');
  return (
    <section id={id} className={`bg-white border border-gray-200 rounded-[14px] overflow-hidden ${className ?? ''}`}>
      {title != null && (
        <GrainGradient
          color="#3B82F6"
          seed={`tme-staff-card-${washSeed}`}
          grainOpacity={0.35}
          className="px-5 py-3 border-b border-gray-200 sm:py-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 min-h-6">
            <h2 className="text-[17px] font-semibold leading-snug text-tme-blue sm:text-[15px]">{title}</h2>
            {titleRight}
          </div>
        </GrainGradient>
      )}
      {(description != null || children != null) && (
        <div className={`${padded ? 'p-5' : ''} ${bodyClassName ?? ''}`}>
          {description != null && (
            <p className={`text-[15px] leading-normal text-gray-600 sm:text-sm ${padded ? 'mb-4' : 'px-5 pt-4 pb-2'}`}>{description}</p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

export default Card;
