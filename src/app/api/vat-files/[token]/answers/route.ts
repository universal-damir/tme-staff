import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { vatFilesRateLimited } from '@/lib/vat-files';
import { applyCustomsAnswersUpdate, sanitizePageLines } from '@/lib/vat-customs';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import { vatFilesViewer } from '@/lib/vat-files-code';
import { VAT_FILE_REQUESTS_TABLE, type VatFileRequestRow } from '@/types/vat-files';

export const runtime = 'nodejs';

// "Apply to all rows" on 300 imports with split parts stays far below this.
const MAX_ANSWERS_BODY_BYTES = 512 * 1024;
// Optimistic write: retry when another write (a second tab, a Send) landed in between.
const MAX_WRITE_ATTEMPTS = 4;

// POST /api/vat-files/[token]/answers   json: { answers: { "<line id>": VatCustomsLineAnswer } }
// Autosave of the customs table. The body carries ONLY the lines that
// changed since the last save (the page tracks them); each one replaces the
// stored answer of that line, all other lines stay. Checks: open, not expired
// link; the row has a customs table; only this row's line ids; option values
// from the shared lists; texts cut to VAT_CUSTOMS_MAX_TEXT_CHARS; at most
// VAT_CUSTOMS_MAX_PARTS parts; replies (`replies: { "<question id>": text }`)
// only to the line's OPEN questions: a reply to a closed / unknown question is
// dropped (never moved to another question) and the line is named in
// `staleReplies`, so the page loads the lines again. An unknown line id
// refuses the whole batch with 400 `unknown_line` (the page then reloads the
// lines and saves the lines that still exist again).
// `updatedAt` is set here per changed line. Writes ONLY customs_answers +
// customs_answers_saved_at (+ updated_at, the write guard), never the
// portal's columns.
// Answer: { savedAt, updated: { "<line id>": updatedAt }, staleReplies: ["<line id>"] }.
// Round 4 B: gated like every route of the page; a changed line keeps
// `savedBy` = the confirmed address (replies to TME's questions included).
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
  const viewer = await vatFilesViewer(req, access.row);
  if (!viewer.ok) return NextResponse.json(viewer.body, { status: viewer.status });

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_ANSWERS_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !('answers' in body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const incoming = (body as { answers: unknown }).answers;

  const supabase = getSupabaseAdmin();
  let current: VatFileRequestRow = access.row;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const lines = sanitizePageLines(current.customs_lines);
    if (lines.length === 0) {
      return NextResponse.json({ error: 'no_customs_table' }, { status: 409 });
    }
    const nowIso = new Date().toISOString();
    const update = applyCustomsAnswersUpdate(current.customs_answers, incoming, lines, nowIso, viewer.email);
    if (!update.ok) {
      return NextResponse.json({ error: update.error, lineId: update.lineId ?? null }, { status: 400 });
    }
    const staleReplies = update.staleReplies;
    if (update.changed.length === 0) {
      return NextResponse.json(
        { savedAt: current.customs_answers_saved_at ?? null, updated: {}, staleReplies },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const patch = {
      customs_answers: update.answers,
      customs_answers_saved_at: nowIso,
      updated_at: nowIso,
    };
    const base = supabase.from(VAT_FILE_REQUESTS_TABLE).update(patch).eq('id', current.id).eq('status', 'open');
    const guarded = current.updated_at ? base.eq('updated_at', current.updated_at) : base.is('updated_at', null);
    const { data: written, error: writeErr } = await guarded.select('id');
    if (writeErr) {
      console.error('vat-files/answers: saving the answers failed');
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }
    if (written && written.length > 0) {
      const updated: Record<string, string> = {};
      for (const id of update.changed) updated[id] = nowIso;
      return NextResponse.json({ savedAt: nowIso, updated, staleReplies }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Another write landed in between, or the portal closed the request: read again.
    const again = await verifyVatFilesAccess(token);
    if (!again.ok || !again.row) {
      return NextResponse.json(vatFilesAccessErrorBody(again), { status: again.status ?? 404 });
    }
    current = again.row;
  }
  return NextResponse.json({ error: 'save_failed' }, { status: 503 });
}
