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
  VAT_CUSTOMS_MAX_NOTES_PER_QUESTION,
  VAT_CUSTOMS_MAX_PARTS,
  VAT_CUSTOMS_MAX_TEXT_CHARS,
  VAT_CUSTOMS_PAYMENT_OPTIONS,
  VAT_CUSTOMS_PURPOSE_OPTIONS,
  isVatCustomsLineComplete,
  isVatCustomsNoteId,
  isVatCustomsReplySent,
  normaliseVatFilesEmail,
  VAT_CUSTOMS_REPLY_SESSION_MINUTES,
  vatCustomsReplyBy,
  vatFilesNamedEmail,
  vatCustomsReplyVersionAt,
  type VatCustomsAnswerPart,
  type VatCustomsAnswers,
  type VatCustomsDefaults,
  type VatCustomsDocKind,
  type VatCustomsLineAnswer,
  type VatCustomsNote,
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

/**
 * Round 5: one spelling per moment. Supabase answers timestamptz columns as
 * "2026-10-11T07:13:06.207+00:00" (2 to 6 fraction digits), the code writes
 * "2026-10-11T07:13:06.207Z": never compare or hash them as text. Null when
 * missing or not a date. Pure.
 */
export function canonicalIso(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Round 5: the same moment (or both missing / not a date). Never a text compare. Pure. */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalIso(a) === canonicalIso(b);
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

/** Replies with their keys in a fixed order (texts cleaned like the server cleans them, empty ones left out): for "did it change?". */
function repliesKey(replies: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(replies ?? {})
    .map(([qid, text]): [string, string] => [qid, cleanCustomsText(text)])
    .filter(([, text]) => text.length > 0)
    .sort(([a], [b]) => Number(a) - Number(b));
}

/** Round 5 item 8: notes with text (cleaned), questions in a fixed order, each note as [id, text] in its order: for "did it change?". */
function notesKey(notes: Record<string, Array<Pick<VatCustomsNote, 'id' | 'text'>>> | undefined): Array<[string, Array<[string, string]>]> {
  return Object.entries(notes ?? {})
    .map(([qid, list]): [string, Array<[string, string]>] => [
      qid,
      (Array.isArray(list) ? list : [])
        .map((n): [string, string] => [String(n?.id), cleanCustomsText(n?.text)])
        .filter(([, text]) => text.length > 0),
    ])
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => Number(a) - Number(b));
}

/** A part for "did it change?": texts cleaned like the server cleans them, empty fields left out, fixed key order. */
function partKey(part: VatCustomsAnswerPart | null | undefined): VatCustomsAnswerPart {
  const cleaned: Record<string, unknown> = { ...(part ?? {}) };
  for (const field of TEXT_FIELDS) {
    if (typeof cleaned[field] === 'string') cleaned[field] = cleanCustomsText(cleaned[field]);
  }
  return canonicalPart(cleaned as VatCustomsAnswerPart);
}

/**
 * The content of an answer for "did it change?": parts, replies and notes,
 * texts cleaned (trimmed) like the server stores them, empty replies / notes
 * left out, and empty parts left out (an opened and emptied row, a split
 * nobody filled in: no answer). Never the stamps (updatedAt, who / when, sentKey).
 */
function answerKey(a: VatCustomsLineAnswer | null | undefined): string {
  if (!a) return JSON.stringify({ parts: [], replies: [], notes: [] });
  return JSON.stringify({
    parts: (a.parts ?? []).map(partKey).filter((p) => Object.keys(p).length > 0),
    replies: repliesKey(a.replies),
    notes: notesKey(a.notes),
  });
}

/** 11.10: answerKey for the page (its Send button compares content, never "touched"). */
export function customsAnswerContentKey(a: VatCustomsLineAnswer | null | undefined): string {
  return answerKey(a);
}

/** A 53-bit string hash (cyrb53), as 14 hex characters. Not for security: only "did it change?". */
function contentHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** 11.10: the fingerprint of a line's content, kept as `sentKey` on a Send (see VatCustomsLineAnswer.sentKey). */
export function customsSentKey(a: VatCustomsLineAnswer | null | undefined): string {
  return contentHash(answerKey(a));
}

const SENT_KEY_RE = /^[0-9a-f]{14}$/;

/**
 * 11.10: the stored lines whose content differs from what the last Send
 * carried (= the Send button has something to send). A line with `sentKey`:
 * its content now vs that fingerprint (typing and deleting back, an emptied
 * note, whitespace: not a change). A line without one: never sent since
 * sentKey exists. Then, when the row has a Send with fingerprints (some line
 * carries one) or no Send at all, the baseline is "nothing": unsent when it
 * has content. Otherwise (a Send from before sentKey) the old rule:
 * `updatedAt` later than customs_answers_sent_at. Pure.
 */
export function customsUnsentLineIds(answers: VatCustomsAnswers | null | undefined, answersSentAt: string | null | undefined): string[] {
  const all = Object.entries(answers ?? {});
  const sent = Date.parse(answersSentAt ?? '');
  const keyed = all.some(([, a]) => typeof a?.sentKey === 'string');
  const out: string[] = [];
  for (const [id, a] of all) {
    if (!a) continue;
    if (typeof a.sentKey === 'string') {
      if (customsSentKey(a) !== a.sentKey) out.push(id);
      continue;
    }
    if (Number.isNaN(sent) || keyed) {
      if (!isCustomsAnswerEmpty(a)) out.push(id);
      continue;
    }
    const at = Date.parse(a.updatedAt ?? '');
    if (!Number.isNaN(at) && at > sent) out.push(id);
  }
  return out;
}

/** 11.10: every line with the fingerprint of its content now (the Send stamps it; stamps and the rest unchanged). Pure. */
export function withCustomsSentKeys(answers: VatCustomsAnswers): VatCustomsAnswers {
  const out: VatCustomsAnswers = {};
  for (const [id, a] of Object.entries(answers)) out[id] = a ? { ...a, sentKey: customsSentKey(a) } : a;
  return out;
}

/** True when nothing at all is filled in (no option chosen, no text, no reply, no note). */
export function isCustomsAnswerEmpty(a: VatCustomsLineAnswer | null | undefined): boolean {
  if (!a) return true;
  if (repliesKey(a.replies).length > 0) return false;
  if (notesKey(a.notes).length > 0) return false;
  return (a.parts ?? []).every((p) => Object.keys(partKey(p)).length === 0);
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
  // Round 5 item 8: the notes under sent replies (with their who / when).
  const notes = readStoredNotes(r.notes);
  if (notes) out.notes = notes;
  // Round 4 C: TME typed this answer (the portal's line.answer only).
  const filledBy = readFilledBy(r.filledBy);
  if (filledBy) out.filledBy = filledBy;
  // 11.10: the content fingerprint of the last Send (server-written).
  if (typeof r.sentKey === 'string' && SENT_KEY_RE.test(r.sentKey)) out.sentKey = r.sentKey;
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
 * Round 5 item 8: the stored notes, read leniently: question id keys (at most
 * MAX_REPLIES_PER_LINE), per question at most VAT_CUSTOMS_MAX_NOTES_PER_QUESTION
 * notes with a valid unique id and a cleaned non-empty text, each with its
 * who / when (readOneReplyMeta). Undefined when none is left.
 */
function readStoredNotes(raw: unknown): Record<string, VatCustomsNote[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, VatCustomsNote[]> = {};
  let n = 0;
  for (const [qid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_REPLIES_PER_LINE) break;
    if (positiveInt(qid) === null || String(positiveInt(qid)) !== qid || !Array.isArray(value)) continue;
    const list: VatCustomsNote[] = [];
    const ids = new Set<string>();
    for (const item of value) {
      if (list.length >= VAT_CUSTOMS_MAX_NOTES_PER_QUESTION) break;
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      const text = cleanCustomsText(r.text);
      if (!isVatCustomsNoteId(r.id) || ids.has(r.id) || !text) continue;
      ids.add(r.id);
      list.push({ ...(readOneReplyMeta(r) ?? {}), id: r.id, text });
    }
    if (list.length > 0) {
      out[qid] = list;
      n++;
    }
  }
  return n > 0 ? out : undefined;
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
      /**
       * Round 5: line ids where the browser tried to change or clear a reply
       * that was already SENT (isVatCustomsReplySent): the sent text was kept,
       * never overwritten. The page loads these lines again.
       */
      lockedReplies: string[];
      /**
       * Round 5: lines refused because somebody else saved them after the page
       * loaded them (the browser's `baseUpdatedAt` differs from the stored
       * `updatedAt`, see customsLineConflict). Nothing of these lines is stored;
       * the value is the stored answer as it is now.
       */
      conflicts: Record<string, CustomsLineConflict>;
      /** Round 5: every line taken (not refused): its stored `updatedAt` after this update (null = none). The page's next base. */
      bases: Record<string, string | null>;
    }
  | { ok: false; error: CustomsAnswersError; lineId?: string };

/** Round 5: a line somebody else changed since the page loaded it. */
export interface CustomsLineConflict {
  /** The stored answer now (with `savedBy`; the route removes it before the page sees it). */
  answer: VatCustomsLineAnswer;
  /** Their save time (the stored `updatedAt`); null = unknown. */
  at: string | null;
  /** Who saved it (confirmed address); null = unknown (no email code). */
  savedBy: string | null;
}

/**
 * Round 5, the per-line conflict rule. The page sends, with every changed
 * line, the `updatedAt` it loaded that line with (`baseUpdatedAt`, null = no
 * stored answer yet). The line is refused when the stored `updatedAt` is a
 * different one AND it was saved by somebody else: another confirmed address,
 * or unknown on either side (no email code: a different stamp alone is a
 * conflict). The same confirmed person (two tabs) is no conflict: last one
 * wins, as before. A body without `baseUpdatedAt` (a page loaded before this
 * change) is never refused. Pure.
 */
export function customsLineConflict(
  base: string | null | undefined,
  stored: VatCustomsLineAnswer | null | undefined,
  viewer: string | null
): boolean {
  if (base === undefined) return false;
  if (sameInstant(base, stored?.updatedAt)) return false;
  const other = stored?.savedBy ?? null;
  return !(viewer && other && other === viewer);
}

/** A body's note list per question past this = not the page (refused as 'invalid_answer'). */
const MAX_NOTES_IN_BODY = VAT_CUSTOMS_MAX_NOTES_PER_QUESTION * 5;

/**
 * Round 5 review: the notes of questions that are no longer open that stay
 * stored: the SENT ones only. An unsent draft of such a question is hidden on
 * the page and would turn "sent" with the next Send (the portal would then
 * take it in and reopen the question), so it is removed. Pure.
 */
function keptClosedNotes(
  storedNotes: Record<string, VatCustomsNote[]>,
  open: Set<string>,
  sent: (n: VatCustomsNote) => boolean
): Record<string, VatCustomsNote[]> {
  const out: Record<string, VatCustomsNote[]> = {};
  for (const [qid, list] of Object.entries(storedNotes)) {
    if (open.has(qid)) continue;
    const kept = list.filter((n) => sent(n));
    if (kept.length > 0) out[qid] = kept;
  }
  return out;
}

/**
 * Round 5 review: on a Send, every stored line (also the ones this Send does
 * not carry) loses its unsent draft notes of questions that are no longer
 * open (see keptClosedNotes), before the Send stamp would make them "sent".
 * The line keeps its `updatedAt` (the drafts were never shown or sent).
 * Returns the new map and the ids of the lines that changed. Pure.
 */
export function dropClosedDraftNotes(
  answers: VatCustomsAnswers,
  lines: Array<Pick<VatCustomsPageLine, 'id' | 'questions'>>,
  answersSentAt: string | null | undefined
): { answers: VatCustomsAnswers; changed: string[] } {
  const out: VatCustomsAnswers = { ...answers };
  const changed: string[] = [];
  for (const line of lines) {
    const id = String(line.id);
    const a = out[id];
    if (!a?.notes) continue;
    const open = openQuestionIds(line);
    const sent = (n: VatCustomsNote) => !!answersSentAt && isVatCustomsReplySent(n, a.updatedAt, answersSentAt);
    const notes = keptClosedNotes(a.notes, open, sent);
    for (const [qid, list] of Object.entries(a.notes)) if (open.has(qid)) notes[qid] = list;
    const count = (m: Record<string, VatCustomsNote[]>) => Object.values(m).reduce((n, l) => n + l.length, 0);
    if (count(notes) === count(a.notes)) continue;
    const next: VatCustomsLineAnswer = { ...a };
    if (Object.keys(notes).length > 0) next.notes = notes;
    else delete next.notes;
    out[id] = next;
    changed.push(id);
  }
  return { answers: out, changed };
}

/**
 * Round 5 review: the Send stamp (customs_answers_sent_at): now, or the row's
 * customs_answers_saved_at when that is later (another server instance with a
 * slightly fast clock saved a draft): a draft saved before the Send must count
 * as sent (isVatCustomsReplySent: last save <= Send). Compared as instants
 * (Supabase reads "+00:00", this server writes "Z"); always an ISO "Z" string.
 * Pure.
 */
export function vatCustomsSendStamp(nowIso: string, savedAt: string | null | undefined): string {
  const now = Date.parse(nowIso);
  const saved = Date.parse(savedAt ?? '');
  if (Number.isNaN(saved) || (!Number.isNaN(now) && saved <= now)) return nowIso;
  return new Date(saved).toISOString();
}

type NotesMerge =
  | { ok: true; notes: Record<string, VatCustomsNote[]>; stale: boolean; locked: boolean }
  | { ok: false; error: CustomsAnswersError };

/**
 * Round 5 item 8, the notes of one line in an autosave / Send. `raw` = the
 * browser's `notes` ({ "<question id>": [{ id, text }] }: every note the page
 * holds for that question, sent ones may be left out). Rules:
 * - `notes` missing (a page from before notes) = the stored notes stay;
 * - SENT notes of questions that are no longer open stay as stored; their
 *   UNSENT drafts are removed (the page hides them, and a later Send would
 *   otherwise make them "sent" and reopen the question at TME); a note with
 *   text to a closed / unknown question is dropped (`stale`);
 * - a SENT note (isVatCustomsReplySent on its stamps) keeps its stored text;
 *   a different text for it is refused (`locked`); left out = kept;
 * - a draft note takes the new text; empty or left out = removed;
 * - a new note (unknown id) is taken only under a SENT reply of an open
 *   question, appended in the page's order; an empty one is ignored;
 * - at most VAT_CUSTOMS_MAX_NOTES_PER_QUESTION per question: new notes past
 *   it are left out (`stale`: the page loads the line again), the rest of
 *   the batch is taken; ids valid and unique (else 'invalid_answer').
 * Changed and new notes come back WITHOUT new stamps (stampCustomsNotes adds
 * them once the line is taken). Pure.
 */
function mergeCustomsNotes(
  raw: unknown,
  stored: VatCustomsLineAnswer | undefined,
  open: Set<string>,
  replies: Record<string, string>,
  answersSentAt: string | null
): NotesMerge {
  const storedNotes = stored?.notes ?? {};
  const sent = (n: VatCustomsReplyMeta | undefined) =>
    !!answersSentAt && isVatCustomsReplySent(n, stored?.updatedAt, answersSentAt);
  const notes = keptClosedNotes(storedNotes, open, sent);
  if (raw === undefined || raw === null) {
    for (const [qid, list] of Object.entries(storedNotes)) if (open.has(qid)) notes[qid] = list;
    return { ok: true, notes, stale: false, locked: false };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_answer' };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_REPLIES_PER_LINE) return { ok: false, error: 'invalid_answer' };
  let stale = false;
  let locked = false;
  const incoming = new Map<string, Array<{ id: string; text: string }>>();
  for (const [rawQid, rawList] of entries) {
    if (!Array.isArray(rawList)) return { ok: false, error: 'invalid_answer' };
    // Far past the limit = not this page (it never holds more than the limit plus a few).
    if (rawList.length > MAX_NOTES_IN_BODY) return { ok: false, error: 'invalid_answer' };
    const items: Array<{ id: string; text: string }> = [];
    const ids = new Set<string>();
    for (const item of rawList) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'invalid_answer' };
      const { id, text } = item as { id?: unknown; text?: unknown };
      if (!isVatCustomsNoteId(id) || ids.has(id)) return { ok: false, error: 'invalid_answer' };
      if (text !== undefined && text !== null && typeof text !== 'string') return { ok: false, error: 'invalid_answer' };
      ids.add(id);
      items.push({ id, text: cleanCustomsText(text) });
    }
    const qid = positiveInt(rawQid);
    if (!qid || !open.has(String(qid))) {
      if (items.some((i) => i.text)) stale = true;
      continue;
    }
    incoming.set(String(qid), items);
  }
  for (const qid of open) {
    const before = storedNotes[qid] ?? [];
    const typed = incoming.get(qid) ?? [];
    const typedById = new Map(typed.map((i) => [i.id, i]));
    const out: VatCustomsNote[] = [];
    for (const n of before) {
      const t = typedById.get(n.id);
      if (sent(n)) {
        if (t && t.text !== n.text) locked = true;
        out.push(n);
      } else if (t?.text) {
        out.push(t.text === n.text ? n : { id: n.id, text: t.text });
      }
    }
    // New notes only under a reply that went out with a Send (the page offers nothing else).
    const replySent = !!replies[qid] && !!stored?.replies?.[qid] && sent(stored.replyMeta?.[qid]);
    for (const t of typed) {
      if (!t.text || before.some((n) => n.id === t.id)) continue;
      if (!replySent) continue;
      // Past the limit: this new note is left out, the rest of the batch is taken; the page reloads the line.
      if (out.length >= VAT_CUSTOMS_MAX_NOTES_PER_QUESTION) {
        stale = true;
        continue;
      }
      out.push({ id: t.id, text: t.text });
    }
    if (out.length > 0) notes[qid] = out;
  }
  return { ok: true, notes, stale, locked };
}

/** Round 5 item 8: who / when per note. A note whose text is the stored one keeps its stamps; else nextReplyMeta. Pure. */
function stampCustomsNotes(
  notes: Record<string, VatCustomsNote[]>,
  before: Record<string, VatCustomsNote[]> | undefined,
  nowIso: string,
  by: string | null
): Record<string, VatCustomsNote[]> {
  const out: Record<string, VatCustomsNote[]> = {};
  for (const [qid, list] of Object.entries(notes)) {
    out[qid] = list.map((n) => {
      const was = before?.[qid]?.find((b) => b.id === n.id);
      if (was && was.text === n.text) return was;
      const { id: _id, text: _text, ...prevMeta } = was ?? { id: '', text: '' };
      void _id;
      void _text;
      return { ...nextReplyMeta(was?.text, was ? prevMeta : undefined, nowIso, by), id: n.id, text: n.text };
    });
  }
  return out;
}

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
  savedBy: string | null = null,
  opts: {
    /**
     * Round 5: the row's customs_answers_sent_at BEFORE this update. Given =
     * replies sent with it are locked (kept as stored, see lockedReplies).
     */
    answersSentAt?: string | null;
  } = {}
): CustomsAnswersUpdate {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { ok: false, error: 'invalid_answers' };
  }
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  const answers = readStoredAnswers(stored, lines);
  const changed: string[] = [];
  const staleReplies: string[] = [];
  const lockedReplies: string[] = [];
  const conflicts: Record<string, CustomsLineConflict> = {};
  const bases: Record<string, string | null> = {};

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
    // Round 5: a reply that was already SENT keeps its stored text (a
    // change or a clear of it is refused, the line named in lockedReplies).
    let locked = false;
    if (opts.answersSentAt) {
      for (const [qid, text] of Object.entries(storedReplies)) {
        if (!open.has(qid)) continue;
        if (!isVatCustomsReplySent(storedMeta[qid], answers[key]?.updatedAt, opts.answersSentAt)) continue;
        if ((replies[qid] ?? '') !== text) locked = true;
        replies[qid] = text;
      }
    }

    // Round 5 item 8: notes under a sent reply (see mergeCustomsNotes).
    const noteResult = mergeCustomsNotes(v.notes, answers[key], open, replies, opts.answersSentAt ?? null);
    if (!noteResult.ok) return { ok: false, error: noteResult.error, lineId: key };
    if (noteResult.stale) stale = true;
    if (noteResult.locked) locked = true;

    const next: VatCustomsLineAnswer = { parts };
    if (Object.keys(replies).length > 0) next.replies = replies;
    if (Object.keys(noteResult.notes).length > 0) next.notes = noteResult.notes;

    const before = answers[key];
    // 11.10 review: what the page showed for this line (mergeLineAnswer): TME's
    // newer answer replaces the parts. "Changed" is measured against THAT, so a
    // client setting a line back to their stored answer (or clearing a line TME
    // filled) over TME's newer one is written (and beats it), while agreeing
    // with TME's answer writes nothing. customsPageSavedKeys uses the same view.
    const tmeShown = portalAnswerShown(line, before);
    const shownBefore: VatCustomsLineAnswer | null | undefined = tmeShown
      ? { ...(before ?? { parts: [] }), parts: line.answer?.parts ?? [] }
      : before;
    if (answerKey(shownBefore) === answerKey(next)) {
      if (stale) staleReplies.push(key);
      if (locked) lockedReplies.push(key);
      bases[key] = before?.updatedAt ?? null;
      continue;
    }
    // Round 5: somebody else saved this line since the page loaded it: refuse it.
    const rawBase = 'baseUpdatedAt' in v ? v.baseUpdatedAt : undefined;
    const base = rawBase === undefined ? undefined : typeof rawBase === 'string' ? rawBase : null;
    if (customsLineConflict(base, before, savedBy)) {
      conflicts[key] = { answer: before ?? { parts: [] }, at: before?.updatedAt ?? null, savedBy: before?.savedBy ?? null };
      continue;
    }
    if (stale) staleReplies.push(key);
    if (locked) lockedReplies.push(key);
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
    // Round 5 item 8: who / when per note, by the reply rules (unchanged text keeps its stamps).
    if (next.notes) next.notes = stampCustomsNotes(next.notes, before?.notes, nowIso, savedBy);
    next.updatedAt = nowIso;
    if (savedBy) next.savedBy = savedBy;
    // 11.10: what the last Send carried stays known (the Send button compares with it).
    // Over TME's newer answer with other parts, the baseline is what TME holds
    // (the shown answer), so the line counts as unsent until the next Send
    // (also when the client cleared it: an empty answer with a sentKey).
    if (tmeShown && partsKey(next) !== partsKey(shownBefore)) next.sentKey = customsSentKey(shownBefore);
    else if (before?.sentKey) next.sentKey = before.sentKey;
    answers[key] = next;
    changed.push(key);
    bases[key] = nowIso;
  }
  return { ok: true, answers, changed, staleReplies, lockedReplies, conflicts, bases };
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

/** A stamp as a number for "which is newer"; missing / not a date = oldest. */
function instantOrOldest(v: string | null | undefined): number {
  const t = Date.parse(v ?? '');
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * True when the page shows the portal's `line.answer` (its parts) instead of
 * the client's saved answer: there is one, and the client has none or an
 * older one (by `updatedAt`, as instants: "Z" and "+00:00" alike; missing =
 * oldest; on a tie the client's wins). Pure.
 */
export function portalAnswerShown(
  line: Pick<VatCustomsPageLine, 'answer'>,
  client: VatCustomsLineAnswer | null | undefined
): boolean {
  const portal = line.answer ?? null;
  if (!portal) return false;
  if (!client) return true;
  return instantOrOldest(client.updatedAt) < instantOrOldest(portal.updatedAt);
}

/** The parts of an answer as a key (empty parts left out), for "did the parts change?". */
function partsKey(a: VatCustomsLineAnswer | null | undefined): string {
  return JSON.stringify((a?.parts ?? []).map(partKey).filter((p) => Object.keys(p).length > 0));
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
  const pick = portalAnswerShown(line, client) ? portal : client;
  const merged: VatCustomsLineAnswer = {
    parts: (pick?.parts ?? []).map((p) => ({ ...p })),
  };
  if (pick?.updatedAt) merged.updatedAt = pick.updatedAt;
  // Round 4 C: TME's answer is the one shown: say who typed it (dropped on the client's first change).
  if (pick && pick === portal && portal.filledBy && (portal.parts?.length ?? 0) > 0) merged.filledBy = { ...portal.filledBy };
  const replies = openReplies(line, client?.replies);
  if (replies) merged.replies = replies;
  // Round 5 item 8: the client's notes, like the replies (open questions only).
  const notes = openNotes(line, client?.notes);
  if (notes) merged.notes = notes;
  return merged;
}

/** Round 5 item 8: only the notes of the line's open questions (copied), or undefined. */
export function openNotes(
  line: Pick<VatCustomsPageLine, 'questions'>,
  notes: Record<string, VatCustomsNote[]> | undefined
): Record<string, VatCustomsNote[]> | undefined {
  const open = openQuestionIds(line);
  const out: Record<string, VatCustomsNote[]> = {};
  for (const [qid, list] of Object.entries(notes ?? {})) {
    if (open.has(qid) && Array.isArray(list) && list.length > 0) out[qid] = list.map((n) => ({ ...n }));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 11.10: per line, the content key (customsAnswerContentKey) of the answer
 * the page shows from the STORED answers: what the server holds. The page
 * compares what it shows now with this (an unsaved real change). Pure.
 */
export function customsPageSavedKeys(lines: VatCustomsPageLine[], stored: VatCustomsAnswers | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, a] of Object.entries(initialPageAnswers(lines, stored ?? {}))) out[id] = answerKey(a);
  return out;
}

/**
 * 11.10: the page's "is there anything to send?" for the answers. True when
 * a line on the page differs in content from what the server holds
 * (`savedKeys`, an unsaved real change) or the server holds a line that
 * differs from what the last Send carried (`serverUnsent`, see
 * customsUnsentLineIds). Opening and closing a note box, typing and deleting
 * back, whitespace, an empty new note: none of these count. Pure.
 */
export function customsPageHasUnsent(input: {
  lines: Array<Pick<VatCustomsPageLine, 'id'>>;
  answers: VatCustomsAnswers;
  savedKeys: Record<string, string>;
  serverUnsent: readonly string[];
}): boolean {
  const ids = new Set(input.lines.map((l) => String(l.id)));
  if (input.serverUnsent.some((id) => ids.has(id))) return true;
  return [...ids].some((id) => answerKey(input.answers[id]) !== (input.savedKeys[id] ?? answerKey(null)));
}

/**
 * 11.10: of the lines the page marked as changed, the ones to save: content
 * differs from what the server holds (`savedKeys`). `always` = lines saved
 * anyway (an earlier save got no answer and may have stored something else).
 * A batch that is left empty writes nothing. Pure.
 */
export function customsLinesToSave(
  ids: Iterable<string>,
  answers: VatCustomsAnswers,
  savedKeys: Record<string, string>,
  always: ReadonlySet<string> = new Set()
): string[] {
  return [...ids].filter((id) => always.has(id) || answerKey(answers[id]) !== (savedKeys[id] ?? answerKey(null)));
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
    deliveryPlace: p.delivery === 'other' ? p.deliveryPlace : undefined,
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

/**
 * Round 5 review: a save whose answer never came back (offline, timeout,
 * 5xx) may still have been stored. True when the stored answer of the line
 * is exactly what that save carried (`sent`: parts + replies as the page sent
 * them; compared as the server stores them: cleaned texts, replies to the
 * line's open questions only). Then the stored `updatedAt` is this page's own
 * stamp, and the next save builds on it instead of conflicting with itself.
 * Pure.
 */
export function customsLineSavedAs(
  line: Pick<VatCustomsPageLine, 'questions'>,
  sent: Pick<VatCustomsLineAnswer, 'parts' | 'replies' | 'notes'> | null | undefined,
  stored: VatCustomsLineAnswer | null | undefined
): boolean {
  if (!sent || !stored) return false;
  const parts: VatCustomsAnswerPart[] = [];
  for (const p of sent.parts ?? []) {
    const checked = sanitizeCustomsPart(p);
    if (!checked.ok) return false;
    parts.push(checked.part);
  }
  const cleaned: Record<string, string> = {};
  for (const [qid, text] of Object.entries(sent.replies ?? {})) {
    const clean = cleanCustomsText(text);
    if (clean) cleaned[qid] = clean;
  }
  const sentNotes: Record<string, VatCustomsNote[]> = {};
  for (const [qid, list] of Object.entries(sent.notes ?? {})) {
    sentNotes[qid] = (list ?? []).map((n) => ({ id: n.id, text: cleanCustomsText(n.text) }));
  }
  // Notes: only when the save carried them (a sent note left out stays stored).
  const notesSame =
    sent.notes === undefined ||
    JSON.stringify(notesKey(openNotes(line, sentNotes))) ===
      JSON.stringify(notesKey(openNotes(line, stored.notes)));
  return (
    notesSame &&
    answerKey({ parts, replies: openReplies(line, cleaned) }) ===
      answerKey({ parts: stored.parts ?? [], replies: openReplies(line, stored.replies) })
  );
}

/**
 * Round 5 review: the server refused to change replies (and notes) that were
 * already SENT (lockedReplies). The text this person typed for them, per line
 * id then key (the question id for a reply, refusedNoteKey for a note), so
 * the page can show it ("Your text was not saved: ...") with a Copy button
 * instead of throwing it away. Only typed texts that differ from the sent
 * one; an emptied reply / note is not kept. Pure.
 */
export function refusedReplyTexts(
  lockedIds: readonly string[],
  typed: Record<string, Pick<VatCustomsLineAnswer, 'replies'> & { notes?: Record<string, Array<Pick<VatCustomsNote, 'id' | 'text'>>> } | undefined>,
  saved: VatCustomsAnswers | null | undefined,
  answersSentAt: string | null | undefined
): Record<string, Record<string, string>> {
  const sent = sentRepliesByLine(saved, answersSentAt);
  const out: Record<string, Record<string, string>> = {};
  for (const id of lockedIds) {
    for (const [qid, raw] of Object.entries(typed[id]?.replies ?? {})) {
      const text = cleanCustomsText(raw);
      const was = sent[id]?.[qid];
      if (!text || was === undefined || text === was) continue;
      (out[id] ??= {})[qid] = text;
    }
    // Notes: a note the other tab already sent (two tabs), typed differently here.
    const line = saved?.[id];
    if (!answersSentAt || !line) continue;
    for (const [qid, list] of Object.entries(typed[id]?.notes ?? {})) {
      for (const n of Array.isArray(list) ? list : []) {
        const text = cleanCustomsText(n?.text);
        const was = line.notes?.[qid]?.find((s) => s.id === n?.id);
        if (!text || !was || text === was.text) continue;
        if (!isVatCustomsReplySent(was, line.updatedAt, answersSentAt)) continue;
        (out[id] ??= {})[refusedNoteKey(qid, was.id)] = text;
      }
    }
  }
  return out;
}

/** Round 5 review: the key of a refused NOTE text in refusedReplyTexts (a reply uses the bare question id). */
export function refusedNoteKey(questionId: string, noteId: string): string {
  return `${questionId}#${noteId}`;
}

/** Round 5 review: true when a refusedReplyTexts key is a note's (refusedNoteKey), not a reply's. */
export function isRefusedNoteKey(key: string): boolean {
  return key.includes('#');
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
      // Round 5 item 8: typed notes of open questions stay (the fresh sent ones come from the server copy).
      const notes = openNotes(line, typed.notes);
      if (notes) kept.notes = notes;
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
 * The line under a reply: "Sent by b.klingler@star.de.com on 11.10.2026 13:09"
 * ("Sent by Bernd Klingler (b.klingler@star.de.com) on ..." with `names`),
 * after a later change "Changed by ... on ...", without an address "Sent on
 * ...". Time = the last save of the current text (Dubai). '' when unknown.
 */
export function replyWhoLine(
  meta: VatCustomsReplyMeta | null | undefined,
  names?: Record<string, string> | null
): string {
  if (!meta) return '';
  const at = formatDubaiDateTime(meta.savedAt || meta.changedAt || meta.sentAt);
  if (!at) return '';
  const changed = !!meta.changedAt;
  const by = vatCustomsReplyBy(meta);
  // Round 4 D: "Sent by Bernd Klingler (b.klingler@star.de) on ..." when the contact's name is known.
  return `${changed ? 'Changed' : 'Sent'}${by ? ` by ${vatFilesNamedEmail(by, names)}` : ''} on ${at}`;
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
  meta: Record<string, Record<string, VatCustomsReplyMeta> | undefined>,
  /** Round 5 item 8: the stored notes of the saved lines (from the server); missing = the line's notes stay. */
  notes?: Record<string, Record<string, VatCustomsNote[]> | undefined>
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
    if (notes && id in notes) {
      const n = notes[id];
      if (n && Object.keys(n).length > 0) next.notes = n;
      else delete next.notes;
    }
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
 * Round 5 item 8, the demo pages (no server): the notes the server would
 * store for these saved lines (same rules as applyCustomsAnswersUpdate; no
 * conflict check). Lines it would refuse keep their notes. Pure.
 */
export function demoNotes(
  current: VatCustomsAnswers,
  saved: Record<string, VatCustomsLineAnswer>,
  lines: VatCustomsPageLine[],
  nowIso: string,
  by: string | null,
  answersSentAt: string | null
): Record<string, Record<string, VatCustomsNote[]>> {
  const body: Record<string, unknown> = {};
  for (const [id, a] of Object.entries(saved)) {
    const { baseUpdatedAt: _b, ...rest } = a as VatCustomsLineAnswer & { baseUpdatedAt?: unknown };
    void _b;
    body[id] = rest;
  }
  const r = applyCustomsAnswersUpdate(current, body, lines, nowIso, by, { answersSentAt });
  const out: Record<string, Record<string, VatCustomsNote[]>> = {};
  if (!r.ok) return out;
  for (const id of Object.keys(saved)) out[id] = r.answers[id]?.notes ?? {};
  return out;
}

/** Round 5 item 8: one note as the page shows it (shownCustomsNotes). */
export interface ShownCustomsNote {
  id: string;
  text: string;
  sent: boolean;
  meta: VatCustomsReplyMeta | undefined;
}

/**
 * Round 5 item 8: what the page shows under a sent reply for one question.
 * First the SENT notes as stored (read-only, in order), then every other note
 * the person holds on the page (drafts, also new ones not saved yet) in the
 * page's order. `meta` = the stored who / when, only while the typed text is
 * the stored one (as shownReplyMeta). Pure.
 */
export function shownCustomsNotes(
  typed: ReadonlyArray<Pick<VatCustomsNote, 'id' | 'text'>> | undefined,
  saved: ReadonlyArray<VatCustomsNote> | undefined,
  savedLineUpdatedAt: string | null | undefined,
  answersSentAt: string | null | undefined
): ShownCustomsNote[] {
  const out: ShownCustomsNote[] = [];
  const sentIds = new Set<string>();
  for (const n of saved ?? []) {
    if (!answersSentAt || !isVatCustomsReplySent(n, savedLineUpdatedAt, answersSentAt)) continue;
    sentIds.add(n.id);
    out.push({ id: n.id, text: n.text, sent: true, meta: n });
  }
  for (const t of typed ?? []) {
    if (sentIds.has(t.id)) continue;
    const s = (saved ?? []).find((n) => n.id === t.id);
    out.push({ id: t.id, text: t.text ?? '', sent: false, meta: s && s.text === cleanCustomsText(t.text) ? s : undefined });
  }
  return out;
}

/** Round 5 item 8: a new note id for the page (unique enough per question; isVatCustomsNoteId). */
export function newCustomsNoteId(now: number = Date.now(), random: () => number = Math.random): string {
  return `n${now.toString(36)}${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
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

// ------------------------------------------------------------------
// Round 5: sent replies are read-only; two people on one page
// ------------------------------------------------------------------

/**
 * The replies the page shows as SENT (read-only), per line id then question
 * id, with the saved text: from the server's copy of the answers and the
 * row's last Send (isVatCustomsReplySent). Only replies with text. Pure.
 */
export function sentRepliesByLine(
  saved: VatCustomsAnswers | null | undefined,
  answersSentAt: string | null | undefined
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!answersSentAt) return out;
  for (const [id, a] of Object.entries(saved ?? {})) {
    for (const [qid, raw] of Object.entries(a?.replies ?? {})) {
      const text = cleanCustomsText(raw);
      if (!text || !isVatCustomsReplySent(a.replyMeta?.[qid], a.updatedAt, answersSentAt)) continue;
      (out[id] ??= {})[qid] = text;
    }
  }
  return out;
}

/**
 * The line under a reply. Sent: "Sent by Anna Keller (anna@x.com) on
 * 11.10.2026 13:09" (no address: "Sent on ..."; no stamp: the row's Send
 * time `fallbackAt`). Not sent yet: "Saved by ... on ... Not sent yet."
 * ("Changed by ..." when someone changed it later). '' when unknown.
 */
export function replyStatusLine(
  meta: VatCustomsReplyMeta | null | undefined,
  names: Record<string, string> | null | undefined,
  sent: boolean,
  fallbackAt?: string | null
): string {
  const at = formatDubaiDateTime(meta?.savedAt || meta?.changedAt || meta?.sentAt || (sent ? fallbackAt : null));
  if (!at) return '';
  const by = vatCustomsReplyBy(meta);
  const who = by ? ` by ${vatFilesNamedEmail(by, names)}` : '';
  if (sent) return `Sent${who} on ${at}`;
  return `${meta?.changedAt ? 'Changed' : 'Saved'}${who} on ${at}. Not sent yet.`;
}

const PURPOSE_LABELS = new Map<string, string>(VAT_CUSTOMS_PURPOSE_OPTIONS.map((o) => [o.value, o.label]));
const PAYMENT_LABELS = new Map<string, string>(VAT_CUSTOMS_PAYMENT_OPTIONS.map((o) => [o.value, o.label]));
const DELIVERY_LABELS = new Map<string, string>(VAT_CUSTOMS_DELIVERY_OPTIONS.map((o) => [o.value, o.label]));

/** One part in a few words: "For sale / stock / trading, Paid, CIF, Other location (Milan)". */
function describeAnswerPart(p: VatCustomsAnswerPart): string {
  const bits: string[] = [];
  if (p.invoiceRef) bits.push(`Invoice ${p.invoiceRef}`);
  if (p.purpose) bits.push(p.purpose === 'other' ? `Other: ${p.purposeOther ?? ''}`.trim() : PURPOSE_LABELS.get(p.purpose) ?? '');
  if (p.payment) bits.push(p.payment === 'other' ? `Other: ${p.paymentOther ?? ''}`.trim() : PAYMENT_LABELS.get(p.payment) ?? '');
  if (p.incoterm) {
    bits.push(p.incoterm === 'other' ? `Other: ${p.incotermOther ?? ''}`.trim() : p.incoterm === 'not_stated' ? 'No Incoterm' : p.incoterm);
  }
  if (p.delivery) {
    const label = (DELIVERY_LABELS.get(p.delivery) ?? '').replace(/\s*\([^)]*\)\s*$/, '');
    bits.push(p.deliveryPlace ? `${label} (${p.deliveryPlace})` : label);
  }
  if (p.comment) bits.push(`Comment: ${p.comment}`);
  return bits.filter(Boolean).join(', ');
}

/**
 * Round 5, the conflict note: what the client had typed on a line, in one
 * short line ("Nothing filled in" when empty), at most 300 characters. Pure.
 */
export function describeLineAnswer(answer: VatCustomsLineAnswer | null | undefined): string {
  const parts = (answer?.parts ?? []).map(describeAnswerPart).filter(Boolean);
  const replies = Object.values(answer?.replies ?? {})
    .map((t) => cleanCustomsText(t))
    .filter(Boolean)
    .map((t) => `Reply: "${t}"`);
  const notes = Object.values(answer?.notes ?? {})
    .flat()
    .map((n) => cleanCustomsText(n?.text))
    .filter(Boolean)
    .map((t) => `Note: "${t}"`);
  const text = [...parts, ...replies, ...notes].join(' | ');
  if (!text) return 'Nothing filled in';
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}
