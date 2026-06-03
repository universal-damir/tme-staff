'use client';

import React, { useState, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Upload, CheckCircle, AlertCircle, Loader2, FileText, RefreshCw } from 'lucide-react';
import { ImageLightbox } from '@/components/ImageLightbox';

interface UploadSlotProps {
  label: string;
  description: string;
  expectedType: 'COVER' | 'INSIDE_PAGES';
  file: File | null;
  onUpload: (file: File) => Promise<boolean>;
  onRemove: () => void;
  validated: boolean;
  validating: boolean;
  error?: string;
  preview?: string;
  accept?: string;
  maxSizeMB?: number;
  /**
   * True when the file was uploaded via the manual-review fallback
   * (3-rejection bypass). The page is not actually AI-verified — TME
   * will check it on the portal side. The slot uses this to swap the
   * green "Valid" / "Page verified" treatment for an amber "Pending
   * review — TME will verify this manually" treatment so the user
   * isn't told their photo is verified when it's just been queued.
   */
  needsReview?: boolean;
}

export function UploadSlot({
  label,
  description,
  expectedType: _expectedType, // Reserved for future use
  file: _file, // File ref tracked by parent
  onUpload,
  onRemove: _onRemove, // No longer wired — Replace covers swap, no X button anymore
  validated,
  validating,
  error,
  preview,
  accept = 'image/jpeg,image/png,image/webp',
  maxSizeMB = 5,
  needsReview = false,
}: UploadSlotProps) {
  void _expectedType;
  void _file;
  void _onRemove;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const isPdfPreview =
    !!preview &&
    (preview.startsWith('data:application/pdf') ||
      preview.toLowerCase().endsWith('.pdf'));

  const MAX_FILE_SIZE = maxSizeMB * 1024 * 1024;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const acceptedTypes = accept.split(',').map(t => t.trim());
      const typeOk =
        acceptedTypes.includes(selectedFile.type) ||
        (acceptedTypes.some(t => t === 'image/*') && selectedFile.type.startsWith('image/'));
      if (!typeOk) {
        const friendly = acceptedTypes.includes('application/pdf')
          ? 'Please upload a JPEG, PNG, WebP image, or a PDF.'
          : 'Please upload a JPEG, PNG, or WebP image.';
        alert(friendly);
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
      if (selectedFile.size > MAX_FILE_SIZE) {
        alert(`File too large. Maximum size is ${maxSizeMB}MB.`);
        return;
      }
      await onUpload(selectedFile);
    }
    // Reset input
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    const acceptedTypes = accept.split(',').map(t => t.trim());
    if (droppedFile && (droppedFile.type.startsWith('image/') || acceptedTypes.includes(droppedFile.type))) {
      if (droppedFile.size > MAX_FILE_SIZE) {
        alert(`File too large. Maximum size is ${maxSizeMB}MB.`);
        return;
      }
      await onUpload(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const getBorderColor = () => {
    if (error) return 'border-red-300';
    if (needsReview) return 'border-amber-300';
    if (validated) return 'border-green-300';
    if (isDragging) return 'border-[#243F7B]';
    return 'border-gray-200';
  };

  const getBgColor = () => {
    if (error) return 'bg-red-50';
    if (needsReview) return 'bg-amber-50';
    if (validated) return 'bg-green-50';
    if (isDragging) return 'bg-blue-50';
    return 'bg-gray-50';
  };

  return (
    <div className="flex flex-col h-full">
      {label && (
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: TME_COLORS.primary }}
        >
          {label}
        </label>
      )}

      <div
        className={`relative flex-1 border-2 border-dashed rounded-lg transition-all duration-200 ${getBorderColor()} ${getBgColor()}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* File Input (hidden) */}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Preview or Upload Prompt */}
        {preview ? (
          <div className="relative p-2">
            {/* Images preview inline. PDFs render via <object>, with a
                generic "PDF uploaded" icon as fallback for browsers that
                refuse data: URLs (some mobile browsers). */}
            {isPdfPreview ? (
              <object
                // #view=FitH = "Fit horizontal" — tells the browser PDF
                // viewer to scale the page to the container width so the
                // user sees the full document instead of a squashed
                // letterbox with scrollbars.
                data={`${preview}#view=FitH&toolbar=1`}
                type="application/pdf"
                className="w-full h-64 rounded-lg bg-white"
                aria-label={label || 'PDF preview'}
              >
                <div className="w-full h-64 flex flex-col items-center justify-center rounded-lg bg-white">
                  <FileText className="w-14 h-14 mb-3" style={{ color: TME_COLORS.primary }} />
                  <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>PDF uploaded</p>
                  <a
                    href={preview}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-xs underline"
                    style={{ color: TME_COLORS.primary }}
                  >
                    Open PDF
                  </a>
                </div>
              </object>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt={label}
                className="w-full h-64 object-contain rounded-lg cursor-zoom-in"
                onClick={() => setLightboxOpen(true)}
              />
            )}

            {/* Status Badge */}
            <div className="absolute top-4 right-4">
              {validating ? (
                <div className="bg-blue-100 text-blue-600 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Validating...
                </div>
              ) : needsReview ? (
                <div className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Pending review
                </div>
              ) : validated ? (
                <div className="bg-green-100 text-green-600 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Valid
                </div>
              ) : error ? (
                <div className="bg-red-100 text-red-600 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Invalid
                </div>
              ) : null}
            </div>

            {/* Replace Button — single way to swap the photo. Opens the
                file picker directly; the new file's onUpload result
                overwrites the previous preview/file/error state in the
                parent. Hidden during validation/submission so the user
                isn't tempted to fire a second upload while the first is
                still in flight (and so the "Validating..." badge isn't
                competing with an actionable button). */}
            {!validating && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="absolute top-4 left-4 bg-white rounded-full p-1.5 shadow-md hover:bg-gray-100 transition-colors flex items-center gap-1 px-2"
                title="Replace with another photo"
              >
                <RefreshCw className="w-3.5 h-3.5 text-gray-600" />
                <span className="text-xs font-medium text-gray-700">Replace</span>
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full h-40 flex flex-col items-center justify-center gap-2 p-4 cursor-pointer hover:bg-gray-100 transition-colors rounded-lg"
          >
            <Upload className="w-8 h-8 text-gray-400" />
            <span className="text-xs text-gray-500 text-center">{description}</span>
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}

      {/* Validated Message — green "Page verified" only when AI actually
          accepted the page. Manual-review submissions get an amber line
          instead so the user understands the page hasn't been verified
          yet — TME will check it on the portal side. */}
      {needsReview && !error && !validating && (
        <p className="mt-2 text-xs text-amber-700 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          TME will verify this manually
        </p>
      )}
      {validated && !needsReview && !error && !validating && (
        <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Page verified
        </p>
      )}

      {preview && !isPdfPreview && (
        <ImageLightbox
          src={preview}
          alt={label}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
