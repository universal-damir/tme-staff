'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TME_COLORS } from '@/lib/constants';
import { topEdgeLooksClipped } from '@/lib/utils';
import { getDocumentUrl, isUploadFailure, type UploadResult } from '@/lib/supabase';
import { callAiCheck } from '@/lib/ai-check-client';
import { MAX_FILE_BYTES } from '@/lib/file-validation';
import { FAILURE_MESSAGES } from '@/lib/request-outcome';
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { ImageLightbox } from '@/components/ImageLightbox';
import { renderPdfFirstPage } from '@/lib/pdf-thumbnail';
import { singlePagePdfError } from '@/lib/single-page-pdf';

interface PhotoUploadProps {
  /** Onboarding submission id; passed to the server-side AI guard. */
  submissionId: string;
  value?: { path: string; filename: string; validated: boolean; needsReview?: boolean };
  /** Returns the stored ref, or `{ error }` with the reason the upload failed. */
  onUpload: (file: File) => Promise<UploadResult | null>;
  /** Form name for the failure log ('employee', 'dependent', 'document-request'). */
  form?: string;
  /**
   * `aiRejected` is true when the attempt counts toward the manual-review
   * strike counter: a real AI rejection, or a check that could not run
   * (so a person whose check keeps failing is never stuck). Failures a hand
   * check cannot fix (closed form, wrong link, too many tries) report
   * validated=false with aiRejected=false.
   * `flags.samePhoto` is true when the vision comparison judged the upload to
   * be the same capture as the photo on file — callers persist it so the
   * portal can flag a manual-review submit of a suspected reused photo.
   */
  onValidated?: (
    validated: boolean,
    errors?: string[],
    aiRejected?: boolean,
    flags?: { samePhoto?: boolean }
  ) => void;
  onRemove?: () => void;
  error?: string;
  /**
   * Suppress the instructional blocks (the "Photo Requirements" checklist).
   * Set on a review page, where the photo is already uploaded and validated
   * and the how-to is noise. Defaults to false so the step pages are
   * unchanged. CS feedback 11.09.
   */
  hideGuidance?: boolean;
  /**
   * The photo already on file for this staff member (renewals / photo
   * re-requests). `sha256` powers the instant byte-identical rejection;
   * `publicUrl` (when the portal supplied a storage path) shows the client
   * which photo NOT to re-submit and enables the server-side vision
   * comparison against re-exports/screenshots/scans of the same photo.
   */
  existingPhoto?: { publicUrl?: string; filename?: string; sha256?: string };
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

export function PhotoUpload({ submissionId, value, onUpload, onValidated, onRemove, error, existingPhoto, hideGuidance = false, form = 'staff-onboarding' }: PhotoUploadProps) {
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

    // Validate file size. Large files upload directly and the AI check gets
    // a resized copy, so the one form-wide limit applies.
    if (file.size > MAX_FILE_BYTES) {
      setUploadError(FAILURE_MESSAGES.too_large);
      return;
    }

    // Single-page rule: a PDF photo must be exactly one page. Catches a
    // multi-page PDF here, before we flatten to page 1 and silently accept it.
    const pageErr = await singlePagePdfError(file, 'photo');
    if (pageErr) {
      setUploadError(pageErr);
      return;
    }

    // Renewal photo-reuse guard, fast path: reject the exact file we already
    // have on record — a renewal requires a recent photo, not the one from
    // the previous application. Re-exports/screenshots of the same photo have
    // a different hash; those are caught by the vision comparison below.
    if (existingPhoto?.sha256) {
      const hash = await sha256Hex(file);
      if (hash && hash === existingPhoto.sha256.toLowerCase()) {
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

    // onUpload never throws for upload failures (it returns `{ error }`);
    // a throw here is a bug in the caller, shown as our own error.
    const uploadPromise: Promise<UploadResult | null> = (async () => {
      try {
        return await onUpload(file);
      } catch {
        return { error: FAILURE_MESSAGES.server_error };
      }
    })();

    // callAiCheck shrinks the image for the AI and names every failure.
    const fileInfo = { size: file.size, type: file.type };
    const validatePromise = callAiCheck<{
      valid?: boolean;
      errors?: string[];
      suggestions?: string[];
    }>(
      '/api/validate-photo',
      { submissionId, token: aiToken },
      previewDataUrl,
      { form, action: 'check:photo', ref: submissionId, file: fileInfo }
    );

    // Renewal photo-reuse guard, vision path: the server compares the upload
    // against the photo on file (fetched server-side from storage) and judges
    // whether it's the same capture — catches re-exports, screenshots, crops,
    // and scans that defeat the SHA-256 fast path. Skipped when there's no
    // photo on file; failures degrade to "no verdict" (never a strike).
    const comparePromise = (async () => {
      if (!existingPhoto) return null;
      const outcome = await callAiCheck<{ samePhoto?: boolean }>(
        '/api/compare-photo',
        { submissionId, token: aiToken },
        previewDataUrl,
        { form, action: 'check:photo-compare', ref: submissionId, file: fileInfo }
      );
      return outcome.ok ? outcome.data : null;
    })();

    const [uploadResult, validationOutcome, comparison] = await Promise.all([
      uploadPromise,
      validatePromise,
      comparePromise,
    ]);

    setIsUploading(false);
    setIsValidating(false);

    if (isUploadFailure(uploadResult)) {
      setUploadError(uploadResult?.error ?? FAILURE_MESSAGES.server_error);
      return;
    }

    // Same-photo verdict wins over everything else: even a technically
    // compliant photo is useless if it's the one the authority already has.
    // A failed compare is NOT a verdict (comparison is null): fall through
    // to normal validation; the SHA-256 fast path and the portal's sync-time
    // backstop still stand.
    const samePhoto = !!comparison?.samePhoto;
    if (samePhoto) {
      const messages = [
        'This appears to be the same photo we already have on file from your previous application. UAE authorities require a newly taken photo (within the last 6 months) — please upload a new one.',
      ];
      // If the fresh upload ALSO failed quality validation, surface those
      // errors too so the client fixes everything in one go.
      if (validationOutcome.ok && validationOutcome.data.valid === false) {
        const v = validationOutcome.data;
        messages.push(
          ...(v.errors ?? []).map((err: string, i: number) => {
            const suggestion = v.suggestions?.[i];
            return suggestion ? `${err} - ${suggestion}` : err;
          })
        );
      }
      setValidationErrors(messages);
      onValidated?.(false, messages, true, { samePhoto: true });
      return;
    }

    // The check could not run (or the request failed): never a pass. It
    // counts as a strike unless a hand check could not help either.
    if (!validationOutcome.ok) {
      setValidationErrors([validationOutcome.message]);
      onValidated?.(false, [validationOutcome.message], validationOutcome.countsAsStrike);
      return;
    }
    const validation = validationOutcome.data;

    if (validation.valid) {
      setValidationErrors([]);
      onValidated?.(true, [], false, { samePhoto: false });
    } else {
      const errorMessages = (validation.errors ?? []).map(
        (err: string, i: number) => {
          const suggestion = validation.suggestions?.[i];
          return suggestion ? `${err} - ${suggestion}` : err;
        }
      );
      setValidationErrors(errorMessages);
      onValidated?.(false, errorMessages, true, { samePhoto: false });
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

  // "Your current photo on file" panel (renewals / photo re-requests). The
  // portal supplies a signed URL, re-signed on every form load. A PDF on file
  // can't render in <img>, so flatten page 1 to a thumbnail.
  const existingUrl = existingPhoto?.publicUrl || null;
  const existingIsPdf = !!existingPhoto?.filename && existingPhoto.filename.toLowerCase().endsWith('.pdf');
  const [existingThumb, setExistingThumb] = useState<string | null>(null);
  const [existingLightboxOpen, setExistingLightboxOpen] = useState(false);
  useEffect(() => {
    if (!existingIsPdf || !existingUrl) {
      setExistingThumb(null);
      return;
    }
    let cancelled = false;
    renderPdfFirstPage(existingUrl)
      .then((t) => { if (!cancelled) setExistingThumb(t); })
      .catch(() => { if (!cancelled) setExistingThumb(null); });
    return () => { cancelled = true; };
  }, [existingIsPdf, existingUrl]);
  const existingImageSrc = existingIsPdf ? existingThumb : existingUrl;

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

      {existingImageSrc && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => setExistingLightboxOpen(true)}
              className="relative w-20 h-24 rounded-md overflow-hidden bg-white border border-amber-200 flex-shrink-0 cursor-zoom-in"
              aria-label="View current photo on file"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={existingImageSrc}
                alt="Current photo on file"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </button>
            <div className="text-sm">
              <p className="font-medium mb-1" style={{ color: TME_COLORS.primary }}>
                This is your current photo on file
              </p>
              <p className="text-gray-700">
                UAE authorities require a <strong>newly taken</strong> photo (within the
                last 6 months). Do not upload this photo again — it will be rejected.
              </p>
            </div>
          </div>
        </div>
      )}

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
          <p className="text-sm text-gray-400">JPEG (.jpg / .jpeg), PNG, or PDF, up to 10 MB. Studio-quality only — self-taken phone photos will be rejected.</p>
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
      {!hideGuidance && (
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
      )}

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

      {existingImageSrc && (
        <ImageLightbox
          src={existingImageSrc}
          alt="Current photo on file"
          open={existingLightboxOpen}
          onClose={() => setExistingLightboxOpen(false)}
        />
      )}
    </div>
  );
}
