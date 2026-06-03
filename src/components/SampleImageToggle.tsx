'use client';

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';

interface SampleImageToggleProps {
  imageSrc: string;
  altText: string;
  label?: string;
  imageClassName?: string;
}

export function SampleImageToggle({ imageSrc, altText, label = 'See example', imageClassName }: SampleImageToggleProps) {
  const [show, setShow] = useState(true);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="flex items-center gap-1.5 text-xs font-medium hover:underline transition-colors"
        style={{ color: TME_COLORS.primary }}
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        {show ? 'Hide example' : label}
      </button>
      {show && (
        <div className="mt-2 flex justify-center">
          <div className="rounded-lg overflow-hidden border border-gray-200 inline-block max-w-full">
            <img src={imageSrc} alt={altText} className={imageClassName || 'max-w-xs'} />
          </div>
        </div>
      )}
    </div>
  );
}
