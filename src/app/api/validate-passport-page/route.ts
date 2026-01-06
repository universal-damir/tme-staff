import { NextRequest, NextResponse } from 'next/server';
import { validatePassportPage, PassportPageType } from '@/lib/passport-page-validation';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, expectedType } = body as { image: string; expectedType?: PassportPageType };

    if (!image) {
      return NextResponse.json(
        { error: 'Image is required' },
        { status: 400 }
      );
    }

    const result = await validatePassportPage(image);

    // If expectedType is provided, check if it matches
    let matches = true;
    let errorMessage = '';

    if (expectedType && result.page_type !== expectedType) {
      matches = false;
      const typeLabels: Record<PassportPageType, string> = {
        COVER: 'Passport Cover',
        INSIDE_PAGES: 'Inside Pages (open passport with both pages)',
        INVALID: 'Valid Passport Page',
      };
      errorMessage = `This doesn't appear to be a ${typeLabels[expectedType]}. Please upload the correct page.`;
    }

    return NextResponse.json({
      ...result,
      matches,
      errorMessage: matches ? null : errorMessage,
    });
  } catch (error) {
    console.error('Passport page validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate passport page' },
      { status: 500 }
    );
  }
}
