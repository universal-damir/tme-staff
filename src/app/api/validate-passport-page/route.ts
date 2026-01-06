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

    const result = await validatePassportPage(image, expectedType);

    // If expectedType is provided, check if it matches
    let matches = true;
    let errorMessage = '';

    if (expectedType && result.page_type !== expectedType) {
      matches = false;
      const typeLabels: Record<PassportPageType, string> = {
        COVER: 'Passport Cover Spread (open passport showing front + back cover)',
        INSIDE_PAGES: 'Inside Pages Spread (open passport showing data page + opposite page)',
        INVALID: 'Valid Passport Page',
      };
      if (result.page_type === 'INVALID') {
        errorMessage = `Please upload the passport spread open showing both pages. Single page photos are not accepted.`;
      } else {
        errorMessage = `This doesn't appear to be a ${typeLabels[expectedType]}. Please upload the correct page spread.`;
      }
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
