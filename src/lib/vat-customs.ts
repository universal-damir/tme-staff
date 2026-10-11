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
  type VatCustomsAnswerPart,
  type VatCustomsAnswers,
  type VatCustomsDefaults,
  type VatCustomsDocKind,
  type VatCustomsLineAnswer,
  type VatCustomsPageLine,
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
      questions.push({ id: qid, text: qtext, askedAt: typeof qr.askedAt === 'string' ? qr.askedAt : '' });
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
      /** Line ids (keys) whose answer really changed; each got `updatedAt = nowIso`. */
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
    // Stored replies to questions that are no longer open stay untouched.
    for (const [qid, text] of Object.entries(answers[key]?.replies ?? {})) {
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
