'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Upload, CheckCircle, AlertCircle, Loader2, FileText, RefreshCw, X } from 'lucide-react';
import { ImageLightbox } from '@/components/ImageLightbox';
import { renderPdfFirstPage } from '@/lib/pdf-thumbnail';
import { useIsMobile } from '@/lib/useIsMobile';

interface UploadSlotProps {
  label: string;
  description: string;
  /**
   * Kept for the staff onboarding call sites that still pass it. Optional:
   * the company-setup portrait-photo slot is not a passport page at all, and
   * labelling it INSIDE_PAGES just to satisfy the prop was meaningless.
   */
  expectedType?: 'COVER' | 'INSIDE_PAGES' | 'ADDITIONAL_PAGE';
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
  /**
   * Show a Remove button (wired to onRemove) next to Replace. Off by
   * default — the staff onboarding forms deliberately dropped the X button
   * (Replace covers the swap); the company-setup intake opts in so a client
   * can clear a recorded upload outright.
   */
  removable?: boolean;
  /**
   * The file was uploaded by TME staff, not by the person filling this form.
   * Renders the slot filled and READ-ONLY: no Replace, no Remove, and a
   * "Provided by TME" note instead of a verification badge. Off by default —
   * the staff onboarding forms never see staff-provided refs.
   */
  providedByStaff?: boolean;
  /** Extra warnings shown under the slot (advisory, never blocking). */
  warnings?: string[];
  /** Rendered under the warnings — e.g. the "Continue anyway" affordance. */
  footer?: React.ReactNode;
}

export function UploadSlot({
  label,
  description,
  expectedType: _expectedType, // Reserved for future use
  file: _file, // File ref tracked by parent
  onUpload,
  onRemove, // Only rendered when `removable` — staff forms keep Replace-only
  validated,
  validating,
  error,
  preview,
  accept = 'application/pdf,image/jpeg,image/png',
  maxSizeMB = 5,
  needsReview = false,
  removable = false,
  providedByStaff = false,
  warnings,
  footer,
}: UploadSlotProps) {
  void _expectedType;
  void _file;
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  // Identity documents accept PDF + JPEG + PNG. On mobile we narrow to PDF
  // *only*: any image type in `accept` makes the OS picker offer the camera
  // ("Take Photo"), and there is no web API to allow library images while
  // hiding it — so PDF-only is the one reliable way to force a real scan and
  // block camera snapshots. Desktop keeps JPEG/PNG (file picker / drag-drop
  // has no camera). WebP / HEIC stay out — HEIC is the native iPhone camera
  // format, exactly the casual-snapshot path we want to discourage.
  const effectiveAccept = useMemo(() => {
    const requested = accept.split(',').map((t) => t.trim());
    let allowed = requested.filter(
      (t) => t === 'application/pdf' || t === 'image/jpeg' || t === 'image/png'
    );
    if (allowed.length === 0) allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (isMobile) allowed = allowed.filter((t) => t === 'application/pdf');
    if (allowed.length === 0) allowed = ['application/pdf'];
    return allowed.join(',');
  }, [accept, isMobile]);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Rendered page-1 image of an uploaded PDF (null while rendering or if it
  // failed — in which case we fall back to the generic "PDF uploaded" card).
  const [pdfThumb, setPdfThumb] = useState<string | null>(null);
  const [pdfThumbLoading, setPdfThumbLoading] = useState(false);
  // Whether the network-fetched preview image has painted. The storage route
  // sends no-store, so the image re-downloads on every revisit/refresh — show a
  // spinner instead of an empty box while it loads. Data-URL previews (a fresh
  // upload this session) resolve almost instantly.
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    setImgLoaded(false);
  }, [preview]);

  const isPdfPreview =
    !!preview &&
    (preview.startsWith('data:application/pdf') ||
      preview.toLowerCase().endsWith('.pdf'));

  const MAX_FILE_SIZE = maxSizeMB * 1024 * 1024;

  // Render the first page of a PDF preview to an inline thumbnail. Re-runs
  // whenever the previewed PDF changes; cancels cleanly if it changes again
  // mid-render so a stale thumbnail can't land on the new file.
  useEffect(() => {
    if (!isPdfPreview || !preview) {
      setPdfThumb(null);
      setPdfThumbLoading(false);
      return;
    }
    let cancelled = false;
    setPdfThumb(null);
    setPdfThumbLoading(true);
    renderPdfFirstPage(preview)
      .then((thumb) => {
        if (!cancelled) {
          setPdfThumb(thumb);
          setPdfThumbLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPdfThumb(null);
          setPdfThumbLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isPdfPreview, preview]);

  // Open the original PDF in a new tab. data: URLs are unreliable for
  // top-level navigation (Chrome blocks/downloads them), so convert to a
  // short-lived blob URL that opens cleanly in the browser's native viewer.
  const openPdf = () => {
    if (!preview) return;
    if (!preview.startsWith('data:')) {
      window.open(preview, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const comma = preview.indexOf(',');
      const mime = preview.slice(5, preview.indexOf(';')) || 'application/pdf';
      const binary = atob(preview.slice(comma + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      window.open(url, '_blank', 'noopener,noreferrer');
      // Revoke after a delay so the new tab has time to load the document.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      window.open(preview, '_blank', 'noopener,noreferrer');
    }
  };

  // The lightbox enlarges the actual image, or the rendered PDF page.
  const lightboxSrc = isPdfPreview ? pdfThumb : preview;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const acceptedTypes = effectiveAccept.split(',').map(t => t.trim());
      const typeOk = acceptedTypes.includes(selectedFile.type);
      if (!typeOk) {
        const friendly = isMobile
          ? 'On mobile, please upload a scanned PDF. Camera photos and image files are not accepted — use a scanner app, or upload a PDF/JPEG/PNG from a computer.'
          : 'Please upload a PDF, JPEG (.jpg / .jpeg), or PNG.';
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
    const acceptedTypes = effectiveAccept.split(',').map(t => t.trim());
    if (droppedFile && acceptedTypes.includes(droppedFile.type)) {
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
          accept={effectiveAccept}
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Preview or Upload Prompt */}
        {preview ? (
          <div className="relative p-2">
            {/* Images preview inline. PDFs render page 1 to an image
                (pdf.js) so they preview just like a photo under the strict
                CSP. While that renders we show a spinner; if it fails we
                fall back to a generic "PDF uploaded" card. */}
            {isPdfPreview ? (
              pdfThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pdfThumb}
                  alt={label || 'PDF preview'}
                  className="w-full h-64 object-contain rounded-lg bg-white cursor-zoom-in"
                  onClick={() => setLightboxOpen(true)}
                />
              ) : (
                <div className="w-full h-64 flex flex-col items-center justify-center rounded-lg bg-white">
                  {pdfThumbLoading ? (
                    <>
                      <Loader2 className="w-8 h-8 mb-3 animate-spin" style={{ color: TME_COLORS.primary }} />
                      <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Loading preview…</p>
                    </>
                  ) : (
                    <>
                      <FileText className="w-14 h-14 mb-3" style={{ color: TME_COLORS.primary }} />
                      <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>PDF uploaded</p>
                      <button
                        type="button"
                        onClick={openPdf}
                        className="mt-2 text-xs underline"
                        style={{ color: TME_COLORS.primary }}
                      >
                        Open PDF
                      </button>
                    </>
                  )}
                </div>
              )
            ) : (
              <div className="relative w-full h-64">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  // key forces a fresh element per preview so a reused node
                  // can't sit on a stale load state.
                  key={preview}
                  src={preview}
                  alt={label}
                  // Data-URL previews can finish decoding before React
                  // attaches onLoad — then the event never fires and the
                  // spinner overlay sticks forever. The ref callback runs at
                  // commit and catches the already-complete case.
                  ref={(el) => {
                    if (el && el.complete) setImgLoaded(true);
                  }}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgLoaded(true)}
                  className="w-full h-64 object-contain rounded-lg cursor-zoom-in"
                  onClick={() => setLightboxOpen(true)}
                />
                {!imgLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-gray-50">
                    <Loader2 className="w-7 h-7 animate-spin" style={{ color: TME_COLORS.primary }} />
                  </div>
                )}
              </div>
            )}

            {/* Status Badge */}
            <div className="absolute top-4 right-4">
              {providedByStaff ? (
                <div className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Provided by TME
                </div>
              ) : validating ? (
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
            {!validating && !providedByStaff && (
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="bg-white rounded-full p-1.5 shadow-md hover:bg-gray-100 transition-colors flex items-center gap-1 px-2"
                  title="Replace with another photo"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-gray-600" />
                  <span className="text-xs font-medium text-gray-700">Replace</span>
                </button>
                {removable && (
                  <button
                    type="button"
                    onClick={onRemove}
                    className="bg-white rounded-full p-1.5 shadow-md hover:bg-red-50 transition-colors flex items-center gap-1 px-2"
                    title="Remove this file"
                  >
                    <X className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs font-medium text-red-500">Remove</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : providedByStaff ? (
          <div className="w-full h-40 flex flex-col items-center justify-center gap-2 p-4 rounded-lg">
            <FileText className="w-8 h-8" style={{ color: TME_COLORS.primary }} />
            <span className="text-xs text-gray-600 text-center">
              Provided by TME — please confirm it is correct.
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full h-40 flex flex-col items-center justify-center gap-2 p-4 cursor-pointer hover:bg-gray-100 transition-colors rounded-lg"
          >
            <Upload className="w-8 h-8 text-gray-400" />
            <span className="text-xs text-gray-500 text-center">{description}</span>
            <span className="text-[11px] text-gray-400 text-center">
              {isMobile ? 'Scanned PDF only · camera disabled' : 'PDF or JPEG'}
            </span>
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
      {providedByStaff ? (
        <p className="mt-2 text-xs text-blue-700 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Provided by TME — please confirm
        </p>
      ) : (
        <>
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
        </>
      )}

      {warnings && warnings.length > 0 && !validating && (
        <div className="mt-2 space-y-1">
          {warnings.map((warning, i) => (
            <p key={i} className="text-xs text-amber-700 flex items-start gap-1">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      )}
      {footer}

      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt={label}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
