import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-server';
import { isValidSubmissionId } from '@/lib/file-validation';
import { verifyOnboardingAccess, isTwoPersonEmployerStep } from '@/lib/onboarding-token';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300;
// Browser-cache the redirect (and the image it points to) briefly so going back
// a step / refreshing within a session serves from cache instead of re-fetching
// and re-downloading every time. `private` keeps it out of shared/CDN caches —
// only the user's own browser. MUST stay well under SIGNED_URL_TTL_SECONDS so a
// cached redirect can never point at an already-expired signed URL.
const REDIRECT_CACHE_SECONDS = 120;

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const path = req.nextUrl.searchParams.get('path') ?? '';
    if (!path) {
      return NextResponse.json({ error: 'missing_path' }, { status: 400 });
    }

    // Path must be `<uuid>/<rest>`; the rest may not contain traversal segments.
    const firstSlash = path.indexOf('/');
    if (firstSlash <= 0) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }
    const submissionId = path.slice(0, firstSlash);
    const rest = path.slice(firstSlash + 1);
    if (!isValidSubmissionId(submissionId)) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }
    if (
      rest.length === 0 ||
      rest.includes('..') ||
      rest.includes('//') ||
      rest.startsWith('/') ||
      rest.includes('\0')
    ) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }

    // Same gate as the form load (`/api/onboarding/[id]`): `id` is the link
    // token from the page URL, `token` the employee access token, `e` the
    // employer token. Closed rows (complete / cancelled / expired) are
    // refused: the completed page shows no files.
    const linkToken = req.nextUrl.searchParams.get('id') ?? '';
    const access = await verifyOnboardingAccess(linkToken, req.nextUrl.searchParams.get('token'), {
      expectedStep: 'auto',
      blockIfComplete: true,
      employerToken: req.nextUrl.searchParams.get('e'),
    });
    if (!access.ok || !access.row) {
      if (access.reason === 'token_required' || access.reason === 'token_invalid' || access.reason === 'recalled') {
        return NextResponse.json({ error: 'unauthorized' }, { status: 403 });
      }
      if (access.reason === 'cancelled' || access.reason === 'expired' || access.reason === 'already_complete') {
        return NextResponse.json({ error: 'submission_closed' }, { status: 410 });
      }
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // The file must live in this row's own folder.
    if (submissionId.toLowerCase() !== access.row.id.toLowerCase()) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // Employer step of a two-person form: the employer owns only the job
    // offer letter (see scrubOnboardingForBrowser), not the employee's files.
    if (isTwoPersonEmployerStep(access.row) && !rest.startsWith('job_offer_letter/')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error('storage/file: signing failed');
      return NextResponse.json({ error: 'sign_failed' }, { status: 500 });
    }

    const res = NextResponse.redirect(data.signedUrl, 302);
    res.headers.set('Cache-Control', `private, max-age=${REDIRECT_CACHE_SECONDS}`);
    return res;
  } catch (err) {
    console.error('storage/file: unexpected error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
