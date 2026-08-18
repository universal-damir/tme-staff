'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, Maximize2 } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
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
      <label className="block text-xs font-medium mb-1" style={{ color: TME_COLORS.primary }}>{label}</label>
      <div className="relative border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-50">
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
              className="absolute top-2 right-2 rounded-full bg-white/90 p-1.5 shadow-sm hover:bg-white transition-colors"
            >
              <Maximize2 className="w-4 h-4" style={{ color: TME_COLORS.primary }} />
            </button>
          </>
        ) : (
          <div className="w-full h-64 flex flex-col items-center justify-center bg-white px-3 text-center">
            {pdfThumbLoading ? (
              <>
                <Loader2 className="w-8 h-8 mb-3 animate-spin" style={{ color: TME_COLORS.primary }} />
                <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>Loading preview…</p>
              </>
            ) : (
              <>
                <FileText className="w-14 h-14 mb-3" style={{ color: TME_COLORS.primary }} />
                <p className="text-sm font-medium" style={{ color: TME_COLORS.primary }}>
                  {isPdf ? 'PDF on file' : 'Preview unavailable'}
                </p>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-xs underline"
                    style={{ color: TME_COLORS.primary }}
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
