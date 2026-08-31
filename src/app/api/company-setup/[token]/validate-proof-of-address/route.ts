/**
 * Company Setup Intake — proof-of-address (bank statement) AI verification.
 *
 * POST /api/company-setup/[token]/validate-proof-of-address
 * Body: { image: string, expectedName?: string, expectedAddress?: string }
 * Returns: { valid, warnings, infra?, observations? }
 *
 * The model reports observations only; the verdict is computed in code (see
 * proof-of-address-validation.ts). Guarded by the company-setup token, with
 * the multi-page-PDF rejection waived — a bank statement is routinely several
 * pages and the client sends only page 1 for the check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { guardCompanySetupAiRoute } from '@/lib/ai-route-guard';
import { validateProofOfAddress } from '@/lib/proof-of-address-validation';

export const runtime = 'nodejs';

const MAX_EXPECTED_LENGTH = 400;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const guard = await guardCompanySetupAiRoute(req, token, { allowMultiPagePdf: true });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { image, expectedName, expectedAddress } = guard.body as {
    image?: unknown;
    expectedName?: unknown;
    expectedAddress?: unknown;
  };

  if (!image || typeof image !== 'string') {
    return NextResponse.json({ error: 'Image is required' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not configured');
    return NextResponse.json(
      { valid: true, warnings: [], infra: true },
      { status: 503 }
    );
  }

  try {
    const result = await validateProofOfAddress(image, {
      name:
        typeof expectedName === 'string'
          ? expectedName.slice(0, MAX_EXPECTED_LENGTH)
          : undefined,
      address:
        typeof expectedAddress === 'string'
          ? expectedAddress.slice(0, MAX_EXPECTED_LENGTH)
          : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('company-setup/validate-proof-of-address:', error);
    return NextResponse.json({ valid: true, warnings: [], infra: true }, { status: 500 });
  }
}
