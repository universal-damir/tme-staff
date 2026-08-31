/**
 * Server-side helpers for the Company Setup Intake (IFZA v1) flow.
 *
 * The intake link (https://staff.tme-services.com/setup/<token>) is minted by
 * the air-gapped portal and pushed to the auxiliary Supabase
 * `company_setup_intake_submissions` table. tme-staff resolves the token here,
 * the client completes the multi-step setup form, and the row is flipped to
 * 'submitted'. The portal then pulls it via the sync-company-setup cron.
 *
 * All callers use the service-role client (anon RLS is locked on this table).
 * Clone of the gap-intake token module (gap-intake-token.ts) — same lifecycle
 * shape, different table + statuses.
 */

import { getSupabaseAdmin } from './supabase-server';
import type {
  CompanySetupDocuments,
  CompanySetupPrefillData,
  CompanySetupSubmittedData,
} from '@/types/company-setup';

export const COMPANY_SETUP_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompanySetupSubmissionStatus =
  | 'invited'
  | 'in_progress'
  | 'submitted'
  | 'cancelled'
  | 'expired';

export interface CompanySetupSubmissionRow {
  id: string;
  link_token: string;
  status: CompanySetupSubmissionStatus;
  prefill_data: CompanySetupPrefillData | null;
  submitted_data: Partial<CompanySetupSubmittedData> | null;
  documents: CompanySetupDocuments | null;
  expires_at: string | null;
  submitted_at: string | null;
}

// Server-only columns (origin_env, synced_to_tme, created_at, updated_at) are
// deliberately NOT selected — nothing here may leak to the browser.
const SAFE_COLUMNS =
  'id, link_token, status, prefill_data, submitted_data, documents, expires_at, submitted_at';

export type CompanySetupAccessFailure =
  | 'invalid_token'
  | 'not_found'
  | 'cancelled'
  | 'expired'
  | 'already_submitted';

export interface CompanySetupAccessResult {
  ok: boolean;
  reason?: CompanySetupAccessFailure;
  status?: number; // HTTP status to pass through
  row?: CompanySetupSubmissionRow;
}

/**
 * Look up an intake row by its public link token and decide whether the client
 * may still act on it. `allowSubmitted=false` (writes) treats an already
 * submitted row as closed; reads pass `true` so the page can render the
 * "thanks, we've received this" view.
 */
export async function verifyCompanySetupAccess(
  token: string,
  opts: { allowSubmitted?: boolean } = {}
): Promise<CompanySetupAccessResult> {
  if (!COMPANY_SETUP_UUID_REGEX.test(token)) {
    return { ok: false, reason: 'invalid_token', status: 404 };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('company_setup_intake_submissions')
    .select(SAFE_COLUMNS)
    .eq('link_token', token)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: 'not_found', status: 404 };
  }

  const row = data as unknown as CompanySetupSubmissionRow;

  if (row.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', status: 410, row };
  }
  if (
    row.status === 'expired' ||
    (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
  ) {
    return { ok: false, reason: 'expired', status: 410, row };
  }
  if (row.status === 'submitted') {
    if (!opts.allowSubmitted) {
      return { ok: false, reason: 'already_submitted', status: 409, row };
    }
    return { ok: true, row };
  }

  return { ok: true, row };
}

/**
 * The subset of a submission row that may reach the browser. The row id and
 * link_token never leave the server via this payload (the client already
 * holds the URL token; the id only appears inside storage paths, which the
 * file proxy re-scopes to the token's own row).
 */
export interface CompanySetupClientPayload {
  status: CompanySetupSubmissionStatus;
  prefill: CompanySetupPrefillData | null;
  submittedData: Partial<CompanySetupSubmittedData> | null;
  documents: CompanySetupDocuments | null;
  expiresAt: string | null;
}

export function scrubRowForClient(row: CompanySetupSubmissionRow): CompanySetupClientPayload {
  return {
    status: row.status,
    prefill: row.prefill_data ?? null,
    submittedData: row.submitted_data ?? null,
    documents: row.documents ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

// Document slots a client upload may target. Fixed vocabulary — the storage
// path segment comes from this list, never from free text.
export const COMPANY_SETUP_DOC_SLOTS = [
  'passport',
  // Indian / Syrian passports only — the additional page (address / family
  // details, or the issue-details page). Gated by nationality in the form and
  // in the submit route's required-documents check.
  'passport_additional',
  'photo',
  'eid_front',
  'eid_back',
  'visa_document',
  'previous_visa_document',
  'proof_of_address',
] as const;

export type CompanySetupDocSlot = (typeof COMPANY_SETUP_DOC_SLOTS)[number];

export function isCompanySetupDocSlot(value: string): value is CompanySetupDocSlot {
  return (COMPANY_SETUP_DOC_SLOTS as readonly string[]).includes(value);
}

/**
 * Validate a client-supplied documents object against the row it claims to
 * belong to: person keys must be array indices 0..5, slots must be from the
 * fixed vocabulary, and every ref path must live under this submission's own
 * storage folder (`<rowId>/...`) with no traversal — a forged path can never
 * point the portal sync at another submission's files.
 *
 * The path must ALSO carry the SLOT it is filed under
 * (`<rowId>/<personIndex>/<slot>/...`), so a client cannot file their passport
 * as their proof of address and have the portal copy it into the wrong
 * shareholder document slot at conversion.
 *
 * The person segment is checked for shape (0..5) but NOT against the JSON key:
 * removing a person re-keys the remaining refs (person 2's documents become
 * person 1's) while the stored objects keep their original path, so a stale
 * index there is legitimate.
 *
 * A staff-provided ref (`source: 'staff'`) lives in the portal's own
 * `<rowId>/staff/` namespace, written before the invite went out.
 */
const CLIENT_PATH_PERSON_SEGMENT = /^[0-5]$/;
export function documentsErrorForRow(
  documents: unknown,
  rowId: string
): string | null {
  if (documents == null) return null;
  if (typeof documents !== 'object' || Array.isArray(documents)) {
    return 'documents must be an object';
  }
  for (const [personKey, slots] of Object.entries(documents as Record<string, unknown>)) {
    if (!/^[0-5]$/.test(personKey)) return `invalid person key "${personKey}"`;
    if (slots == null) continue;
    if (typeof slots !== 'object' || Array.isArray(slots)) {
      return `documents["${personKey}"] must be an object`;
    }
    for (const [slot, ref] of Object.entries(slots as Record<string, unknown>)) {
      if (!isCompanySetupDocSlot(slot)) return `invalid document slot "${slot}"`;
      if (ref == null) continue;
      if (typeof ref !== 'object' || Array.isArray(ref)) {
        return `documents["${personKey}"].${slot} must be an object`;
      }
      const source = (ref as { source?: unknown }).source;
      if (source !== undefined && source !== 'staff' && source !== 'client') {
        return `documents["${personKey}"].${slot} has an invalid source`;
      }
      const path = (ref as { path?: unknown }).path;
      if (typeof path !== 'string') {
        return `documents["${personKey}"].${slot} has an invalid path`;
      }
      if (path.includes('..') || path.includes('//') || path.includes('\0')) {
        return `documents["${personKey}"].${slot} has an invalid path`;
      }
      if (source === 'staff') {
        // Staff-provided files live in the portal's own namespace.
        if (!path.startsWith(`${rowId}/staff/`)) {
          return `documents["${personKey}"].${slot} has an invalid path`;
        }
        continue;
      }
      // Client upload: <rowId>/<0-5>/<slot>/<file>
      const segments = path.split('/');
      if (
        segments.length < 4 ||
        segments[0] !== rowId ||
        !CLIENT_PATH_PERSON_SEGMENT.test(segments[1]) ||
        segments[2] !== slot ||
        segments[3].length === 0
      ) {
        return `documents["${personKey}"].${slot} has an invalid path`;
      }
    }
  }
  return null;
}
