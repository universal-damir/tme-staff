/**
 * Company Setup Intake — passport page AI validation.
 *
 * POST /api/company-setup/[token]/validate-passport
 * Body: { image: string, expectedType?: 'INSIDE_PAGES' | 'ADDITIONAL_PAGE', nationality?: string }
 * Returns: PassportPageValidationResult + { matches, errorMessage }
 *
 * Two page types are collected per person:
 *  - INSIDE_PAGES (default): the data-page spread, always required.
 *  - ADDITIONAL_PAGE: Indian (address / family details) and Syrian
 *    (issue details) passports only — `nationality` picks the prompt variant.
 *
 * The data-page check runs with `requireSpread`, so the accept/reject verdict
 * is computed in CODE from the model's structural observations (two complete
 * pages + visible fold, or a UAE passport) instead of trusting the model's own
 * page_type — a lone data page on a white scanner bed used to pass as a spread.
 * Thin wrapper around the shared validatePassportPage() lib, guarded by the
 * company-setup token — clone of /api/validate-passport-page, which stays
 * untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validatePassportPage, type PassportPageType } from '@/lib/passport-page-validation';
import { guardCompanySetupAiRoute } from '@/lib/ai-route-guard';
import { passportAdditionalPageVariant } from '@/lib/staff-form-logic';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const guard = await guardCompanySetupAiRoute(req, token);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    const { image, nationality, expectedType } = guard.body as {
      image?: unknown;
      nationality?: unknown;
      expectedType?: unknown;
    };
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }

    const nationalityStr = typeof nationality === 'string' ? nationality : undefined;
    const pageType: PassportPageType =
      expectedType === 'ADDITIONAL_PAGE' ? 'ADDITIONAL_PAGE' : 'INSIDE_PAGES';

    const result = await validatePassportPage(image, pageType, nationalityStr, {
      // Spread rule applies to the data page only — an additional page is
      // legitimately a single sheet in some passport editions.
      requireSpread: pageType === 'INSIDE_PAGES',
    });

    const matches = result.page_type === pageType;
    let errorMessage: string | null = null;
    if (!matches) {
      const reason = (result.details || '').trim();
      if (pageType === 'ADDITIONAL_PAGE') {
        const variant = passportAdditionalPageVariant(nationalityStr);
        const pageName =
          variant === 'syria'
            ? 'the issue-details page (date and place of issue, expiry, national number)'
            : 'the address / family-details page (father, mother, spouse, address)';
        errorMessage = reason
          ? `We couldn't verify this page: ${reason}. Please upload ${pageName} of the passport.`
          : `Please upload ${pageName} of the passport.`;
      } else {
        errorMessage = reason
          ? `We couldn't verify this passport scan: ${reason}`
          : `Please upload the passport spread open at the data page (holder photo + machine-readable lines), with all four corners visible.`;
      }
    }

    return NextResponse.json({ ...result, matches, errorMessage });
  } catch (error) {
    console.error('company-setup/validate-passport:', error);
    return NextResponse.json(
      { error: 'Failed to validate passport page', infra: true },
      { status: 500 }
    );
  }
}
