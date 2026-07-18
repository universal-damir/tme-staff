import { NextRequest, NextResponse } from 'next/server';
import { validatePassportPage, PassportPageType } from '@/lib/passport-page-validation';
import { guardAiRoute } from '@/lib/ai-route-guard';

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    const { image, expectedType, nationality } = guard.body as {
      image?: unknown;
      expectedType?: PassportPageType;
      nationality?: unknown;
    };

    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }

    // nationality picks the ADDITIONAL_PAGE prompt variant (Indian address
    // page vs Syrian issue-details page); harmless for other page types.
    const nationalityStr = typeof nationality === 'string' ? nationality : undefined;
    const isSyrianVariant = ['syrian', 'syria', 'syrian arab republic'].includes(
      (nationalityStr || '').trim().toLowerCase()
    );

    const result = await validatePassportPage(image, expectedType, nationalityStr);

    let matches = true;
    let errorMessage = '';

    if (expectedType && result.page_type !== expectedType) {
      matches = false;
      const typeLabels: Record<PassportPageType, string> = {
        COVER: 'Passport Cover Spread (open passport showing front + back cover)',
        INSIDE_PAGES: 'Inside Pages Spread (open passport showing data page + opposite page)',
        ADDITIONAL_PAGE: isSyrianVariant
          ? 'Syrian Passport Additional Page (date/place of issue + national number)'
          : 'Indian Passport Additional Page (address + family details / file number)',
        INVALID: 'Valid Passport Page',
      };
      if (result.page_type === 'INVALID') {
        const reason = (result.details || '').trim();
        if (expectedType === 'ADDITIONAL_PAGE') {
          // Additional-page rejections aren't about a "spread" — the page
          // is sometimes a single sheet. Use the model's reason directly
          // with a softer retry suggestion.
          errorMessage = isSyrianVariant
            ? reason
              ? `We couldn't verify this as the additional page: ${reason} Please make sure you're uploading the page with the date/place of issue and national number.`
              : `Please upload the additional page showing the date and place of issue, expiry date, and national number.`
            : reason
              ? `We couldn't verify this as the additional page: ${reason} Please make sure you're uploading the address / family-details page.`
              : `Please upload the additional page showing your address and family details (Father / Mother / Spouse names, address, file number).`;
        } else {
          errorMessage = reason
            ? `We couldn't verify this passport spread: ${reason}. Please upload a flat scan or a clear, straight-on photo with the entire passport spread visible — all four corners in frame, no glare or blur.`
            : `Please upload the passport spread open showing both pages, with all four corners visible. Single-page or blurry/angled photos are not accepted.`;
        }
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
      { error: 'Failed to validate passport page', infra: true },
      { status: 500 }
    );
  }
}
