'use client';

import React, { useState, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { compressImageForAI } from '@/lib/utils';
import { Camera, Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';

interface PhotoUploadProps {
  value?: { path: string; filename: string; validated: boolean };
  onUpload: (file: File) => Promise<{ path: string; filename: string } | null>;
  onValidated?: (validated: boolean, errors?: string[]) => void;
  onRemove?: () => void;
  error?: string;
}

export function PhotoUpload({ value, onUpload, onValidated, onRemove, error }: PhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB - Claude API limit)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File size must be less than 5MB');
      return;
    }

    setUploadError(null);
    setValidationErrors([]);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload file
    setIsUploading(true);
    try {
      const result = await onUpload(file);
      if (result) {
        // Call AI validation API
        setIsValidating(true);

        // Read file as base64 for API
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64Image = e.target?.result as string;

          try {
            // Compress image to fit Claude API limits
            const compressedImage = await compressImageForAI(base64Image);

            const response = await fetch('/api/validate-photo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: compressedImage }),
            });

            const validation = await response.json();

            setIsValidating(false);

            if (validation.valid) {
              setValidationErrors([]);
              onValidated?.(true, []);
            } else {
              // Combine errors and suggestions for display
              const errorMessages = validation.errors.map((err: string, i: number) => {
                const suggestion = validation.suggestions?.[i];
                return suggestion ? `${err} - ${suggestion}` : err;
              });
              setValidationErrors(errorMessages);
              onValidated?.(false, errorMessages);
            }
          } catch (apiError) {
            console.error('Photo validation API error:', apiError);
            setIsValidating(false);
            setValidationErrors(['Unable to validate photo. Please try again.']);
            onValidated?.(false, ['Validation service unavailable']);
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
    setValidationErrors([]);
    setUploadError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    onRemove?.();
  };

  const isValidated = value?.validated ?? false;

  return (
    <div className="w-full">
      <label
        className="block text-sm font-medium mb-2"
        style={{ color: TME_COLORS.primary }}
      >
        Photo
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
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center border-2 border-dashed border-gray-300"
          >
            <Camera className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-600 mb-2">Click to upload your photo</p>
          <p className="text-sm text-gray-400">JPG, PNG up to 5MB</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      ) : (
        // Preview area
        <div className="relative border-2 rounded-lg p-4" style={{ borderColor: isValidated ? '#22c55e' : '#e5e7eb' }}>
          <div className="flex items-start gap-4">
            <div className="relative w-32 h-32 rounded-lg overflow-hidden bg-gray-100">
              {preview && (
                <Image
                  src={preview}
                  alt="Photo preview"
                  fill
                  className="object-cover"
                />
              )}
              {(isUploading || isValidating) && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: TME_COLORS.primary }} />
                </div>
              )}
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{value?.filename || 'Photo'}</span>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {isValidating && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validating photo...
                </div>
              )}

              {isValidated && !isValidating && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  Photo validated
                </div>
              )}

              {validationErrors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {validationErrors.map((err, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-red-500">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {err}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="mt-2 text-sm underline"
                    style={{ color: TME_COLORS.primary }}
                  >
                    Upload a new photo
                  </button>
                </div>
              )}
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* Photo requirements */}
      <div className="mt-3 p-3 bg-gray-50 rounded-lg">
        <p className="text-xs font-medium text-gray-600 mb-2">Photo Requirements:</p>
        <ul className="text-xs text-gray-500 space-y-1">
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            White background
          </li>
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            Face 70-80% of photo
          </li>
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            No glasses, neutral expression
          </li>
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            Clear, no shadows or blur
          </li>
        </ul>
      </div>

      {(error || uploadError) && (
        <p className="mt-1 text-sm text-red-500">{error || uploadError}</p>
      )}
    </div>
  );
}
