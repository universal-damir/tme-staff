import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { vatFilesChangeInfo, vatFilesRateLimited } from '@/lib/vat-files';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import { vatFilesViewer } from '@/lib/vat-files-code';

export const runtime = 'nodejs';

// GET /api/vat-files/[token]/version?since=<ISO>
// Round 5: the page's "changed by someone else?" check (every 60 s while the
// tab is visible, and when it gets the focus back). Small answer, no page
// data: { version, status, source, at, by, byName, self, clientChangedAt }
// (VatFilesChangeInfo). `since` = the last client change the page knows; a
// client change after it is "someone on the client side", else TME. Gated
// like GET (email code; a closed row answers too, so the page can say "TME
// closed this request"). Names / addresses only for a code-confirmed viewer.
// Writes nothing.
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
  const viewer = await vatFilesViewer(req, access.row);
  if (!viewer.ok) {
    return NextResponse.json(viewer.body, { status: viewer.status, headers: { 'Cache-Control': 'no-store' } });
  }
  const since = req.nextUrl.searchParams.get('since');
  return NextResponse.json(vatFilesChangeInfo(access.row, viewer.email, since && since.length <= 40 ? since : null), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
