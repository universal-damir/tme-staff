import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, EKYC_BUCKET } from '@/lib/supabase-server';
import {
  ekycAccessErrorBody,
  isEkycDocumentSlot,
  isEkycPathForRow,
  verifyEkycAccess,
} from '@/lib/ekyc-token';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300;
// Must stay well under the signed URL's life.
const REDIRECT_CACHE_SECONDS = 120;

// GET /api/kyc/[token]/file?slot=<slot>
// Opens a file the client uploaded. The browser names a SLOT, never a path:
// the path is read from this row's own `documents` column and must sit in
// this row's folder, so a token can only ever open its own files. Reads stay
// allowed after submit (read-only view).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const access = await verifyEkycAccess(token, { allowSubmitted: true });
    if (!access.ok || !access.row) {
      return NextResponse.json(ekycAccessErrorBody(access), { status: access.status ?? 404 });
    }
    const row = access.row;

    const slot = req.nextUrl.searchParams.get('slot') ?? '';
    if (!isEkycDocumentSlot(slot)) {
      return NextResponse.json({ error: 'invalid_slot' }, { status: 400 });
    }
    const path = row.documents?.[slot]?.path;
    if (!path) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!isEkycPathForRow(path, row.id)) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin()
      .storage.from(EKYC_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      console.error('kyc/file: signing failed');
      return NextResponse.json({ error: 'sign_failed' }, { status: 500 });
    }
    const res = NextResponse.redirect(data.signedUrl, 302);
    res.headers.set('Cache-Control', `private, max-age=${REDIRECT_CACHE_SECONDS}`);
    return res;
  } catch (err) {
    console.error('kyc/file: unexpected error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
