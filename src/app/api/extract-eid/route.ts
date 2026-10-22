/**
 * Emirates ID Extraction API Route
 *
 * POST /api/extract-eid
 * Body: { image: string, side: 'front' | 'back', path?: string, submissionId: string, token: string }
 * Returns: EidExtractionResult
 *
 * With `path` (the stored upload, `<rowId>/eid_front|eid_back/...`) the
 * route reads the STORED file and records the verdict server-side
 * (STAFF-001). The document-request gate accepts an Emirates ID only with
 * such a verdict (or a hand check).
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractEid, type EidExtractionResult } from '@/lib/eid-extraction';
import { guardAiRoute } from '@/lib/ai-route-guard';
import { loadStoredFileForCheck, recordServerCheck } from '@/lib/document-checks-server';
import { eidCheckKind } from '@/lib/document-checks';

export async function POST(request: NextRequest): Promise<NextResponse<EidExtractionResult>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      { success: false, data: {}, confidence: {}, error: guard.error },
      { status: guard.status }
    );
  }

  try {
    const { image, side = 'front', path } = guard.body as {
      image?: unknown;
      side?: 'front' | 'back';
      path?: unknown;
    };

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { success: false, data: {}, confidence: {}, error: 'No image provided' },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { success: false, data: {}, confidence: {}, error: 'Emirates ID extraction service unavailable' },
        { status: 503 }
      );
    }

    // Bind the verdict to the stored file when the form says which one it is.
    let input: string = image;
    let bind: { path: string; sha256: string; bound: boolean } | null = null;
    const kind = eidCheckKind(side);
    if (path !== undefined) {
      const stored = await loadStoredFileForCheck(guard.row.id, kind, path, { allowPdf: true });
      if (!stored.ok) {
        return NextResponse.json(
          { success: false, data: {}, confidence: {}, error: stored.error, ...(stored.infra ? { infra: true } : {}) },
          { status: stored.status }
        );
      }
      if (stored.pdfPages !== null && stored.pdfPages > 1) {
        // A refused file is a failed check (it counts toward the hand check).
        await recordServerCheck(guard.row.id, path as string, {
          kind,
          verdict: 'fail',
          bound: true,
          sha256: stored.sha256,
        });
        return NextResponse.json(
          {
            success: false,
            data: {},
            confidence: {},
            error: `This file has ${stored.pdfPages} pages. Please upload only a single page — one page per file.`,
          },
          { status: 422 }
        );
      }
      bind = { path: path as string, sha256: stored.sha256, bound: stored.dataUrl !== null };
      if (stored.dataUrl) input = stored.dataUrl;
    }

    const result = await extractEid(input, side === 'back' ? 'back' : 'front');

    if (bind && result.infra) {
      // Best effort: the check could not run on the stored file. Counts
      // toward the hand-check option (lib/document-checks.ts).
      await recordServerCheck(guard.row.id, bind.path, { kind, infra: true, sha256: bind.sha256 });
    }
    if (bind && !result.infra) {
      // Same rule the forms apply: the front must yield an EID number.
      const passed = kind === 'eid:front' ? result.success && !!result.data?.emirates_id_number : result.success;
      const saved = await recordServerCheck(guard.row.id, bind.path, {
        kind,
        verdict: passed ? 'pass' : 'fail',
        bound: bind.bound,
        sha256: bind.sha256,
      });
      if (!saved) {
        return NextResponse.json(
          { success: false, data: {}, confidence: {}, error: 'Emirates ID extraction service unavailable', infra: true },
          { status: 503 }
        );
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Emirates ID extraction API error:', error);
    return NextResponse.json(
      { success: false, data: {}, confidence: {}, error: 'An error occurred during extraction' },
      { status: 500 }
    );
  }
}
