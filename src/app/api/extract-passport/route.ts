/**
 * Passport Extraction API Route
 *
 * POST /api/extract-passport
 * Body: { image: string } - Base64 encoded image
 * Returns: PassportExtractionResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractPassport, type PassportExtractionResult } from '@/lib/passport-extraction';

export async function POST(request: NextRequest): Promise<NextResponse<PassportExtractionResult>> {
  try {
    const body = await request.json();
    const { image } = body;

    if (!image) {
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

    // Validate image is base64
    if (typeof image !== 'string') {
      return NextResponse.json(
        {
          success: false,
          data: {},
          confidence: {},
          mrz_verified: false,
          error: 'Invalid image format',
        },
        { status: 400 }
      );
    }

    // Check if ANTHROPIC_API_KEY is configured
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

    // Extract passport data
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
