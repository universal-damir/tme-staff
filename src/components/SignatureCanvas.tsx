'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { TME_COLORS } from '@/lib/constants';

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

  // Resize canvas to container width
  useEffect(() => {
    const resizeCanvas = () => {
      if (containerRef.current && sigCanvas.current) {
        const canvas = sigCanvas.current.getCanvas();
        const container = containerRef.current;
        const isMobile = window.innerWidth < 768;
        canvas.width = container.offsetWidth;
        canvas.height = isMobile ? 120 : 180;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Save current state to history before each stroke
  const handleBegin = () => {
    if (sigCanvas.current) {
      const currentState = sigCanvas.current.toDataURL('image/png');
      setHistory(prev => [...prev.slice(-10), currentState]); // Keep last 10 states
    }
  };

  // Undo function
  const handleUndo = useCallback(() => {
    if (history.length > 0 && sigCanvas.current) {
      const previousState = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));

      if (history.length === 1) {
        // Going back to empty state
        sigCanvas.current.clear();
        setIsEmpty(true);
        setCanUndo(false);
        onSignatureChange(null);
      } else {
        // Restore previous state
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

  // Keyboard shortcut for undo (Ctrl+Z / Cmd+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !disabled) {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, disabled]);

  const handleEnd = () => {
    if (sigCanvas.current) {
      const data = sigCanvas.current.toDataURL('image/png');
      const empty = sigCanvas.current.isEmpty();
      setIsEmpty(empty);
      setCanUndo(history.length > 0);
      onSignatureChange(empty ? null : data);
    }
  };

  const handleClear = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear();
      setIsEmpty(true);
      setHistory([]);
      setCanUndo(false);
      onSignatureChange(null);
    }
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
          border: `2px solid ${isEmpty ? '#e5e7eb' : TME_COLORS.primary}`,
          borderRadius: '8px',
          backgroundColor: disabled ? '#f5f5f5' : '#ffffff',
          transition: 'border-color 0.2s',
        }}
      >
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
            height: 120px;
          }
          @media (min-width: 768px) {
            .signature-canvas {
              height: 180px;
            }
          }
        `}</style>
      </div>

      <div className="flex justify-between items-center mt-2">
        <span className="text-sm text-gray-500">
          Draw your signature {canUndo && <span className="text-gray-400">• ⌘Z to undo</span>}
        </span>
        <div className="flex gap-2">
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
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled || isEmpty}
            className="px-3 py-1.5 text-sm rounded border transition-colors"
            style={{
              color: disabled || isEmpty ? '#999' : TME_COLORS.primary,
              borderColor: disabled || isEmpty ? '#ddd' : TME_COLORS.primary,
              cursor: disabled || isEmpty ? 'not-allowed' : 'pointer',
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
