/**
 * Emirates ID Extraction API Route
 *
 * POST /api/extract-eid
 * Body: { image: string, side: 'front' | 'back' }
 * Returns: EidExtractionResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractEid, type EidExtractionResult } from '@/lib/eid-extraction';

export async function POST(request: NextRequest): Promise<NextResponse<EidExtractionResult>> {
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
        { success: false, data: {}, confidence: {}, error: 'Emirates ID extraction service unavailable' },
        { status: 503 }
      );
    }

    const result = await extractEid(image, side);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Emirates ID extraction API error:', error);
    return NextResponse.json(
      { success: false, data: {}, confidence: {}, error: 'An error occurred during extraction' },
      { status: 500 }
    );
  }
}
