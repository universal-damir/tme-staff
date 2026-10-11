import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { vatFilesRateLimited } from '@/lib/vat-files';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import {
  allowedEmailsOf,
  codeRequiredFor,
  emailForChoice,
  isCrossSitePost,
  maskedAddresses,
  sendVatFilesCode,
} from '@/lib/vat-files-code';

export const runtime = 'nodejs';

// POST /api/vat-files/[token]/code/send   json: { choice }
// Round 4 B, step 1 of the email code: mail a 6-digit code to the address the
// person picked under "Who are you?" (`choice` = the opaque id from the
// masked list). Only addresses on the row's allowed_emails: someone else
// cannot ask for a code at all. See src/lib/vat-files-code.ts.
// Answer: 200 { ok: true, masked }; 400 unknown_address / no_code_needed;
// 404 / 410 expired like the page (a closed row takes the code too: the
// client may still see what they sent, read-only); 429 too_many_codes (sentence in errorMessage);
// 502 mail_failed.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  const ip = getClientIp(req);
  if (vatFilesRateLimited(ip)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (isCrossSitePost(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const access = await verifyVatFilesAccess(token, { allowClosed: true });
  if (!access.ok || !access.row) {
    return NextResponse.json(vatFilesAccessErrorBody(access), { status: access.status ?? 404 });
  }
  const row = access.row;
  if (!codeRequiredFor(row)) return NextResponse.json({ error: 'no_code_needed' }, { status: 400 });

  let choice: unknown;
  try {
    choice = ((await req.json()) as { choice?: unknown } | null)?.choice;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const allowed = allowedEmailsOf(row);
  const email = emailForChoice(row.id, allowed, choice);
  if (!email) return NextResponse.json({ error: 'unknown_address' }, { status: 400 });

  const result = await sendVatFilesCode(getSupabaseAdmin(), {
    requestId: row.id,
    email,
    ip: ip === 'unknown' ? null : ip,
    companyName: row.company_name ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, errorMessage: result.message }, { status: result.status });
  }
  const masked = maskedAddresses(row.id, allowed).find((a) => a.id === choice)?.masked ?? '';
  // devCode only exists in next dev without a Brevo login (vatFilesDevCodeOnPage).
  return NextResponse.json(
    result.devCode ? { ok: true, masked, devCode: result.devCode } : { ok: true, masked },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
