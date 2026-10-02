/**
 * Server-side helpers for the eKYC client form (clients.tme-services.com/kyc/<token>).
 *
 * The portal (ekyc_requests, migration 602) mints an `ekyc_submissions` row in
 * the auxiliary Supabase with the pre-fill snapshot and the link token. The
 * client saves drafts and submits here; the portal's sync cron pulls the row.
 * Contract: src/types/ekyc.ts (EkycSubmissionRow). DDL: portal
 * database/supabase/ekyc_submissions.sql.
 *
 * All callers use the service-role client (RLS on, no policies). Same
 * lifecycle shape as the supplier-checks and company-setup intakes.
 */

import { getSupabaseAdmin } from './supabase-server';
import type {
  EkycDocumentSlot,
  EkycDocuments,
  EkycPrefillData,
  EkycSubmissionStatus,
  EkycType,
} from '@/types/ekyc';
import { EKYC_DOCUMENT_SLOTS } from '@/types/ekyc';

export const EKYC_TABLE = 'ekyc_submissions';

export const EKYC_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns this app reads. */
export interface EkycAccessRow {
  id: string;
  type: EkycType;
  status: EkycSubmissionStatus;
  display_name: string | null;
  bilingual: boolean | null;
  prefill_data: EkycPrefillData | null;
  form_data: unknown;
  documents: EkycDocuments | null;
  expires_at: string | null;
  submitted_at: string | null;
  /** Server only: the submit compares it, so a write that landed in between is not lost. */
  updated_at: string | null;
}

// Server-only columns (link_token, origin_env, portal_request_id, client_code,
// synced_to_tme, created_at) are deliberately NOT selected: nothing here may
// leak to the browser. The id is selected for the writes and the storage
// paths, updated_at for the submit's compare-and-set; neither is ever sent to
// the browser (scrubEkycRowForClient picks its fields one by one).
export const EKYC_SAFE_COLUMNS =
  'id, type, status, display_name, bilingual, prefill_data, form_data, documents, expires_at, submitted_at, updated_at';

/** A row the client can still write to. */
export const EKYC_OPEN_STATUSES: readonly EkycSubmissionStatus[] = ['invited', 'in_progress'];

export type EkycAccessFailure =
  | 'invalid_token'
  | 'not_found'
  | 'cancelled'
  | 'expired'
  | 'already_submitted';

export interface EkycAccessResult {
  ok: boolean;
  reason?: EkycAccessFailure;
  status?: number; // HTTP status to pass through
  row?: EkycAccessRow;
}

/**
 * The access decision for a row that was found (pure, testable).
 * - cancelled (resend / withdrawn) = 410
 * - submitted / synced: fine for reads (read-only view), 409 for writes.
 *   Checked before the expiry, so a submitted form still opens read-only
 *   after the 14 days.
 * - expired status or past expires_at = 410
 */
export function decideEkycAccess(
  row: EkycAccessRow,
  opts: { allowSubmitted?: boolean } = {},
  now: number = Date.now()
): EkycAccessResult {
  if (row.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', status: 410, row };
  }
  if (row.status === 'submitted' || row.status === 'synced') {
    if (!opts.allowSubmitted) {
      return { ok: false, reason: 'already_submitted', status: 409, row };
    }
    return { ok: true, row };
  }
  if (row.status === 'expired' || (row.expires_at && new Date(row.expires_at).getTime() < now)) {
    return { ok: false, reason: 'expired', status: 410, row };
  }
  return { ok: true, row };
}

export async function verifyEkycAccess(
  token: string,
  opts: { allowSubmitted?: boolean } = {}
): Promise<EkycAccessResult> {
  if (!EKYC_UUID_REGEX.test(token)) {
    return { ok: false, reason: 'invalid_token', status: 404 };
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(EKYC_TABLE)
    .select(EKYC_SAFE_COLUMNS)
    .eq('link_token', token)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, reason: 'not_found', status: 404 };
  }
  return decideEkycAccess(data as unknown as EkycAccessRow, opts);
}

/**
 * Error body for a failed access check. A closed link (410) says whether the
 * form was bilingual, so the "no longer valid" page can show German too.
 */
export function ekycAccessErrorBody(access: EkycAccessResult): { error: string; bilingual?: boolean } {
  const body: { error: string; bilingual?: boolean } = { error: access.reason ?? 'not_found' };
  if (access.status === 410 && access.row) body.bilingual = access.row.bilingual === true;
  return body;
}

export function isEkycDocumentSlot(value: string): value is EkycDocumentSlot {
  return EKYC_DOCUMENT_SLOTS.some((d) => d.slot === value);
}

/** What the browser learns about an uploaded file: never the storage path. */
export interface EkycClientDocument {
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}
export type EkycClientDocuments = Partial<Record<EkycDocumentSlot, EkycClientDocument>>;

export function scrubDocumentsForClient(documents: EkycDocuments | null | undefined): EkycClientDocuments {
  const out: EkycClientDocuments = {};
  if (!documents || typeof documents !== 'object') return out;
  for (const def of EKYC_DOCUMENT_SLOTS) {
    const ref = documents[def.slot];
    if (!ref || typeof ref.path !== 'string' || !ref.path) continue;
    out[def.slot] = {
      filename: String(ref.filename ?? ''),
      mimeType: String(ref.mimeType ?? ''),
      size: Number(ref.size) || 0,
      uploadedAt: String(ref.uploadedAt ?? ''),
    };
  }
  return out;
}

/** The subset of a row that may reach the browser. No id, token or env. */
export interface EkycClientPayload {
  type: EkycType;
  /** 'open' while the client can still edit; 'submitted' once locked. */
  status: 'open' | 'submitted';
  displayName: string;
  bilingual: boolean;
  /** Corporate only (R7). Individual: always null (R6). */
  prefill: EkycPrefillData | null;
  formData: unknown;
  documents: EkycClientDocuments;
  expiresAt: string | null;
}

export function scrubEkycRowForClient(row: EkycAccessRow): EkycClientPayload {
  const submitted = row.status === 'submitted' || row.status === 'synced';
  return {
    type: row.type,
    status: submitted ? 'submitted' : 'open',
    displayName: row.display_name ?? '',
    bilingual: row.bilingual === true,
    prefill: row.type === 'corporate' ? (row.prefill_data ?? null) : null,
    formData: row.form_data ?? null,
    documents: row.type === 'individual' ? scrubDocumentsForClient(row.documents) : {},
    expiresAt: row.expires_at ?? null,
  };
}

/** True when a stored path lives under this row's own folder, with no traversal. */
export function isEkycPathForRow(path: unknown, rowId: string): path is string {
  if (typeof path !== 'string' || !path.startsWith(`${rowId}/`)) return false;
  const rest = path.slice(rowId.length + 1);
  return (
    rest.length > 0 &&
    !rest.includes('..') &&
    !rest.includes('/') &&
    !rest.includes('\\') &&
    !rest.includes('\0')
  );
}
