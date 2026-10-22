/**
 * Same-photo comparison API route (visa renewals / photo re-requests).
 *
 * POST /api/compare-photo
 * Body: { image: string, path?: string, submissionId: string, token: string }
 * Returns: PhotoCompareResult
 *
 * With `path` (the stored new photo, `<rowId>/photo/...`) the NEW photo is
 * also read from storage, not from the browser, and a "same photo" verdict
 * is recorded server-side so that upload can no longer count as validated
 * (STAFF-001, lib/document-checks.ts).
 *
 * The photo on file is NEVER accepted from the client — the server reads
 * `existing_documents.photo.path` from the submission row (which TME Portal
 * wrote at renewal creation) and downloads it from storage with the
 * service-role client. Trusting a client-supplied "old photo" would let the
 * caller compare against anything and defeat the check.
 *
 * validate-photo runs the same comparison itself on every stored photo, so
 * the verdict no longer depends on the browser calling this route; the
 * route stays for pages opened before that change.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PhotoCompareResult } from '@/lib/photo-compare';
import { guardAiRoute } from '@/lib/ai-route-guard';
import {
  compareWithPhotoOnFile,
  loadStoredFileForCheck,
  parsePhotoDataUrl,
  photoOnFilePath,
  recordServerCheck,
} from '@/lib/document-checks-server';

export async function POST(request: NextRequest): Promise<NextResponse<PhotoCompareResult>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      { samePhoto: false, confidence: 0, infra: true },
      { status: guard.status }
    );
  }

  try {
    const { image, path } = guard.body as { image?: unknown; path?: unknown };

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { samePhoto: false, confidence: 0, infra: true },
        { status: 400 }
      );
    }

    // Nothing to compare against — legacy submissions carry only {sha256,
    // filename} in existing_documents.photo; the path is what makes the
    // visual comparison possible.
    if (!photoOnFilePath(guard.row.existing_documents)) {
      return NextResponse.json({ samePhoto: false, confidence: 0, skipped: true });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return NextResponse.json(
        { samePhoto: false, confidence: 0, infra: true },
        { status: 503 }
      );
    }

    // The new photo: the stored upload when the form names it.
    let newPhoto = parsePhotoDataUrl(image);
    let bind: { path: string; sha256: string } | null = null;
    if (path !== undefined) {
      const stored = await loadStoredFileForCheck(guard.row.id, 'photo', path, { allowPdf: true });
      if (!stored.ok) {
        return NextResponse.json(
          { samePhoto: false, confidence: 0, infra: true },
          { status: stored.status }
        );
      }
      bind = { path: path as string, sha256: stored.sha256 };
      if (stored.dataUrl) newPhoto = parsePhotoDataUrl(stored.dataUrl);
    }

    const result = await compareWithPhotoOnFile(guard.row.existing_documents, newPhoto);

    if (bind && !result.infra) {
      // Only the comparison's own field: the photo check writes the
      // verdict and whether it read the stored file.
      const saved = await recordServerCheck(guard.row.id, bind.path, {
        kind: 'photo',
        samePhoto: result.samePhoto === true,
        sha256: bind.sha256,
      });
      if (!saved) {
        return NextResponse.json({ samePhoto: false, confidence: 0, infra: true }, { status: 503 });
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Photo compare API error:', error);
    return NextResponse.json(
      { samePhoto: false, confidence: 0, infra: true },
      { status: 500 }
    );
  }
}
