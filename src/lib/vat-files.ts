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
  type VatFileEntry,
  type VatFileRequestRow,
  type VatFilesPagePayload,
} from '@/types/vat-files';

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
  };
}

// ------------------------------------------------------------------
// Send (finalize)
// ------------------------------------------------------------------

/** One file the browser says it uploaded in this round. */
export interface VatFilesSubmittedFile {
  path: string;
  name: string;
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

/** Read the Send body: `{ files: [{ path, name }], comment }`. Null when malformed. */
export function parseFinalizeBody(
  body: unknown
): { files: VatFilesSubmittedFile[]; comment: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { files?: unknown; comment?: unknown };
  if (!Array.isArray(b.files)) return null;
  const files: VatFilesSubmittedFile[] = [];
  for (const f of b.files) {
    if (!f || typeof f !== 'object') return null;
    const { path, name } = f as { path?: unknown; name?: unknown };
    if (typeof path !== 'string') return null;
    files.push({ path, name: typeof name === 'string' ? name : '' });
  }
  return { files, comment: cleanComment(b.comment) };
}

export type FinalizeCheck =
  | { ok: true; entries: VatFileEntry[] }
  | { ok: false; error: 'no_files' | 'too_many_files' | 'invalid_path' | 'upload_not_received' };

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
  nowIso: string
): FinalizeCheck {
  if (submitted.length === 0) return { ok: false, error: 'no_files' };
  if (submitted.length > VAT_FILES_MAX_PER_ROUND) return { ok: false, error: 'too_many_files' };

  const known = new Set(existing.map((f) => f.path));
  const seen = new Set<string>();
  const entries: VatFileEntry[] = [];
  for (const f of submitted) {
    if (!isUploadPathForLink(f.path, environment, token)) return { ok: false, error: 'invalid_path' };
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
