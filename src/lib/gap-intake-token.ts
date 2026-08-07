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

// Accounting / ERP systems offered in the intake dropdown. The three "no real
// system" answers (Excel, Word, None) come first — they are the most common
// reality for the clients we invite, and burying them at the bottom pushed
// people into "Other" to type the same three words by hand. Then the named
// systems alphabetically, then "Other", which must stay last because it reveals
// the free-text field. The portal stores the picked value in
// `accounting_software` and the free text in `accounting_software_other`.
//
// MUST STAY IN SYNC with the portal repo (`src/lib/gap-analysis/
// accounting-software.ts`). The combined 'None / spreadsheets' option was
// retired in 08.2026 when Excel and Word were split out; do not re-add it.
export const ACCOUNTING_SOFTWARE_OPTIONS = [
  'Excel',
  'Word',
  'None',
  'Focus',
  'FreshBooks',
  'Microsoft Dynamics 365',
  'Odoo',
  'Oracle NetSuite',
  'QuickBooks',
  'Sage',
  'SAP',
  'Tally',
  'Wafeq',
  'Xero',
  'Zoho Books',
  'Other',
] as const;

export type AccountingSoftwareOption = (typeof ACCOUNTING_SOFTWARE_OPTIONS)[number];

export function isAllowedAccountingSoftware(v: string): boolean {
  return (ACCOUNTING_SOFTWARE_OPTIONS as ReadonlyArray<string>).includes(v);
}

/**
 * Per-system guidance on producing the structured XML that UAE e-invoicing needs.
 *
 * This is TME's working estimate from each vendor's public documentation, not a
 * guarantee — exact capability depends on the client's edition, region and plan,
 * which the consultant confirms during the assessment. The intake page shows the
 * matching entry as soon as a client picks their system, so they immediately see
 * whether their tool can export XML and roughly how. "Other" has no entry (we
 * can't map free text); Excel / Word / None are handled as a reassurance.
 *
 * `xml`:
 *   'yes'   — the system natively produces structured XML e-invoices
 *   'maybe' — possible, but typically via a specific plan, region or add-on
 *   'no'    — no structured XML on its own; we'll recommend the simplest route
 */
export type XmlCapability = 'yes' | 'maybe' | 'no';

export interface AccountingSoftwareGuidance {
  xml: XmlCapability;
  /** One client-friendly sentence on how to obtain the XML / what to expect. */
  note: string;
}

export const ACCOUNTING_SOFTWARE_GUIDANCE: Record<string, AccountingSoftwareGuidance> = {
  Excel: {
    xml: 'no',
    note: "Excel produces a spreadsheet, not a structured XML e-invoice — and that's completely fine. We'll recommend a simple, right-sized tool so you're ready for the mandate.",
  },
  Word: {
    xml: 'no',
    note: "Word documents and the PDFs made from them carry no structured invoice data — and that's completely fine. We'll recommend a simple, right-sized tool so you're ready for the mandate.",
  },
  None: {
    xml: 'no',
    note: "No accounting system means there's no structured XML yet — and that's completely fine. We'll recommend a simple, right-sized tool so you're ready for the mandate.",
  },
  Focus: {
    xml: 'yes',
    note: 'Focus (Focus Softnet) is built for the region and supports e-invoicing, so it can export invoices as structured XML. Your Focus consultant can switch on the UAE e-invoice format.',
  },
  FreshBooks: {
    xml: 'no',
    note: "FreshBooks focuses on PDF invoicing and doesn't produce structured XML on its own. That's no problem — we'll suggest the simplest connector to make you compliant.",
  },
  'Microsoft Dynamics 365': {
    xml: 'yes',
    note: 'Dynamics 365 Finance includes Electronic Invoicing, which outputs invoices as XML using a configurable format. Your partner can map it to the UAE e-invoice standard.',
  },
  Odoo: {
    xml: 'yes',
    note: "Odoo's Accounting app can generate structured e-invoices (UBL / PEPPOL). Once e-invoicing is enabled in settings, the XML is attached to each customer invoice.",
  },
  'Oracle NetSuite': {
    xml: 'yes',
    note: "NetSuite's Electronic Invoicing SuiteApp generates UBL / PEPPOL XML. Once it's installed and enabled, invoices can be exported or sent as XML.",
  },
  QuickBooks: {
    xml: 'maybe',
    note: "QuickBooks sends PDF invoices by default. Structured XML is available through PEPPOL e-invoicing in some regions or via a connector app — we'll help you choose the right option.",
  },
  Sage: {
    xml: 'yes',
    note: 'Most Sage products (e.g. Sage 200, Sage X3) support UBL / PEPPOL e-invoicing, sometimes through an add-on. Your Sage partner can enable structured XML export.',
  },
  SAP: {
    xml: 'yes',
    note: "SAP's Document and Reporting Compliance (DRC) module produces statutory e-invoices in XML. Your SAP team can enable the UAE format and export it from the billing document.",
  },
  Tally: {
    xml: 'yes',
    note: 'TallyPrime has built-in e-invoicing that produces the structured invoice file. Enable e-invoicing under Features (F11) and export the XML from the voucher.',
  },
  Wafeq: {
    xml: 'yes',
    note: 'Wafeq is built for regional e-invoicing and generates compliant XML automatically. Once e-invoicing is switched on, you can download the XML from each invoice.',
  },
  Xero: {
    xml: 'yes',
    note: "Xero supports PEPPOL e-invoicing and structured invoice data. Where PEPPOL isn't yet available in your region, an approved e-invoicing app can generate the XML.",
  },
  'Zoho Books': {
    xml: 'maybe',
    note: 'Zoho Books supports e-invoicing and can export invoice data as XML, depending on your plan and region. Enable e-invoicing in Settings, then export the file or use the API.',
  },
};

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
  // E-invoicing pre-assessment fee the client must agree to before submitting.
  price_aed: number | null;
  // Client declared they issue no invoices (receive-only) — waives the sample
  // upload requirement; the ASP appointment is still mandatory.
  no_invoices_issued: boolean | null;
}

const SAFE_COLUMNS =
  'id, link_token, company_name, accounting_software, accounting_software_other, invoice_files, status, expires_at, price_aed, no_invoices_issued';

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
