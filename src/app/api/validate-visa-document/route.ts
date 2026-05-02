/**
 * Visa Document Validation API Route
 *
 * POST /api/validate-visa-document
 * Body: { image: string, expectedCategory: string, submissionId: string, token: string }
 * Returns: VisaDocumentValidationResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateVisaDocument, type VisaDocumentValidationResult } from '@/lib/visa-document-validation';
import { guardAiRoute } from '@/lib/ai-route-guard';

export async function POST(request: NextRequest): Promise<NextResponse<VisaDocumentValidationResult>> {
  const guard = await guardAiRoute(request);
  if (!guard.ok) {
    return NextResponse.json(
      { valid: false, details: '', errorMessage: guard.error },
      { status: guard.status }
    );
  }

  try {
    const { image, expectedCategory } = guard.body as { image?: unknown; expectedCategory?: unknown };

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { valid: false, details: '', errorMessage: 'No image provided' },
        { status: 400 }
      );
    }

    if (!expectedCategory || typeof expectedCategory !== 'string') {
      return NextResponse.json(
        { valid: false, details: '', errorMessage: 'No expected category provided' },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { valid: false, details: '', errorMessage: 'Visa validation service unavailable' },
        { status: 503 }
      );
    }

    const result = await validateVisaDocument(image, expectedCategory);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Visa document validation API error:', error);
    return NextResponse.json(
      { valid: false, details: '', errorMessage: 'An error occurred during validation' },
      { status: 500 }
    );
  }
}
