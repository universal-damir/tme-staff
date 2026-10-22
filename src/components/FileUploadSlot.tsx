'use client';

import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FieldError } from '@/components/ui/FormBits';
import { useIsMobile } from '@/lib/useIsMobile';
import { isUploadFailure, type UploadResult } from '@/lib/supabase';
import { FAILURE_MESSAGES } from '@/lib/request-outcome';
import { MAX_FILE_BYTES } from '@/lib/file-validation';

interface FileUploadSlotProps {
  label: string;
  description?: string;
  /** Resolves to the stored file, or `{ error }` with the reason to show. */
  onUpload: (file: File) => Promise<UploadResult | null>;
  onRemove: () => void;
  uploaded: boolean;
  filename?: string;
}

/**
 * Simple file upload slot for documents (PDF/images).
 * No AI validation — just upload and display.
 */
export function FileUploadSlot({
  label,
  description,
  onUpload,
  onRemove,
  uploaded,
  filename,
}: FileUploadSlotProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  // PDF + JPEG + PNG; on mobile, PDF only — accepting any image type makes the
  // OS picker offer the camera, and there's no way to hide it while allowing
  // library images. PDF-only forces a real scan. See useIsMobile.
  const acceptAttr = isMobile ? 'application/pdf' : 'application/pdf,image/jpeg,image/png';

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = isMobile
      ? ['application/pdf']
      : ['application/pdf', 'image/jpeg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      setError(
        isMobile
          ? 'On mobile, please upload a scanned PDF. Camera photos are not accepted. Use a scanner app, or upload a PDF/JPEG/PNG from a computer.'
          : 'Please upload a PDF, JPEG (.jpg / .jpeg), or PNG.'
      );
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setError(FAILURE_MESSAGES.too_large);
      return;
    }

    setError(null);
    setIsUploading(true);
    try {
      const result = await onUpload(file);
      if (isUploadFailure(result)) {
        setError(result?.error ?? FAILURE_MESSAGES.server_error);
      }
    } catch {
      setError(FAILURE_MESSAGES.server_error);
    } finally {
      setIsUploading(false);
      // Reset input so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      className={`border-2 border-dashed rounded-[10px] p-4 sm:px-4 sm:py-3 transition-all duration-200 ${
        uploaded ? 'border-tme-blue' : error ? 'border-tme-red' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {uploaded ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0 text-tme-blue" aria-hidden />
          ) : (
            <FileText className="w-5 h-5 text-gray-500 flex-shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug text-tme-blue sm:text-sm sm:font-medium">{label}</p>
            {uploaded && filename ? (
              <p className="text-sm sm:text-[13px] text-gray-600 break-all">{filename}</p>
            ) : description ? (
              <p className="text-sm sm:text-[13px] text-gray-600">{description}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {uploaded ? (
            <Button tone="dangerGhost" onClick={onRemove} aria-label={`Remove file: ${label}`}>
              <X className="w-4 h-4" aria-hidden />
              Remove
            </Button>
          ) : isUploading ? (
            <span className="size-11 sm:size-9 inline-flex items-center justify-center" aria-label="Uploading">
              <Loader2 className="w-5 h-5 animate-spin text-tme-blue" aria-hidden />
            </span>
          ) : (
            <Button tone="secondary" onClick={() => inputRef.current?.click()}>
              <Upload className="w-4 h-4" aria-hidden />
              Upload
            </Button>
          )}
        </div>
      </div>

      {error && (
        <FieldError>{error}</FieldError>
      )}

      {/* Upfront accepted-files notice, worded per device — without it,
          users only discover the policy after their file is rejected (or
          never, when the picker greys images out) and assume the system is
          broken. */}
      {!uploaded && !error && (
        <p className="text-sm leading-snug text-amber-800 mt-2 sm:text-[13px]">
          {isMobile
            ? 'Only PDF scans of official documents are accepted on this device. Camera photos are not. Please use a scanner app, or upload from a computer.'
            : 'Only scans of official documents are accepted (PDF, JPEG, or PNG).'}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
