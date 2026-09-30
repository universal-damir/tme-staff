/**
 * Server-side helpers for the Supplier Verification Policy (SVP) intake.
 *
 * The link (https://staff.tme-services.com/supplier-checks/<token>) is minted
 * by the air-gapped portal and pushed to the auxiliary Supabase
 * `svp_intake_submissions` table with a `prefill_data` snapshot. tme-staff
 * resolves the token here, the client confirms the three roles, the records
 * location and the price, and the row is flipped to 'submitted'. The portal
 * then pulls it via the sync-svp-intake cron.
 *
 * All callers use the service-role client (anon RLS is locked on this table).
 * Clone of the gap-intake token module (gap-intake-token.ts): same lifecycle
 * shape, JSONB prefill / answers like the company-setup intake.
 */

import { getSupabaseAdmin } from './supabase-server';
import type {
  SvpPolicyAnswers,
  SvpPrefill,
  SvpSubmissionStatus,
} from '@/types/supplier-policy';

export const SVP_INTAKE_TABLE = 'svp_intake_submissions';

export const SVP_INTAKE_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SvpIntakeRow {
  id: string;
  link_token: string;
  company_name: string | null;
  status: SvpSubmissionStatus;
  /** VAT-exclusive AED. PostgREST may hand NUMERIC back as a string. */
  price_aed: number | string | null;
  prefill_data: Partial<SvpPrefill> | null;
  submitted_data: Partial<SvpPolicyAnswers> | null;
  expires_at: string | null;
  submitted_at: string | null;
}

// Server-only columns (client_id, company_code, origin_env, synced_to_tme,
// created_at, updated_at) are deliberately NOT selected: nothing here may
// leak to the browser.
export const SVP_SAFE_COLUMNS =
  'id, link_token, company_name, status, price_aed, prefill_data, submitted_data, expires_at, submitted_at';

export type SvpIntakeAccessFailure =
  | 'invalid_token'
  | 'not_found'
  | 'cancelled'
  | 'expired'
  | 'already_submitted';

export interface SvpIntakeAccessResult {
  ok: boolean;
  reason?: SvpIntakeAccessFailure;
  status?: number; // HTTP status to pass through
  row?: SvpIntakeRow;
}

/**
 * The access decision for a row that was found (pure, so it is testable
 * without Supabase). Cancelled or past its expiry = 410; submitted / synced
 * = 409 on writes, fine on reads (the page shows "already received").
 */
export function decideSvpIntakeAccess(
  row: SvpIntakeRow,
  opts: { allowSubmitted?: boolean } = {},
  now: number = Date.now()
): SvpIntakeAccessResult {
  if (row.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', status: 410, row };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < now) {
    return { ok: false, reason: 'expired', status: 410, row };
  }
  if (row.status === 'submitted' || row.status === 'synced') {
    if (!opts.allowSubmitted) {
      return { ok: false, reason: 'already_submitted', status: 409, row };
    }
    return { ok: true, row };
  }
  return { ok: true, row };
}

/**
 * Look up an intake row by its public link token and decide whether the client
 * may still act on it. `allowSubmitted=false` (writes) treats an already
 * submitted/synced row as closed; reads pass `true` so the page can render the
 * "thanks, we've received this" view.
 */
export async function verifySvpIntakeAccess(
  token: string,
  opts: { allowSubmitted?: boolean } = {}
): Promise<SvpIntakeAccessResult> {
  if (!SVP_INTAKE_UUID_REGEX.test(token)) {
    return { ok: false, reason: 'invalid_token', status: 404 };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(SVP_INTAKE_TABLE)
    .select(SVP_SAFE_COLUMNS)
    .eq('link_token', token)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: 'not_found', status: 404 };
  }

  return decideSvpIntakeAccess(data as unknown as SvpIntakeRow, opts);
}

/** The price as a number, or null (NUMERIC may arrive as a string). */
export function svpRowPrice(row: Pick<SvpIntakeRow, 'price_aed'>): number | null {
  if (row.price_aed == null || row.price_aed === '') return null;
  const n = Number(row.price_aed);
  return Number.isFinite(n) ? n : null;
}

/**
 * The subset of a row that may reach the browser. The row id, the link token
 * and the client id never leave the server (the client already holds the URL
 * token).
 */
export interface SvpIntakeClientPayload {
  status: SvpSubmissionStatus;
  companyName: string | null;
  /** VAT-exclusive AED. */
  priceAed: number | null;
  prefill: SvpPrefill | null;
  submitted: Partial<SvpPolicyAnswers> | null;
  expiresAt: string | null;
}

function cleanPrefill(raw: Partial<SvpPrefill> | null): SvpPrefill | null {
  if (!raw || typeof raw !== 'object') return null;
  const emptyPerson = { name: '', position: '', email: '' };
  const suggested = raw.suggested ?? {
    implementer: emptyPerson,
    reviewer: emptyPerson,
    supervisor: emptyPerson,
  };
  return {
    companyName: raw.companyName ?? '',
    companyCode: raw.companyCode ?? '',
    trn: raw.trn ?? null,
    registeredAddress: raw.registeredAddress ?? null,
    vatPeriodsText: raw.vatPeriodsText ?? null,
    priceAed: raw.priceAed ?? null,
    suggested: {
      implementer: { ...emptyPerson, ...suggested.implementer },
      reviewer: { ...emptyPerson, ...suggested.reviewer },
      supervisor: { ...emptyPerson, ...suggested.supervisor },
    },
    officers: Array.isArray(raw.officers) ? raw.officers : [],
  };
}

export function scrubRowForClient(row: SvpIntakeRow): SvpIntakeClientPayload {
  const prefill = cleanPrefill(row.prefill_data);
  return {
    status: row.status,
    companyName: row.company_name ?? prefill?.companyName ?? null,
    // The row column is the price the portal froze at mint; prefill is a fallback.
    priceAed: svpRowPrice(row) ?? prefill?.priceAed ?? null,
    prefill,
    submitted: row.submitted_data ?? null,
    expiresAt: row.expires_at ?? null,
  };
}
