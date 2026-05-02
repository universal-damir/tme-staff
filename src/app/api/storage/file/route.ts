import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-server';
import { isValidSubmissionId } from '@/lib/file-validation';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300;

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

    const supabase = getSupabaseAdmin();

    const { data: row, error: rowErr } = await supabase
      .from('staff_onboarding_submissions')
      .select('id')
      .eq('id', submissionId)
      .maybeSingle();

    if (rowErr) {
      console.error('storage/file: row lookup failed');
      return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error('storage/file: signing failed');
      return NextResponse.json({ error: 'sign_failed' }, { status: 500 });
    }

    const res = NextResponse.redirect(data.signedUrl, 302);
    res.headers.set('Cache-Control', 'private, max-age=0, no-store');
    return res;
  } catch (err) {
    console.error('storage/file: unexpected error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
