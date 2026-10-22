/**
 * Photo Validation API Route
 *
 * POST /api/validate-photo
 * Body: { image: string, path?: string, submissionId: string, token: string }
 * Returns: PhotoValidationResult
 *
 * With `path` (the stored upload, `<rowId>/photo/...`) the route checks the
 * STORED file and records the verdict server-side (STAFF-001); only that
 * record can make the photo count as validated. `image` (the browser's
 * smaller copy) is checked only when the stored file cannot be sent to the
 * AI; such a pass still goes to a human (lib/document-checks.ts).
 *
 * On a renewal / photo re-request with a photo on file, the same request
 * also compares the stored upload with that photo (same-photo guard) and
 * records the result, so it does not depend on the browser calling
 * /api/compare-photo. The answer carries `samePhoto` when it ran.
 *
 * A check that could not run on a stored file is recorded too (`infra`): it
 * counts toward the hand-check option, as it does in the form.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validatePhoto, type PhotoValidationResult } from '@/lib/photo-validation';
import { guardAiRoute } from '@/lib/ai-route-guard';
import {
  compareWithPhotoOnFile,
  comparesPhotoOnFile,
  loadStoredFileForCheck,
  parsePhotoDataUrl,
  photoOnFilePath,
  recordServerCheck,
} from '@/lib/document-checks-server';
import type { PhotoCompareResult } from '@/lib/photo-compare';

export async function POST(
  request: NextRequest
): Promise<NextResponse<PhotoValidationResult & { samePhoto?: boolean }>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      {
        valid: false,
        errors: [guard.error],
        suggestions: [],
        confidence: 0,
      },
      { status: guard.status }
    );
  }

  try {
    const { image, path } = guard.body as { image?: unknown; path?: unknown };

    if (!image) {
      return NextResponse.json(
        {
          valid: false,
          errors: ['No image provided'],
          suggestions: ['Please upload an image'],
          confidence: 0,
        },
        { status: 400 }
      );
    }

    if (typeof image !== 'string') {
      return NextResponse.json(
        {
          valid: false,
          errors: ['Invalid image format'],
          suggestions: ['Please provide a base64 encoded image'],
          confidence: 0,
        },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return NextResponse.json(
        {
          valid: false,
          errors: ['Photo validation service unavailable'],
          suggestions: ['Please try again later'],
          confidence: 0,
          infra: true,
        },
        { status: 503 }
      );
    }

    // Bind the verdict to the stored file when the form says which one it is.
    let input = image;
    let bind: { path: string; sha256: string; bound: boolean } | null = null;
    if (path !== undefined) {
      // The photo check reads images only: a stored PDF photo is checked from
      // the browser's rendered copy and then goes to a human.
      const stored = await loadStoredFileForCheck(guard.row.id, 'photo', path, { allowPdf: false });
      if (!stored.ok) {
        return NextResponse.json(
          { valid: false, errors: [stored.error], suggestions: [], confidence: 0, ...(stored.infra ? { infra: true } : {}) },
          { status: stored.status }
        );
      }
      bind = { path: path as string, sha256: stored.sha256, bound: stored.dataUrl !== null };
      if (stored.dataUrl) input = stored.dataUrl;
    }

    // Same-photo guard on the stored upload (renewals / re-requests).
    const runCompare =
      !!bind &&
      comparesPhotoOnFile(guard.row.onboarding_type) &&
      !!photoOnFilePath(guard.row.existing_documents);
    const [result, comparison] = await Promise.all([
      validatePhoto(input),
      runCompare
        ? compareWithPhotoOnFile(guard.row.existing_documents, parsePhotoDataUrl(input)).catch(
            (): PhotoCompareResult => ({ samePhoto: false, confidence: 0, infra: true })
          )
        : Promise.resolve(null),
    ]);
    // A comparison that could not run is no verdict (as in the browser).
    const samePhoto =
      comparison && !comparison.infra && !comparison.skipped ? comparison.samePhoto === true : undefined;

    if (bind && result.infra) {
      // Best effort: the check could not run on the stored file. Counts
      // toward the hand-check option (lib/document-checks.ts).
      await recordServerCheck(guard.row.id, bind.path, {
        kind: 'photo',
        infra: true,
        sha256: bind.sha256,
        ...(samePhoto !== undefined ? { samePhoto } : {}),
      });
    }
    if (bind && !result.infra) {
      const saved = await recordServerCheck(guard.row.id, bind.path, {
        kind: 'photo',
        verdict: result.valid ? 'pass' : 'fail',
        bound: bind.bound,
        sha256: bind.sha256,
        ...(samePhoto !== undefined ? { samePhoto } : {}),
      });
      if (!saved) {
        return NextResponse.json(
          {
            valid: false,
            errors: ['Photo validation service unavailable'],
            suggestions: ['Please try again later'],
            confidence: 0,
            infra: true,
          },
          { status: 503 }
        );
      }
    }
    return NextResponse.json(samePhoto !== undefined ? { ...result, samePhoto } : result);
  } catch (error) {
    console.error('Photo validation API error:', error);
    return NextResponse.json(
      {
        valid: false,
        errors: ['An error occurred during validation'],
        suggestions: ['Please try again'],
        confidence: 0,
        infra: true,
      },
      { status: 500 }
    );
  }
}
