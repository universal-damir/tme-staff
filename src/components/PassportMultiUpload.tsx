'use client';

import React, { useState, useCallback } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { compressImageForAI } from '@/lib/utils';
import { getDocumentUrl } from '@/lib/supabase';
import { UploadSlot } from '@/components/UploadSlot';
import { Info, CheckCircle, ChevronDown } from 'lucide-react';
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
  /** When true, inside pages section is revealed (controlled by parent step logic) */
  revealInsidePages?: boolean;
  /** Step numbers for display in section headers */
  coverStepNumber?: number;
  insideStepNumber?: number;
}

export function PassportMultiUpload({
  submissionId: _submissionId,
  onUpload,
  onExtracted,
  onPagesChange,
  initialPages,
  revealInsidePages = true,
  coverStepNumber,
  insideStepNumber,
}: PassportMultiUploadProps) {
  void _submissionId;
  const [pages, setPages] = useState<{
    cover: PassportPage;
    insidePages: PassportPage;
  }>({
    cover: {
      file: null,
      preview: initialPages?.cover?.path ? getDocumentUrl(initialPages.cover.path) : null,
      validated: initialPages?.cover?.validated || false,
      validating: false,
      error: null,
      storagePath: initialPages?.cover?.path || null,
    },
    insidePages: {
      file: null,
      preview: initialPages?.insidePages?.path ? getDocumentUrl(initialPages.insidePages.path) : null,
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

  const extractPassportData = useCallback(async (imageBase64: string): Promise<Record<string, unknown> | null> => {
    try {
      const compressedImage = await compressImageForAI(imageBase64);
      const response = await fetch('/api/extract-passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedImage }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          if (onExtracted) {
            onExtracted(result.data);
          }
          return result.data;
        }
      }
      return null;
    } catch (error) {
      console.error('Passport extraction error:', error);
      return null;
    }
  }, [onExtracted]);

  const handleUpload = useCallback(
    async (
      pageKey: 'cover' | 'insidePages',
      expectedType: PassportPageType,
      file: File
    ): Promise<boolean> => {
      const reader = new FileReader();
      const preview = await new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });

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

      let extractedData: Record<string, unknown> | null = null;
      if (pageKey === 'insidePages') {
        extractedData = await extractPassportData(preview);
      }

      const newPages = {
        ...pages,
        [pageKey]: {
          file,
          preview,
          validated: true,
          validating: false,
          error: null,
          storagePath: uploadResult.path,
          extractedData: extractedData || undefined,
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

  return (
    <div className="space-y-6">
      {/* Step 2: Passport Cover */}
      <div className="space-y-4">
        <div
          className="flex items-start gap-3 p-4 rounded-lg"
          style={{ backgroundColor: '#EBF4FF' }}
        >
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
          <div className="text-sm" style={{ color: TME_COLORS.primary }}>
            <p className="font-medium">Upload your passport cover (open/spread showing front + back cover)</p>
            <p className="mt-2 text-xs text-gray-600">
              Single page photos are not accepted. Passport must be spread open.
            </p>
          </div>
        </div>

        <UploadSlot
          label={coverStepNumber ? '' : 'Passport Cover'}
          description="Spread open: front + back cover visible"
          expectedType="COVER"
          file={pages.cover.file}
          preview={pages.cover.preview || undefined}
          validated={pages.cover.validated}
          validating={pages.cover.validating}
          error={pages.cover.error || undefined}
          onUpload={(file) => handleUpload('cover', 'COVER', file)}
          onRemove={() => handleRemove('cover')}
        />

        {pages.cover.validated && !revealInsidePages && (
          <div className="mt-2 flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle className="w-4 h-4" />
            Cover verified. Upload inside pages below.
            <ChevronDown className="w-4 h-4 animate-bounce" />
          </div>
        )}
      </div>

      {/* Step 3: Inside Pages - revealed after cover validates */}
      {revealInsidePages && (
        <div className="space-y-4">
          {insideStepNumber && (
            <div className="flex items-center gap-3 mb-2">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ backgroundColor: TME_COLORS.primary }}
              >
                {insideStepNumber}
              </span>
              <h2 className="text-lg font-semibold" style={{ color: TME_COLORS.primary }}>
                Inside Pages
              </h2>
            </div>
          )}

          <div
            className="flex items-start gap-3 p-4 rounded-lg"
            style={{ backgroundColor: '#EBF4FF' }}
          >
            <Info className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: TME_COLORS.primary }} />
            <div className="text-sm" style={{ color: TME_COLORS.primary }}>
              <p className="font-medium">Upload your passport inside pages (open/spread showing data page + opposite page)</p>
              <p className="mt-2 text-xs text-gray-600">
                Your details will be automatically extracted from this page.
              </p>
            </div>
          </div>

          <UploadSlot
            label=""
            description="Spread open: data page + opposite page"
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
      )}
    </div>
  );
}
