/**
 * Visa Document Validation API Route
 *
 * POST /api/validate-visa-document
 * Body: { image: string, expectedCategory: string }
 * Returns: VisaDocumentValidationResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateVisaDocument, type VisaDocumentValidationResult } from '@/lib/visa-document-validation';

export async function POST(request: NextRequest): Promise<NextResponse<VisaDocumentValidationResult>> {
  try {
    const body = await request.json();
    const { image, expectedCategory } = body;

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { valid: false, details: '', errorMessage: 'No image provided' },
        { status: 400 }
      );
    }

    if (!expectedCategory) {
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
