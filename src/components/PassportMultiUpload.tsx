'use client';

import React, { useState, useCallback } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { compressImageForAI } from '@/lib/utils';
import { UploadSlot } from '@/components/UploadSlot';
import { Info } from 'lucide-react';
import type { PassportPageType } from '@/lib/passport-page-validation';
import type { EmployeeFormData } from '@/types';

interface PassportPage {
  file: File | null;
  preview: string | null;
  validated: boolean;
  validating: boolean;
  error: string | null;
  storagePath: string | null;
}

interface PassportMultiUploadProps {
  submissionId: string;
  onUpload: (pageType: string, file: File) => Promise<{ path: string } | null>;
  onExtracted?: (data: Partial<EmployeeFormData>) => void;
  onPagesChange?: (pages: { cover: PassportPage; insidePages: PassportPage }) => void;
  initialPages?: {
    cover?: { path: string; validated?: boolean };
    insidePages?: { path: string; validated?: boolean };
  };
}

export function PassportMultiUpload({
  submissionId: _submissionId, // Used for future features
  onUpload,
  onExtracted,
  onPagesChange,
  initialPages,
}: PassportMultiUploadProps) {
  void _submissionId; // Silence unused variable warning
  const [pages, setPages] = useState<{
    cover: PassportPage;
    insidePages: PassportPage;
  }>({
    cover: {
      file: null,
      preview: initialPages?.cover?.path || null,
      validated: initialPages?.cover?.validated || false,
      validating: false,
      error: null,
      storagePath: initialPages?.cover?.path || null,
    },
    insidePages: {
      file: null,
      preview: initialPages?.insidePages?.path || null,
      validated: initialPages?.insidePages?.validated || false,
      validating: false,
      error: null,
      storagePath: initialPages?.insidePages?.path || null,
    },
  });

  const validatePageType = async (
    imageBase64: string,
    expectedType: PassportPageType
  ): Promise<{ valid: boolean; error?: string }> => {
    try {
      // Compress image to fit Claude API limits
      const compressedImage = await compressImageForAI(imageBase64);

      const response = await fetch('/api/validate-passport-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage, expectedType }),
      });

      if (!response.ok) {
        throw new Error('Validation failed');
      }

      const result = await response.json();
      return {
        valid: result.matches,
        error: result.errorMessage || undefined,
      };
    } catch (error) {
      console.error('Page validation error:', error);
      return {
        valid: false,
        error: 'Unable to validate page. Please try again.',
      };
    }
  };

  const extractPassportData = useCallback(async (imageBase64: string): Promise<void> => {
    try {
      // Compress image to fit Claude API limits
      const compressedImage = await compressImageForAI(imageBase64);

      const response = await fetch('/api/extract-passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data && onExtracted) {
          onExtracted(result.data);
        }
      }
    } catch (error) {
      console.error('Passport extraction error:', error);
    }
  }, [onExtracted]);

  const handleUpload = useCallback(
    async (
      pageKey: 'cover' | 'insidePages',
      expectedType: PassportPageType,
      file: File
    ): Promise<boolean> => {
      // Create preview
      const reader = new FileReader();
      const preview = await new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });

      // Set validating state
      setPages((prev) => ({
        ...prev,
        [pageKey]: {
          ...prev[pageKey],
          file,
          preview,
          validating: true,
          error: null,
          validated: false,
        },
      }));

      // Validate page type
      const validation = await validatePageType(preview, expectedType);

      if (!validation.valid) {
        setPages((prev) => ({
          ...prev,
          [pageKey]: {
            ...prev[pageKey],
            validating: false,
            validated: false,
            error: validation.error || 'This is not the correct page type',
          },
        }));
        return false;
      }

      // Upload to storage
      const uploadResult = await onUpload(pageKey, file);
      if (!uploadResult) {
        setPages((prev) => ({
          ...prev,
          [pageKey]: {
            ...prev[pageKey],
            validating: false,
            validated: false,
            error: 'Failed to upload file',
          },
        }));
        return false;
      }

      // If this is the inside pages, extract passport info
      if (pageKey === 'insidePages' && onExtracted) {
        await extractPassportData(preview);
      }

      // Update state with success
      const newPages = {
        ...pages,
        [pageKey]: {
          file,
          preview,
          validated: true,
          validating: false,
          error: null,
          storagePath: uploadResult.path,
        },
      };
      setPages(newPages);
      onPagesChange?.(newPages);

      return true;
    },
    [pages, onUpload, extractPassportData, onExtracted, onPagesChange]
  );

  const handleRemove = useCallback(
    (pageKey: 'cover' | 'insidePages') => {
      const newPages = {
        ...pages,
        [pageKey]: {
          file: null,
          preview: null,
          validated: false,
          validating: false,
          error: null,
          storagePath: null,
        },
      };
      setPages(newPages);
      onPagesChange?.(newPages);
    },
    [pages, onPagesChange]
  );

  const allPagesValid = pages.cover.validated && pages.insidePages.validated;

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div
        className="flex items-start gap-3 p-4 rounded-lg"
        style={{ backgroundColor: '#EBF4FF' }}
      >
        <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
        <div className="text-sm" style={{ color: TME_COLORS.primary }}>
          <p className="font-medium">Please upload 2 passport images:</p>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            <li>Passport cover (outside front)</li>
            <li>Inside pages (open passport showing data page + opposite page)</li>
          </ul>
        </div>
      </div>

      {/* Upload Slots */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UploadSlot
          label="Passport Cover"
          description="Outside front of closed passport"
          expectedType="COVER"
          file={pages.cover.file}
          preview={pages.cover.preview || undefined}
          validated={pages.cover.validated}
          validating={pages.cover.validating}
          error={pages.cover.error || undefined}
          onUpload={(file) => handleUpload('cover', 'COVER', file)}
          onRemove={() => handleRemove('cover')}
        />

        <UploadSlot
          label="Inside Pages"
          description="Open passport showing both pages"
          expectedType="INSIDE_PAGES"
          file={pages.insidePages.file}
          preview={pages.insidePages.preview || undefined}
          validated={pages.insidePages.validated}
          validating={pages.insidePages.validating}
          error={pages.insidePages.error || undefined}
          onUpload={(file) => handleUpload('insidePages', 'INSIDE_PAGES', file)}
          onRemove={() => handleRemove('insidePages')}
        />
      </div>

      {/* Status Message */}
      {allPagesValid && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
          <span className="text-sm text-green-600 font-medium">
            All passport pages validated successfully
          </span>
        </div>
      )}
    </div>
  );
}
