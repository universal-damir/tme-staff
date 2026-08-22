import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, COMPANY_SETUP_BUCKET } from '@/lib/supabase-server';
import { verifyCompanySetupAccess } from '@/lib/company-setup-token';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300;
// Browser-cache the redirect (and the image it points to) briefly so going back
// a step / refreshing within a session serves from cache instead of re-fetching
// every time. `private` keeps it out of shared/CDN caches. MUST stay well under
// SIGNED_URL_TTL_SECONDS so a cached redirect can never point at an
// already-expired signed URL. (Clone of /api/storage/file for the new bucket,
// hardened: the path must belong to the token's OWN submission.)
const REDIRECT_CACHE_SECONDS = 120;

// GET /api/company-setup/[token]/file?path=<submissionId>/<personIndex>/<slot>/<name>
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params;

    // Reads stay allowed after submission so the review screen can still show
    // previews on the thank-you view.
    const access = await verifyCompanySetupAccess(token, { allowSubmitted: true });
    if (!access.ok || !access.row) {
      return NextResponse.json(
        { error: access.reason ?? 'not_found' },
        { status: access.status ?? 404 }
      );
    }
    const row = access.row;

    const path = req.nextUrl.searchParams.get('path') ?? '';
    if (!path) {
      return NextResponse.json({ error: 'missing_path' }, { status: 400 });
    }

    // The path must live under this submission's own folder — a token can
    // never sign URLs for another submission's files.
    if (!path.startsWith(`${row.id}/`)) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }
    const rest = path.slice(row.id.length + 1);
    if (
      rest.length === 0 ||
      rest.includes('..') ||
      rest.includes('//') ||
      rest.startsWith('/') ||
      rest.includes('\0')
    ) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(COMPANY_SETUP_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error('company-setup/file: signing failed');
      return NextResponse.json({ error: 'sign_failed' }, { status: 500 });
    }

    const res = NextResponse.redirect(data.signedUrl, 302);
    res.headers.set('Cache-Control', `private, max-age=${REDIRECT_CACHE_SECONDS}`);
    return res;
  } catch (err) {
    console.error('company-setup/file: unexpected error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
