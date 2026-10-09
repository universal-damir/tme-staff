import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { scrubVatFilesRow, vatFilesRateLimited } from '@/lib/vat-files';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';

export const runtime = 'nodejs';

// GET /api/vat-files/[token]
// Page data for the VAT filing upload link: company, period, deadline, the
// requested points, whether an FTA import list can be downloaded, and the
// files already received. A closed request still answers (the page shows
// "this request is closed"). Never returns the row id, token, environment,
// storage paths or the portal filing id.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  if (vatFilesRateLimited(getClientIp(req))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const access = await verifyVatFilesAccess(token, { allowClosed: true });
  if (!access.ok || !access.row) {
    return NextResponse.json(vatFilesAccessErrorBody(access), { status: access.status ?? 404 });
  }
  return NextResponse.json(scrubVatFilesRow(access.row), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
