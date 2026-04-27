'use client';

import React, { useState, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Upload, CheckCircle, AlertCircle, X, Loader2, FileText } from 'lucide-react';
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
}

export function UploadSlot({
  label,
  description,
  expectedType: _expectedType, // Reserved for future use
  file: _file, // File ref tracked by parent
  onUpload,
  onRemove,
  validated,
  validating,
  error,
  preview,
  accept = 'image/jpeg,image/png,image/webp',
  maxSizeMB = 5,
}: UploadSlotProps) {
  void _expectedType;
  void _file;
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
    if (validated) return 'border-green-300';
    if (isDragging) return 'border-[#243F7B]';
    return 'border-gray-200';
  };

  const getBgColor = () => {
    if (error) return 'bg-red-50';
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
            {/* Images preview inline. PDFs don't preview — validation runs,
                and once valid we just show a compact "PDF uploaded" card. */}
            {isPdfPreview ? (
              <div className="w-full h-64 flex flex-col items-center justify-center rounded-lg bg-white">
                <FileText className="w-14 h-14 mb-3" style={{ color: TME_COLORS.primary }} />
                <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>PDF uploaded</p>
              </div>
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

            {/* Remove Button */}
            <button
              type="button"
              onClick={onRemove}
              className="absolute top-4 left-4 bg-white rounded-full p-1 shadow-md hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
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

      {/* Validated Message - only show when not currently validating */}
      {validated && !error && !validating && (
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
