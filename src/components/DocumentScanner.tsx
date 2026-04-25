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
  // Mid-edge handles. Default to midpoints of each edge — in that position
  // the warp is exactly equivalent to a plain 4-corner perspective warp.
  // Drag a handle to compensate for slight edge curvature (book bow, lens
  // distortion, table reflection). The warp adds a smooth perturbation to
  // the perspective base so the mid-handle is interpolated through.
  mt: Point;
  mr: Point;
  mb: Point;
  ml: Point;
};
type CornerKey = keyof Corners;

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function defaultCorners(w: number, h: number): Corners {
  const ix = w * 0.08;
  const iy = h * 0.08;
  const tl = { x: ix, y: iy };
  const tr = { x: w - ix, y: iy };
  const br = { x: w - ix, y: h - iy };
  const bl = { x: ix, y: h - iy };
  return {
    tl, tr, br, bl,
    mt: mid(tl, tr),
    mr: mid(tr, br),
    mb: mid(br, bl),
    ml: mid(bl, tl),
  };
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
  const [mode, setMode] = useState<'edit' | 'processing' | 'preview'>('edit');
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
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
    setMode('processing');
    try {
      const blob = await warpAndExport(imageRef.current, corners);
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'scan';
      const f = new File([blob], `${baseName}-scanned.jpg`, { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      // Revoke any previous preview URL.
      if (scannedUrl) URL.revokeObjectURL(scannedUrl);
      setScannedFile(f);
      setScannedUrl(url);
      setMode('preview');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to process scan');
      setMode('edit');
    }
  };

  const handleAdjust = () => {
    if (scannedUrl) URL.revokeObjectURL(scannedUrl);
    setScannedUrl(null);
    setScannedFile(null);
    setMode('edit');
  };

  const handleApprove = () => {
    if (!scannedFile) return;
    onConfirm(scannedFile);
  };

  // Cleanup preview URL on unmount.
  useEffect(() => {
    return () => {
      if (scannedUrl) URL.revokeObjectURL(scannedUrl);
    };
  }, [scannedUrl]);

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

  const outlinePath = useMemo(() => {
    if (!corners || !metrics) return '';
    const tl = screenCorner(corners.tl);
    const tr = screenCorner(corners.tr);
    const br = screenCorner(corners.br);
    const bl = screenCorner(corners.bl);
    const mt = screenCorner(corners.mt);
    const mr = screenCorner(corners.mr);
    const mb = screenCorner(corners.mb);
    const ml = screenCorner(corners.ml);
    // Quadratic Bezier control point that makes the curve actually pass through
    // the mid handle: c = 2·mid - 0.5·start - 0.5·end.
    const ctrl = (m: Point, a: Point, b: Point) => ({
      x: 2 * m.x - 0.5 * a.x - 0.5 * b.x,
      y: 2 * m.y - 0.5 * a.y - 0.5 * b.y,
    });
    const cTop = ctrl(mt, tl, tr);
    const cRight = ctrl(mr, tr, br);
    const cBot = ctrl(mb, br, bl);
    const cLeft = ctrl(ml, bl, tl);
    return (
      `M ${tl.x} ${tl.y}` +
      ` Q ${cTop.x} ${cTop.y} ${tr.x} ${tr.y}` +
      ` Q ${cRight.x} ${cRight.y} ${br.x} ${br.y}` +
      ` Q ${cBot.x} ${cBot.y} ${bl.x} ${bl.y}` +
      ` Q ${cLeft.x} ${cLeft.y} ${tl.x} ${tl.y} Z`
    );
  }, [corners, metrics, screenCorner]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col select-none"
      style={{
        backgroundColor: TME_COLORS.background,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <div
        className="flex items-center justify-between p-3"
        style={{ color: TME_COLORS.primary }}
      >
        <button
          type="button"
          onClick={onCancel}
          className="p-2 -m-2"
          aria-label="Cancel"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-sm font-medium">
          {mode === 'preview' ? 'Preview' : 'Drag corners to passport edges'}
        </span>
        {mode === 'edit' || mode === 'processing' ? (
          <button
            type="button"
            onClick={handleReset}
            disabled={!corners}
            className="p-2 -m-2 disabled:opacity-30"
            aria-label="Reset corners"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        ) : (
          <span className="w-5 h-5 inline-block" />
        )}
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden select-none"
        style={{ touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {mode === 'preview' && scannedUrl && (
          <div className="absolute inset-0 flex items-center justify-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={scannedUrl}
              alt="Scanned preview"
              draggable={false}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                userSelect: 'none',
                pointerEvents: 'none',
                background: '#fff',
              }}
            />
          </div>
        )}

        {!imgSize && !errMsg && mode !== 'preview' && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{ color: TME_COLORS.primary }}
          >
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading…
          </div>
        )}

        {errMsg && mode !== 'preview' && (
          <div className="absolute inset-0 flex items-center justify-center text-red-600 text-sm px-6 text-center">
            {errMsg}
          </div>
        )}

        {mode !== 'preview' && imgUrl && metrics && corners && (
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
              <path
                d={outlinePath}
                fill="rgba(36, 63, 123, 0.18)"
                stroke="#FFB300"
                strokeWidth={2}
              />
            </svg>
            {(['tl', 'tr', 'br', 'bl', 'mt', 'mr', 'mb', 'ml'] as CornerKey[]).map((key) => {
              const p = screenCorner(corners[key]);
              const isMid = key === 'mt' || key === 'mr' || key === 'mb' || key === 'ml';
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
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                  aria-label={key}
                />
              );
            })}
          </>
        )}

        {mode === 'processing' && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{ backgroundColor: 'rgba(245,245,245,0.85)', color: TME_COLORS.primary }}
          >
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Flattening…
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2">
        {mode === 'preview' ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdjust}
              className="flex-1 py-3 rounded-lg font-medium border"
              style={{
                backgroundColor: '#FFFFFF',
                color: TME_COLORS.primary,
                borderColor: TME_COLORS.border,
              }}
            >
              Adjust
            </button>
            <button
              type="button"
              onClick={handleApprove}
              className="flex-1 py-3 rounded-lg text-white font-medium flex items-center justify-center gap-2"
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              <Check className="w-4 h-4" />
              Upload
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 rounded-lg font-medium border"
              style={{
                backgroundColor: '#FFFFFF',
                color: TME_COLORS.primary,
                borderColor: TME_COLORS.border,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!corners || mode === 'processing'}
              className="flex-1 py-3 rounded-lg text-white font-medium flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ backgroundColor: TME_COLORS.primary }}
            >
              <Check className="w-4 h-4" />
              Use scan
            </button>
          </div>
        )}
        {(errMsg || !imgSize) && mode !== 'preview' && (
          <button
            type="button"
            onClick={handleUseOriginal}
            className="w-full py-2 text-sm underline"
            style={{ color: TME_COLORS.primary, opacity: 0.8 }}
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
  const widthTop = dist(corners.tl, corners.tr);
  const widthBot = dist(corners.bl, corners.br);
  const heightLeft = dist(corners.tl, corners.bl);
  const heightRight = dist(corners.tr, corners.br);

  let outW = Math.max(widthTop, widthBot);
  let outH = Math.max(heightLeft, heightRight);
  const longest = Math.max(outW, outH);
  if (longest > MAX_OUTPUT_LONG_SIDE) {
    const k = MAX_OUTPUT_LONG_SIDE / longest;
    outW *= k;
    outH *= k;
  }
  outW = Math.max(1, Math.round(outW));
  outH = Math.max(1, Math.round(outH));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  const T = PerspT(
    [
      corners.tl.x, corners.tl.y,
      corners.tr.x, corners.tr.y,
      corners.br.x, corners.br.y,
      corners.bl.x, corners.bl.y,
    ],
    [
      0, 0,
      outW, 0,
      outW, outH,
      0, outH,
    ]
  );

  // Mid-edge perturbations: difference between the user's mid-handle and
  // where the pure-perspective warp would have placed that midpoint. Each
  // delta gets blended in with a hat function that's 1 at its mid-edge,
  // 0 at all corners and the opposite edge.
  const [pmtX, pmtY] = T.transformInverse(outW / 2, 0);
  const [pmbX, pmbY] = T.transformInverse(outW / 2, outH);
  const [pmlX, pmlY] = T.transformInverse(0, outH / 2);
  const [pmrX, pmrY] = T.transformInverse(outW, outH / 2);
  const dmt = { x: corners.mt.x - pmtX, y: corners.mt.y - pmtY };
  const dmb = { x: corners.mb.x - pmbX, y: corners.mb.y - pmbY };
  const dml = { x: corners.ml.x - pmlX, y: corners.ml.y - pmlY };
  const dmr = { x: corners.mr.x - pmrX, y: corners.mr.y - pmrY };

  const inverse = (dx: number, dy: number): [number, number] => {
    const [bx, by] = T.transformInverse(dx, dy);
    const u = dx / outW;
    const v = dy / outH;
    const wt = (1 - v) * 4 * u * (1 - u);
    const wb = v * 4 * u * (1 - u);
    const wl = (1 - u) * 4 * v * (1 - v);
    const wr = u * 4 * v * (1 - v);
    return [
      bx + wt * dmt.x + wb * dmb.x + wl * dml.x + wr * dmr.x,
      by + wt * dmt.y + wb * dmb.y + wl * dml.y + wr * dmr.y,
    ];
  };

  const N = WARP_GRID_N;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const dx0 = (i * outW) / N;
      const dy0 = (j * outH) / N;
      const dx1 = ((i + 1) * outW) / N;
      const dy1 = ((j + 1) * outH) / N;

      const [sx00, sy00] = inverse(dx0, dy0);
      const [sx10, sy10] = inverse(dx1, dy0);
      const [sx11, sy11] = inverse(dx1, dy1);
      const [sx01, sy01] = inverse(dx0, dy1);

      drawAffineTriangle(ctx, img,
        sx00, sy00, sx10, sy10, sx11, sy11,
        dx0, dy0, dx1, dy0, dx1, dy1);
      drawAffineTriangle(ctx, img,
        sx00, sy00, sx11, sy11, sx01, sy01,
        dx0, dy0, dx1, dy1, dx0, dy1);
    }
  }

  applyScanFilter(ctx, outW, outH);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encode failed'))),
      'image/jpeg',
      JPEG_QUALITY
    )
  );
}

// "Scan-like" enhancement: auto white-balance via percentile-based linear
// stretch on the luminance channel. Makes paper look truly white and text
// pop without losing color in stamps/photos. Roughly 30 ms on a 2000x1500
// image on iPhone 13.
function applyScanFilter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const hist = new Uint32Array(256);
  const sampleStep = 16;
  let sampled = 0;
  for (let i = 0; i < data.length; i += 4 * sampleStep) {
    const lum = Math.round(
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    );
    hist[lum]++;
    sampled++;
  }

  let pLo = 0;
  let pHi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= sampled * 0.02) {
      pLo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= sampled * 0.02) {
      pHi = i;
      break;
    }
  }

  if (pHi - pLo < 20) return;

  // Stretch percentile range into [4, 251] — leave a touch of headroom so
  // we don't clip too aggressively.
  const dstLo = 4;
  const dstHi = 251;
  const scale = (dstHi - dstLo) / (pHi - pLo);

  for (let i = 0; i < data.length; i += 4) {
    let r = (data[i] - pLo) * scale + dstLo;
    let g = (data[i + 1] - pLo) * scale + dstLo;
    let b = (data[i + 2] - pLo) * scale + dstLo;
    if (r < 0) r = 0; else if (r > 255) r = 255;
    if (g < 0) g = 0; else if (g > 255) g = 255;
    if (b < 0) b = 0; else if (b > 255) b = 255;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  ctx.putImageData(imgData, 0, 0);
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
