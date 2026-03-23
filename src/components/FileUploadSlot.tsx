'use client';

import React, { useState, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Upload, FileText, CheckCircle, X, Loader2 } from 'lucide-react';

interface FileUploadSlotProps {
  label: string;
  description?: string;
  onUpload: (file: File) => Promise<{ path: string; filename: string } | null>;
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setError('Please select a JPG, PNG, or PDF file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setError(null);
    setIsUploading(true);
    try {
      const result = await onUpload(file);
      if (!result) {
        setError('Failed to upload file');
      }
    } catch {
      setError('Failed to upload file');
    } finally {
      setIsUploading(false);
      // Reset input so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 transition-all duration-200"
      style={{ borderColor: uploaded ? TME_COLORS.primary : error ? '#ef4444' : '#e5e7eb' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {uploaded ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: TME_COLORS.primary }} />
          ) : (
            <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-700">{label}</p>
            {uploaded && filename ? (
              <p className="text-xs text-gray-500 truncate">{filename}</p>
            ) : description ? (
              <p className="text-xs text-gray-400">{description}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {uploaded ? (
            <button
              type="button"
              onClick={onRemove}
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
              title="Remove file"
            >
              <X className="w-4 h-4 text-red-500" />
            </button>
          ) : isUploading ? (
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: TME_COLORS.primary }} />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-sm"
              style={{ backgroundColor: '#f0f4ff', color: TME_COLORS.primary }}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500 mt-2">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
