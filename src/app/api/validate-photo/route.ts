/**
 * Photo Validation API Route
 *
 * POST /api/validate-photo
 * Body: { image: string } - Base64 encoded image
 * Returns: PhotoValidationResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { validatePhoto, type PhotoValidationResult } from '@/lib/photo-validation';

export async function POST(request: NextRequest): Promise<NextResponse<PhotoValidationResult>> {
  try {
    const body = await request.json();
    const { image } = body;

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

    // Validate image is base64
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

    // Check if ANTHROPIC_API_KEY is configured
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

    // Validate the photo
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
