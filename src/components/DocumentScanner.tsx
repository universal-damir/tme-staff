'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, Check, RotateCcw } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';

const OPENCV_URL = '/opencv.js';
const MAX_OUTPUT_LONG_SIDE = 2000;
const HANDLE_SIZE = 28;

type Point = { x: number; y: number };
type Corners = {
  topLeftCorner: Point;
  topRightCorner: Point;
  bottomLeftCorner: Point;
  bottomRightCorner: Point;
};
type CornerKey = keyof Corners;

declare global {
  interface Window {
    // OpenCV.js global, untyped.
    cv?: unknown;
  }
}

let opencvPromise: Promise<unknown> | null = null;

export function preloadScanner(): void {
  if (typeof window === 'undefined') return;
  void ensureOpenCV().catch(() => {
    /* swallow — modal will surface error to the user when they actually open it */
  });
}

function ensureOpenCV(): Promise<unknown> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (opencvPromise) return opencvPromise;

  opencvPromise = new Promise((resolve, reject) => {
    const ready = () =>
      Boolean((window.cv as { Mat?: unknown } | undefined)?.Mat);

    if (ready()) return resolve(window.cv);

    if (!document.querySelector('script[data-opencv]')) {
      const script = document.createElement('script');
      script.src = OPENCV_URL;
      script.async = true;
      script.dataset.opencv = '1';
      script.onerror = () => {
        opencvPromise = null;
        reject(new Error('Failed to load OpenCV.js'));
      };
      document.head.appendChild(script);
    }

    const start = Date.now();
    const tick = () => {
      if (ready()) return resolve(window.cv);
      if (Date.now() - start > 30000) {
        opencvPromise = null;
        return reject(new Error('OpenCV.js timed out loading'));
      }
      setTimeout(tick, 100);
    };
    tick();
  });

  return opencvPromise;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function insetCorners(w: number, h: number): Corners {
  const ix = w * 0.08;
  const iy = h * 0.08;
  return {
    topLeftCorner: { x: ix, y: iy },
    topRightCorner: { x: w - ix, y: iy },
    bottomLeftCorner: { x: ix, y: h - iy },
    bottomRightCorner: { x: w - ix, y: h - iy },
  };
}

interface DisplayMetrics {
  dispW: number;
  dispH: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function useDisplayMetrics(
  containerRef: React.RefObject<HTMLDivElement | null>,
  imgSize: { w: number; h: number } | null
): DisplayMetrics | null {
  const [metrics, setMetrics] = useState<DisplayMetrics | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !imgSize) return;

    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const scale = Math.min(cw / imgSize.w, ch / imgSize.h);
      const dispW = imgSize.w * scale;
      const dispH = imgSize.h * scale;
      setMetrics({
        dispW,
        dispH,
        scale,
        offsetX: (cw - dispW) / 2,
        offsetY: (ch - dispH) / 2,
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, imgSize]);

  return metrics;
}

interface DocumentScannerProps {
  file: File;
  onConfirm: (file: File) => void;
  onCancel: () => void;
}

export function DocumentScanner({ file, onConfirm, onCancel }: DocumentScannerProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'processing' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<CornerKey | null>(null);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<unknown>(null);
  const cvRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    async function init() {
      try {
        const cv = await ensureOpenCV();
        if (cancelled) return;
        cvRef.current = cv;

        const mod = await import('jscanify/client');
        if (cancelled) return;
        // jscanify exports the class as the default export under CJS interop.
        const JscanifyCtor = (mod as { default?: unknown }).default ?? mod;
        const Ctor = JscanifyCtor as new () => unknown;
        scannerRef.current = new Ctor();

        const img = new Image();
        createdUrl = URL.createObjectURL(file);
        img.src = createdUrl;
        await img.decode();
        if (cancelled) return;
        imageRef.current = img;
        setImgUrl(createdUrl);
        setImgSize({ w: img.naturalWidth, h: img.naturalHeight });

        let detected: Corners | null = null;
        const cvAny = cv as { imread: (i: HTMLImageElement) => { delete: () => void } };
        const mat = cvAny.imread(img);
        try {
          const scanner = scannerRef.current as {
            findPaperContour: (m: unknown) => unknown;
            getCornerPoints: (c: unknown, m: unknown) => Partial<Corners>;
          };
          const contour = scanner.findPaperContour(mat);
          if (contour) {
            const c = scanner.getCornerPoints(contour, mat);
            if (
              c.topLeftCorner &&
              c.topRightCorner &&
              c.bottomLeftCorner &&
              c.bottomRightCorner
            ) {
              detected = c as Corners;
            }
          }
        } finally {
          mat.delete();
        }

        if (!detected) {
          detected = insetCorners(img.naturalWidth, img.naturalHeight);
        }

        if (!cancelled) {
          setCorners(detected);
          setStatus('ready');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          setErrMsg(msg);
          setStatus('error');
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file]);

  const metrics = useDisplayMetrics(containerRef, imgSize);

  const onPointerDown = useCallback(
    (key: CornerKey) => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      setDraggingKey(key);
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingKey || !metrics || !imgSize) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const imgX = clamp((localX - metrics.offsetX) / metrics.scale, 0, imgSize.w);
      const imgY = clamp((localY - metrics.offsetY) / metrics.scale, 0, imgSize.h);
      setCorners((prev) =>
        prev ? { ...prev, [draggingKey]: { x: imgX, y: imgY } } : prev
      );
    },
    [draggingKey, metrics, imgSize]
  );

  const onPointerUp = useCallback(() => {
    setDraggingKey(null);
  }, []);

  const handleReset = () => {
    if (!imgSize) return;
    setCorners(insetCorners(imgSize.w, imgSize.h));
  };

  const handleConfirm = async () => {
    if (!corners || !imageRef.current || !scannerRef.current) return;
    setStatus('processing');
    try {
      const { topLeftCorner: tl, topRightCorner: tr, bottomLeftCorner: bl, bottomRightCorner: br } = corners;
      const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
      const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
      const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
      const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
      let outW = Math.max(widthA, widthB);
      let outH = Math.max(heightA, heightB);
      const longest = Math.max(outW, outH);
      if (longest > MAX_OUTPUT_LONG_SIDE) {
        const k = MAX_OUTPUT_LONG_SIDE / longest;
        outW *= k;
        outH *= k;
      }
      outW = Math.max(1, Math.round(outW));
      outH = Math.max(1, Math.round(outH));

      const scanner = scannerRef.current as {
        extractPaper: (
          image: HTMLImageElement,
          w: number,
          h: number,
          c: Corners
        ) => HTMLCanvasElement | null;
      };
      const canvas = scanner.extractPaper(imageRef.current, outW, outH, corners);
      if (!canvas) throw new Error('Could not extract document');

      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
          'image/jpeg',
          0.92
        )
      );

      const baseName = file.name.replace(/\.[^.]+$/, '') || 'scan';
      const scannedFile = new File([blob], `${baseName}-scanned.jpg`, { type: 'image/jpeg' });
      onConfirm(scannedFile);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to process scan');
      setStatus('ready');
    }
  };

  const screenCorner = (p: Point) =>
    metrics
      ? { x: p.x * metrics.scale + metrics.offsetX, y: p.y * metrics.scale + metrics.offsetY }
      : { x: 0, y: 0 };

  const polygonPoints =
    corners && metrics
      ? (
          [
            screenCorner(corners.topLeftCorner),
            screenCorner(corners.topRightCorner),
            screenCorner(corners.bottomRightCorner),
            screenCorner(corners.bottomLeftCorner),
          ]
            .map((p) => `${p.x},${p.y}`)
            .join(' ')
        )
      : '';

  const handleUseOriginal = () => {
    onConfirm(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex items-center justify-between p-3 text-white">
        <button
          type="button"
          onClick={onCancel}
          className="p-2 -m-2"
          aria-label="Cancel"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-sm font-medium">Adjust corners</span>
        <button
          type="button"
          onClick={handleReset}
          disabled={status !== 'ready'}
          className="p-2 -m-2 disabled:opacity-30"
          aria-label="Reset corners"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden touch-none select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-sm px-6 text-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading scanner…</span>
            <span className="text-xs text-white/60">
              First time can take ~30s on slow connections.
            </span>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center text-red-300 px-6 text-center text-sm">
            {errMsg}
          </div>
        )}

        {imgUrl && metrics && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgUrl}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: metrics.offsetX,
                top: metrics.offsetY,
                width: metrics.dispW,
                height: metrics.dispH,
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
            {corners && (
              <>
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width="100%"
                  height="100%"
                >
                  <polygon
                    points={polygonPoints}
                    fill="rgba(36, 63, 123, 0.18)"
                    stroke="#FFB300"
                    strokeWidth={2}
                  />
                </svg>
                {(['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'] as CornerKey[]).map((key) => {
                  const p = screenCorner(corners[key]);
                  return (
                    <div
                      key={key}
                      onPointerDown={onPointerDown(key)}
                      style={{
                        position: 'absolute',
                        left: p.x - HANDLE_SIZE / 2,
                        top: p.y - HANDLE_SIZE / 2,
                        width: HANDLE_SIZE,
                        height: HANDLE_SIZE,
                        borderRadius: '50%',
                        background: '#FFB300',
                        border: '3px solid white',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
                        touchAction: 'none',
                        cursor: 'grab',
                      }}
                      aria-label={key}
                    />
                  );
                })}
              </>
            )}
          </>
        )}

        {status === 'processing' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-sm">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Flattening…
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-lg bg-white/10 text-white font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={status !== 'ready'}
            className="flex-1 py-3 rounded-lg text-white font-medium flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ backgroundColor: TME_COLORS.primary }}
          >
            <Check className="w-4 h-4" />
            Use scan
          </button>
        </div>
        {(status === 'loading' || status === 'error') && (
          <button
            type="button"
            onClick={handleUseOriginal}
            className="w-full py-2 text-white/80 text-sm underline"
          >
            Use original photo (skip scan)
          </button>
        )}
      </div>
    </div>
  );
}
