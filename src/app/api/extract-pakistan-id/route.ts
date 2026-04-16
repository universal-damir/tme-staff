/**
 * Pakistani National ID (CNIC/NICOP) Extraction API Route
 *
 * POST /api/extract-pakistan-id
 * Body: { image: string, side: 'front' | 'back' }
 * Returns: PakistanIdExtractionResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractPakistanId, type PakistanIdExtractionResult } from '@/lib/pakistan-id-extraction';

export async function POST(request: NextRequest): Promise<NextResponse<PakistanIdExtractionResult>> {
  try {
    const body = await request.json();
    const { image, side = 'front' } = body;

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { success: false, data: {}, confidence: {}, error: 'No image provided' },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { success: false, data: {}, confidence: {}, error: 'Pakistan ID extraction service unavailable' },
        { status: 503 }
      );
    }

    const result = await extractPakistanId(image, side);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Pakistan ID extraction API error:', error);
    return NextResponse.json(
      { success: false, data: {}, confidence: {}, error: 'An error occurred during extraction' },
      { status: 500 }
    );
  }
}
