/**
 * Company Setup Intake — passport-photo AI validation.
 *
 * POST /api/company-setup/[token]/validate-photo
 * Body: { image: string }
 * Returns: PhotoValidationResult
 *
 * Thin wrapper around the shared validatePhoto() lib (no glasses, plain
 * background, etc.), guarded by the company-setup token instead of the staff
 * onboarding submissionId/token pair — clone of /api/validate-photo, which
 * stays untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validatePhoto, type PhotoValidationResult } from '@/lib/photo-validation';
import { guardCompanySetupAiRoute } from '@/lib/ai-route-guard';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse<PhotoValidationResult>> {
  const { token } = await params;
  const guard = await guardCompanySetupAiRoute(req, token);
  if (!guard.ok) {
    return NextResponse.json(
      { valid: false, errors: [guard.error], suggestions: [], confidence: 0 },
      { status: guard.status }
    );
  }

  try {
    const { image } = guard.body as { image?: unknown };
    if (!image || typeof image !== 'string') {
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

    const result = await validatePhoto(image);
    return NextResponse.json(result);
  } catch (error) {
    console.error('company-setup/validate-photo:', error);
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
