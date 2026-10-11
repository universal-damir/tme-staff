/**
 * VAT filing upload link: the pure parts (no Supabase), shared by the API
 * routes, the page and the tests.
 *
 * The portal sends the client a customs request or a files request with a
 * link `/vat-files/{token}`. The client downloads the FTA import list
 * (customs), uploads files, adds an optional comment and presses Send. Each
 * Send appends the files to the row's `files`; the portal pulls them in.
 */

import {
  VAT_FILES_ALLOWED_EXTENSIONS,
  VAT_FILES_MAX_COMMENT_CHARS,
  VAT_FILES_MAX_FILE_BYTES,
  VAT_FILES_MAX_FILES_PER_SEND,
  vatFileExtension,
  vatFileNameFromPath,
  vatFileStoragePath,
  normaliseVatFilesEmail,
  readVatAllowedNames,
  type VatFileEntry,
  type VatFileRequestRow,
  type VatCustomsAnswers,
  type VatCustomsDocKind,
  type VatCustomsLineAnswer,
  type VatFilesPagePayload,
} from '@/types/vat-files';
import {
  buildLineFiles,
  canonicalIso,
  isVatCustomsDocKind,
  mergeLineAnswer,
  readDefaults,
  readStoredAnswers,
  sameInstant,
  sanitizePageLines,
} from './vat-customs';

// ------------------------------------------------------------------
// Limits (the shared ones live in the mirrored types file)
// ------------------------------------------------------------------

/** Largest single file. Files over ~4 MB travel by direct upload (lib/direct-upload.ts). */
export const VAT_FILES_MAX_BYTES = VAT_FILES_MAX_FILE_BYTES;
/** Files in one Send. */
export const VAT_FILES_MAX_PER_ROUND = VAT_FILES_MAX_FILES_PER_SEND;
/** Files on one link over all rounds (tme-staff only: keeps the jsonb bounded). */
export const VAT_FILES_MAX_TOTAL = 300;
/**
 * Objects one link's folder may hold, sent or not (+ the FTA import list): a
 * new upload is refused above this, so unsent uploads cannot fill the bucket.
 */
export const VAT_FILES_MAX_STORED = VAT_FILES_MAX_TOTAL + 50;
/** Characters in the optional comment. */
export const VAT_FILES_MAX_COMMENT = VAT_FILES_MAX_COMMENT_CHARS;

/**
 * Link tokens are minted by the portal (32 random bytes, base64url = 43
 * characters). Accept any long url-safe string; nothing else ever reaches
 * Supabase or a storage path.
 */
export const VAT_FILES_TOKEN_REGEX = /^[A-Za-z0-9_-]{20,128}$/;

export function isValidVatFilesToken(token: string): boolean {
  return VAT_FILES_TOKEN_REGEX.test(token);
}

/** The environment value becomes the first path segment, so it must be plain. */
const ENVIRONMENT_REGEX = /^[a-z0-9_-]{1,40}$/i;

export function isSafeEnvironment(env: unknown): env is string {
  return typeof env === 'string' && ENVIRONMENT_REGEX.test(env);
}

// ------------------------------------------------------------------
// File types: the magic bytes decide, the extension picks within a family
// ------------------------------------------------------------------

export interface VatFileType {
  ext: string;
  mime: string;
}

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.msg': 'application/vnd.ms-outlook',
  '.csv': 'text/csv',
  '.eml': 'message/rfc822',
};

const ZIP_EXTS = new Set(['.xlsx', '.docx']);
const OLE_EXTS = new Set(['.xls', '.msg']);
const TEXT_EXTS = new Set(['.csv', '.eml']);
const JPEG_EXTS = new Set(['.jpg', '.jpeg']);

/** For the file picker: exactly the extensions the portal stores. */
export const VAT_FILES_ACCEPT = VAT_FILES_ALLOWED_EXTENSIONS.join(',');

export function isAcceptedExtension(name: string): boolean {
  const ext = vatFileExtension(name);
  return VAT_FILES_ALLOWED_EXTENSIONS.includes(ext) && ext in EXT_MIME;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** Plain text: a BOM, or no NUL byte in the first 8 KB. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return true; // UTF-8 BOM
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true; // UTF-16 (Excel "Unicode text")
  const head = bytes.subarray(0, 8192);
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return false;
  return head.length > 0;
}

/**
 * The file type from its first bytes, checked against the extension the
 * client gave. Null = not a file we accept (or the name lies about it).
 */
export function detectVatFile(bytes: Uint8Array, filename: string): VatFileType | null {
  if (!isAcceptedExtension(filename) || bytes.length < 4) return null;
  const ext = vatFileExtension(filename);
  const ok = (): VatFileType => ({ ext, mime: EXT_MIME[ext] });

  if (ext === '.pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? ok() : null;
  if (JPEG_EXTS.has(ext)) return startsWith(bytes, [0xff, 0xd8, 0xff]) ? ok() : null;
  if (ext === '.png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? ok() : null;
  if (ZIP_EXTS.has(ext)) return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ? ok() : null;
  if (OLE_EXTS.has(ext)) {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) ? ok() : null;
  }
  if (TEXT_EXTS.has(ext)) return looksLikeText(bytes) ? ok() : null;
  return null;
}

// ------------------------------------------------------------------
// Names and paths
// ------------------------------------------------------------------

/** The last segment of a name that may carry a folder (`C:\\x\\y.pdf`, `../y.pdf`). */
function baseName(name: string): string {
  const parts = String(name).split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/** The name shown to people: letters of any script, digits, . - _ ( ) and space. */
export function displayFileName(name: string): string {
  const cleaned = baseName(name)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}.\-_ ()]/gu, '_')
    .trim();
  return (cleaned || 'file').slice(0, 200);
}

/** Folder of one link in the bucket. */
export function linkFolder(environment: string, token: string): string {
  return `${environment}/${token}`;
}

/**
 * `{environment}/{token}/{uuid}-{safeName}` through the shared
 * vatFileStoragePath. The portal's sync skips any path with `..` in it, so a
 * name like `Invoice..pdf` (or a long name cut right after a dot) is made
 * plain first; it would otherwise be stored but never imported.
 */
export function buildStoragePath(environment: string, token: string, uuid: string, originalName: string): string {
  const path = vatFileStoragePath(environment, token, uuid, String(originalName).replace(/\.{2,}/g, '.'));
  if (!path.includes('..')) return path;
  return vatFileStoragePath(environment, token, uuid, `file${vatFileExtension(originalName)}`);
}

const STORED_NAME_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$/;

/**
 * True when `path` is a final upload path of THIS link (the shape
 * vatFileStoragePath makes). Anything else, e.g. another link's folder, a
 * sub folder or the `_incoming/` copies, is refused.
 */
export function isUploadPathForLink(path: unknown, environment: string, token: string): path is string {
  if (typeof path !== 'string') return false;
  const prefix = `${linkFolder(environment, token)}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  // No `..` anywhere: the portal's sync refuses such paths.
  return STORED_NAME_REGEX.test(rest) && !rest.includes('..');
}

// ------------------------------------------------------------------
// Access
// ------------------------------------------------------------------

export type VatFilesAccessFailure = 'invalid_token' | 'not_found' | 'expired' | 'closed';

export interface VatFilesAccessResult {
  ok: boolean;
  reason?: VatFilesAccessFailure;
  status?: number;
  row?: VatFileRequestRow;
}

/**
 * Pure access decision for a found row. Expired = 410 'expired' (the page
 * shows "link not valid"). Closed = 410 'closed' on writes; reads pass
 * `allowClosed` so the page can show "this request is closed".
 */
export function decideVatFilesAccess(
  row: VatFileRequestRow,
  opts: { allowClosed?: boolean } = {},
  now: number = Date.now()
): VatFilesAccessResult {
  if (row.expires_at && new Date(row.expires_at).getTime() < now) {
    return { ok: false, reason: 'expired', status: 410, row };
  }
  if (!isSafeEnvironment(row.environment)) {
    // A row we cannot build a safe path for is treated as missing.
    return { ok: false, reason: 'not_found', status: 404 };
  }
  if (row.status !== 'open') {
    if (opts.allowClosed && row.status === 'closed') return { ok: true, row };
    return { ok: false, reason: 'closed', status: 410, row };
  }
  return { ok: true, row };
}

// ------------------------------------------------------------------
// What the browser may see
// ------------------------------------------------------------------

/** One file already received, as the page lists it. */
export type VatFilesReceivedFile = VatFilesPagePayload['files'][number];

/**
 * Row -> page data (the shared VatFilesPagePayload). Never the row id, token,
 * environment, storage paths or the portal filing id. The FTA import list
 * may come with a files request too (non-accounting client, "include customs
 * import request"), so it is offered whenever the row has one.
 */
export function scrubVatFilesRow(row: VatFileRequestRow, now: number = Date.now()): VatFilesPagePayload {
  const items = Array.isArray(row.requested_items)
    ? row.requested_items.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
  const files = Array.isArray(row.files) ? row.files : [];
  // Round 3 columns: missing (older Supabase schema, or a row without a
  // customs table) = no table.
  const customsLines = sanitizePageLines(row.customs_lines);
  return {
    companyCode: row.company_code ?? null,
    companyName: row.company_name ?? null,
    periodKey: row.period_key ?? '',
    periodLabel: row.period_label ?? null,
    kind: row.kind === 'customs' ? 'customs' : 'files',
    requestedItems: items,
    deadline: row.deadline ?? null,
    hasCustomsList: !!row.customs_list_path,
    customsListName: row.customs_list_path ? vatFileNameFromPath(row.customs_list_path) : null,
    status: row.status === 'open' ? 'open' : 'closed',
    expired: !!row.expires_at && new Date(row.expires_at).getTime() < now,
    files: files.map((f) => ({
      name: String(f?.name ?? 'file'),
      size: Number(f?.size) || 0,
      uploadedAt: String(f?.uploadedAt ?? ''),
    })),
    clientComment: row.client_comment ?? null,
    customsLines,
    customsAnswers: withoutSavedBy(readStoredAnswers(row.customs_answers, customsLines)),
    customsDefaults: customsLines.length > 0 ? readDefaults(row.customs_defaults) : null,
    // Round 5: one spelling (Supabase reads "+00:00", a Send writes "Z").
    customsAnswersSentAt: canonicalIso(row.customs_answers_sent_at),
    lineFiles: buildLineFiles(files, customsLines),
  };
}

/**
 * Round 4 D: the names the page may show next to an email, from the row's
 * allowed_names (portal-written). Only for addresses the payload already
 * names (the viewer, who sent / changed a reply), never the whole list, and
 * only for a viewer who confirmed an address with the code (no viewer = no
 * names, so a visitor without a code learns nothing new). Looked up at every
 * load, so older stamps get the name too. Pure.
 */
export function vatFilesPeopleNames(
  allowedNames: unknown,
  payload: Pick<VatFilesPagePayload, 'customsAnswers'>,
  viewerEmail: string | null | undefined
): Record<string, string> {
  const viewer = normaliseVatFilesEmail(viewerEmail);
  if (!viewer) return {};
  const names = readVatAllowedNames(allowedNames);
  const shown = new Set<string>([viewer]);
  for (const a of Object.values(payload.customsAnswers ?? {})) {
    // Round 5 item 8: who wrote a note is named like who sent a reply.
    const metas = [...Object.values(a?.replyMeta ?? {}), ...Object.values(a?.notes ?? {}).flat()];
    for (const m of metas) {
      for (const e of [m?.sentBy, m?.changedBy]) {
        const key = normaliseVatFilesEmail(e);
        if (key) shown.add(key);
      }
    }
  }
  const out: Record<string, string> = {};
  for (const e of shown) if (names[e]) out[e] = names[e];
  return out;
}

/**
 * The page data for a viewer: the scrubbed row plus `viewerEmail` and
 * `peopleNames` (vatFilesPeopleNames: names only for a code-confirmed viewer,
 * only the viewer and reply authors). Every route whose answer replaces the
 * page data (GET, Send) builds it here, so "Sent by Name (email)" and
 * "Confirmed as ..." survive a Send. Pure.
 */
export function vatFilesViewerPayload(
  row: VatFileRequestRow,
  viewerEmail: string | null | undefined,
  now: number = Date.now()
): VatFilesPagePayload {
  const payload = scrubVatFilesRow(row, now);
  const email = viewerEmail ?? null;
  return {
    ...payload,
    viewerEmail: email,
    peopleNames: vatFilesPeopleNames(row.allowed_names, payload, email),
    // Round 5: for the "changed by someone else?" check.
    version: vatFilesPageVersion(payload),
    clientChangedAt: vatFilesLastClientChange(row).at,
  };
}

// ------------------------------------------------------------------
// Round 5: two people on one page
// ------------------------------------------------------------------

/** An ISO timestamp, in any spelling ("Z" or "+00:00", any number of fraction digits). */
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * JSON with object keys sorted (jsonb re-orders keys, so the same data must
 * give the same text) and every timestamp in one spelling (canonicalIso), so
 * a "+00:00" read and a "Z" write of the same moment hash alike.
 */
function stableJson(value: unknown): string {
  if (typeof value === 'string' && ISO_STAMP.test(value)) return JSON.stringify(canonicalIso(value) ?? value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A 53-bit string hash (cyrb53), as 14 hex characters. Not for security: only "did it change?". */
function hash53(text: string): string {
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

/**
 * Round 5: the fingerprint of what the page shows and what a second person
 * could change under the client's hands: status, the client answers (with
 * who / when per reply), the last Send, per line the open questions and the
 * answer the page shows (TME's answer when it is the newer one), and the
 * number of files. NOT the portal's ticks or stamps: the portal re-writes the
 * lines after every sync, which alone must not say "TME updated the table".
 * Viewer-independent. Pure.
 */
export function vatFilesPageVersion(
  payload: Pick<VatFilesPagePayload, 'status' | 'customsLines' | 'customsAnswers' | 'customsAnswersSentAt' | 'files'>
): string {
  const answers = payload.customsAnswers ?? {};
  const shown = {
    s: payload.status,
    a: answers,
    t: canonicalIso(payload.customsAnswersSentAt),
    l: (payload.customsLines ?? []).map((l) => {
      const merged = mergeLineAnswer(l, answers[String(l.id)]);
      return [l.id, (l.questions ?? []).map((q) => [q.id, q.text]), merged.parts, merged.filledBy ? 1 : 0];
    }),
    f: (payload.files ?? []).length,
  };
  return hash53(stableJson(shown));
}

/**
 * Round 5: the last change the CLIENT side made (autosave or Send) and who:
 * the later of customs_answers_saved_at (who = savedBy of the line saved
 * then) and last_submitted_at (who = last_submitted_by). Pure.
 */
export function vatFilesLastClientChange(row: VatFileRequestRow): { at: string | null; by: string | null } {
  // One spelling (canonicalIso): Supabase reads "+00:00", the line stamps are "Z".
  const savedAt = canonicalIso(row.customs_answers_saved_at);
  const sentAt = canonicalIso(row.last_submitted_at);
  const t = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  if (!savedAt && !sentAt) return { at: null, by: null };
  if (sentAt && t(sentAt) >= t(savedAt)) {
    return { at: sentAt, by: normaliseVatFilesEmail(row.last_submitted_by) };
  }
  let by: string | null = null;
  const raw = row.customs_answers;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const a of Object.values(raw as Record<string, { updatedAt?: unknown; savedBy?: unknown }>)) {
      if (a && typeof a.updatedAt === 'string' && sameInstant(a.updatedAt, savedAt)) {
        by = normaliseVatFilesEmail(a.savedBy);
        if (by) break;
      }
    }
  }
  return { at: savedAt, by };
}

/** Round 5: what the "changed by someone else?" check answers (GET /version, and a save that saw a change). */
export interface VatFilesChangeInfo {
  /** vatFilesPageVersion of the row now. */
  version: string;
  status: 'open' | 'closed';
  /** 'client' = a save / Send on the page after `since`; 'tme' = the portal (questions, lines, closed). */
  source: 'client' | 'tme';
  /** When (server time); null = unknown. */
  at: string | null;
  /** Who (confirmed address), ONLY for a code-confirmed viewer; null otherwise. */
  by: string | null;
  /** That person's contact name (allowed_names), only with `by`; null = none known. */
  byName: string | null;
  /** The viewer's own address saved it (another tab or device of the same person). */
  self: boolean;
  /** The last client change (server time): the page's next `since`. */
  clientChangedAt: string | null;
}

/**
 * Round 5: describe the row's latest change for a viewer. `since` = the last
 * client change the page knows (its payload's clientChangedAt, or its own
 * last save): a client change after it is "someone on the client side",
 * otherwise it was TME. Names follow vatFilesPeopleNames: only for a viewer
 * who confirmed an address with the code; without the code no address and
 * no name ("Someone else"). Pure.
 */
export function vatFilesChangeInfo(
  row: VatFileRequestRow,
  viewerEmail: string | null | undefined,
  since: string | null | undefined,
  now: number = Date.now()
): VatFilesChangeInfo {
  const payload = scrubVatFilesRow(row, now);
  const viewer = normaliseVatFilesEmail(viewerEmail);
  const last = vatFilesLastClientChange(row);
  const sinceAt = Date.parse(since ?? '');
  const lastAt = Date.parse(last.at ?? '');
  const byClient = !Number.isNaN(lastAt) && (Number.isNaN(sinceAt) || lastAt > sinceAt);
  const by = byClient && viewer ? last.by : null;
  const name = by ? readVatAllowedNames(row.allowed_names)[by] ?? null : null;
  return {
    version: vatFilesPageVersion(payload),
    status: payload.status,
    source: byClient ? 'client' : 'tme',
    at: byClient ? last.at : canonicalIso(row.updated_at),
    by,
    byName: name,
    self: !!by && by === viewer,
    clientChangedAt: last.at,
  };
}

/**
 * 11.10 review: what the page does after a Send (no conflicts) from what the
 * SERVER did, never from what the page expected. `answersSent` = the server
 * stamped the answers (its `answersSent`); `filesSent` = files it took.
 * Something went out = the "thank you" page, saying answers only when they
 * were stamped. Nothing went out = stay on the table (the page has taken the
 * stored lines again) with a short note: the locked note when a sent reply
 * was refused, otherwise "Nothing new to send.". Pure.
 */
export function vatFilesSendResult(input: {
  answersSent: boolean;
  filesSent: number;
  locked: boolean;
}): { stay: false; answersSent: boolean } | { stay: true; reason: 'locked' | 'nothing_new'; message: string | null } {
  if (input.answersSent || input.filesSent > 0) return { stay: false, answersSent: input.answersSent };
  // The locked note itself is shown by the page (setNotice); no second message.
  if (input.locked) return { stay: true, reason: 'locked', message: null };
  return { stay: true, reason: 'nothing_new', message: 'Nothing new to send.' };
}

/**
 * Round 5, the page's decision: show "X changed the table at 17:10" or not.
 * Nothing when the version is the one the page shows, or one its own saves
 * produced. A request TME closed always shows. Text names the person only
 * when the server gave a name / address (code-confirmed viewers). Pure.
 */
export function vatFilesChangeNotice(input: {
  knownVersion: string | null | undefined;
  ownVersions?: readonly string[];
  pageStatus: 'open' | 'closed';
  change: Pick<VatFilesChangeInfo, 'version' | 'status' | 'source' | 'at' | 'by' | 'byName' | 'self'>;
}): string | null {
  const { change } = input;
  const time = formatChangeTime(change.at);
  const at = time ? ` at ${time}` : '';
  if (input.pageStatus === 'open' && change.status === 'closed') return `TME closed this request${at}.`;
  if (!change.version || !input.knownVersion) return null;
  if (change.version === input.knownVersion || (input.ownVersions ?? []).includes(change.version)) return null;
  if (change.source === 'tme') return `TME updated the table${at}.`;
  if (change.self) return `You changed the table in another window${at}.`;
  const who = change.byName || change.by || 'Someone else';
  return `${who} changed the table${at}.`;
}

/** 'hh:mm' Dubai time ('' when unknown); the page's other times use Dubai time too. */
function formatChangeTime(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
}

/** Round 5: a refused line as the page gets it. */
export interface VatFilesPageConflict {
  /** The stored answer now (never `savedBy`). */
  answer: VatCustomsLineAnswer;
  at: string | null;
  /** Who saved it, ONLY for a code-confirmed viewer; null otherwise. */
  by: string | null;
  byName: string | null;
}

/**
 * Round 5: the conflicts of a save, for the page. `savedBy` is never sent;
 * who saved it (address + contact name) only to a code-confirmed viewer, as
 * vatFilesPeopleNames. Pure.
 */
export function vatFilesConflictsForPage(
  conflicts: Record<string, { answer: VatCustomsLineAnswer; at: string | null; savedBy: string | null }>,
  viewerEmail: string | null | undefined,
  allowedNames: unknown
): Record<string, VatFilesPageConflict> {
  const viewer = normaliseVatFilesEmail(viewerEmail);
  const names = viewer ? readVatAllowedNames(allowedNames) : {};
  const out: Record<string, VatFilesPageConflict> = {};
  for (const [id, c] of Object.entries(conflicts)) {
    const { savedBy: _by, ...answer } = c.answer;
    void _by;
    const by = viewer ? normaliseVatFilesEmail(c.savedBy) : null;
    out[id] = { answer, at: c.at, by, byName: by ? names[by] ?? null : null };
  }
  return out;
}

/**
 * Round 4 B: who saved a line stays on the server. Round 4 C: the who / when
 * per REPLY (replyMeta) does go to the page: Damir 11.10, the line under each
 * reply names the confirmed address that sent it.
 */
function withoutSavedBy(answers: VatCustomsAnswers): VatCustomsAnswers {
  const out: VatCustomsAnswers = {};
  for (const [id, a] of Object.entries(answers)) {
    const { savedBy: _by, ...rest } = a;
    void _by;
    out[id] = rest;
  }
  return out;
}

// ------------------------------------------------------------------
// Send (finalize)
// ------------------------------------------------------------------

/** One file the browser says it uploaded in this round. */
export interface VatFilesSubmittedFile {
  path: string;
  name: string;
  /** Round 3: the customs line the file belongs to (checked against the row's lines at Send). */
  lineId?: number;
  docKind?: VatCustomsDocKind;
}

/** Comment: control characters out (line breaks kept), trimmed, capped. */
export function cleanComment(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, VAT_FILES_MAX_COMMENT);
}

/**
 * Read the Send body: `{ files: [{ path, name, lineId?, docKind? }], comment,
 * answers? }`. `answers` (round 3) = the customs answers not autosaved yet,
 * keyed by line id; its presence means "this Send carries the answers".
 * Null when malformed.
 */
export function parseFinalizeBody(
  body: unknown
): { files: VatFilesSubmittedFile[]; comment: string; answers?: unknown } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { files?: unknown; comment?: unknown; answers?: unknown };
  if (!Array.isArray(b.files)) return null;
  const files: VatFilesSubmittedFile[] = [];
  for (const f of b.files) {
    if (!f || typeof f !== 'object') return null;
    const { path, name, lineId, docKind } = f as { path?: unknown; name?: unknown; lineId?: unknown; docKind?: unknown };
    if (typeof path !== 'string') return null;
    const entry: VatFilesSubmittedFile = { path, name: typeof name === 'string' ? name : '' };
    if (lineId !== undefined && lineId !== null) {
      if (typeof lineId !== 'number' || !Number.isSafeInteger(lineId) || lineId <= 0) return null;
      if (!isVatCustomsDocKind(docKind)) return null;
      entry.lineId = lineId;
      entry.docKind = docKind;
    }
    files.push(entry);
  }
  const parsed: { files: VatFilesSubmittedFile[]; comment: string; answers?: unknown } = {
    files,
    comment: cleanComment(b.comment),
  };
  if (b.answers !== undefined) parsed.answers = b.answers;
  return parsed;
}

export type FinalizeCheck =
  | { ok: true; entries: VatFileEntry[] }
  | { ok: false; error: 'no_files' | 'too_many_files' | 'invalid_path' | 'upload_not_received' | 'unknown_line' };

/**
 * Build the entries one Send adds. Every path must be this link's upload
 * path and present in storage (`stored`: path -> size in bytes). A path that
 * is already in the row is skipped (a double click never doubles a file).
 */
export function buildFinalizeEntries(
  existing: VatFileEntry[],
  submitted: VatFilesSubmittedFile[],
  comment: string,
  stored: ReadonlyMap<string, number>,
  environment: string,
  token: string,
  nowIso: string,
  opts: {
    /** Round 3: ids of the row's customs lines; a file for any other line is refused. */
    lineIds?: ReadonlySet<number>;
    /** A Send that carries customs answers may come without files. */
    allowNoFiles?: boolean;
    /** Round 4 B: the confirmed address of the sender, kept on each new entry; null = unknown. */
    uploadedBy?: string | null;
  } = {}
): FinalizeCheck {
  if (submitted.length === 0 && !opts.allowNoFiles) return { ok: false, error: 'no_files' };
  if (submitted.length > VAT_FILES_MAX_PER_ROUND) return { ok: false, error: 'too_many_files' };

  const known = new Set(existing.map((f) => f.path));
  const seen = new Set<string>();
  const entries: VatFileEntry[] = [];
  for (const f of submitted) {
    if (!isUploadPathForLink(f.path, environment, token)) return { ok: false, error: 'invalid_path' };
    if (f.lineId !== undefined && !opts.lineIds?.has(f.lineId)) return { ok: false, error: 'unknown_line' };
    if (known.has(f.path) || seen.has(f.path)) continue;
    const size = stored.get(f.path);
    if (size === undefined) return { ok: false, error: 'upload_not_received' };
    seen.add(f.path);
    // Fallback name: the stored name without its uuid prefix.
    const fallback = f.path.slice(f.path.lastIndexOf('/') + 1 + 37);
    // The name must carry the stored file's extension (the portal checks the
    // type by the name); otherwise use the stored name.
    const shown = displayFileName(f.name.trim() || fallback);
    const entry: VatFileEntry = {
      path: f.path,
      name: vatFileExtension(shown) === vatFileExtension(f.path) ? shown : displayFileName(fallback),
      size,
      uploadedAt: nowIso,
    };
    if (comment) entry.comment = comment;
    if (opts.uploadedBy) entry.uploadedBy = opts.uploadedBy;
    if (f.lineId !== undefined && f.docKind) {
      entry.lineId = f.lineId;
      entry.docKind = f.docKind;
    }
    entries.push(entry);
  }
  if (existing.length + entries.length > VAT_FILES_MAX_TOTAL) {
    return { ok: false, error: 'too_many_files' };
  }
  return { ok: true, entries };
}

// ------------------------------------------------------------------
// Display helpers (page)
// ------------------------------------------------------------------

/** `2026-10-28` (or a full ISO timestamp) -> `28.10.2026`. Empty when unreadable. */
export function formatDeadline(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/**
 * The portal's period label ends with the period key, e.g.
 * 'Jun - Aug 2026 (2606-2608)'. The client sees 'Jun - Aug 2026'.
 */
export function clientPeriodLabel(label: string | null | undefined): string {
  return String(label ?? '').replace(/\s*\(\d{4}-\d{4}\)\s*$/, '').trim();
}

/** 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const oneDecimal = (n: number) => Math.round(n * 10) / 10;
  if (bytes < 1024 * 1024) return `${Math.max(1, oneDecimal(bytes / 1024))} KB`;
  return `${oneDecimal(bytes / (1024 * 1024))} MB`;
}

// ------------------------------------------------------------------
// Rate limit (best effort, warm instance only)
// ------------------------------------------------------------------

// Own budget, larger than the AI routes' 30/min: one client may send 40
// files, and a large file costs two calls.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 150;
const rateState = new Map<string, { count: number; resetAt: number }>();

export function vatFilesRateLimited(ip: string, now: number = Date.now()): boolean {
  const bucket = rateState.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateState.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateState.size > 5000) {
      for (const [k, v] of rateState) if (v.resetAt <= now) rateState.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}
