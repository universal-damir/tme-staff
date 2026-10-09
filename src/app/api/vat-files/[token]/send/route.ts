import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  buildFinalizeEntries,
  linkFolder,
  parseFinalizeBody,
  scrubVatFilesRow,
  vatFilesRateLimited,
} from '@/lib/vat-files';
import { listVatLinkFolder, verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import {
  VAT_FILE_REQUESTS_TABLE,
  type VatFileEntry,
  type VatFileRequestRow,
} from '@/types/vat-files';

export const runtime = 'nodejs';

// Paths + names of up to 40 files and a 2000 character comment.
const MAX_BODY_BYTES = 64 * 1024;
// Optimistic write of `files`: retry when another write landed in between.
const MAX_WRITE_ATTEMPTS = 4;

// POST /api/vat-files/[token]/send   json: { files: [{ path, name }], comment }
// The client's Send: the files uploaded in this round join the row's
// `files` (each with the round's comment), `client_comment` and
// `last_submitted_at` are set. The row stays open, so the client can send
// more files later through the same link. Answer: the page data.
export async function POST(
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
  const row = access.row;

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const parsed = parseFinalizeBody(body);
  if (!parsed) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const stored = await listVatLinkFolder(linkFolder(row.environment, row.link_token));
  if (!stored) {
    console.error('vat-files/send: could not list the uploaded files');
    return NextResponse.json({ error: 'send_failed' }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  let current: VatFileRequestRow = row;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const existing: VatFileEntry[] = Array.isArray(current.files) ? current.files : [];
    const nowIso = new Date().toISOString();
    const built = buildFinalizeEntries(
      existing,
      parsed.files,
      parsed.comment,
      stored,
      row.environment,
      row.link_token,
      nowIso
    );
    if (!built.ok) {
      const status = built.error === 'too_many_files' ? 409 : 400;
      return NextResponse.json({ error: built.error }, { status });
    }

    const files = [...existing, ...built.entries];
    const patch: Record<string, unknown> = { files, updated_at: nowIso };
    // A double click sends nothing new: keep the timestamps as they were.
    if (built.entries.length > 0) {
      patch.last_submitted_at = nowIso;
      if (parsed.comment) patch.client_comment = parsed.comment;
    }

    const base = supabase.from(VAT_FILE_REQUESTS_TABLE).update(patch).eq('id', row.id).eq('status', 'open');
    const guarded = current.updated_at
      ? base.eq('updated_at', current.updated_at)
      : base.is('updated_at', null);
    const { data: written, error: writeErr } = await guarded.select('id');
    if (writeErr) {
      console.error('vat-files/send: saving the files failed');
      return NextResponse.json({ error: 'send_failed' }, { status: 500 });
    }
    if (written && written.length > 0) {
      return NextResponse.json({
        ...scrubVatFilesRow({ ...current, ...patch, files } as VatFileRequestRow),
        sent: built.entries.map((e) => ({ name: e.name, size: e.size, uploadedAt: e.uploadedAt })),
      });
    }

    // Another write landed in between, or the portal closed the request: read again.
    const again = await verifyVatFilesAccess(token);
    if (!again.ok || !again.row) {
      return NextResponse.json(vatFilesAccessErrorBody(again), { status: again.status ?? 404 });
    }
    current = again.row;
  }
  return NextResponse.json({ error: 'send_failed' }, { status: 503 });
}
