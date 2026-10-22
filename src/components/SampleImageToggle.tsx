'use client';

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

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
        aria-expanded={show}
        className="min-h-11 sm:min-h-8 -ml-2 px-2 inline-flex items-center gap-1.5 rounded-[10px] sm:rounded-lg text-sm sm:text-[13px] font-semibold sm:font-medium text-tme-blue hover:bg-blue-50 transition-colors tme-btn-focus"
      >
        {show ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
        {show ? 'Hide example' : label}
      </button>
      {show && (
        <div className="mt-1 flex justify-center">
          <div className="rounded-[10px] overflow-hidden border border-gray-200 inline-block max-w-full">
            <img src={imageSrc} alt={altText} className={imageClassName || 'max-w-xs'} />
          </div>
        </div>
      )}
    </div>
  );
}
