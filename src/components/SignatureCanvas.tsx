'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';

/**
 * Screen texts of the pad. Every one is optional; a missing one keeps the
 * English default. The eKYC form passes bilingual texts (German under the
 * English) and hides the keyboard hint.
 */
export interface SignaturePadTexts {
  draw?: React.ReactNode;
  saved?: React.ReactNode;
  edit?: React.ReactNode;
  undo?: React.ReactNode;
  clear?: React.ReactNode;
  /** Show the "Tap Undo" / "⌘Z to undo" hint. Default: true. */
  undoHint?: boolean;
}

interface SignaturePadProps {
  onSignatureChange: (data: string | null) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  texts?: SignaturePadTexts;
  /** id on the label element, so a caller can point aria-labelledby at it. */
  labelId?: string;
  // Restore a previously-captured signature on mount. When a non-empty data
  // URL is supplied the pad starts in the LOCKED state showing that image, so
  // navigating away and back (which remounts this component) does not visually
  // lose a signature the parent still holds. Seeded ONCE on mount only.
  initialValue?: string | null;
}

export function SignaturePad({
  onSignatureChange,
  disabled = false,
  label = 'Signature',
  initialValue,
  texts,
  labelId,
}: SignaturePadProps) {
  const tDraw = texts?.draw ?? 'Draw your signature';
  const tSaved = texts?.saved ?? 'Signature saved';
  const tEdit = texts?.edit ?? 'Edit';
  const tUndo = texts?.undo ?? 'Undo';
  const tClear = texts?.clear ?? 'Clear';
  const showUndoHint = texts?.undoHint ?? true;
  // A non-empty data URL means the parent already has a saved signature; start
  // locked so the first render shows it (with the Edit button) instead of an
  // empty canvas. We do NOT call onSignatureChange on mount — the parent value
  // is already correct — and we only read initialValue for the initial state.
  const hasInitialSignature = !!(initialValue && initialValue.startsWith('data:'));
  const sigCanvas = useRef<SignatureCanvas>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(!hasInitialSignature);
  const [history, setHistory] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  // Lock mode: after signing, show static image so user can scroll past without erasing
  const [isLocked, setIsLocked] = useState(hasInitialSignature);
  const [lockedImage, setLockedImage] = useState<string | null>(hasInitialSignature ? initialValue! : null);

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Resize canvas to container width
  useEffect(() => {
    if (isLocked) return; // Don't resize while locked (canvas is hidden)
    const resizeCanvas = () => {
      if (containerRef.current && sigCanvas.current) {
        const canvas = sigCanvas.current.getCanvas();
        const container = containerRef.current;
        const mobile = window.innerWidth < 768;
        canvas.width = container.offsetWidth;
        canvas.height = mobile ? 150 : 180;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [isLocked]);

  // Save current state to history before each stroke
  const handleBegin = () => {
    if (sigCanvas.current) {
      const currentState = sigCanvas.current.toDataURL('image/png');
      setHistory(prev => [...prev.slice(-10), currentState]);
    }
  };

  // Undo function
  const handleUndo = useCallback(() => {
    if (history.length > 0 && sigCanvas.current) {
      const previousState = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));

      if (history.length === 1) {
        sigCanvas.current.clear();
        setIsEmpty(true);
        setCanUndo(false);
        onSignatureChange(null);
      } else {
        sigCanvas.current.fromDataURL(previousState, {
          width: sigCanvas.current.getCanvas().width,
          height: sigCanvas.current.getCanvas().height
        });
        setIsEmpty(false);
        setCanUndo(history.length > 1);
        onSignatureChange(previousState);
      }
    }
  }, [history, onSignatureChange]);

  // Keyboard shortcut for undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !disabled && !isLocked) {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, disabled, isLocked]);

  const handleEnd = () => {
    if (sigCanvas.current) {
      const data = sigCanvas.current.toDataURL('image/png');
      const empty = sigCanvas.current.isEmpty();
      setIsEmpty(empty);
      setCanUndo(history.length > 0);
      onSignatureChange(empty ? null : data);

      // Auto-lock on touch devices after signing (so user can scroll past)
      if (!empty && isTouchDevice) {
        setTimeout(() => {
          if (sigCanvas.current && !sigCanvas.current.isEmpty()) {
            const imgData = sigCanvas.current.toDataURL('image/png');
            setLockedImage(imgData);
            setIsLocked(true);
          }
        }, 1500); // 1.5s delay to let user add more strokes
      }
    }
  };

  const handleClear = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear();
    }
    setIsEmpty(true);
    setHistory([]);
    setCanUndo(false);
    setIsLocked(false);
    setLockedImage(null);
    onSignatureChange(null);
  };

  const handleEdit = () => {
    setIsLocked(false);
    setLockedImage(null);
    // Canvas will re-render and be resized by the useEffect
    // Need to restore the signature data after canvas mounts
    setTimeout(() => {
      if (sigCanvas.current && lockedImage) {
        const canvas = sigCanvas.current.getCanvas();
        if (containerRef.current) {
          const mobile = window.innerWidth < 768;
          canvas.width = containerRef.current.offsetWidth;
          canvas.height = mobile ? 150 : 180;
        }
        sigCanvas.current.fromDataURL(lockedImage, {
          width: canvas.width,
          height: canvas.height,
        });
      }
    }, 50);
  };

  return (
    <div className="w-full">
      <label
        id={labelId}
        className="block text-[15px] font-semibold leading-snug mb-1.5 text-tme-blue sm:text-sm sm:font-medium sm:mb-1"
      >
        {label}
        <span className="text-tme-red ml-1" aria-hidden>*</span>
      </label>

      <div
        ref={containerRef}
        style={{
          border: `2px solid ${isEmpty && !isLocked ? '#e5e7eb' : '#243F7B'}`,
          borderRadius: '10px',
          overflow: 'hidden',
          backgroundColor: disabled ? '#f5f5f5' : '#ffffff',
          transition: 'border-color 0.2s',
        }}
      >
        {isLocked && lockedImage ? (
          // Locked: show static image (user can scroll past without erasing)
          <div
            className="relative w-full"
            style={{ height: isTouchDevice && window.innerWidth < 768 ? '150px' : '180px' }}
          >
            <Image
              src={lockedImage}
              alt="Your signature"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        ) : (
          // Active: show drawing canvas
          <>
            <SignatureCanvas
              ref={sigCanvas}
              penColor="#000000"
              canvasProps={{
                className: 'signature-canvas',
                style: {
                  width: '100%',
                  cursor: disabled ? 'not-allowed' : 'crosshair',
                },
              }}
              onBegin={handleBegin}
              onEnd={handleEnd}
            />
            <style>{`
              .signature-canvas {
                height: 150px;
              }
              @media (min-width: 768px) {
                .signature-canvas {
                  height: 180px;
                }
              }
            `}</style>
          </>
        )}
      </div>

      <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 mt-2">
        <span className="text-sm sm:text-[13px] text-gray-600">
          {isLocked ? (
            tSaved
          ) : (
            <>
              {tDraw}{' '}
              {showUndoHint && canUndo && (
                <span className="text-gray-600">{isTouchDevice ? '• Tap Undo' : '• ⌘Z to undo'}</span>
              )}
            </>
          )}
        </span>
        <div className="flex gap-2 ml-auto">
          {isLocked ? (
            <Button tone="ghost" onClick={handleEdit} disabled={disabled}>
              {tEdit}
            </Button>
          ) : (
            <Button tone="ghost" onClick={handleUndo} disabled={disabled || !canUndo}>
              {tUndo}
            </Button>
          )}
          <Button tone="plain" onClick={handleClear} disabled={disabled || (isEmpty && !isLocked)}>
            {tClear}
          </Button>
        </div>
      </div>
    </div>
  );
}
