/**
 * Server-side access for the VAT filing upload link (`/vat-files/{token}`).
 *
 * The air-gapped portal writes one `vat_file_requests` row per link into the
 * auxiliary Supabase project. RLS is on with no anon policies: every call
 * here uses the service-role client and looks up exactly one row by its
 * link token, so no other row is ever read or exposed.
 */

import { getSupabaseAdmin } from './supabase-server';
import { VAT_FILE_REQUESTS_TABLE, VAT_FILES_BUCKET, type VatFileRequestRow } from '@/types/vat-files';
import {
  decideVatFilesAccess,
  isValidVatFilesToken,
  type VatFilesAccessResult,
} from './vat-files';

export const VAT_FILES_COLUMNS =
  'id, link_token, environment, portal_filing_id, company_code, company_name, period_key, period_label, kind, requested_items, customs_list_path, deadline, status, files, client_comment, last_submitted_at, created_at, updated_at, expires_at';

export async function verifyVatFilesAccess(
  token: string,
  opts: { allowClosed?: boolean } = {}
): Promise<VatFilesAccessResult> {
  if (!isValidVatFilesToken(token)) {
    return { ok: false, reason: 'invalid_token', status: 404 };
  }
  const { data, error } = await getSupabaseAdmin()
    .from(VAT_FILE_REQUESTS_TABLE)
    .select(VAT_FILES_COLUMNS)
    .eq('link_token', token)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, reason: 'not_found', status: 404 };
  }
  return decideVatFilesAccess(data as unknown as VatFileRequestRow, opts);
}

/** JSON error body for a failed access check (reason only, never the row). */
export function vatFilesAccessErrorBody(access: VatFilesAccessResult): { error: string } {
  return { error: access.reason ?? 'not_found' };
}

const LIST_PAGE = 1000;
/** A folder bigger than this is never read to the end (uploads stop far earlier). */
const MAX_LIST_PAGES = 20;

/**
 * path -> size of every object in one link's folder, page by page until the
 * end. Null when storage cannot be read, or the folder is larger than the
 * ceiling: never a silently cut list. With `stopAfter`, reading stops as soon
 * as more than that many objects were seen (enough to say "too many").
 */
export async function listVatLinkFolder(
  folder: string,
  opts: { stopAfter?: number } = {}
): Promise<Map<string, number> | null> {
  const stored = new Map<string, number>();
  const bucket = getSupabaseAdmin().storage.from(VAT_FILES_BUCKET);
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { data, error } = await bucket.list(folder, { limit: LIST_PAGE, offset: page * LIST_PAGE });
    if (error || !data) return null;
    for (const obj of data) {
      const size = Number((obj.metadata as { size?: unknown } | null)?.size);
      if (obj.id && Number.isFinite(size)) stored.set(`${folder}/${obj.name}`, size);
    }
    if (opts.stopAfter !== undefined && stored.size > opts.stopAfter) return stored;
    if (data.length < LIST_PAGE) return stored;
  }
  return null;
}
