'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2, FileText, RefreshCw, X } from 'lucide-react';
import { ImageLightbox } from '@/components/ImageLightbox';
import { renderPdfFirstPage } from '@/lib/pdf-thumbnail';
import { useIsMobile } from '@/lib/useIsMobile';
import { MAX_FILE_BYTES } from '@/lib/file-validation';
import { FAILURE_MESSAGES } from '@/lib/request-outcome';

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
   * Renders the slot filled with a "Provided by TME" note instead of a
   * verification badge. Off by default: the staff onboarding forms never see
   * staff-provided refs.
   */
  providedByStaff?: boolean;
  /**
   * Let the client replace a `providedByStaff` file. The form asks them to
   * confirm our file is correct, so they need a way to say it is not: this
   * shows an "Upload the correct one" button that runs the normal upload +
   * check path, and the new file becomes theirs. Off by default, so the staff
   * onboarding forms keep the read-only behaviour they had.
   */
  staffDocReplaceable?: boolean;
  /**
   * Render the messages (errors, status line, warnings, footer) BESIDE the
   * upload tile instead of stacked under it. Off by default, so the staff
   * onboarding forms keep their single column; the company-setup intake opts
   * in because a bank statement can carry four lines of warning and reading
   * them under the image pushed everything else off the screen.
   */
  messagesBeside?: boolean;
  /** Extra warnings shown under the slot (advisory, never blocking). */
  warnings?: string[];
  /** Rendered under the warnings — e.g. the "Continue anyway" affordance. */
  footer?: React.ReactNode;
  /** Show the red required asterisk after the label. Off by default. */
  required?: boolean;
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
  maxSizeMB = MAX_FILE_BYTES / (1024 * 1024),
  needsReview = false,
  removable = false,
  providedByStaff = false,
  staffDocReplaceable = false,
  messagesBeside = false,
  warnings,
  footer,
  required = false,
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
  // The form-wide limit has one shared sentence; a slot with its own
  // smaller limit names that limit.
  const tooLargeMessage =
    MAX_FILE_SIZE === MAX_FILE_BYTES
      ? FAILURE_MESSAGES.too_large
      : `This file is too large. Please upload a file smaller than ${maxSizeMB} MB.`;

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

  // Same checks for the file picker and drag-and-drop. Returns false (after
  // telling the person why) when the file cannot be uploaded.
  const checkFile = (selectedFile: File): boolean => {
    const acceptedTypes = effectiveAccept.split(',').map(t => t.trim());
    const typeOk = acceptedTypes.includes(selectedFile.type);
    if (!typeOk) {
      const friendly = isMobile
        ? 'On mobile, please upload a scanned PDF. Camera photos and image files are not accepted. Use a scanner app, or upload a PDF/JPEG/PNG from a computer.'
        : 'Please upload a PDF, JPEG (.jpg / .jpeg), or PNG.';
      alert(friendly);
      return false;
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      alert(tooLargeMessage);
      return false;
    }
    return true;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && checkFile(selectedFile)) {
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
    // A dropped file of the wrong type used to be ignored silently.
    if (droppedFile && checkFile(droppedFile)) {
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
    if (isDragging) return 'border-tme-blue';
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
        <label className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">
          {label}
          {required && <span className="text-tme-red ml-1" aria-hidden>*</span>}
        </label>
      )}

      {/* `display: contents` keeps the stacked layout byte-identical for every
          caller that did not opt into messagesBeside. */}
      <div
        className={
          messagesBeside
            ? 'flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 items-start'
            : 'contents'
        }
      >
      <div
        className={`relative flex-1 border-2 border-dashed rounded-[10px] transition-all duration-200 ${getBorderColor()} ${getBgColor()}`}
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
                      <Loader2 className="w-8 h-8 mb-3 animate-spin text-tme-blue" />
                      <p className="text-sm font-medium text-tme-blue">Loading preview…</p>
                    </>
                  ) : (
                    <>
                      <FileText className="w-14 h-14 mb-3 text-tme-blue" />
                      <p className="text-[15px] font-semibold text-tme-blue sm:text-sm">PDF uploaded</p>
                      <button
                        type="button"
                        onClick={openPdf}
                        className="mt-1 min-h-11 px-3 rounded-[10px] text-[15px] font-semibold text-tme-blue sm:min-h-9 sm:rounded-lg sm:text-sm sm:font-medium underline underline-offset-2 hover:bg-blue-50 transition-colors tme-btn-focus"
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
                    <Loader2 className="w-7 h-7 animate-spin text-tme-blue" />
                  </div>
                )}
              </div>
            )}

            {/* Status Badge */}
            <div className="absolute top-3 right-3">
              {providedByStaff ? (
                <div className="bg-blue-100 text-tme-blue h-7 px-2.5 rounded-full text-[13px] font-semibold shadow-sm sm:h-6 sm:px-2 sm:text-xs sm:font-medium flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Provided by TME
                </div>
              ) : validating ? (
                <div className="bg-blue-100 text-tme-blue h-7 px-2.5 rounded-full text-[13px] font-semibold shadow-sm sm:h-6 sm:px-2 sm:text-xs sm:font-medium flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Validating...
                </div>
              ) : needsReview ? (
                <div className="bg-amber-100 text-amber-800 h-7 px-2.5 rounded-full text-[13px] font-semibold shadow-sm sm:h-6 sm:px-2 sm:text-xs sm:font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" aria-hidden />
                  Pending review
                </div>
              ) : validated ? (
                <div className="bg-green-100 text-green-800 h-7 px-2.5 rounded-full text-[13px] font-semibold shadow-sm sm:h-6 sm:px-2 sm:text-xs sm:font-medium flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" aria-hidden />
                  Valid
                </div>
              ) : error ? (
                <div className="bg-red-100 text-tme-red h-7 px-2.5 rounded-full text-[13px] font-semibold shadow-sm sm:h-6 sm:px-2 sm:text-xs sm:font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" aria-hidden />
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
            {!validating && (!providedByStaff || staffDocReplaceable) && (
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="min-h-11 px-3.5 sm:min-h-9 sm:px-3 bg-white rounded-full border border-gray-200 shadow-md hover:bg-blue-50 transition-colors flex items-center gap-1.5 text-sm sm:text-[13px] font-semibold text-tme-blue tme-btn-focus"
                  aria-label={
                    providedByStaff
                      ? 'Our file is not correct: replace it with the right one'
                      : 'Replace with another file'
                  }
                >
                  <RefreshCw className="w-4 h-4" aria-hidden />
                  <span>Replace</span>
                </button>
                {removable && !providedByStaff && (
                  <button
                    type="button"
                    onClick={onRemove}
                    className="min-h-11 px-3.5 sm:min-h-9 sm:px-3 bg-white rounded-full border border-gray-200 shadow-md hover:bg-red-50 transition-colors flex items-center gap-1.5 text-sm sm:text-[13px] font-semibold text-tme-red tme-btn-focus"
                    aria-label="Remove this file"
                  >
                    <X className="w-4 h-4" aria-hidden />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : providedByStaff ? (
          <div className="w-full min-h-40 flex flex-col items-center justify-center gap-2 p-4 rounded-[10px]">
            <FileText className="w-8 h-8 text-tme-blue" aria-hidden />
            <span className="text-sm sm:text-[13px] text-gray-600 text-center">
              Provided by TME. Please confirm it is correct.
            </span>
            {staffDocReplaceable && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-1 min-h-11 px-4 sm:min-h-9 sm:px-3 rounded-[var(--btn-radius)] text-sm sm:text-[13px] font-semibold bg-white border border-gray-200 text-tme-blue hover:bg-blue-50 transition-colors tme-btn-focus"
              >
                Not correct? Upload the right one
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full min-h-40 flex flex-col items-center justify-center gap-2 p-4 cursor-pointer hover:bg-blue-50 transition-colors rounded-[10px] tme-btn-focus"
          >
            <Upload className="w-8 h-8 text-tme-blue" aria-hidden />
            <span className="text-[15px] font-medium text-gray-700 text-center sm:text-sm">{description}</span>
            <span className="text-sm sm:text-[13px] text-gray-600 text-center">
              {isMobile ? 'Scanned PDF only · camera disabled' : 'PDF or JPEG'}
            </span>
          </button>
        )}
      </div>

      <div className={messagesBeside ? 'min-w-0' : 'contents'}>
      {/* Error Message */}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium leading-snug text-tme-red sm:mt-1.5 sm:text-[13px] flex items-start gap-1.5">
          <AlertCircle className="w-[18px] h-[18px] shrink-0 mt-px" aria-hidden />
          {error}
        </p>
      )}

      {/* Status line. The preview already carries a badge saying exactly this
          ("Pending review" / "Valid"), so the line only appears when there is
          no preview to put a badge on — otherwise every uploaded file said the
          same thing twice. The error line is different: the badge says
          "Invalid", the line says WHY, so it always shows. */}
      {providedByStaff ? (
        <p className="mt-2 text-sm leading-snug text-tme-blue sm:mt-1.5 sm:text-[13px] flex items-start gap-1.5">
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          Provided by TME. Please confirm it is correct
          {staffDocReplaceable ? ', or replace it with the right file.' : '.'}
        </p>
      ) : (
        !preview && (
          <>
            {needsReview && !error && !validating && (
              <p className="mt-2 text-sm leading-snug text-amber-800 sm:mt-1.5 sm:text-[13px] flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                TME will verify this manually
              </p>
            )}
            {validated && !needsReview && !error && !validating && (
              <p className="mt-2 text-sm font-medium leading-snug text-green-800 sm:mt-1.5 sm:text-[13px] flex items-start gap-1.5">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                Page verified
              </p>
            )}
          </>
        )
      )}

      {warnings && warnings.length > 0 && !validating && (
        <div className="mt-2 space-y-1">
          {warnings.map((warning, i) => (
            <p key={i} className="text-sm leading-snug text-amber-800 sm:text-[13px] flex items-start gap-1.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              {warning}
            </p>
          ))}
        </div>
      )}
      {footer}
      </div>
      </div>

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
