/**
 * Indian Passport Additional Page Extraction API Route
 *
 * POST /api/extract-passport-additional
 * Body: { image: string } - Base64 encoded image
 * Returns: AdditionalPageExtractionResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractAdditionalPage, type AdditionalPageExtractionResult } from '@/lib/passport-additional-extraction';

export async function POST(request: NextRequest): Promise<NextResponse<AdditionalPageExtractionResult>> {
  try {
    const body = await request.json();
    const { image } = body;

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
