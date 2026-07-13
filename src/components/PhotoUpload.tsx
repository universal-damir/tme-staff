'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { compressImageForAI, topEdgeLooksClipped } from '@/lib/utils';
import { getDocumentUrl } from '@/lib/supabase';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { ImageLightbox } from '@/components/ImageLightbox';
import { renderPdfFirstPage } from '@/lib/pdf-thumbnail';
import { singlePagePdfError } from '@/lib/single-page-pdf';

interface PhotoUploadProps {
  /** Onboarding submission id; passed to the server-side AI guard. */
  submissionId: string;
  value?: { path: string; filename: string; validated: boolean; needsReview?: boolean };
  onUpload: (file: File) => Promise<{ path: string; filename: string } | null>;
  /**
   * `aiRejected` is true only when the AI validator actually judged the photo
   * invalid — service failures report validated=false with aiRejected=false so
   * they don't count toward the manual-review strike counter.
   */
  onValidated?: (validated: boolean, errors?: string[], aiRejected?: boolean) => void;
  onRemove?: () => void;
  error?: string;
  /**
   * SHA-256 (hex) of the photo already on file for this staff member
   * (renewals). The old photo itself is never shown; the hash lets us reject
   * a re-upload of the identical file with a clear message.
   */
  existingPhotoSha256?: string;
}

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Insecure context / very old browser — skip the reuse check rather than
    // block the upload.
    return null;
  }
}

export function PhotoUpload({ submissionId, value, onUpload, onValidated, onRemove, error, existingPhotoSha256 }: PhotoUploadProps) {
  const aiToken = useSearchParams().get('token');
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

    // Validate file type — a JPEG/PNG photo or a PDF scan. (HEIC / WebP stay
    // out: HEIC in particular is the native iPhone camera format, exactly the
    // casual-snapshot path we want to discourage.)
    const isJpeg = file.type === 'image/jpeg';
    const isPng = file.type === 'image/png';
    const isPdf = file.type === 'application/pdf';
    if (!isJpeg && !isPng && !isPdf) {
      setUploadError('Please upload a JPEG or PNG photo, or a PDF.');
      return;
    }

    // Validate file size (max 5MB - Claude API limit)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File size must be less than 5MB');
      return;
    }

    // Single-page rule: a PDF photo must be exactly one page. Catches a
    // multi-page PDF here, before we flatten to page 1 and silently accept it.
    const pageErr = await singlePagePdfError(file, 'photo');
    if (pageErr) {
      setUploadError(pageErr);
      return;
    }

    // Renewal photo-reuse guard: reject the exact file we already have on
    // record — a renewal requires a recent photo, not the one from the
    // previous application.
    if (existingPhotoSha256) {
      const hash = await sha256Hex(file);
      if (hash && hash === existingPhotoSha256.toLowerCase()) {
        setUploadError(
          'This is the same photo we already have on file from your previous application. Please upload a recent photo (taken within the last 6 months).'
        );
        return;
      }
    }

    setUploadError(null);
    setValidationErrors([]);

    // Read the file once. For a PDF, render page 1 to a JPEG so it previews
    // via <img> and is validated by the vision model exactly like a photo —
    // the original file is still what gets uploaded below. Reuse the result
    // for the AI validation call.
    let previewDataUrl: string;
    try {
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      previewDataUrl = isPdf ? await renderPdfFirstPage(rawDataUrl) : rawDataUrl;
    } catch {
      setUploadError('Could not read that file. Please upload a JPEG/PNG photo or a different PDF.');
      return;
    }

    // Deterministic framing pre-check: dark (hair) pixels on the very top
    // border mean the head is cut off. Decided in pixels because the vision
    // model's edge-contact judgment is unstable; counts as a rejection so the
    // 2-strike manual-review fallback stays reachable.
    if (await topEdgeLooksClipped(previewDataUrl)) {
      const msg =
        'The top of the head appears cut off by the top edge of the photo. Please upload a photo with clear background visible above the hair.';
      setPreview(previewDataUrl);
      setValidationErrors([msg]);
      onValidated?.(false, [msg], true);
      return;
    }
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
          body: JSON.stringify({ image: compressedImage, submissionId, token: aiToken }),
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
      onValidated?.(false, ['Validation service unavailable'], false);
      return;
    }

    if (validation.valid) {
      setValidationErrors([]);
      onValidated?.(true, [], false);
    } else {
      const errorMessages = (validation.errors as string[]).map(
        (err: string, i: number) => {
          const suggestion = validation.suggestions?.[i];
          return suggestion ? `${err} - ${suggestion}` : err;
        }
      );
      setValidationErrors(errorMessages);
      onValidated?.(false, errorMessages, true);
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
  // Build the image source: prefer local preview, fall back to Supabase storage
  // URL. A stored PDF can't render in <img>, so render its first page to a thumb
  // (mirrors the fresh-upload PDF path above).
  const storedUrl = value?.path ? getDocumentUrl(value.path) : null;
  const storedIsPdf = !!value?.filename && value.filename.toLowerCase().endsWith('.pdf');
  const [storedPdfThumb, setStoredPdfThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!storedIsPdf || !storedUrl || preview) {
      setStoredPdfThumb(null);
      return;
    }
    let cancelled = false;
    renderPdfFirstPage(storedUrl)
      .then((t) => { if (!cancelled) setStoredPdfThumb(t); })
      .catch(() => { if (!cancelled) setStoredPdfThumb(null); });
    return () => { cancelled = true; };
  }, [storedIsPdf, storedUrl, preview]);
  const imageSrc = preview || (storedIsPdf ? storedPdfThumb : storedUrl);

  // Track whether the (often network-fetched) image has actually painted, so we
  // can show a spinner instead of an empty grey box while it loads. The storage
  // route sends no-store, so this fires on every revisit/refresh/back-nav, not
  // just the first paint. Local data-URL previews resolve almost instantly.
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    setImgLoaded(false);
  }, [imageSrc]);

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
          <p className="text-sm text-gray-400">JPEG (.jpg / .jpeg), PNG, or PDF, up to 5MB. Studio-quality only — self-taken phone photos will be rejected.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,application/pdf"
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
            className="relative w-48 h-64 rounded-lg overflow-hidden bg-gray-100 mx-auto block cursor-zoom-in disabled:cursor-default"
            aria-label="View full-size photo"
          >
            {imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                // key forces a fresh element per src; the ref callback
                // catches images that finished decoding before React
                // attached onLoad (data URLs) — otherwise the spinner
                // overlay sticks forever.
                key={imageSrc}
                src={imageSrc}
                alt="Photo preview"
                loading="eager"
                decoding="async"
                ref={(el) => {
                  if (el && el.complete) setImgLoaded(true);
                }}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgLoaded(true)}
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Upload className="w-8 h-8 text-gray-300" />
              </div>
            )}
            {(isUploading || isValidating || (!!imageSrc && !imgLoaded)) && (
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

            {isValidated && !isValidating && !value?.needsReview && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Photo validated
              </div>
            )}

            {isValidated && !isValidating && value?.needsReview && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                Submitted for manual review — a TME team member will verify this photo
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
            accept=".jpg,.jpeg,.png,application/pdf"
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
            Head AND shoulders visible — space above your head, no tight cropping
          </li>
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            Face 70-80% of photo
          </li>
          <li className="flex items-center gap-1">
            <Upload className="w-3 h-3" />
            Recent photo (within 6 months) — not a photo of a printed photo
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
