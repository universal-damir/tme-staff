import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { vatFilesRateLimited } from '@/lib/vat-files';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import { VAT_FILES_BUCKET, vatFileNameFromPath } from '@/types/vat-files';

export const runtime = 'nodejs';

// GET /api/vat-files/[token]/customs-list
// Sends the browser to a short-lived signed URL of the FTA import list the
// portal stored for this link (a customs request, or a files request with
// the customs point). Open requests only.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  if (vatFilesRateLimited(getClientIp(req))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const access = await verifyVatFilesAccess(token);
  if (!access.ok || !access.row) {
    return NextResponse.json(vatFilesAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const path = access.row.customs_list_path;
  if (!path) {
    return NextResponse.json({ error: 'no_customs_list' }, { status: 404 });
  }

  // The portal's own file name (path without the '<uuid>-' prefix).
  const downloadName = vatFileNameFromPath(path) ?? 'FTA import list.xlsx';

  const { data, error } = await getSupabaseAdmin()
    .storage.from(VAT_FILES_BUCKET)
    .createSignedUrl(path, 300, { download: downloadName });
  if (error || !data?.signedUrl) {
    console.error('vat-files/customs-list: could not sign the FTA list');
    return NextResponse.json({ error: 'download_failed' }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
