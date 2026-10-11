import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  buildFinalizeEntries,
  linkFolder,
  parseFinalizeBody,
  vatFilesConflictsForPage,
  vatFilesRateLimited,
  vatFilesViewerPayload,
  type VatFilesPageConflict,
} from '@/lib/vat-files';
import {
  applyCustomsAnswersUpdate,
  customsUnsentLineIds,
  dropClosedDraftNotes,
  sanitizePageLines,
  vatCustomsSendStamp,
  withCustomsSentKeys,
} from '@/lib/vat-customs';
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
// through the same link. Answer: the page data, with viewerEmail + peopleNames like the GET.
// Round 4 B: with an email code, each new file carries `uploadedBy`, changed
// answer lines `savedBy`, and the row `last_submitted_by` (the confirmed address).
// Round 5: the answers follow the answers route: a reply already SENT stays
// as it is (`lockedReplies`), a line somebody else saved since the page
// loaded it is refused (`conflicts`, who only for a code-confirmed viewer).
// A Send that brings nothing new writes nothing (not even updated_at).
// A Send with a refused line (conflict) does NOT stamp customs_answers_sent_at:
// the taken lines are saved as an autosave would, `answersSent` is false, and
// the page asks the person to settle the conflicts and press Send again (files
// in the same Send still go out).
// Round 5 item 8: notes under a sent reply travel like replies (same merge,
// same locks); a Send stamps every draft note as sent (its last save is then
// not later than customs_answers_sent_at), so it becomes read-only.
// Round 5 review: before that stamp, unsent draft notes of questions that are
// no longer open are removed from every line (dropClosedDraftNotes), so they
// never turn "sent" and reopen a question TME closed. The stamp is never
// earlier than customs_answers_saved_at (vatCustomsSendStamp: a draft saved by
// another server instance with a slightly fast clock still counts as sent);
// last_submitted_at gets the same stamp.
// 11.10: the stamp needs a real change: a line whose content (texts cleaned,
// empty notes / replies left out) differs from what the last Send carried
// (customsUnsentLineIds, against each line's `sentKey`); the stamping Send
// writes the new `sentKey` on every line. A Send whose answers came back to
// the sent content saves them like an autosave, without a stamp.
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
    // Round 5 review: the Send stamp (customs_answers_sent_at + last_submitted_at), never before the last save.
    let sendStamp = nowIso;
    let saveOnly = false;
    let staleReplies: string[] = [];
    let lockedReplies: string[] = [];
    let conflicts: Record<string, VatFilesPageConflict> = {};
    if (withAnswers) {
      const update = applyCustomsAnswersUpdate(current.customs_answers, parsed.answers ?? {}, currentLines, nowIso, by, {
        answersSentAt: current.customs_answers_sent_at ?? null,
      });
      if (!update.ok) {
        return NextResponse.json({ error: update.error, lineId: update.lineId ?? null }, { status: 400 });
      }
      staleReplies = update.staleReplies;
      lockedReplies = update.lockedReplies;
      conflicts = vatFilesConflictsForPage(update.conflicts, by, current.allowed_names);
      const swept = dropClosedDraftNotes(update.answers, currentLines, current.customs_answers_sent_at ?? null);
      if (update.changed.length > 0 || swept.changed.length > 0) patch.customs_answers = swept.answers;
      if (update.changed.length > 0) patch.customs_answers_saved_at = nowIso;
      const savedAt = current.customs_answers_saved_at ?? null;
      const sentAt = current.customs_answers_sent_at ?? null;
      // 11.10: something to send = a line whose content differs from what the
      // last Send carried (customsUnsentLineIds), never "saved after the last
      // Send": typed and deleted back, an emptied note: nothing new.
      const unsentContent = customsUnsentLineIds(swept.answers, sentAt).length > 0;
      // Round 5: a line refused as a conflict = the answers are NOT sent: the
      // other lines are saved like an autosave (no Send stamp), so nobody's
      // unsent draft becomes "sent" / read-only. The page shows the conflicts;
      // after "Use mine" / "Keep theirs" the person presses Send again.
      const hasConflicts = Object.keys(conflicts).length > 0;
      stampAnswers = !hasConflicts && unsentContent;
      // A change that brings the content back to what was sent is saved like an autosave (no Send stamp).
      saveOnly = !stampAnswers && update.changed.length > 0;
      if (stampAnswers) {
        sendStamp = vatCustomsSendStamp(nowIso, (patch.customs_answers_saved_at as string | undefined) ?? savedAt);
        patch.customs_answers_sent_at = sendStamp;
        // 11.10: each line keeps the fingerprint of what this Send carried.
        patch.customs_answers = withCustomsSentKeys(swept.answers);
      }
      if (built.entries.length === 0 && !stampAnswers && !saveOnly) {
        // Nothing new: a double click after a Send is fine, a first empty Send is
        // not (unless lines were refused: the page must hear about them).
        const refused = lockedReplies.length > 0 || Object.keys(conflicts).length > 0;
        if (sentAt || refused) {
          return NextResponse.json({
            ...vatFilesViewerPayload(current, viewer.email),
            answersSent: false,
            staleReplies,
            lockedReplies,
            conflicts,
            sent: [],
          });
        }
        return NextResponse.json({ error: 'no_files' }, { status: 400 });
      }
    }
    // Round 5: a repeated Send of files already in the row (double click) changes nothing: no write.
    if (built.entries.length === 0 && !stampAnswers && !saveOnly) {
      return NextResponse.json({ ...vatFilesViewerPayload(current, viewer.email), answersSent: false, sent: [] });
    }
    // A double click sends nothing new: keep the timestamps as they were. A
    // save-only (conflicts, no files) is no Send: no last_submitted_at either.
    if (built.entries.length > 0 || stampAnswers) {
      patch.last_submitted_at = sendStamp;
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
        ...vatFilesViewerPayload({ ...current, ...patch, files } as VatFileRequestRow, viewer.email),
        answersSent: stampAnswers,
        staleReplies,
        lockedReplies,
        conflicts,
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
