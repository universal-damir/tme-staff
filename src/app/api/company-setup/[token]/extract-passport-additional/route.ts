/**
 * Company Setup Intake — passport ADDITIONAL page extraction (India / Syria).
 *
 * POST /api/company-setup/[token]/extract-passport-additional
 * Body: { image: string, nationality?: string }
 * Returns: AdditionalPageExtractionResult
 *
 * Runs after the additional page passed validate-passport with
 * expectedType=ADDITIONAL_PAGE. India fills the family details and home
 * address; Syria fills the passport issue/expiry dates, which the Syrian DATA
 * page does not carry at all — without this the client has to type them.
 *
 * Clone of the staff /api/extract-passport-additional route, guarded by the
 * company-setup link token instead of the onboarding submissionId/token pair.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  extractAdditionalPage,
  type AdditionalPageExtractionResult,
} from '@/lib/passport-additional-extraction';
import { passportAdditionalPageVariant } from '@/lib/staff-form-logic';
import { guardCompanySetupAiRoute } from '@/lib/ai-route-guard';

export const runtime = 'nodejs';

function failure(error: string, status: number): NextResponse<AdditionalPageExtractionResult> {
  return NextResponse.json({ success: false, data: {}, error }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse<AdditionalPageExtractionResult>> {
  const { token } = await params;
  const guard = await guardCompanySetupAiRoute(req, token);
  if (!guard.ok) {
    return failure(guard.error, guard.status);
  }

  try {
    const { image, nationality } = guard.body as { image?: unknown; nationality?: unknown };
    if (!image || typeof image !== 'string') {
      return failure('No image provided', 400);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return failure('Extraction service unavailable', 503);
    }

    const variant =
      passportAdditionalPageVariant(typeof nationality === 'string' ? nationality : undefined) ??
      'india';
    const result = await extractAdditionalPage(image, variant);
    return NextResponse.json(result);
  } catch (error) {
    console.error('company-setup/extract-passport-additional:', error);
    return failure('An error occurred during extraction', 500);
  }
}
