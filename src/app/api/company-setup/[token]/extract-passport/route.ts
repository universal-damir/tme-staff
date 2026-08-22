/**
 * Company Setup Intake — passport data extraction.
 *
 * POST /api/company-setup/[token]/extract-passport
 * Body: { image: string }
 * Returns: PassportExtractionResult
 *
 * Runs AFTER the passport data page passed validate-passport: the client
 * sends the same compressed image and the extracted fields prefill the
 * person's details (full name, nationality, DOB, passport number/dates,
 * gender, place of birth). Extraction failing is never an error the client
 * has to deal with — the form falls back to manual entry.
 *
 * Clone of the staff /api/extract-passport route, guarded by the
 * company-setup link token instead of the onboarding submissionId/token pair.
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractPassport, type PassportExtractionResult } from '@/lib/passport-extraction';
import { guardCompanySetupAiRoute } from '@/lib/ai-route-guard';

export const runtime = 'nodejs';

function failure(error: string, status: number): NextResponse<PassportExtractionResult> {
  return NextResponse.json(
    { success: false, data: {}, confidence: {}, mrz_verified: false, error },
    { status }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse<PassportExtractionResult>> {
  const { token } = await params;
  const guard = await guardCompanySetupAiRoute(req, token);
  if (!guard.ok) {
    return failure(guard.error, guard.status);
  }

  try {
    const { image } = guard.body as { image?: unknown };
    if (!image || typeof image !== 'string') {
      return failure('No image provided', 400);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return failure('Passport extraction service unavailable', 503);
    }

    const result = await extractPassport(image);
    return NextResponse.json(result);
  } catch (error) {
    console.error('company-setup/extract-passport:', error);
    return failure('An error occurred during extraction', 500);
  }
}
