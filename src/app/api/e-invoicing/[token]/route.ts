import { NextRequest, NextResponse } from 'next/server';
import {
  verifyGapIntakeAccess,
  ACCOUNTING_SOFTWARE_OPTIONS,
  ACCOUNTING_SOFTWARE_GUIDANCE,
} from '@/lib/gap-intake-token';

export const runtime = 'nodejs';

// GET /api/e-invoicing/[token]
// Resolve the intake token for the page: company name, current status, the
// already-uploaded file list, and the accounting-software options.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // Reads allow an already-submitted row so the page can render the thank-you view.
  const access = await verifyGapIntakeAccess(token, { allowSubmitted: true });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }

  const row = access.row;
  return NextResponse.json({
    company_name: row.company_name,
    status: row.status,
    price_aed: row.price_aed,
    accounting_software: row.accounting_software,
    accounting_software_other: row.accounting_software_other,
    files: (row.invoice_files ?? []).map((f) => ({
      filename: f.filename,
      channel: f.channel,
    })),
    software_options: ACCOUNTING_SOFTWARE_OPTIONS,
    software_guidance: ACCOUNTING_SOFTWARE_GUIDANCE,
  });
}
