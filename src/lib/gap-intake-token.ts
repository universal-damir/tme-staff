/**
 * Server-side helpers for the e-invoicing gap-analysis intake flow.
 *
 * The intake link (https://staff.tme-services.com/e-invoicing/<token>) is minted
 * by the air-gapped portal and pushed to the auxiliary Supabase
 * `gap_intake_submissions` table. tme-staff resolves the token here, shows the
 * client a 2-field form (accounting software + sample invoices), and flips the
 * row to 'submitted'. The portal then pulls it via the sync-gap-intake cron.
 *
 * All callers use the service-role client (anon RLS is locked on this table).
 */

import { getSupabaseAdmin } from './supabase-server';

export const GAP_INTAKE_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accounting / ERP systems offered in the intake dropdown. Keep "Other" last —
// it reveals the free-text field. The portal stores the picked value in
// `accounting_software` and the free text in `accounting_software_other`.
export const ACCOUNTING_SOFTWARE_OPTIONS = [
  'SAP',
  'Oracle NetSuite',
  'Microsoft Dynamics 365',
  'Zoho Books',
  'QuickBooks',
  'Xero',
  'Tally',
  'Sage',
  'Odoo',
  'Wafeq',
  'FreshBooks',
  'Focus',
  'None / spreadsheets',
  'Other',
] as const;

export type AccountingSoftwareOption = (typeof ACCOUNTING_SOFTWARE_OPTIONS)[number];

export function isAllowedAccountingSoftware(v: string): boolean {
  return (ACCOUNTING_SOFTWARE_OPTIONS as ReadonlyArray<string>).includes(v);
}

export interface GapIntakeFileRef {
  path: string;
  filename: string;
  channel: 'digital_xml' | 'physical';
}

export interface GapIntakeRow {
  id: string;
  link_token: string;
  company_name: string | null;
  accounting_software: string | null;
  accounting_software_other: string | null;
  invoice_files: GapIntakeFileRef[] | null;
  status: 'invited' | 'submitted' | 'synced' | 'cancelled';
  expires_at: string | null;
}

const SAFE_COLUMNS =
  'id, link_token, company_name, accounting_software, accounting_software_other, invoice_files, status, expires_at';

export type GapIntakeAccessFailure =
  | 'invalid_token'
  | 'not_found'
  | 'cancelled'
  | 'expired'
  | 'already_submitted';

export interface GapIntakeAccessResult {
  ok: boolean;
  reason?: GapIntakeAccessFailure;
  status?: number; // HTTP status to pass through
  row?: GapIntakeRow;
}

/**
 * Look up an intake row by its public link token and decide whether the client
 * may still act on it. `allowSubmitted=false` (writes) treats an already
 * submitted/synced row as closed; reads pass `true` so the page can render the
 * "thanks, we've received this" view.
 */
export async function verifyGapIntakeAccess(
  token: string,
  opts: { allowSubmitted?: boolean } = {}
): Promise<GapIntakeAccessResult> {
  if (!GAP_INTAKE_UUID_REGEX.test(token)) {
    return { ok: false, reason: 'invalid_token', status: 404 };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('gap_intake_submissions')
    .select(SAFE_COLUMNS)
    .eq('link_token', token)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: 'not_found', status: 404 };
  }

  const row = data as unknown as GapIntakeRow;

  if (row.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', status: 410, row };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
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
