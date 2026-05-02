/**
 * Photo Validation API Route
 *
 * POST /api/validate-photo
 * Body: { image: string, submissionId: string, token: string }
 * Returns: PhotoValidationResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { validatePhoto, type PhotoValidationResult } from '@/lib/photo-validation';
import { guardAiRoute } from '@/lib/ai-route-guard';

export async function POST(request: NextRequest): Promise<NextResponse<PhotoValidationResult>> {
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
    const { image } = guard.body as { image?: unknown };

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
        },
        { status: 503 }
      );
    }

    const result = await validatePhoto(image);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Photo validation API error:', error);
    return NextResponse.json(
      {
        valid: false,
        errors: ['An error occurred during validation'],
        suggestions: ['Please try again'],
        confidence: 0,
      },
      { status: 500 }
    );
  }
}
