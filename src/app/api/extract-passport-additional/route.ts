/**
 * Indian Passport Additional Page Extraction API Route
 *
 * POST /api/extract-passport-additional
 * Body: { image: string, submissionId: string, token: string }
 * Returns: AdditionalPageExtractionResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractAdditionalPage, type AdditionalPageExtractionResult } from '@/lib/passport-additional-extraction';
import { guardAiRoute } from '@/lib/ai-route-guard';

export async function POST(request: NextRequest): Promise<NextResponse<AdditionalPageExtractionResult>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      { success: false, data: {}, error: guard.error },
      { status: guard.status }
    );
  }

  try {
    const { image } = guard.body as { image?: unknown };

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { success: false, data: {}, error: 'No image provided' },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return NextResponse.json(
        { success: false, data: {}, error: 'Extraction service unavailable' },
        { status: 503 }
      );
    }

    const result = await extractAdditionalPage(image);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Additional page extraction API error:', error);
    return NextResponse.json(
      { success: false, data: {}, error: 'An error occurred during extraction' },
      { status: 500 }
    );
  }
}
