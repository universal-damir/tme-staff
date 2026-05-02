/**
 * Pakistani National ID (CNIC/NICOP) Extraction API Route
 *
 * POST /api/extract-pakistan-id
 * Body: { image: string, side: 'front' | 'back', submissionId: string, token: string }
 * Returns: PakistanIdExtractionResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractPakistanId, type PakistanIdExtractionResult } from '@/lib/pakistan-id-extraction';
import { guardAiRoute } from '@/lib/ai-route-guard';

export async function POST(request: NextRequest): Promise<NextResponse<PakistanIdExtractionResult>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      { success: false, data: {}, confidence: {}, error: guard.error },
      { status: guard.status }
    );
  }

  try {
    const { image, side = 'front' } = guard.body as { image?: unknown; side?: 'front' | 'back' };

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { success: false, data: {}, confidence: {}, error: 'No image provided' },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { success: false, data: {}, confidence: {}, error: 'Pakistan ID extraction service unavailable' },
        { status: 503 }
      );
    }

    const result = await extractPakistanId(image, side);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Pakistan ID extraction API error:', error);
    return NextResponse.json(
      { success: false, data: {}, confidence: {}, error: 'An error occurred during extraction' },
      { status: 500 }
    );
  }
}
