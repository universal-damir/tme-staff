// VAT filing round 2: the client upload link - the shared shapes.
//
// MIRRORED VERBATIM: portal src/lib/vat-filing/upload-link-types.ts
//                <-> tme-staff src/types/vat-files.ts
// Change both files together, never one alone. No imports, no runtime
// dependencies: plain types, constants and small pure helpers only.
//
// The Supabase table is vat_file_requests (aux project tme-portal-sign,
// database/migrations/supabase_vat_file_requests.sql in the portal), the
// private storage bucket is `vat-files`. The portal writes the row when the
// customs request / files request email goes out; the tme-staff page
// /vat-files/<token> shows it and appends the client's files; the portal pulls
// the files in (sync-vat-uploads).

/** The Supabase table (RLS on, service role only). */
export const VAT_FILE_REQUESTS_TABLE = 'vat_file_requests';

/** Storage bucket for the FTA import list and the client's uploads (private). */
export const VAT_FILES_BUCKET = 'vat-files';

/** The page path on tme-staff; the link is `${STAFF_PORTAL_URL}${VAT_FILES_PAGE_PATH}/${token}`. */
export const VAT_FILES_PAGE_PATH = '/vat-files';

/** 'customs' = the customs request (accounting clients); 'files' = the files request. */
export type VatFileRequestKind = 'customs' | 'files';

/** 'open' takes uploads; 'closed' = the files step is done at TME, the page only says thank you. */
export type VatFileRequestStatus = 'open' | 'closed';

/**
 * Which portal wrote the row (the portal's appOriginEnv()): 'production',
 * 'development', 'sandbox', or APP_ENV. Each portal reads only its own rows.
 */
export type VatFileEnvironment = string;

/** One file the client uploaded, as kept in vat_file_requests.files. */
export interface VatFileEntry {
  /** Storage path in the bucket: `<environment>/<link_token>/<uuid>-<safeName>`. Unique. */
  path: string;
  /** The name the client's file had (cleaned), shown on the page and in the portal. */
  name: string;
  /** Bytes. */
  size: number;
  /** ISO timestamp of the Send that brought the file. */
  uploadedAt: string;
  /** The comment typed with that Send, when there was one. */
  comment?: string;
}

/** A row of vat_file_requests, as Supabase returns it. */
export interface VatFileRequestRow {
  id: string;
  link_token: string;
  environment: VatFileEnvironment;
  portal_filing_id: number;
  company_code: string | null;
  company_name: string | null;
  /** 'YYMM-YYMM' */
  period_key: string;
  /** 'Jun - Aug 2026 (2606-2608)' */
  period_label: string | null;
  kind: VatFileRequestKind;
  /** The numbered points of the email, plain text, in order. */
  requested_items: string[];
  /** Storage path of the FTA import list the client may download; null = none. */
  customs_list_path: string | null;
  /** ISO date (YYYY-MM-DD) the client was asked to answer by; null = none given. */
  deadline: string | null;
  status: VatFileRequestStatus;
  files: VatFileEntry[];
  /** The latest comment the client sent. */
  client_comment: string | null;
  last_submitted_at: string | null;
  created_at: string;
  updated_at: string;
  /** After this the page takes no more uploads; null = no end. */
  expires_at: string | null;
}

/** What the tme-staff page shows (built from the row; never the storage paths). */
export interface VatFilesPagePayload {
  companyCode: string | null;
  companyName: string | null;
  periodKey: string;
  periodLabel: string | null;
  kind: VatFileRequestKind;
  requestedItems: string[];
  deadline: string | null;
  /** The FTA import list can be downloaded. */
  hasCustomsList: boolean;
  /** Its file name, for the download button. */
  customsListName: string | null;
  status: VatFileRequestStatus;
  /** expires_at has passed: no more uploads. */
  expired: boolean;
  /** Files already sent through this link, oldest first. */
  files: Array<{ name: string; size: number; uploadedAt: string }>;
  clientComment: string | null;
}

/** Upload limits, the same as the portal's VAT filing documents (period-documents.ts). */
export const VAT_FILES_MAX_FILES_PER_SEND = 10;
export const VAT_FILES_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Extensions the portal stores (lower case, with the dot). */
export const VAT_FILES_ALLOWED_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.xlsx',
  '.xls',
  '.docx',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.msg',
  '.eml',
];
/** Longest client comment kept. */
export const VAT_FILES_MAX_COMMENT_CHARS = 2000;

/** '.PDF' -> '.pdf'; '' when the name has no extension. */
export function vatFileExtension(name: string): string {
  const m = /\.[^./\\]+$/.exec(String(name || '').trim());
  return m ? m[0].toLowerCase() : '';
}

/** True when the portal will take this file (extension and size). */
export function isAllowedVatFile(name: string, size: number): boolean {
  return (
    VAT_FILES_ALLOWED_EXTENSIONS.includes(vatFileExtension(name)) &&
    Number.isFinite(size) &&
    size > 0 &&
    size <= VAT_FILES_MAX_FILE_BYTES
  );
}

/**
 * A file name safe for a storage path: letters, digits, dot, dash and
 * underscore; everything else becomes '_'. At most 120 characters, the
 * extension kept. Never empty.
 */
export function safeVatFileName(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const ext = vatFileExtension(base);
  const stem = (ext ? base.slice(0, -ext.length) : base)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  const cleanStem = (stem || 'file').slice(0, 120 - ext.length);
  return `${cleanStem}${ext}`;
}

/** `<environment>/<link_token>/<uuid>-<safeName>` */
export function vatFileStoragePath(environment: string, linkToken: string, uuid: string, fileName: string): string {
  return `${environment}/${linkToken}/${uuid}-${safeVatFileName(fileName)}`;
}

/** The name part of a storage path (the '<uuid>-' prefix dropped). */
export function vatFileNameFromPath(path: string | null | undefined): string | null {
  const last = String(path || '').split('/').pop() || '';
  if (!last) return null;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || last;
}
