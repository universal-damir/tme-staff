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
import { applyCustomsAnswersUpdate, sanitizePageLines } from '@/lib/vat-customs';
import { listVatLinkFolder, verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import { vatFilesViewer } from '@/lib/vat-files-code';
import {
  VAT_FILE_REQUESTS_TABLE,
  type VatFileEntry,
  type VatFileRequestRow,
} from '@/types/vat-files';

export const runtime = 'nodejs';

// Paths + names of up to 10 files, a 2000 character comment and the customs
// answers not autosaved yet (same cap as the answers route).
const MAX_BODY_BYTES = 576 * 1024;
// Optimistic write of `files`: retry when another write landed in between.
const MAX_WRITE_ATTEMPTS = 4;

// POST /api/vat-files/[token]/send
//   json: { files: [{ path, name, lineId?, docKind? }], comment, answers? }
// The client's Send: the files uploaded in this round join the row's
// `files` (each with the round's comment, and its customs line + kind when
// it was added on a row), `client_comment` and `last_submitted_at` are set.
// Round 3: `answers` present = this Send carries the customs answers (the
// lines not autosaved yet, merged like the answers route). Then files may be
// empty, and when the answers changed since the last Send (or were never
// sent) `customs_answers_sent_at` AND `last_submitted_at` are stamped, so
// the portal's sync (it reads rows by last_submitted_at, compares
// customs_answers_sent_at) picks them up. A repeated Send with nothing new
// stamps nothing. Replies follow the answers route (only to open questions;
// `staleReplies` names lines where one was dropped). The row stays open, so the client can send more later
// through the same link. Answer: the page data.
// Round 4 B: with an email code, each new file carries `uploadedBy`, changed
// answer lines `savedBy`, and the row `last_submitted_by` (the confirmed address).
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
  const row = access.row;
  // Round 4 B: who sends (null = no code needed, nothing recorded).
  const by = viewer.email;

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

  const lines = sanitizePageLines(row.customs_lines);
  // Answers only count on a row with a customs table (older rows: files only).
  const withAnswers = parsed.answers !== undefined && lines.length > 0;

  const stored =
    parsed.files.length > 0
      ? await listVatLinkFolder(linkFolder(row.environment, row.link_token))
      : new Map<string, number>();
  if (!stored) {
    console.error('vat-files/send: could not list the uploaded files');
    return NextResponse.json({ error: 'send_failed' }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  let current: VatFileRequestRow = row;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const existing: VatFileEntry[] = Array.isArray(current.files) ? current.files : [];
    const nowIso = new Date().toISOString();
    const currentLines = sanitizePageLines(current.customs_lines);
    const lineIds = new Set(currentLines.map((l) => l.id));
    const built = buildFinalizeEntries(
      existing,
      parsed.files,
      parsed.comment,
      stored,
      row.environment,
      row.link_token,
      nowIso,
      { lineIds, allowNoFiles: withAnswers, uploadedBy: by }
    );
    if (!built.ok) {
      const status = built.error === 'too_many_files' ? 409 : 400;
      return NextResponse.json({ error: built.error }, { status });
    }

    const files = [...existing, ...built.entries];
    const patch: Record<string, unknown> = { files, updated_at: nowIso };
    let stampAnswers = false;
    let staleReplies: string[] = [];
    if (withAnswers) {
      const update = applyCustomsAnswersUpdate(current.customs_answers, parsed.answers ?? {}, currentLines, nowIso, by);
      if (!update.ok) {
        return NextResponse.json({ error: update.error, lineId: update.lineId ?? null }, { status: 400 });
      }
      staleReplies = update.staleReplies;
      if (update.changed.length > 0) {
        patch.customs_answers = update.answers;
        patch.customs_answers_saved_at = nowIso;
      }
      const savedAt = current.customs_answers_saved_at ?? null;
      const sentAt = current.customs_answers_sent_at ?? null;
      const unsentSave = !!savedAt && (!sentAt || Date.parse(savedAt) > Date.parse(sentAt));
      stampAnswers = update.changed.length > 0 || unsentSave;
      if (stampAnswers) patch.customs_answers_sent_at = nowIso;
      if (built.entries.length === 0 && !stampAnswers) {
        // Nothing new: a double click after a Send is fine, a first empty Send is not.
        if (sentAt) {
          return NextResponse.json({ ...scrubVatFilesRow(current), sent: [] });
        }
        return NextResponse.json({ error: 'no_files' }, { status: 400 });
      }
    }
    // A double click sends nothing new: keep the timestamps as they were.
    if (built.entries.length > 0 || stampAnswers) {
      patch.last_submitted_at = nowIso;
      // Only with a code (the column comes with the round 4 SQL, like allowed_emails).
      if (by) patch.last_submitted_by = by;
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
        answersSent: stampAnswers,
        staleReplies,
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
