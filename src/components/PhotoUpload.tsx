'use client';

import React, { useState, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { compressImageForAI } from '@/lib/utils';
import { getDocumentUrl } from '@/lib/supabase';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { ImageLightbox } from '@/components/ImageLightbox';

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
  const [lightboxOpen, setLightboxOpen] = useState(false);
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

    // Create preview ONCE; reuse the base64 for AI validation below.
    const previewDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
    setPreview(previewDataUrl);

    // Run upload + AI validation in PARALLEL — they don't depend on each
    // other and used to be serial, doubling the perceived wait. Both also
    // share the same already-decoded base64.
    setIsUploading(true);
    setIsValidating(true);

    const uploadPromise = (async () => {
      try {
        return await onUpload(file);
      } catch {
        return null;
      }
    })();

    const validatePromise = (async () => {
      try {
        const compressedImage = await compressImageForAI(previewDataUrl);
        const response = await fetch('/api/validate-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: compressedImage }),
        });
        return await response.json();
      } catch (err) {
        console.error('Photo validation API error:', err);
        return null;
      }
    })();

    const [uploadResult, validation] = await Promise.all([
      uploadPromise,
      validatePromise,
    ]);

    setIsUploading(false);
    setIsValidating(false);

    if (!uploadResult) {
      setUploadError('Failed to upload file');
      return;
    }

    if (!validation) {
      setValidationErrors(['Unable to validate photo. Please try again.']);
      onValidated?.(false, ['Validation service unavailable']);
      return;
    }

    if (validation.valid) {
      setValidationErrors([]);
      onValidated?.(true, []);
    } else {
      const errorMessages = (validation.errors as string[]).map(
        (err: string, i: number) => {
          const suggestion = validation.suggestions?.[i];
          return suggestion ? `${err} - ${suggestion}` : err;
        }
      );
      setValidationErrors(errorMessages);
      onValidated?.(false, errorMessages);
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
  // Build the image source: prefer local preview, fall back to Supabase storage URL
  const imageSrc = preview || (value?.path ? getDocumentUrl(value.path) : null);

  return (
    <div className="w-full">
      <label
        className="block text-sm font-medium mb-2"
        style={{ color: TME_COLORS.primary }}
      >
        ID Photo
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
            <Upload className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-600 mb-2">Upload your studio passport photo</p>
          <p className="text-sm text-gray-400">JPG, PNG, HEIC up to 5MB. Studio-quality only — self-taken photos from the front camera on the phone will be rejected.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.heic,.webp"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      ) : (
        // Preview area: photo on top, status/errors below — keeps long AI
        // feedback readable instead of squeezing it next to the thumbnail.
        <div
          className="relative border-2 rounded-lg p-4"
          style={{ borderColor: isValidated ? '#22c55e' : '#e5e7eb' }}
        >
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded z-10"
            aria-label="Remove photo"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>

          <button
            type="button"
            onClick={() => imageSrc && setLightboxOpen(true)}
            disabled={!imageSrc}
            className="relative w-48 h-48 rounded-lg overflow-hidden bg-gray-100 mx-auto block cursor-zoom-in disabled:cursor-default"
            aria-label="View full-size photo"
          >
            {imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageSrc}
                alt="Photo preview"
                loading="eager"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Upload className="w-8 h-8 text-gray-300" />
              </div>
            )}
            {(isUploading || isValidating) && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: TME_COLORS.primary }} />
              </div>
            )}
          </button>

          <div className="mt-3">
            {isValidating && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                Validating photo…
              </div>
            )}

            {isValidated && !isValidating && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Photo validated
              </div>
            )}

            {!isValidated && !isValidating && !isUploading && value && validationErrors.length === 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-amber-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>Photo needs re-upload for validation</span>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="text-sm underline"
                  style={{ color: TME_COLORS.primary }}
                >
                  Re-upload
                </button>
              </div>
            )}

            {validationErrors.length > 0 && (
              <div className="space-y-2">
                {validationErrors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-red-500">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="text-sm underline"
                  style={{ color: TME_COLORS.primary }}
                >
                  Upload a new photo
                </button>
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.heic,.webp"
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

      {imageSrc && (
        <ImageLightbox
          src={imageSrc}
          alt="ID photo"
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
