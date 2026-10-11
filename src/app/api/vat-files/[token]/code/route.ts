import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { isValidVatFilesToken, vatFilesRateLimited } from '@/lib/vat-files';
import { verifyVatFilesAccess } from '@/lib/vat-files-token';
import { VAT_FILES_PROOF_COOKIE, clearProofCookie, isCrossSitePost, revokeProof } from '@/lib/vat-files-code';

export const runtime = 'nodejs';

// DELETE /api/vat-files/[token]/code
// Round 4 B, "Not you?": this browser forgets its proof for this link (the
// next load asks "Who are you?" again), and the proof row in Supabase loses
// its proof_hash / proof_expires_at, so a copy of the cookie stops working too.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  if (!isValidVatFilesToken(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 404 });
  if (vatFilesRateLimited(getClientIp(req))) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (isCrossSitePost(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const proof = req.cookies.get(VAT_FILES_PROOF_COOKIE)?.value;
  if (proof) {
    // Closed or expired links still lose the proof (the row comes back with the reason).
    const access = await verifyVatFilesAccess(token, { allowClosed: true });
    if (access.row) await revokeProof(getSupabaseAdmin(), access.row.id, proof);
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  clearProofCookie(res, token);
  return res;
}
