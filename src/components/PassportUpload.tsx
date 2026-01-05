'use client';

import React, { useState, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { FileText, Upload, X, CheckCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';
import type { EmployeeFormData } from '@/types';

interface PassportUploadProps {
  value?: { path: string; filename: string; extracted_data?: Record<string, unknown> };
  onUpload: (file: File) => Promise<{ path: string; filename: string } | null>;
  onExtracted?: (data: Partial<EmployeeFormData>) => void;
  onRemove?: () => void;
  error?: string;
}

export function PassportUpload({ value, onUpload, onExtracted, onRemove, error }: PassportUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setUploadError('Please select a JPG, PNG, or PDF file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size must be less than 10MB');
      return;
    }

    setUploadError(null);
    setExtracted(false);

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreview(null); // PDF - no preview
    }

    // Upload file
    setIsUploading(true);
    try {
      const result = await onUpload(file);
      if (result) {
        // Call OCR extraction API
        setIsExtracting(true);

        // Read file as base64 for API
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64Image = e.target?.result as string;

          try {
            const response = await fetch('/api/extract-passport', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: base64Image }),
            });

            const extraction = await response.json();

            setIsExtracting(false);

            if (extraction.success && extraction.data) {
              setExtracted(true);
              // Map extracted data to EmployeeFormData format
              const mappedData = {
                first_name: extraction.data.first_name,
                middle_name: extraction.data.middle_name,
                last_name: extraction.data.family_name,
                nationality: extraction.data.nationality,
                passport_no: extraction.data.passport_no,
                passport_issue_date: extraction.data.passport_issue_date,
                passport_expiry_date: extraction.data.passport_expiry_date,
                date_of_birth: extraction.data.date_of_birth,
                gender: extraction.data.gender,
                place_of_birth: extraction.data.place_of_birth,
              };
              // Remove undefined values
              const cleanData = Object.fromEntries(
                Object.entries(mappedData).filter(([, v]) => v !== undefined)
              );
              onExtracted?.(cleanData);
            } else {
              setExtracted(true);
              setUploadError(extraction.error || 'Could not extract passport data');
              onExtracted?.({});
            }
          } catch (apiError) {
            console.error('Passport extraction API error:', apiError);
            setIsExtracting(false);
            setUploadError('Unable to extract passport data. Please try again.');
            onExtracted?.({});
          }
        };
        reader.readAsDataURL(file);
      } else {
        setUploadError('Failed to upload file');
      }
    } catch {
      setUploadError('Failed to upload file');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    setExtracted(false);
    setUploadError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    onRemove?.();
  };

  return (
    <div className="w-full">
      <label
        className="block text-sm font-medium mb-2"
        style={{ color: TME_COLORS.primary }}
      >
        Passport
        <span className="text-red-500 ml-1">*</span>
      </label>

      {!preview && !value ? (
        // Upload area
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors hover:border-gray-400"
          style={{ borderColor: error ? '#ef4444' : '#e5e7eb' }}
          onClick={() => inputRef.current?.click()}
        >
          <div
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ backgroundColor: TME_COLORS.secondary }}
          >
            <FileText className="w-8 h-8" style={{ color: TME_COLORS.primary }} />
          </div>
          <p className="text-gray-600 mb-2">Click to upload your passport</p>
          <p className="text-sm text-gray-400">JPG, PNG, or PDF up to 10MB</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      ) : (
        // Preview area
        <div className="relative border-2 rounded-lg p-4" style={{ borderColor: extracted ? '#22c55e' : '#e5e7eb' }}>
          <div className="flex items-start gap-4">
            <div className="relative w-32 h-24 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
              {preview ? (
                <Image
                  src={preview}
                  alt="Passport preview"
                  fill
                  className="object-cover"
                />
              ) : (
                <FileText className="w-12 h-12 text-gray-400" />
              )}
              {(isUploading || isExtracting) && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: TME_COLORS.primary }} />
                </div>
              )}
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{value?.filename || 'Passport'}</span>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {isExtracting && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Extracting information...
                </div>
              )}

              {extracted && !isExtracting && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  Information extracted - please verify below
                </div>
              )}
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* Passport tips */}
      <div className="mt-3 p-3 bg-gray-50 rounded-lg">
        <p className="text-xs font-medium text-gray-600 mb-2">Tips for best results:</p>
        <ul className="text-xs text-gray-500 space-y-1">
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            Upload the data page (with photo)
          </li>
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            Ensure all text is clearly visible
          </li>
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            Avoid glare and shadows
          </li>
        </ul>
      </div>

      {(error || uploadError) && (
        <p className="mt-1 text-sm text-red-500">{error || uploadError}</p>
      )}
    </div>
  );
}
