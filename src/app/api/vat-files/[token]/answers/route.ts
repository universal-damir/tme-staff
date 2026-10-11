import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/ai-route-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  scrubVatFilesRow,
  vatFilesChangeInfo,
  vatFilesConflictsForPage,
  vatFilesLastClientChange,
  vatFilesPageVersion,
  vatFilesRateLimited,
  type VatFilesChangeInfo,
} from '@/lib/vat-files';
import { applyCustomsAnswersUpdate, customsUnsentLineIds, readStoredAnswers, sanitizePageLines } from '@/lib/vat-customs';
import { verifyVatFilesAccess, vatFilesAccessErrorBody } from '@/lib/vat-files-token';
import { vatFilesViewer } from '@/lib/vat-files-code';
import { VAT_FILE_REQUESTS_TABLE, type VatCustomsNote, type VatCustomsReplyMeta, type VatFileRequestRow } from '@/types/vat-files';

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
// Answer: { savedAt, updated: { "<line id>": updatedAt }, staleReplies: ["<line id>"],
//          replyMeta: { "<line id>": { "<question id>": VatCustomsReplyMeta } } } (round 4 C).
// Round 4 B: gated like every route of the page; a changed line keeps
// `savedBy` = the confirmed address (replies to TME's questions included).
// Round 5:
// - a reply that was already SENT (isVatCustomsReplySent) is never changed or
//   cleared: the sent text stays, the line is named in `lockedReplies` and
//   the page loads it again;
// - each line may carry `baseUpdatedAt` (the stored updatedAt the page loaded
//   it with, null = none). Saved since by somebody else (customsLineConflict)
//   = the line is refused, the others are saved; `conflicts: { "<line id>":
//   { answer, at, by, byName } }` (who only for a code-confirmed viewer);
// - body `seen: { version, clientAt }` = what the page last knew; when the row
//   changed since (another person, TME), `otherChange` (VatFilesChangeInfo)
//   tells the page to offer a reload;
// - the answer adds `bases` (each taken line's stored updatedAt now),
//   `version` + `clientChangedAt` (after this save).
// Round 5 item 8: a line may carry `notes: { "<question id>": [{ id, text }] }`
// (notes under a SENT reply, see mergeCustomsNotes in lib/vat-customs.ts):
// drafts take the new text (empty = removed), sent notes never change
// (`lockedReplies`), notes to closed questions are dropped (`staleReplies`),
// unsent drafts of closed questions are removed, at most
// VAT_CUSTOMS_MAX_NOTES_PER_QUESTION (extra new notes are left out, the line
// named in `staleReplies` so the page reloads it; the rest is saved). The
// answer adds `notes: { "<line id>": { "<question id>": VatCustomsNote[] } }`
// for the changed lines (with the who / when this server stamped).
// 11.10: a batch whose lines all hold what is stored already (texts compared
// cleaned, empty notes / replies / parts left out) writes nothing: no
// customs_answers_saved_at, no updated_at, so no new version for anybody. The
// answer adds `unsentLines`: the line ids whose content differs from what the
// last Send carried (customsUnsentLineIds; the page's Send button uses it).
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
  const seenRaw = (body as { seen?: unknown }).seen;
  const seen =
    seenRaw && typeof seenRaw === 'object' && typeof (seenRaw as { version?: unknown }).version === 'string'
      ? {
          version: (seenRaw as { version: string }).version,
          clientAt:
            typeof (seenRaw as { clientAt?: unknown }).clientAt === 'string' ? (seenRaw as { clientAt: string }).clientAt : null,
        }
      : null;

  const supabase = getSupabaseAdmin();
  let current: VatFileRequestRow = access.row;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const lines = sanitizePageLines(current.customs_lines);
    if (lines.length === 0) {
      return NextResponse.json({ error: 'no_customs_table' }, { status: 409 });
    }
    const nowIso = new Date().toISOString();
    const update = applyCustomsAnswersUpdate(current.customs_answers, incoming, lines, nowIso, viewer.email, {
      answersSentAt: current.customs_answers_sent_at ?? null,
    });
    if (!update.ok) {
      return NextResponse.json({ error: update.error, lineId: update.lineId ?? null }, { status: 400 });
    }
    const staleReplies = update.staleReplies;
    const extra = {
      staleReplies,
      lockedReplies: update.lockedReplies,
      conflicts: vatFilesConflictsForPage(update.conflicts, viewer.email, current.allowed_names),
      bases: update.bases,
    };
    // The row changed since the page last looked (another person, another tab, TME).
    let otherChange: VatFilesChangeInfo | undefined;
    if (seen && vatFilesPageVersion(scrubVatFilesRow(current)) !== seen.version) {
      otherChange = vatFilesChangeInfo(current, viewer.email, seen.clientAt);
    }
    if (update.changed.length === 0) {
      // 11.10: nothing changed = nothing written (no saved_at, no updated_at, no new version).
      return NextResponse.json(
        {
          savedAt: current.customs_answers_saved_at ?? null,
          updated: {},
          ...extra,
          unsentLines: customsUnsentLineIds(readStoredAnswers(current.customs_answers, lines), current.customs_answers_sent_at ?? null),
          version: vatFilesPageVersion(scrubVatFilesRow(current)),
          clientChangedAt: vatFilesLastClientChange(current).at,
          ...(otherChange ? { otherChange } : {}),
        },
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
      // Round 4 C: who / when per reply of the changed lines (an empty map = no replies left), for the line under each reply.
      const replyMeta: Record<string, Record<string, VatCustomsReplyMeta>> = {};
      // Round 5 item 8: the stored notes of the changed lines (with who / when; {} = none left).
      const notes: Record<string, Record<string, VatCustomsNote[]>> = {};
      for (const id of update.changed) {
        updated[id] = nowIso;
        replyMeta[id] = update.answers[id]?.replyMeta ?? {};
        notes[id] = update.answers[id]?.notes ?? {};
      }
      const after = { ...current, ...patch } as VatFileRequestRow;
      return NextResponse.json(
        {
          savedAt: nowIso,
          updated,
          replyMeta,
          notes,
          ...extra,
          unsentLines: customsUnsentLineIds(update.answers, current.customs_answers_sent_at ?? null),
          version: vatFilesPageVersion(scrubVatFilesRow(after)),
          clientChangedAt: nowIso,
          ...(otherChange ? { otherChange } : {}),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
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
