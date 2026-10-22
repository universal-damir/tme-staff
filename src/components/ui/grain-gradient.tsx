'use client';

import React from 'react';

/**
 * Grainy "bloom field" gradient background (21st.dev style).
 * Copied from the TME portal (src/components/ui/grain-gradient.tsx), 22.10.2026.
 *
 * Usage:
 *   <GrainGradient color="#3B82F6" seed={someStableId} className="p-3 rounded-lg">
 *     ...content...
 *   </GrainGradient>
 *
 * Or use the raw building blocks (GRAIN_NOISE + bloomGradient) directly
 * when you need full control over the wrapper element.
 */

// Monochrome film grain (SVG turbulence desaturated, tiles at 128px).
// Blend with 'overlay' on a gradient for the grainy-gradient look.
export const GRAIN_NOISE =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// Irregular radial color blobs plus a white bloom, in the given color.
// Blob positions are seeded from `seedStr` so a given seed always produces
// the same wash - stable across re-renders, different across items.
export const bloomGradient = (color: string, seedStr: string): string => {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  // Cheap deterministic PRNG: returns 0..1
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pct = (min: number, max: number) => Math.round(min + rand() * (max - min));

  const blobs = [
    `radial-gradient(90% 140% at ${pct(0, 30)}% ${pct(-20, 40)}%, ${color}66 0%, transparent 65%)`,
    `radial-gradient(100% 150% at ${pct(70, 110)}% ${pct(60, 130)}%, ${color}59 0%, transparent 60%)`,
    `radial-gradient(80% 120% at ${pct(35, 70)}% ${pct(80, 140)}%, ${color}33 0%, transparent 55%)`,
  ];
  const bloom = `radial-gradient(110% 150% at ${pct(55, 95)}% ${pct(-30, 10)}%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 55%)`;
  return [bloom, ...blobs, `linear-gradient(0deg, ${color}14, ${color}14)`].join(', ');
};

export interface GrainGradientProps {
  /** Base color of the wash (hex, e.g. '#3B82F6') */
  color: string;
  /** Stable seed (e.g. a record id) - same seed, same wash */
  seed: string;
  /** Grain strength 0..1 (default 0.5) */
  grainOpacity?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** Element to render (default 'div'), e.g. 'header' for the page band. */
  as?: 'div' | 'header' | 'section';
}

export const GrainGradient: React.FC<GrainGradientProps> = ({
  color,
  seed,
  grainOpacity = 0.5,
  className,
  style,
  children,
  as: Tag = 'div',
}) => (
  <Tag
    className={`relative ${className || ''}`}
    style={{
      backgroundColor: '#FFFFFF',
      backgroundImage: bloomGradient(color, seed),
      ...style,
    }}
  >
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: GRAIN_NOISE,
        backgroundSize: '128px 128px',
        mixBlendMode: 'overlay',
        opacity: grainOpacity,
      }}
    />
    <div className="relative">{children}</div>
  </Tag>
);
