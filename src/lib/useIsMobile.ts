'use client';

import { useEffect, useState } from 'react';

/**
 * True on touch phones (touch-capable AND viewport < 768px). Used to gate
 * mobile-only behaviour:
 *
 * - the drag-corners DocumentScanner (only useful for camera captures), and
 * - the document upload policy, which on mobile accepts **PDF only**. A
 *   file input that accepts any image type makes iOS/Android offer "Take
 *   Photo" in the OS picker sheet — there is no web API to allow images
 *   from the library while hiding the camera. Restricting `accept` to
 *   `application/pdf` is the only way to remove the camera entirely, so
 *   clients can only upload a real scan, never a blurry phone snapshot.
 *
 * Initialised synchronously on the client to avoid a flicker between the
 * default desktop render and the first effect tick. Re-checks on resize.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    'ontouchstart' in window &&
    window.innerWidth < 768
  );
  useEffect(() => {
    const check = () => {
      setIsMobile('ontouchstart' in window && window.innerWidth < 768);
    };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}
