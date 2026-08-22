/**
 * Company Setup Intake — passport data-page AI validation.
 *
 * POST /api/company-setup/[token]/validate-passport
 * Body: { image: string, nationality?: string }
 * Returns: PassportPageValidationResult + { matches, errorMessage }
 *
 * The intake collects ONE passport file per person — the data page spread
 * (flatbed scan), so the expected type is always INSIDE_PAGES. Thin wrapper
 * around the shared validatePassportPage() lib, guarded by the company-setup
 * token — clone of /api/validate-passport-page, which stays untouched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validatePassportPage } from '@/lib/passport-page-validation';
import { guardCompanySetupAiRoute } from '@/lib/ai-route-guard';

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
    const { image, nationality } = guard.body as { image?: unknown; nationality?: unknown };
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 });
    }

    const nationalityStr = typeof nationality === 'string' ? nationality : undefined;
    const result = await validatePassportPage(image, 'INSIDE_PAGES', nationalityStr);

    const matches = result.page_type === 'INSIDE_PAGES';
    let errorMessage: string | null = null;
    if (!matches) {
      const reason = (result.details || '').trim();
      errorMessage =
        result.page_type === 'INVALID'
          ? reason
            ? `We couldn't verify this passport scan: ${reason}. Please upload a flat scan with the entire passport spread visible — all four corners in frame, no glare or blur.`
            : `Please upload the passport spread open at the data page (holder photo + machine-readable lines), with all four corners visible.`
          : `This doesn't appear to be the passport data page (holder photo + machine-readable lines). Please upload the correct page spread.`;
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
