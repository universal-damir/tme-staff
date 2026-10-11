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
  /** Round 3: the customs line (portal vat_customs_lines.id) the file belongs to; absent = general file. */
  lineId?: number;
  /** Round 3: what the file is for that line. */
  docKind?: VatCustomsDocKind;
  /** Round 4: the confirmed email (lower case) of the person whose Send brought the file; absent = unknown (no code). */
  uploadedBy?: string;
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
  /** Round 3. Portal-owned: the import lines (empty = no customs table). */
  customs_lines?: VatCustomsPageLine[];
  /** Round 3. Portal-owned: "Same as last quarter" answer. */
  customs_defaults?: VatCustomsDefaults;
  /** Round 3. Client-owned: the answers, autosaved. */
  customs_answers?: VatCustomsAnswers;
  /** Round 3. Client-owned: last autosave. */
  customs_answers_saved_at?: string | null;
  /** Round 3. Client-owned: last Send that carried the answers. */
  customs_answers_sent_at?: string | null;
  /** Round 4. Portal-owned: who may open the page (lower case); empty / missing = anyone with the link (as before). */
  allowed_emails?: string[] | null;
  /** Round 4. Client-owned: the confirmed email of the last Send; null = unknown. */
  last_submitted_by?: string | null;
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
  /** Round 3: the customs table; empty = the page shows no table. */
  customsLines: VatCustomsPageLine[];
  /** Round 3: the client's saved answers (merged over each line's `answer`). */
  customsAnswers: VatCustomsAnswers;
  customsDefaults: VatCustomsDefaults;
  customsAnswersSentAt: string | null;
  /** Round 3: per-line files sent so far (name + line + kind), for the row ticks on the page. */
  lineFiles: Array<{ lineId: number; docKind: VatCustomsDocKind; name: string; uploadedAt: string }>;
  /** Round 4: the email the viewer confirmed with a code; null / missing = no code needed. */
  viewerEmail?: string | null;
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

// ============================================
// Round 3 (11.10.2026): the customs table
// Changed 11.10 after review: questions[] (all open ones) + replies map;
// delivery point = the place next to the Incoterm; optional when no Incoterm.
// ============================================
//
// The staff upload the FTA CSV; the portal keeps one line per import
// (portal table vat_customs_lines) and writes the client's view of them to
// vat_file_requests.customs_lines. The client answers on the page; tme-staff
// writes vat_file_requests.customs_answers (autosave) and, on Send, stamps
// customs_answers_sent_at. The portal pulls the answers in (same sync as the
// files). Ownership: the PORTAL writes customs_lines + customs_defaults, the
// CLIENT PAGE writes customs_answers + customs_answers_saved_at /
// customs_answers_sent_at. Neither side ever writes the other's columns.

/** Purpose of import. The last option is always 'other' (free text required). */
export const VAT_CUSTOMS_PURPOSE_OPTIONS = [
  { value: 'sale_stock', label: 'For sale / stock / trading' },
  { value: 'office_use', label: 'Office use / tools' },
  { value: 'fixed_asset', label: 'Shop fit-out / fixed asset' },
  { value: 'spare_parts', label: 'Spare parts / maintenance / repair' },
  { value: 'marketing_gifts', label: 'Marketing / gifts / give-away' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'staff_uniforms', label: 'Staff uniforms' },
  { value: 'demo_display', label: 'Demo / testing / event display' },
  { value: 'samples', label: 'Samples (not for sale)' },
  { value: 'replacement', label: 'Replacement (not for sale)' },
  { value: 'customer_return', label: 'Customer return / sales return' },
  { value: 'other', label: 'Other (please explain)' },
] as const;

/** Paid or free of charge. */
export const VAT_CUSTOMS_PAYMENT_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'will_be_paid', label: 'Will be paid' },
  { value: 'foc', label: 'FOC (free of charge)' },
  { value: 'other', label: 'Other (please explain)' },
] as const;

/** Incoterms 2020 as on the supplier invoice. */
export const VAT_CUSTOMS_INCOTERM_OPTIONS = [
  { value: 'EXW', label: 'EXW - Ex Works' },
  { value: 'FCA', label: 'FCA - Free Carrier' },
  { value: 'CPT', label: 'CPT - Carriage Paid To' },
  { value: 'CIP', label: 'CIP - Carriage and Insurance Paid To' },
  { value: 'DAP', label: 'DAP - Delivered at Place' },
  { value: 'DPU', label: 'DPU - Delivered at Place Unloaded' },
  { value: 'DDP', label: 'DDP - Delivered Duty Paid' },
  { value: 'FAS', label: 'FAS - Free Alongside Ship (sea)' },
  { value: 'FOB', label: 'FOB - Free on Board (sea)' },
  { value: 'CFR', label: 'CFR - Cost and Freight (sea)' },
  { value: 'CIF', label: 'CIF - Cost, Insurance and Freight (sea)' },
  { value: 'not_stated', label: 'Not stated on the invoice' },
  { value: 'other', label: 'Other (please explain)' },
] as const;

/**
 * Delivery point = the place named next to the Incoterm on the supplier
 * invoice (e.g. "CIP Dubai Airport" -> UAE - port / airport), NOT where the
 * goods went afterwards. 'outside_uae' and 'other' need the place text.
 */
export const VAT_CUSTOMS_DELIVERY_OPTIONS = [
  { value: 'uae_premises', label: 'UAE - our office / warehouse' },
  { value: 'uae_port', label: 'UAE - port / airport (e.g. "CIP Dubai Airport")' },
  { value: 'outside_uae', label: 'Outside the UAE (please name the place on the invoice)' },
  { value: 'other', label: 'Other (please explain)' },
] as const;

export type VatCustomsPurpose = (typeof VAT_CUSTOMS_PURPOSE_OPTIONS)[number]['value'];
export type VatCustomsPayment = (typeof VAT_CUSTOMS_PAYMENT_OPTIONS)[number]['value'];
export type VatCustomsIncoterm = (typeof VAT_CUSTOMS_INCOTERM_OPTIONS)[number]['value'];
export type VatCustomsDelivery = (typeof VAT_CUSTOMS_DELIVERY_OPTIONS)[number]['value'];

/** Longest free text kept in one answer field. */
export const VAT_CUSTOMS_MAX_TEXT_CHARS = 500;
/** Most parts one import may be split into (one per supplier invoice). */
export const VAT_CUSTOMS_MAX_PARTS = 20;

/**
 * One answer part. An import has one part, or one per supplier invoice when
 * one BOE covers several invoices (then invoiceRef names the invoice).
 * Every field may be empty while the client is still working.
 */
export interface VatCustomsAnswerPart {
  invoiceRef?: string;
  purpose?: VatCustomsPurpose | null;
  purposeOther?: string;
  payment?: VatCustomsPayment | null;
  paymentOther?: string;
  incoterm?: VatCustomsIncoterm | null;
  incotermOther?: string;
  delivery?: VatCustomsDelivery | null;
  /** The place (city / country / site); required for 'outside_uae' and 'other'. */
  deliveryPlace?: string;
  comment?: string;
}

/** The client's answer for one import line, keyed by the portal line id. */
export interface VatCustomsLineAnswer {
  parts: VatCustomsAnswerPart[];
  /**
   * The client's replies to TME's open questions on this line (see
   * VatCustomsPageLine.questions), keyed by question id. A reply belongs to
   * ONE question; it is never moved to another one.
   */
  replies?: Record<string, string>;
  /** ISO timestamp of the client's last change to this line. */
  updatedAt?: string;
  /** Round 4: the confirmed email of the person who made that change; absent = unknown. Never shown on the page. */
  savedBy?: string;
}

/** vat_file_requests.customs_answers: { "<portal line id>": VatCustomsLineAnswer } */
export type VatCustomsAnswers = Record<string, VatCustomsLineAnswer>;

/** One import line as the PORTAL writes it to vat_file_requests.customs_lines. */
export interface VatCustomsPageLine {
  /** Portal vat_customs_lines.id. The key of customs_answers. */
  id: number;
  /** 1-based order in the FTA list. */
  lineNo: number;
  /** YYYY-MM-DD */
  declarationDate: string | null;
  /** The BOE number. */
  declarationNo: string;
  transactionRefNo: string | null;
  /** AED, the FTA 'Total Value' (excluding VAT). */
  totalValue: number | null;
  /** AED, the FTA 'Total Vat'. */
  totalVat: number | null;
  /** The BOE is in the portal's documents for this line (client or staff). */
  hasBoe: boolean;
  /** At least one supplier invoice is in the portal's documents for this line. */
  hasInvoice: boolean;
  /** Answers TME already holds for this line (staff typed them, or an earlier Send). Prefills the page. */
  answer?: VatCustomsLineAnswer | null;
  /** TME's open (sent, not resolved) questions on this line, oldest first. Empty = none. */
  questions?: Array<{ id: number; text: string; askedAt: string }>;
}

/**
 * vat_file_requests.customs_defaults: the client's most common answer of the
 * last filing that had answers. Powers "Same as last quarter". Null = none.
 */
export type VatCustomsDefaults = VatCustomsAnswerPart | null;

/** What a per-line upload is (VatFileEntry.docKind). */
export type VatCustomsDocKind = 'boe' | 'invoice' | 'other';

function hasText(s: string | undefined | null): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * One part is answered: purpose, payment, incoterm and delivery chosen, with
 * the text each 'other' needs, and the place for 'outside_uae' / 'other'
 * delivery. Used by the page AND the portal, so both count progress alike.
 */
export function isVatCustomsPartComplete(part: VatCustomsAnswerPart | null | undefined): boolean {
  if (!part) return false;
  if (!part.purpose || (part.purpose === 'other' && !hasText(part.purposeOther))) return false;
  if (!part.payment || (part.payment === 'other' && !hasText(part.paymentOther))) return false;
  if (!part.incoterm || (part.incoterm === 'other' && !hasText(part.incotermOther))) return false;
  // No Incoterm on the invoice = no named place to give; the delivery point is optional then.
  if (part.incoterm === 'not_stated' && !part.delivery) return true;
  if (!part.delivery) return false;
  if ((part.delivery === 'outside_uae' || part.delivery === 'other') && !hasText(part.deliveryPlace)) return false;
  return true;
}

/** A line is answered when it has at least one part and every part is complete (split parts also need invoiceRef). */
export function isVatCustomsLineComplete(answer: VatCustomsLineAnswer | null | undefined): boolean {
  const parts = answer?.parts ?? [];
  if (parts.length === 0) return false;
  if (parts.length > 1 && parts.some((p) => !hasText(p.invoiceRef))) return false;
  return parts.every(isVatCustomsPartComplete);
}

/** The label of a stored option value ('' when unknown). */
export function vatCustomsOptionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null | undefined
): string {
  return options.find((o) => o.value === value)?.label ?? '';
}

// ============================================
// Round 4 (11.10.2026): email code on the link
// ============================================
//
// The link opens only for the addresses the request went to. The PORTAL
// writes vat_file_requests.allowed_emails (To + CC of every booked customs
// request / files request / reminder / customs questions email, TME's own
// addresses left out; addresses are only ever added). With the tme-staff
// switch VAT_FILES_EMAIL_CODE=on and a non-empty list, the page asks "Who
// are you?" (masked addresses), mails a 6-digit code and, after the right
// code, keeps a proof in the browser for VAT_FILES_PROOF_DAYS. Every upload /
// answer / reply then carries WHO (VatFileEntry.uploadedBy,
// VatCustomsLineAnswer.savedBy, vat_file_requests.last_submitted_by). An
// empty list (rows made before round 4) or the switch off = the page works
// as before, and the who fields stay absent.

/** Codes sent for the page (tme-staff only, service role; HMAC hashes only). */
export const VAT_FILE_EMAIL_CODES_TABLE = 'vat_file_email_codes';

/** How long the browser's proof stays valid after the right code. */
export const VAT_FILES_PROOF_DAYS = 7;

/** Digits in the code. */
export const VAT_FILES_CODE_LENGTH = 6;

const VAT_FILES_EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

/** Trimmed, lower-case address, or null when it does not look like one. */
export function normaliseVatFilesEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && VAT_FILES_EMAIL_RE.test(email) ? email : null;
}

/** The stored list, read leniently: valid addresses only, lower case, each once, in stored order. */
export function readVatAllowedEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const e = normaliseVatFilesEmail(v);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** The stored list plus new addresses (added at the end). Never removes one. */
export function mergeVatAllowedEmails(existing: unknown, add: readonly unknown[]): string[] {
  const out = readVatAllowedEmails(existing);
  for (const v of add) {
    const e = normaliseVatFilesEmail(v);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** Most letters a masked address ever shows before the stars. */
export const VAT_FILES_MASK_MAX_LETTERS = 4;

/** "d***@client.com". `reveal` = letters shown before the stars (to tell two addresses apart), at most 4. */
export function maskVatFilesEmail(email: string, reveal: number = 1): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const shown = local.slice(0, Math.max(1, Math.min(reveal, VAT_FILES_MASK_MAX_LETTERS, local.length - 1)));
  return `${shown}***${email.slice(at)}`;
}

/** One address the page offers under "Who are you?": an opaque id and the masked address. */
export interface VatFilesCodeAddress {
  id: string;
  masked: string;
}
