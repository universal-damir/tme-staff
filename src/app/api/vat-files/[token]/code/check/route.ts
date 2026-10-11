import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { vatFilesRateLimited } from '@/lib/vat-files';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import {
  allowedEmailsOf,
  checkVatFilesCode,
  codeRequiredFor,
  emailForChoice,
  isCrossSitePost,
  setProofCookie,
} from '@/lib/vat-files-code';
import { VAT_FILES_CODE_LENGTH } from '@/types/vat-files';

export const runtime = 'nodejs';

// POST /api/vat-files/[token]/code/check   json: { choice, code }
// Round 4 B, step 2: the typed code. A right code sets the proof cookie
// (httpOnly, Path = this link's API folder, 7 days) and answers { ok: true }.
// Wrong / expired code, too many tries: 400 with the sentence in errorMessage.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  if (vatFilesRateLimited(getClientIp(req))) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (isCrossSitePost(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const access = await verifyVatFilesAccess(token, { allowClosed: true });
  if (!access.ok || !access.row) {
    return NextResponse.json(vatFilesAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const row = access.row;
  if (!codeRequiredFor(row)) return NextResponse.json({ error: 'no_code_needed' }, { status: 400 });

  let body: { choice?: unknown; code?: unknown } | null;
  try {
    body = (await req.json()) as { choice?: unknown; code?: unknown } | null;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const email = emailForChoice(row.id, allowedEmailsOf(row), body?.choice);
  if (!email) return NextResponse.json({ error: 'unknown_address' }, { status: 400 });
  const code = typeof body?.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!new RegExp(`^\\d{${VAT_FILES_CODE_LENGTH}}$`).test(code)) {
    return NextResponse.json(
      { error: 'code_format', errorMessage: `Please type the ${VAT_FILES_CODE_LENGTH}-digit code from the email.` },
      { status: 400 }
    );
  }

  const result = await checkVatFilesCode(getSupabaseAdmin(), { requestId: row.id, email, code });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, errorMessage: result.message }, { status: result.status });
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  setProofCookie(res, token, result.proof);
  return res;
}
