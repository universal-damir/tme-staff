'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { TME_COLORS } from '@/lib/constants';
import Image from 'next/image';

interface SignaturePadProps {
  onSignatureChange: (data: string | null) => void;
  disabled?: boolean;
  label?: string;
}

export function SignaturePad({ onSignatureChange, disabled = false, label = 'Signature' }: SignaturePadProps) {
  const sigCanvas = useRef<SignatureCanvas>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  // Lock mode: after signing, show static image so user can scroll past without erasing
  const [isLocked, setIsLocked] = useState(false);
  const [lockedImage, setLockedImage] = useState<string | null>(null);

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
        className="block text-sm font-medium mb-2"
        style={{ color: TME_COLORS.primary }}
      >
        {label}
        <span className="text-red-500 ml-1">*</span>
      </label>

      <div
        ref={containerRef}
        style={{
          border: `2px solid ${isEmpty && !isLocked ? '#e5e7eb' : TME_COLORS.primary}`,
          borderRadius: '8px',
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

      <div className="flex justify-between items-center mt-2">
        <span className="text-sm text-gray-500">
          {isLocked ? (
            'Signature saved'
          ) : (
            <>Draw your signature {canUndo && <span className="text-gray-400">{isTouchDevice ? '• Tap Undo' : '• ⌘Z to undo'}</span>}</>
          )}
        </span>
        <div className="flex gap-2">
          {isLocked ? (
            <button
              type="button"
              onClick={handleEdit}
              disabled={disabled}
              className="px-3 py-1.5 text-sm rounded border transition-colors"
              style={{
                color: disabled ? '#999' : TME_COLORS.primary,
                borderColor: disabled ? '#ddd' : TME_COLORS.primary,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              onClick={handleUndo}
              disabled={disabled || !canUndo}
              className="px-3 py-1.5 text-sm rounded border transition-colors"
              style={{
                color: disabled || !canUndo ? '#999' : '#666',
                borderColor: disabled || !canUndo ? '#ddd' : '#ccc',
                cursor: disabled || !canUndo ? 'not-allowed' : 'pointer',
              }}
            >
              Undo
            </button>
          )}
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled || (isEmpty && !isLocked)}
            className="px-3 py-1.5 text-sm rounded border transition-colors"
            style={{
              color: disabled || (isEmpty && !isLocked) ? '#999' : TME_COLORS.primary,
              borderColor: disabled || (isEmpty && !isLocked) ? '#ddd' : TME_COLORS.primary,
              cursor: disabled || (isEmpty && !isLocked) ? 'not-allowed' : 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
