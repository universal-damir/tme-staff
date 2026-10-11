import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { vatFilesRateLimited, vatFilesViewerPayload } from '@/lib/vat-files';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import { vatFilesViewer } from '@/lib/vat-files-code';

export const runtime = 'nodejs';

// GET /api/vat-files/[token]
// Page data for the VAT filing upload link: company, period, deadline, the
// requested points, whether an FTA import list can be downloaded, and the
// files already received. A closed request still answers with status
// 'closed': the page shows what the client sent, read-only (every write
// route refuses a closed row). Never returns the row id, token, environment,
// storage paths or the portal filing id.
// Round 4 B: a row that names who may open it (allowed_emails, switch
// VAT_FILES_EMAIL_CODE=on) answers 401 `email_code_required` with the masked
// addresses for "Who are you?" until the browser holds a valid proof, open or
// closed alike (11.10: a closed row shows its data only after the code).
// An expired row stays 410 'expired' with no data.
// Round 4 D: `peopleNames` = the contact names (allowed_names) of the viewer
// and of who sent / changed a reply; only after the code, never the list.
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
  // Round 4 D: the names next to the emails this payload shows (code-confirmed viewers only).
  return NextResponse.json(vatFilesViewerPayload(access.row, viewer.email), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
