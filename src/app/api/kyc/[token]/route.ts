import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  EKYC_TABLE,
  ekycAccessErrorBody,
  scrubEkycRowForClient,
  verifyEkycAccess,
} from '@/lib/ekyc-token';

export const runtime = 'nodejs';

// GET /api/kyc/[token]
// The form's starting point: type, heading, bilingual flag, pre-fill
// (corporate only), the saved draft and the uploaded files (names only).
// Never returns the row id, the token, the portal ids or origin_env.
// A submitted row still opens (read-only view).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  const access = await verifyEkycAccess(token, { allowSubmitted: true });
  if (!access.ok || !access.row) {
    return NextResponse.json(ekycAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const row = access.row;

  // First open: invited -> in_progress, so the portal knows the client
  // started. Best effort: the first save flips it too.
  if (row.status === 'invited') {
    const { error } = await getSupabaseAdmin()
      .from(EKYC_TABLE)
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'invited');
    if (!error) row.status = 'in_progress';
  }

  const res = NextResponse.json(scrubEkycRowForClient(row));
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
