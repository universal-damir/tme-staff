'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, Maximize2 } from 'lucide-react';
import { renderPdfFirstPage } from '@/lib/pdf-thumbnail';
import { ImageLightbox } from '@/components/ImageLightbox';

/** Existing-document preview for the renewal confirm panels (staff + dependent).
 *
 *  Stored passports can be PDFs (uploads accept them). This used to embed those
 *  with <object type="application/pdf">, which the app's CSP (`object-src
 *  'none'`, next.config.ts) blocks outright — so a PDF on file ALWAYS collapsed
 *  to the bare "Open … (PDF)" fallback link and sat next to a real photo
 *  thumbnail looking broken.
 *
 *  PDFs now render page 1 to an image via pdf.js, the same way UploadSlot and
 *  PhotoUpload preview a freshly uploaded PDF, so every tile looks identical
 *  regardless of what was originally uploaded.
 *
 *  Tiles are also click-to-enlarge: at tile size nobody can actually read a
 *  passport data page, and this panel asks them to confirm it is still valid.
 */
export default function ExistingDocPreview({
  label,
  doc,
}: {
  label: string;
  doc: { path?: string; publicUrl?: string; filename?: string };
}) {
  const name = doc.filename || doc.path || (doc.publicUrl || '').split('?')[0];
  const isPdf = /\.pdf$/i.test(name || '');
  const url = doc.publicUrl;

  const [pdfThumb, setPdfThumb] = useState<string | null>(null);
  const [pdfThumbLoading, setPdfThumbLoading] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Render page 1 of a stored PDF to an inline thumbnail. Cancels cleanly if
  // the document changes mid-render so a stale thumbnail can't land on it.
  useEffect(() => {
    if (!isPdf || !url) {
      setPdfThumb(null);
      setPdfThumbLoading(false);
      return;
    }
    let cancelled = false;
    setPdfThumb(null);
    setPdfThumbLoading(true);
    renderPdfFirstPage(url)
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
  }, [isPdf, url]);

  // What the tile shows, and what the lightbox enlarges: the rendered page for
  // a PDF, the file itself for a photo.
  const previewSrc = isPdf ? pdfThumb : url;
  const canEnlarge = !!previewSrc && !imgFailed;

  return (
    <div>
      <label className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1">{label}</label>
      <div className="relative border-2 border-gray-200 rounded-[10px] overflow-hidden bg-gray-50">
        {canEnlarge ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt={label}
              onError={() => setImgFailed(true)}
              onClick={() => setLightboxOpen(true)}
              className="w-full h-64 object-contain bg-white cursor-zoom-in"
            />
            {/* Always visible rather than hover-only — most of these forms are
                filled on a phone, where there is no hover state to discover. */}
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`Enlarge ${label}`}
              className="absolute top-1.5 right-1.5 size-11 sm:size-9 inline-flex items-center justify-center rounded-full bg-white/90 border border-gray-200 shadow-sm hover:bg-white transition-colors text-tme-blue tme-btn-focus"
            >
              <Maximize2 className="w-5 h-5" aria-hidden />
            </button>
          </>
        ) : (
          <div className="w-full h-64 flex flex-col items-center justify-center bg-white px-3 text-center">
            {pdfThumbLoading ? (
              <>
                <Loader2 className="w-8 h-8 mb-3 animate-spin text-tme-blue" aria-hidden />
                <p className="text-sm font-medium text-tme-blue">Loading preview…</p>
              </>
            ) : (
              <>
                <FileText className="w-14 h-14 mb-3 text-tme-blue" aria-hidden />
                <p className="text-[15px] font-semibold text-tme-blue sm:text-sm">
                  {isPdf ? 'PDF on file' : 'Preview unavailable'}
                </p>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 min-h-11 inline-flex items-center px-3 rounded-[10px] text-[15px] font-semibold sm:min-h-9 sm:rounded-lg sm:text-sm sm:font-medium text-tme-blue underline underline-offset-2 hover:bg-blue-50 transition-colors tme-btn-focus"
                  >
                    Open {label}
                  </a>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {previewSrc && (
        <ImageLightbox
          src={previewSrc}
          alt={label}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}
