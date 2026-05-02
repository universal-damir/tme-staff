/**
 * Passport Extraction API Route
 *
 * POST /api/extract-passport
 * Body: { image: string, submissionId: string, token: string }
 * Returns: PassportExtractionResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractPassport, type PassportExtractionResult } from '@/lib/passport-extraction';
import { guardAiRoute } from '@/lib/ai-route-guard';

export async function POST(request: NextRequest): Promise<NextResponse<PassportExtractionResult>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      {
        success: false,
        data: {},
        confidence: {},
        mrz_verified: false,
        error: guard.error,
      },
      { status: guard.status }
    );
  }

  try {
    const { image } = guard.body as { image?: unknown };

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        {
          success: false,
          data: {},
          confidence: {},
          mrz_verified: false,
          error: 'No image provided',
        },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return NextResponse.json(
        {
          success: false,
          data: {},
          confidence: {},
          mrz_verified: false,
          error: 'Passport extraction service unavailable',
        },
        { status: 503 }
      );
    }

    const result = await extractPassport(image);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Passport extraction API error:', error);
    return NextResponse.json(
      {
        success: false,
        data: {},
        confidence: {},
        mrz_verified: false,
        error: 'An error occurred during extraction',
      },
      { status: 500 }
    );
  }
}
