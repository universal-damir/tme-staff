'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X, Check, RotateCcw } from 'lucide-react';
import { TME_COLORS } from '@/lib/constants';
import PerspT from 'perspective-transform';

const HANDLE_SIZE = 28;
const MAX_OUTPUT_LONG_SIDE = 2000;
const MAX_SOURCE_LONG_SIDE = 2400;
const WARP_GRID_N = 20;
const JPEG_QUALITY = 0.92;

type Point = { x: number; y: number };
type Corners = {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
  // Spine handles. For a flat document leave these at midpoints of the top
  // and bottom edges. For a passport spread, drag them onto the visible spine
  // so the warp can split the page into two flat halves.
  mt: Point;
  mb: Point;
};
type CornerKey = keyof Corners;

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function defaultCorners(w: number, h: number): Corners {
  const ix = w * 0.08;
  const iy = h * 0.08;
  const tl = { x: ix, y: iy };
  const tr = { x: w - ix, y: iy };
  const br = { x: w - ix, y: h - iy };
  const bl = { x: ix, y: h - iy };
  return { tl, tr, br, bl, mt: midpoint(tl, tr), mb: midpoint(bl, br) };
}

interface DisplayMetrics {
  dispW: number;
  dispH: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface DocumentScannerProps {
  file: File;
  onConfirm: (file: File) => void;
  onCancel: () => void;
}

export function DocumentScanner({ file, onConfirm, onCancel }: DocumentScannerProps) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [draggingKey, setDraggingKey] = useState<CornerKey | null>(null);
  const [metrics, setMetrics] = useState<DisplayMetrics | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function load() {
      try {
        const rawUrl = URL.createObjectURL(file);
        objectUrls.push(rawUrl);
        const rawImg = new Image();
        rawImg.src = rawUrl;
        await rawImg.decode();
        if (cancelled) return;

        const longest = Math.max(rawImg.naturalWidth, rawImg.naturalHeight);
        let finalImg = rawImg;
        let finalUrl = rawUrl;
        let w = rawImg.naturalWidth;
        let h = rawImg.naturalHeight;

        if (longest > MAX_SOURCE_LONG_SIDE) {
          const k = MAX_SOURCE_LONG_SIDE / longest;
          w = Math.round(w * k);
          h = Math.round(h * k);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const cctx = c.getContext('2d');
          if (!cctx) throw new Error('No 2D context');
          cctx.drawImage(rawImg, 0, 0, w, h);
          const blob = await new Promise<Blob>((resolve, reject) =>
            c.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('Downscale failed'))),
              'image/jpeg',
              0.95
            )
          );
          if (cancelled) return;
          finalUrl = URL.createObjectURL(blob);
          objectUrls.push(finalUrl);
          finalImg = new Image();
          finalImg.src = finalUrl;
          await finalImg.decode();
          if (cancelled) return;
        }

        imageRef.current = finalImg;
        setImgUrl(finalUrl);
        setImgSize({ w, h });
        setCorners(defaultCorners(w, h));
      } catch (e) {
        if (!cancelled) {
          setErrMsg(e instanceof Error ? e.message : 'Failed to load image');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      for (const u of objectUrls) URL.revokeObjectURL(u);
    };
  }, [file]);

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
  }, [imgSize]);

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
      e.preventDefault();
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
    setCorners(defaultCorners(imgSize.w, imgSize.h));
  };

  const handleConfirm = async () => {
    if (!corners || !imageRef.current) return;
    setProcessing(true);
    try {
      const blob = await warpAndExport(imageRef.current, corners);
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'scan';
      const scannedFile = new File([blob], `${baseName}-scanned.jpg`, {
        type: 'image/jpeg',
      });
      onConfirm(scannedFile);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to process scan');
      setProcessing(false);
    }
  };

  const handleUseOriginal = () => {
    onConfirm(file);
  };

  const screenCorner = useCallback(
    (p: Point) => {
      if (!metrics) return { x: 0, y: 0 };
      return {
        x: p.x * metrics.scale + metrics.offsetX,
        y: p.y * metrics.scale + metrics.offsetY,
      };
    },
    [metrics]
  );

  const polygonPoints = useMemo(() => {
    if (!corners || !metrics) return '';
    const pts = [
      screenCorner(corners.tl),
      screenCorner(corners.mt),
      screenCorner(corners.tr),
      screenCorner(corners.br),
      screenCorner(corners.mb),
      screenCorner(corners.bl),
    ];
    return pts.map((p) => `${p.x},${p.y}`).join(' ');
  }, [corners, metrics, screenCorner]);

  const spineLine = useMemo(() => {
    if (!corners || !metrics) return null;
    const a = screenCorner(corners.mt);
    const b = screenCorner(corners.mb);
    return { a, b };
  }, [corners, metrics, screenCorner]);

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
        <span className="text-sm font-medium">Align corners + spine</span>
        <button
          type="button"
          onClick={handleReset}
          disabled={!corners}
          className="p-2 -m-2 disabled:opacity-30"
          aria-label="Reset corners"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden select-none"
        style={{ touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {!imgSize && !errMsg && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading…
          </div>
        )}

        {errMsg && (
          <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm px-6 text-center">
            {errMsg}
          </div>
        )}

        {imgUrl && metrics && corners && (
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
              {spineLine && (
                <line
                  x1={spineLine.a.x}
                  y1={spineLine.a.y}
                  x2={spineLine.b.x}
                  y2={spineLine.b.y}
                  stroke="#FFB300"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  opacity={0.6}
                />
              )}
            </svg>
            {(['tl', 'tr', 'br', 'bl', 'mt', 'mb'] as CornerKey[]).map((key) => {
              const p = screenCorner(corners[key]);
              const isMid = key === 'mt' || key === 'mb';
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
                    background: isMid ? '#FFFFFF' : '#FFB300',
                    border: isMid ? '3px solid #FFB300' : '3px solid white',
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

        {processing && (
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
            disabled={!corners || processing}
            className="flex-1 py-3 rounded-lg text-white font-medium flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ backgroundColor: TME_COLORS.primary }}
          >
            <Check className="w-4 h-4" />
            Use scan
          </button>
        </div>
        {(errMsg || !imgSize) && (
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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function warpAndExport(img: HTMLImageElement, corners: Corners): Promise<Blob> {
  // Left half: tl-mt-mb-bl. Right half: mt-tr-br-mb. Each warps to its own
  // rectangle; they're stitched along a common spine in the output canvas.
  const leftWidth = Math.max(
    dist(corners.tl, corners.mt),
    dist(corners.bl, corners.mb)
  );
  const rightWidth = Math.max(
    dist(corners.mt, corners.tr),
    dist(corners.mb, corners.br)
  );
  const heightLeft = Math.max(
    dist(corners.tl, corners.bl),
    dist(corners.mt, corners.mb)
  );
  const heightRight = Math.max(
    dist(corners.mt, corners.mb),
    dist(corners.tr, corners.br)
  );

  let totalW = leftWidth + rightWidth;
  let totalH = Math.max(heightLeft, heightRight);
  const longest = Math.max(totalW, totalH);
  if (longest > MAX_OUTPUT_LONG_SIDE) {
    const k = MAX_OUTPUT_LONG_SIDE / longest;
    totalW *= k;
    totalH *= k;
  }
  totalW = Math.max(2, Math.round(totalW));
  totalH = Math.max(1, Math.round(totalH));

  // Allocate widths proportionally so the spine lands at the correct
  // boundary in the output rectangle.
  const splitX = Math.max(1, Math.min(totalW - 1,
    Math.round((leftWidth / (leftWidth + rightWidth)) * totalW)
  ));

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  warpQuadIntoRect(
    ctx, img,
    corners.tl, corners.mt, corners.mb, corners.bl,
    0, 0, splitX, totalH
  );
  warpQuadIntoRect(
    ctx, img,
    corners.mt, corners.tr, corners.br, corners.mb,
    splitX, 0, totalW - splitX, totalH
  );

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encode failed'))),
      'image/jpeg',
      JPEG_QUALITY
    )
  );
}

// Warps a source quad (4 image-space points, clockwise from top-left) into
// the rectangle (rx, ry, rw, rh) of the destination canvas. Uses a grid of
// affine triangles so text stays sharp.
function warpQuadIntoRect(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  topLeft: Point,
  topRight: Point,
  botRight: Point,
  botLeft: Point,
  rx: number,
  ry: number,
  rw: number,
  rh: number
) {
  const T = PerspT(
    [
      topLeft.x, topLeft.y,
      topRight.x, topRight.y,
      botRight.x, botRight.y,
      botLeft.x, botLeft.y,
    ],
    [
      rx, ry,
      rx + rw, ry,
      rx + rw, ry + rh,
      rx, ry + rh,
    ]
  );

  const N = WARP_GRID_N;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const dx0 = rx + (i * rw) / N;
      const dy0 = ry + (j * rh) / N;
      const dx1 = rx + ((i + 1) * rw) / N;
      const dy1 = ry + ((j + 1) * rh) / N;

      const [sx00, sy00] = T.transformInverse(dx0, dy0);
      const [sx10, sy10] = T.transformInverse(dx1, dy0);
      const [sx11, sy11] = T.transformInverse(dx1, dy1);
      const [sx01, sy01] = T.transformInverse(dx0, dy1);

      drawAffineTriangle(ctx, img,
        sx00, sy00, sx10, sy10, sx11, sy11,
        dx0, dy0, dx1, dy0, dx1, dy1);
      drawAffineTriangle(ctx, img,
        sx00, sy00, sx11, sy11, sx01, sy01,
        dx0, dy0, dx1, dy1, dx0, dy1);
    }
  }
}

function drawAffineTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number,
) {
  const denom = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
  if (Math.abs(denom) < 1e-10) return;

  const a = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) / denom;
  const c = ((dx2 - dx0) * (sx1 - sx0) - (dx1 - dx0) * (sx2 - sx0)) / denom;
  const b = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) / denom;
  const d = ((dy2 - dy0) * (sx1 - sx0) - (dy1 - dy0) * (sx2 - sx0)) / denom;
  const e = dx0 - a * sx0 - c * sy0;
  const f = dy0 - b * sx0 - d * sy0;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
