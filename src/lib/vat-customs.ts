/**
 * VAT filing round 3: the customs table on the upload page - the pure parts
 * (no Supabase), shared by the API routes, the page and the tests.
 *
 * The portal writes the import lines to vat_file_requests.customs_lines
 * (portal-owned). The client answers them on the page; this site writes
 * customs_answers + customs_answers_saved_at (autosave) and
 * customs_answers_sent_at (Send). Never the portal's columns.
 *
 * Answer rules (page and portal alike): per line the newer `updatedAt` wins;
 * `updatedAt` is always set here on the server, never trusted from the browser.
 */

import {
  VAT_CUSTOMS_DELIVERY_OPTIONS,
  VAT_CUSTOMS_INCOTERM_OPTIONS,
  VAT_CUSTOMS_MAX_PARTS,
  VAT_CUSTOMS_MAX_TEXT_CHARS,
  VAT_CUSTOMS_PAYMENT_OPTIONS,
  VAT_CUSTOMS_PURPOSE_OPTIONS,
  isVatCustomsLineComplete,
  normaliseVatFilesEmail,
  VAT_CUSTOMS_REPLY_SESSION_MINUTES,
  vatCustomsReplyBy,
  vatCustomsReplyVersionAt,
  type VatCustomsAnswerPart,
  type VatCustomsAnswers,
  type VatCustomsDefaults,
  type VatCustomsDocKind,
  type VatCustomsLineAnswer,
  type VatCustomsPageLine,
  type VatCustomsReplyMeta,
  type VatFileEntry,
  type VatFilesPagePayload,
} from '@/types/vat-files';

// ------------------------------------------------------------------
// Small cleaners
// ------------------------------------------------------------------

const PURPOSES = new Set<string>(VAT_CUSTOMS_PURPOSE_OPTIONS.map((o) => o.value));
const PAYMENTS = new Set<string>(VAT_CUSTOMS_PAYMENT_OPTIONS.map((o) => o.value));
const INCOTERMS = new Set<string>(VAT_CUSTOMS_INCOTERM_OPTIONS.map((o) => o.value));
const DELIVERIES = new Set<string>(VAT_CUSTOMS_DELIVERY_OPTIONS.map((o) => o.value));
const DOC_KINDS = new Set<string>(['boe', 'invoice', 'other']);

export function isVatCustomsDocKind(v: unknown): v is VatCustomsDocKind {
  return typeof v === 'string' && DOC_KINDS.has(v);
}

/** Free text: control characters out (line breaks kept), trimmed, cut to the shared maximum. */
export function cleanCustomsText(raw: unknown, max: number = VAT_CUSTOMS_MAX_TEXT_CHARS): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

/** A positive whole number id (the portal's serial ids). */
function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function finiteOrNull(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function isoDateOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

function isoOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : undefined;
}

// ------------------------------------------------------------------
// Parts and answers
// ------------------------------------------------------------------

type OptionField = 'purpose' | 'payment' | 'incoterm' | 'delivery';
type TextField = 'invoiceRef' | 'purposeOther' | 'paymentOther' | 'incotermOther' | 'deliveryPlace' | 'comment';

const OPTION_FIELDS: Array<[OptionField, Set<string>]> = [
  ['purpose', PURPOSES],
  ['payment', PAYMENTS],
  ['incoterm', INCOTERMS],
  ['delivery', DELIVERIES],
];
const TEXT_FIELDS: TextField[] = ['invoiceRef', 'purposeOther', 'paymentOther', 'incotermOther', 'deliveryPlace', 'comment'];
/** Fixed key order, so two equal answers serialize alike. */
const PART_KEYS: Array<keyof VatCustomsAnswerPart> = [
  'invoiceRef',
  'purpose',
  'purposeOther',
  'payment',
  'paymentOther',
  'incoterm',
  'incotermOther',
  'delivery',
  'deliveryPlace',
  'comment',
];

export type CustomsPartCheck = { ok: true; part: VatCustomsAnswerPart } | { ok: false };

/**
 * One part from the browser. Option values must come from the shared lists
 * (empty / null = not chosen yet); texts are cleaned and cut. Unknown keys
 * are dropped. Only filled keys are kept.
 */
export function sanitizeCustomsPart(raw: unknown): CustomsPartCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const r = raw as Record<string, unknown>;
  const part: VatCustomsAnswerPart = {};
  for (const [field, allowed] of OPTION_FIELDS) {
    const v = r[field];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !allowed.has(v)) return { ok: false };
    (part as Record<string, unknown>)[field] = v;
  }
  for (const field of TEXT_FIELDS) {
    const v = r[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { ok: false };
    const clean = cleanCustomsText(v);
    if (clean) part[field] = clean;
  }
  return { ok: true, part: canonicalPart(part) };
}

function canonicalPart(part: VatCustomsAnswerPart): VatCustomsAnswerPart {
  const out: Record<string, unknown> = {};
  for (const k of PART_KEYS) {
    const v = part[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out as VatCustomsAnswerPart;
}

/** Replies with their keys in a fixed order (empty texts left out): for "did it change?". */
function repliesKey(replies: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(replies ?? {})
    .filter(([, text]) => typeof text === 'string' && text.trim().length > 0)
    .sort(([a], [b]) => Number(a) - Number(b));
}

/** The answer without its timestamp, keys in a fixed order: for "did it change?". */
function answerKey(a: VatCustomsLineAnswer | null | undefined): string {
  if (!a) return JSON.stringify({ parts: [], replies: [] });
  return JSON.stringify({
    parts: (a.parts ?? []).map(canonicalPart),
    replies: repliesKey(a.replies),
  });
}

/** True when nothing at all is filled in (no option chosen, no text, no reply). */
export function isCustomsAnswerEmpty(a: VatCustomsLineAnswer | null | undefined): boolean {
  if (!a) return true;
  if (repliesKey(a.replies).length > 0) return false;
  return (a.parts ?? []).every((p) => Object.keys(canonicalPart(p)).length === 0);
}

/** Most replies kept per line (one per open question; a line rarely has more than two). */
const MAX_REPLIES_PER_LINE = 20;

/** Stored replies, read leniently: question id keys, cleaned non-empty texts. */
function readStoredReplies(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_REPLIES_PER_LINE) break;
    const qid = positiveInt(key);
    const text = cleanCustomsText(value);
    if (!qid || !text) continue;
    out[String(qid)] = text;
    n++;
  }
  return n > 0 ? out : undefined;
}

/**
 * A stored answer (our own column, or the portal's line.answer), read
 * leniently: bad parts are dropped, never an error. Null when unusable.
 */
export function readStoredLineAnswer(raw: unknown): VatCustomsLineAnswer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const parts: VatCustomsAnswerPart[] = [];
  if (Array.isArray(r.parts)) {
    for (const p of r.parts.slice(0, VAT_CUSTOMS_MAX_PARTS)) {
      const checked = sanitizeCustomsPart(p);
      if (checked.ok) parts.push(checked.part);
    }
  }
  const out: VatCustomsLineAnswer = { parts };
  const replies = readStoredReplies(r.replies);
  if (replies) out.replies = replies;
  const updatedAt = isoOrUndefined(r.updatedAt);
  if (updatedAt) out.updatedAt = updatedAt;
  // Round 4 B: kept on the server; the page payload drops it (scrubVatFilesRow).
  const savedBy = normaliseVatFilesEmail(r.savedBy);
  if (savedBy) out.savedBy = savedBy;
  // Round 4 C: who / when per reply (also of a cleared reply: meta without text).
  const replyMeta = readReplyMeta(r.replyMeta);
  if (replyMeta) out.replyMeta = replyMeta;
  // Round 4 C: TME typed this answer (the portal's line.answer only).
  const filledBy = readFilledBy(r.filledBy);
  if (filledBy) out.filledBy = filledBy;
  return out;
}

/** A colleague's name as the portal wrote it: one line, at most 120 characters; null when empty. */
export function cleanStaffName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = cleanCustomsText(raw, 120).replace(/\s+/g, ' ').trim();
  return name || null;
}

function readFilledBy(raw: unknown): VatCustomsLineAnswer['filledBy'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return { name: cleanStaffName((raw as Record<string, unknown>).name) };
}

/** One reply's who / when, read leniently (bad stamps and addresses dropped). */
function readOneReplyMeta(raw: unknown): VatCustomsReplyMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: VatCustomsReplyMeta = {};
  const sentAt = isoOrUndefined(r.sentAt);
  if (sentAt) out.sentAt = sentAt;
  const sentBy = normaliseVatFilesEmail(r.sentBy);
  if (sentBy) out.sentBy = sentBy;
  const changedAt = isoOrUndefined(r.changedAt);
  if (changedAt) out.changedAt = changedAt;
  const changedBy = normaliseVatFilesEmail(r.changedBy);
  if (changedBy && changedAt) out.changedBy = changedBy;
  const savedAt = isoOrUndefined(r.savedAt);
  if (savedAt) out.savedAt = savedAt;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The stored replyMeta (keys = positive integer question ids, at most
 * MAX_REPLIES_PER_LINE). A meta without a reply text = the client cleared
 * that reply: its last who / when is kept, so typing it again within the
 * session window stays the same version, and the portal sees the clear.
 */
function readReplyMeta(raw: unknown): Record<string, VatCustomsReplyMeta> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, VatCustomsReplyMeta> = {};
  let n = 0;
  for (const [qid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_REPLIES_PER_LINE) break;
    if (positiveInt(qid) === null || String(positiveInt(qid)) !== qid) continue;
    const meta = readOneReplyMeta(value);
    if (meta) {
      out[qid] = meta;
      n++;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Round 4 C: the who / when of a reply whose text just changed (server time
 * `nowIso`, `by` = the confirmed address or null). An empty new text (the
 * client cleared the reply) goes through the same rule: the caller keeps the
 * result as the cleared reply's meta. No earlier reply and no earlier who /
 * when = a new one ("Sent"). The same person again within
 * VAT_CUSTOMS_REPLY_SESSION_MINUTES of the last save = the same version
 * (autosave while typing, also clear-then-retype): only savedAt moves.
 * Otherwise a change ("Changed by ..."). An earlier reply without any who /
 * when (stored before round 4 C) counts as a change. The portal books the
 * same way (decideCustomsReplyUpdate in customs-who.ts).
 */
export function nextReplyMeta(
  previousText: string | undefined,
  previous: VatCustomsReplyMeta | undefined,
  nowIso: string,
  by: string | null
): VatCustomsReplyMeta {
  const hadText = typeof previousText === 'string' && previousText.trim().length > 0;
  // A cleared reply keeps its last who / when (no text): not a new one.
  if (!hadText && !vatCustomsReplyVersionAt(previous)) {
    return { sentAt: nowIso, ...(by ? { sentBy: by } : {}), savedAt: nowIso };
  }
  const prev = previous ?? {};
  const lastAt = prev.savedAt || vatCustomsReplyVersionAt(prev);
  const lastBy = vatCustomsReplyBy(prev);
  const sameSession =
    !!lastAt &&
    (lastBy ?? null) === (by ?? null) &&
    Date.parse(nowIso) - Date.parse(lastAt) < VAT_CUSTOMS_REPLY_SESSION_MINUTES * 60_000;
  if (sameSession) return { ...prev, savedAt: nowIso };
  const out: VatCustomsReplyMeta = {};
  if (prev.sentAt) out.sentAt = prev.sentAt;
  if (prev.sentBy) out.sentBy = prev.sentBy;
  out.changedAt = nowIso;
  if (by) out.changedBy = by;
  out.savedAt = nowIso;
  return out;
}

// ------------------------------------------------------------------
// Lines (portal-owned, read leniently)
// ------------------------------------------------------------------

/** vat_file_requests.customs_lines -> what the page may show. A missing column = no lines. */
export function sanitizePageLines(raw: unknown): VatCustomsPageLine[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const lines: VatCustomsPageLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = positiveInt(r.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // `questions` (all open ones, oldest first); an older portal wrote one `question`.
    const rawQuestions = Array.isArray(r.questions) ? r.questions : r.question ? [r.question] : [];
    const questions: NonNullable<VatCustomsPageLine['questions']> = [];
    const seenQ = new Set<number>();
    for (const q of rawQuestions.slice(0, MAX_REPLIES_PER_LINE)) {
      if (!q || typeof q !== 'object') continue;
      const qr = q as Record<string, unknown>;
      const qid = positiveInt(qr.id);
      const qtext = qid ? cleanCustomsText(qr.text, 2000) : '';
      if (!qid || !qtext || seenQ.has(qid)) continue;
      seenQ.add(qid);
      const askedBy = cleanStaffName(qr.askedBy);
      questions.push({
        id: qid,
        text: qtext,
        askedAt: typeof qr.askedAt === 'string' ? qr.askedAt : '',
        ...(askedBy ? { askedBy } : {}),
      });
    }
    lines.push({
      id,
      lineNo: positiveInt(r.lineNo) ?? lines.length + 1,
      declarationDate: isoDateOrNull(r.declarationDate),
      declarationNo: String(r.declarationNo ?? '').trim().slice(0, 60),
      transactionRefNo: typeof r.transactionRefNo === 'string' ? r.transactionRefNo.trim().slice(0, 60) || null : null,
      totalValue: finiteOrNull(r.totalValue),
      totalVat: finiteOrNull(r.totalVat),
      hasBoe: r.hasBoe === true,
      hasInvoice: r.hasInvoice === true,
      answer: readStoredLineAnswer(r.answer),
      questions,
    });
  }
  return lines;
}

/** customs_answers as stored -> only lines that exist, each read leniently. */
export function readStoredAnswers(raw: unknown, lines: VatCustomsPageLine[]): VatCustomsAnswers {
  const out: VatCustomsAnswers = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const ids = new Set(lines.map((l) => String(l.id)));
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(key)) continue;
    const a = readStoredLineAnswer(value);
    if (a) out[key] = a;
  }
  return out;
}

/** customs_defaults: one part, or null. */
export function readDefaults(raw: unknown): VatCustomsDefaults {
  const checked = sanitizeCustomsPart(raw);
  if (!checked.ok) return null;
  const { invoiceRef: _ignored, ...rest } = checked.part;
  void _ignored;
  return Object.keys(rest).length > 0 ? rest : null;
}

/** Per-line files sent so far (for the row ticks). */
export function buildLineFiles(
  files: VatFileEntry[],
  lines: VatCustomsPageLine[]
): VatFilesPagePayload['lineFiles'] {
  const ids = new Set(lines.map((l) => l.id));
  const out: VatFilesPagePayload['lineFiles'] = [];
  for (const f of files) {
    const lineId = positiveInt(f?.lineId);
    if (!lineId || !ids.has(lineId) || !isVatCustomsDocKind(f?.docKind)) continue;
    out.push({ lineId, docKind: f.docKind, name: String(f.name ?? 'file'), uploadedAt: String(f.uploadedAt ?? '') });
  }
  return out;
}

// ------------------------------------------------------------------
// Saving answers (autosave and Send)
// ------------------------------------------------------------------

export type CustomsAnswersError = 'invalid_answers' | 'unknown_line' | 'invalid_answer' | 'too_many_parts';

export type CustomsAnswersUpdate =
  | {
      ok: true;
      /** The whole map to store. */
      answers: VatCustomsAnswers;
      /** Line ids (keys) whose answer really changed; each got `updatedAt = nowIso`. Their who / when per reply is in `answers[id].replyMeta`. */
      changed: string[];
      /**
       * Line ids where a reply was left out because its question is no longer
       * open on that line (TME closed it, or it is unknown). The page then
       * loads the lines again. The text is never moved to another question.
       */
      staleReplies: string[];
    }
  | { ok: false; error: CustomsAnswersError; lineId?: string };

/** The ids of a line's open questions, as strings. */
function openQuestionIds(line: Pick<VatCustomsPageLine, 'questions'>): Set<string> {
  return new Set((line.questions ?? []).map((q) => String(q.id)));
}

/**
 * Merge the lines the browser sends (`incoming`: ONLY the changed lines,
 * keyed by line id) into the stored map. Each incoming line replaces the
 * stored one. Checks: an object; only ids of this row's lines; option values
 * from the shared lists; at most VAT_CUSTOMS_MAX_PARTS parts. Replies
 * (`replies: { "<question id>": text }`) are kept only for the line's OPEN
 * questions; a reply to a closed or unknown question is dropped and the line
 * listed in `staleReplies` (never moved to another question). Stored replies
 * to questions that are no longer open stay as they were (TME may not have
 * pulled them yet). A line whose content did not change keeps its stored
 * `updatedAt`; a changed one gets `nowIso`. Lines not sent stay as they are.
 */
export function applyCustomsAnswersUpdate(
  stored: unknown,
  incoming: unknown,
  lines: VatCustomsPageLine[],
  nowIso: string,
  /** Round 4 B: the confirmed address of the person saving; kept on each CHANGED line as `savedBy`. Null = unknown. */
  savedBy: string | null = null
): CustomsAnswersUpdate {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { ok: false, error: 'invalid_answers' };
  }
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  const answers = readStoredAnswers(stored, lines);
  const changed: string[] = [];
  const staleReplies: string[] = [];

  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    const line = byId.get(key);
    if (!line) return { ok: false, error: 'unknown_line', lineId: key };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'invalid_answer', lineId: key };
    }
    const v = value as Record<string, unknown>;
    if (v.parts !== undefined && !Array.isArray(v.parts)) return { ok: false, error: 'invalid_answer', lineId: key };
    const rawParts = (v.parts as unknown[] | undefined) ?? [];
    if (rawParts.length > VAT_CUSTOMS_MAX_PARTS) return { ok: false, error: 'too_many_parts', lineId: key };
    const parts: VatCustomsAnswerPart[] = [];
    for (const p of rawParts) {
      const checked = sanitizeCustomsPart(p);
      if (!checked.ok) return { ok: false, error: 'invalid_answer', lineId: key };
      parts.push(checked.part);
    }

    // Replies: only to this line's open questions.
    const open = openQuestionIds(line);
    const rawReplies: Array<[string, unknown]> = [];
    if (v.replies !== undefined && v.replies !== null) {
      if (typeof v.replies !== 'object' || Array.isArray(v.replies)) {
        return { ok: false, error: 'invalid_answer', lineId: key };
      }
      rawReplies.push(...Object.entries(v.replies as Record<string, unknown>));
    }
    // A page loaded before the change sends one `reply` + `replyToQuestionId`:
    // kept only when it names an open question of this line (same rule).
    if (typeof v.reply === 'string' && v.replyToQuestionId !== undefined && v.replyToQuestionId !== null) {
      rawReplies.push([String(v.replyToQuestionId), v.reply]);
    }
    if (rawReplies.length > MAX_REPLIES_PER_LINE) return { ok: false, error: 'invalid_answer', lineId: key };
    const replies: Record<string, string> = {};
    const storedReplies = answers[key]?.replies ?? {};
    const storedMeta = answers[key]?.replyMeta ?? {};
    // Stored replies to questions that are no longer open stay untouched (with their who / when).
    for (const [qid, text] of Object.entries(storedReplies)) {
      if (!open.has(qid)) replies[qid] = text;
    }
    let stale = false;
    for (const [rawQid, rawText] of rawReplies) {
      if (rawText !== undefined && rawText !== null && typeof rawText !== 'string') {
        return { ok: false, error: 'invalid_answer', lineId: key };
      }
      const qid = positiveInt(rawQid);
      const text = cleanCustomsText(rawText);
      if (!qid || !open.has(String(qid))) {
        if (text) stale = true;
        continue;
      }
      if (text) replies[String(qid)] = text;
    }
    if (stale) staleReplies.push(key);

    const next: VatCustomsLineAnswer = { parts };
    if (Object.keys(replies).length > 0) next.replies = replies;

    const before = answers[key];
    if (answerKey(before) === answerKey(next)) continue;
    // Round 4 C: who / when per reply. Unchanged text keeps its stamps; a
    // changed one gets new ones (same version or a change, see nextReplyMeta).
    // A reply of an open question that is no longer there was cleared: it
    // keeps a meta without text (its last who / when), so a retype within the
    // window is the same version and the portal sees the clear. Questions no
    // longer open keep their stamps as they are.
    const replyMeta: Record<string, VatCustomsReplyMeta> = {};
    for (const qid of new Set([...Object.keys(replies), ...Object.keys(storedReplies), ...Object.keys(storedMeta)])) {
      const text = open.has(qid) ? replies[qid] ?? '' : storedReplies[qid] ?? '';
      const was = storedReplies[qid] ?? '';
      if (was === text) {
        if (storedMeta[qid]) replyMeta[qid] = storedMeta[qid];
      } else {
        replyMeta[qid] = nextReplyMeta(was, storedMeta[qid], nowIso, savedBy);
      }
    }
    if (Object.keys(replyMeta).length > 0) next.replyMeta = replyMeta;
    next.updatedAt = nowIso;
    if (savedBy) next.savedBy = savedBy;
    answers[key] = next;
    changed.push(key);
  }
  return { ok: true, answers, changed, staleReplies };
}

// ------------------------------------------------------------------
// What the page shows
// ------------------------------------------------------------------

/** Only the replies to the line's open questions (the ones the page shows). */
export function openReplies(
  line: Pick<VatCustomsPageLine, 'questions'>,
  replies: Record<string, string> | undefined
): Record<string, string> | undefined {
  const open = openQuestionIds(line);
  const out: Record<string, string> = {};
  for (const [qid, text] of Object.entries(replies ?? {})) {
    if (open.has(qid) && typeof text === 'string') out[qid] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Per line: the newer of the portal's `line.answer` (staff typed it, staff
 * cleared it = `{ parts: [], updatedAt }`, or an earlier Send came back) and
 * the client's saved answer, by `updatedAt`. A missing `updatedAt` counts as
 * oldest; on a tie the client's wins. The replies always come from the
 * client's answer, and only those to the line's open questions.
 */
export function mergeLineAnswer(
  line: Pick<VatCustomsPageLine, 'answer' | 'questions'>,
  client: VatCustomsLineAnswer | null | undefined
): VatCustomsLineAnswer {
  const portal = line.answer ?? null;
  const pick =
    !client ? portal : !portal ? client : (client.updatedAt ?? '') >= (portal.updatedAt ?? '') ? client : portal;
  const merged: VatCustomsLineAnswer = {
    parts: (pick?.parts ?? []).map((p) => ({ ...p })),
  };
  if (pick?.updatedAt) merged.updatedAt = pick.updatedAt;
  // Round 4 C: TME's answer is the one shown: say who typed it (dropped on the client's first change).
  if (pick && pick === portal && portal.filledBy && (portal.parts?.length ?? 0) > 0) merged.filledBy = { ...portal.filledBy };
  const replies = openReplies(line, client?.replies);
  if (replies) merged.replies = replies;
  return merged;
}

/** The answers the page starts with: one entry per line (merged). */
export function initialPageAnswers(
  lines: VatCustomsPageLine[],
  saved: VatCustomsAnswers
): VatCustomsAnswers {
  const out: VatCustomsAnswers = {};
  for (const line of lines) out[String(line.id)] = mergeLineAnswer(line, saved[String(line.id)]);
  return out;
}

/** The four answers of a part (no invoice number, no comment): what "Apply to all" copies. */
export function copyableAnswer(part: VatCustomsAnswerPart | null | undefined): VatCustomsAnswerPart {
  const p = part ?? {};
  return canonicalPart({
    purpose: p.purpose,
    purposeOther: p.purpose === 'other' ? p.purposeOther : undefined,
    payment: p.payment,
    paymentOther: p.payment === 'other' ? p.paymentOther : undefined,
    incoterm: p.incoterm,
    incotermOther: p.incoterm === 'other' ? p.incotermOther : undefined,
    delivery: p.delivery,
    deliveryPlace: p.delivery === 'outside_uae' || p.delivery === 'other' ? p.deliveryPlace : undefined,
  });
}

/**
 * "Apply to all rows" / "Same as last quarter": every EMPTY line gets one
 * part with `source`'s four answers. A line with anything filled in (an
 * option, a text, a split, a reply) is never touched. Returns the new map and
 * the ids it filled.
 */
/** A line "Apply to all" / "Same as last quarter" may fill: nothing filled in, not split. */
export function isFillableLine(a: VatCustomsLineAnswer | null | undefined): boolean {
  return isCustomsAnswerEmpty(a) && (a?.parts?.length ?? 0) <= 1;
}

export function fillEmptyLines(
  answers: VatCustomsAnswers,
  lineIds: Array<number | string>,
  source: VatCustomsAnswerPart | null | undefined
): { answers: VatCustomsAnswers; filled: string[] } {
  const copy = copyableAnswer(source);
  if (Object.keys(copy).length === 0) return { answers, filled: [] };
  const out: VatCustomsAnswers = { ...answers };
  const filled: string[] = [];
  for (const raw of lineIds) {
    const id = String(raw);
    const current = out[id];
    if (!isFillableLine(current)) continue;
    out[id] = { ...(current ?? {}), parts: [{ ...copy }] };
    filled.push(id);
  }
  return { answers: out, filled };
}

// ------------------------------------------------------------------
// After TME changed the lines (reload)
// ------------------------------------------------------------------

export interface CustomsReloadResult {
  /** The answers the page shows now: one entry per fresh line. */
  answers: VatCustomsAnswers;
  /** Line ids still to save (typed, not saved yet, and the line still exists). */
  dirty: string[];
  /** Typed-but-unsaved line ids whose import is no longer on the list. */
  droppedLines: string[];
  /** Lines came or went (the "list of imports was updated" note). */
  listChanged: boolean;
  /** A typed reply was dropped because its question is no longer open. */
  repliesDropped: boolean;
}

/**
 * The page loaded the lines again (an autosave hit `unknown_line`, or the
 * server dropped a reply to a closed question). Rules:
 * - a line that is gone is dropped (its id leaves `dirty` too);
 * - a line that still exists and was typed in but not saved keeps EXACTLY
 *   what the client typed (parts), and stays dirty, so it is saved again;
 *   only its replies to questions that are no longer open are dropped
 *   (never moved to another question);
 * - every other line shows the fresh merge of TME's answer and the saved one.
 */
export function reconcileAfterReload(
  current: VatCustomsAnswers,
  dirty: Iterable<string>,
  freshLines: VatCustomsPageLine[],
  freshSaved: VatCustomsAnswers
): CustomsReloadResult {
  const freshIds = new Set(freshLines.map((l) => String(l.id)));
  const dirtySet = new Set(dirty);
  const answers: VatCustomsAnswers = {};
  const keepDirty: string[] = [];
  let repliesDropped = false;
  for (const line of freshLines) {
    const id = String(line.id);
    const typed = current[id];
    if (dirtySet.has(id) && typed) {
      const kept: VatCustomsLineAnswer = { parts: (typed.parts ?? []).map((p) => ({ ...p })) };
      if (typed.updatedAt) kept.updatedAt = typed.updatedAt;
      const replies = openReplies(line, typed.replies);
      if (replies) kept.replies = replies;
      if (repliesKey(typed.replies).length !== repliesKey(replies).length) repliesDropped = true;
      answers[id] = kept;
      keepDirty.push(id);
    } else {
      answers[id] = mergeLineAnswer(line, freshSaved[id]);
    }
  }
  const droppedLines = [...dirtySet].filter((id) => !freshIds.has(id));
  const currentIds = Object.keys(current);
  const listChanged =
    currentIds.some((id) => !freshIds.has(id)) || [...freshIds].some((id) => !(id in current));
  return { answers, dirty: keepDirty, droppedLines, listChanged, repliesDropped };
}

// ------------------------------------------------------------------
// Filters on the page (U6)
// ------------------------------------------------------------------

export type CustomsLineFilter = 'all' | 'open' | 'questions';

/**
 * The line ids a filter shows; null = all. The page takes this set when the
 * client picks the filter (a row they just answered does not jump away while
 * they type); the counts on the chips stay live.
 */
export function filterCustomsLineIds(
  filter: CustomsLineFilter,
  lines: VatCustomsPageLine[],
  answers: VatCustomsAnswers
): Set<string> | null {
  if (filter === 'all') return null;
  const ids = new Set<string>();
  for (const l of lines) {
    const id = String(l.id);
    const show = filter === 'open' ? !isVatCustomsLineComplete(answers[id]) : (l.questions?.length ?? 0) > 0;
    if (show) ids.add(id);
  }
  return ids;
}

// ------------------------------------------------------------------
// Display helpers
// ------------------------------------------------------------------

/** 1234.5 -> "AED 1,234.50"; '' when unknown. */
export function formatAed(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `AED (${abs})` : `AED ${abs}`;
}

/** 1234.5 -> "1,234.50" (the table's AED columns say the currency in the header). */
export function formatAmount(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

/**
 * '2026-08-03' -> '03.08.2026'. The page's deadline (Round 2, formatDeadline)
 * shows dd.mm.yyyy, so the table dates do the same: one date style per page.
 */
export function formatPageDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/** An ISO timestamp -> 'hh:mm' in Dubai time. */
export function formatDubaiTime(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(t));
}

/** An ISO timestamp -> 'dd.mm.yyyy hh:mm' in Dubai time. */
export function formatDubaiDateTime(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

/** An ISO timestamp -> 'dd.mm.yyyy' in Dubai time ('' when unknown). */
export function formatDubaiDate(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

// ------------------------------------------------------------------
// Round 4 C: who asked, who replied (page wording)
// ------------------------------------------------------------------

/**
 * The head of a TME question: "Anshad Muhammed, TME Services, asked on
 * 11.10.2026"; no name: "TME Services asked on 11.10.2026"; no date either:
 * "TME Services asks".
 */
export function questionAskedLine(q: { askedAt?: string | null; askedBy?: string | null }): string {
  const date = formatDubaiDate(q.askedAt);
  const name = cleanStaffName(q.askedBy);
  if (!date) return name ? `${name}, TME Services, asks` : 'TME Services asks';
  return name ? `${name}, TME Services, asked on ${date}` : `TME Services asked on ${date}`;
}

/**
 * The line under a reply: "Sent by b.klingler@star.de.com on 11.10.2026 13:09",
 * after a later change "Changed by ... on ...", without an address "Sent on
 * ...". Time = the last save of the current text (Dubai). '' when unknown.
 */
export function replyWhoLine(meta: VatCustomsReplyMeta | null | undefined): string {
  if (!meta) return '';
  const at = formatDubaiDateTime(meta.savedAt || meta.changedAt || meta.sentAt);
  if (!at) return '';
  const changed = !!meta.changedAt;
  const by = vatCustomsReplyBy(meta);
  return `${changed ? 'Changed' : 'Sent'}${by ? ` by ${by}` : ''} on ${at}`;
}

/** "Filled in by Anshad Muhammed, TME Services, on 11.10.2026" for an answer TME typed; '' when not TME's. */
export function filledByLine(answer: Pick<VatCustomsLineAnswer, 'filledBy' | 'updatedAt'> | null | undefined): string {
  if (!answer?.filledBy) return '';
  const name = cleanStaffName(answer.filledBy.name);
  const date = formatDubaiDate(answer.updatedAt);
  const who = name ? `${name}, TME Services,` : 'TME Services';
  return `Filled in by ${who}${date ? ` on ${date}` : ''}`;
}

/**
 * Round 4 C, the page after a good autosave: the payload's copy of the saved
 * answers gets the replies just saved and their who / when (`meta` per line,
 * from the server). Lines not in `saved` stay as they are. Pure.
 */
export function withSavedReplyMeta(
  current: VatCustomsAnswers,
  saved: VatCustomsAnswers,
  meta: Record<string, Record<string, VatCustomsReplyMeta> | undefined>
): VatCustomsAnswers {
  const out: VatCustomsAnswers = { ...current };
  for (const [id, body] of Object.entries(saved)) {
    if (!(id in meta)) continue;
    const prev = out[id] ?? { parts: body.parts ?? [] };
    const next: VatCustomsLineAnswer = { ...prev, parts: body.parts ?? prev.parts ?? [] };
    const replies: Record<string, string> = {};
    for (const [qid, raw] of Object.entries(body.replies ?? {})) {
      const text = cleanCustomsText(raw);
      if (text) replies[qid] = text;
    }
    if (Object.keys(replies).length > 0) next.replies = replies;
    else delete next.replies;
    const m = meta[id];
    if (m && Object.keys(m).length > 0) next.replyMeta = m;
    else delete next.replyMeta;
    out[id] = next;
  }
  return out;
}

/** The demo pages (no server): the who / when the server would write for these saved lines. */
export function demoReplyMeta(
  current: VatCustomsAnswers,
  saved: VatCustomsAnswers,
  nowIso: string,
  by: string | null
): Record<string, Record<string, VatCustomsReplyMeta>> {
  const out: Record<string, Record<string, VatCustomsReplyMeta>> = {};
  for (const [id, body] of Object.entries(saved)) {
    const prev = current[id];
    const meta: Record<string, VatCustomsReplyMeta> = {};
    const typed: Record<string, string> = {};
    for (const [qid, raw] of Object.entries(body.replies ?? {})) {
      const text = cleanCustomsText(raw);
      if (text) typed[qid] = text;
    }
    // Like the server: a cleared reply keeps a meta without text.
    const ids = new Set([...Object.keys(typed), ...Object.keys(prev?.replies ?? {}), ...Object.keys(prev?.replyMeta ?? {})]);
    for (const qid of ids) {
      const text = typed[qid] ?? '';
      const was = prev?.replies?.[qid] ?? '';
      const before = prev?.replyMeta?.[qid];
      if (was === text) {
        if (before) meta[qid] = before;
      } else {
        meta[qid] = nextReplyMeta(was, before, nowIso, by);
      }
    }
    out[id] = meta;
  }
  return out;
}

/**
 * Round 4 C, the line under each reply: the saved who / when per line, but
 * only for replies whose typed text is the saved one. While the client edits
 * a reply (typed text differs from the saved text) its "Sent ... on" line is
 * left out until the autosave stores it. Lines with nothing left out keep the
 * saved object (stable for memoised rows). Pure.
 */
export function shownReplyMeta(
  saved: VatCustomsAnswers | null | undefined,
  typed: VatCustomsAnswers | null | undefined
): Record<string, Record<string, VatCustomsReplyMeta> | undefined> {
  const out: Record<string, Record<string, VatCustomsReplyMeta> | undefined> = {};
  for (const [id, a] of Object.entries(saved ?? {})) {
    const meta = a?.replyMeta;
    if (!meta) continue;
    const typedReplies = typed?.[id]?.replies;
    // Not touched on this page (no typed copy of the line): as saved.
    if (!typed?.[id]) {
      out[id] = meta;
      continue;
    }
    let kept: Record<string, VatCustomsReplyMeta> | null = null;
    for (const qid of Object.keys(meta)) {
      const now = cleanCustomsText(typedReplies?.[qid]);
      const was = a.replies?.[qid] ?? '';
      if (now !== was) kept ??= { ...meta };
      if (now !== was && kept) delete kept[qid];
    }
    out[id] = kept ?? meta;
  }
  return out;
}
