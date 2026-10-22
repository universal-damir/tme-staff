/**
 * VAT filing round 4 B: email code on the client upload link (Damir 11.10.2026).
 *
 * The link /vat-files/<token> goes to every To and CC of the request, and
 * anyone holding it could open it. Now (switch VAT_FILES_EMAIL_CODE=on, and
 * the row has allowed_emails) the person picks their address from the masked
 * list ("Who are you?"), gets a 6-digit code by email and types it. A right
 * code gives the browser a proof (httpOnly cookie, scoped to this link's API
 * path, valid VAT_FILES_PROOF_DAYS) that every API route of the page checks.
 * Only addresses on the list get a code: someone else is told to ask TME to
 * add them (no domain-wide access).
 *
 * Same pattern as tme-sign src/lib/email-code.ts: only HMAC hashes of the
 * code and the proof are stored (vat_file_email_codes, DDL in the portal
 * repo: database/migrations/supabase_vat_files_email_code.sql); mail goes
 * through the Brevo SMTP relay with the portal's login
 * (BREVO_SMTP_USER / BREVO_SMTP_PASSWORD, the same values as tme-sign).
 *
 * The switch off, or an empty allowed_emails (every row made before round
 * 4), = the page works as before and nothing here runs.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { createTransport } from 'nodemailer';
import type { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from './supabase-server';
import {
  VAT_FILE_EMAIL_CODES_TABLE,
  VAT_FILES_CODE_LENGTH,
  VAT_FILES_PROOF_DAYS,
  VAT_FILES_MASK_MAX_LETTERS,
  maskVatFilesEmail,
  readVatAllowedEmails,
  type VatFileRequestRow,
  type VatFilesCodeAddress,
} from '@/types/vat-files';

type Supabase = ReturnType<typeof getSupabaseAdmin>;

export const CODE_TTL_MS = 10 * 60 * 1000;
export const PROOF_TTL_MS = VAT_FILES_PROOF_DAYS * 24 * 60 * 60 * 1000;
export const MAX_WRONG_TRIES = 5;
export const RESEND_WAIT_MS = 60 * 1000;
export const MAX_CODES_PER_EMAIL_PER_HOUR = 5;
export const MAX_CODES_PER_LINK_PER_HOUR = 10;
export const MAX_CODES_PER_IP_PER_HOUR = 20;

/**
 * Slow guessing over many codes (review 11.10.2026): wrong tries are summed
 * over every code of the last 24 hours, per link and per address (over all
 * links). Past the limit no new code goes out and no code is checked.
 */
export const WRONG_TRIES_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_WRONG_TRIES_PER_LINK_PER_DAY = 15;
export const MAX_WRONG_TRIES_PER_EMAIL_PER_DAY = 10;
export const TOO_MANY_WRONG_CODES_TEXT = 'Too many wrong codes. Please try again tomorrow or contact TME Services.';

/** Code rows of a link older than this are deleted when a new code is sent (no cron). */
export const CODE_ROWS_KEEP_DAYS = 30;

/** The proof cookie; its Path is the link's API folder, so each link has its own. */
export const VAT_FILES_PROOF_COOKIE = 'vat_files_proof';

const FROM = { name: 'TME Services', email: 'noreply@TME-Services.com' };

// ------------------------------------------------------------------
// Switch and list
// ------------------------------------------------------------------

/** VAT_FILES_EMAIL_CODE=on (Netlify env). Off = the page works as before. */
export function vatFilesEmailCodeOn(): boolean {
  return (process.env.VAT_FILES_EMAIL_CODE || '').trim().toLowerCase() === 'on';
}

/** The addresses that may open this row; empty = no code needed (a row made before round 4). */
export function allowedEmailsOf(row: Pick<VatFileRequestRow, 'allowed_emails'>): string[] {
  return readVatAllowedEmails(row.allowed_emails);
}

/** The switch is on AND the row names who may open it. */
export function codeRequiredFor(row: Pick<VatFileRequestRow, 'allowed_emails'>): boolean {
  return vatFilesEmailCodeOn() && allowedEmailsOf(row).length > 0;
}

let warnedFallback = false;

function secret(): string {
  // VAT_FILES_CODE_SECRET should be set on Netlify. The service key fallback
  // stays so codes and proofs already handed out keep matching if it is not
  // (the Netlify env cannot be checked from here); it mixes a database key
  // into a hash secret, so production says so once in the function log.
  if (!process.env.VAT_FILES_CODE_SECRET && process.env.NODE_ENV === 'production' && !warnedFallback) {
    warnedFallback = true;
    console.warn('vat-files-code: VAT_FILES_CODE_SECRET is not set, using SUPABASE_SERVICE_KEY');
  }
  const key = process.env.VAT_FILES_CODE_SECRET || process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('VAT_FILES_CODE_SECRET / SUPABASE_SERVICE_KEY is not set');
  return key;
}

function hmac(text: string): string {
  return createHmac('sha256', secret()).update(text).digest('hex');
}

function codeHash(requestId: string, email: string, code: string): string {
  return hmac(`vat-code:${requestId}:${email}:${code}`);
}

/** The proof alone names the person: its row holds the email. */
function proofHash(requestId: string, proof: string): string {
  return hmac(`vat-proof:${requestId}:${proof}`);
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The opaque id of an address under "Who are you?" (the browser never sees the address). */
export function addressId(requestId: string, email: string): string {
  return hmac(`vat-address:${requestId}:${email}`).slice(0, 16);
}

/**
 * "Who are you?": every allowed address masked (d***@client.com), with more
 * letters shown where two would otherwise look the same.
 */
export function maskedAddresses(requestId: string, emails: string[]): VatFilesCodeAddress[] {
  const counted = (list: string[]) => {
    const counts = new Map<string, number>();
    list.forEach((m) => counts.set(m, (counts.get(m) ?? 0) + 1));
    return counts;
  };
  const masks = emails.map((e) => maskVatFilesEmail(e, 1));
  for (let reveal = 2; reveal <= VAT_FILES_MASK_MAX_LETTERS; reveal++) {
    const counts = counted(masks);
    if ([...counts.values()].every((n) => n === 1)) break;
    emails.forEach((e, i) => {
      if ((counts.get(masks[i]) ?? 0) > 1) masks[i] = maskVatFilesEmail(e, reveal);
    });
  }
  // Still two the same after 4 letters: number them per domain
  // ("address 1 at client.com"), never more letters.
  const counts = counted(masks);
  const perDomain = new Map<string, number>();
  emails.forEach((e, i) => {
    if ((counts.get(masks[i]) ?? 0) < 2) return;
    const domain = e.slice(e.lastIndexOf('@') + 1);
    const n = (perDomain.get(domain) ?? 0) + 1;
    perDomain.set(domain, n);
    masks[i] = `address ${n} at ${domain}`;
  });
  return emails.map((e, i) => ({ id: addressId(requestId, e), masked: masks[i] }));
}

/** The allowed address behind an id from "Who are you?", or null. */
export function emailForChoice(requestId: string, emails: string[], choice: unknown): string | null {
  if (typeof choice !== 'string' || !/^[0-9a-f]{16}$/.test(choice)) return null;
  return emails.find((e) => addressId(requestId, e) === choice) ?? null;
}

// ------------------------------------------------------------------
// The code email
// ------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Subject, plain text and HTML of the code email (pure, for the tests). */
export function codeEmailContent(code: string, companyName: string | null): { subject: string; text: string; html: string } {
  const forWhat = companyName ? `the VAT filing documents of ${companyName}` : 'your VAT filing documents';
  const text =
    `Hello,\n\n` +
    `Your code to open the page for ${forWhat} is:\n\n${code}\n\n` +
    `The code works for 10 minutes. Please type it on the page.\n\n` +
    `If you did not ask for this code, you can ignore this email.`;
  const html =
    `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">` +
    `<p>Hello,</p>` +
    `<p>Your code to open the page for ${escapeHtml(forWhat)} is:</p>` +
    `<p style="font-size: 26px; font-weight: bold; letter-spacing: 6px; color: #243F7B;">${code}</p>` +
    `<p>The code works for 10 minutes. Please type it on the page.</p>` +
    `<p>If you did not ask for this code, you can ignore this email.</p>` +
    `</div>`;
  // No code in the subject (it shows in lock-screen previews), as in tme-sign.
  return { subject: 'Your TME Services code', text, html };
}

/**
 * Local testing only: next dev without a Brevo login prints the code instead
 * of mailing it, and the page shows it in a yellow "Dev only" box. Never true
 * on Netlify (NODE_ENV is production there).
 */
export function vatFilesDevCodeOnPage(): boolean {
  return process.env.NODE_ENV === 'development' && !(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASSWORD);
}

async function mailCode(to: string, code: string, companyName: string | null): Promise<boolean> {
  const { subject, text, html } = codeEmailContent(code, companyName);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASSWORD;
  if (!user || !pass) {
    // Local testing only: the code is printed instead of mailed.
    if (process.env.NODE_ENV === 'development') {
      console.log(`[vat-files/code] DEV, no Brevo SMTP login: code for ${to} is ${code}`);
      return true;
    }
    console.error('[vat-files/code] BREVO_SMTP_USER / BREVO_SMTP_PASSWORD are not set');
    return false;
  }
  try {
    // Same Brevo SMTP relay and login as the portal and tme-sign. Brevo's web
    // API only takes calls from approved IP addresses, and Netlify's change.
    const transport = createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    await transport.sendMail({ from: `"${FROM.name}" <${FROM.email}>`, to, subject, html, text });
    return true;
  } catch (err) {
    console.error('[vat-files/code] Brevo SMTP send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

// ------------------------------------------------------------------
// Wrong tries over 24 hours
// ------------------------------------------------------------------

interface TriedCode {
  attempts: number | null;
  verified_at: string | null;
}

/** Wrong tries in these code rows: every try counts, except the right one of a used code. Pure. */
export function wrongTriesIn(rows: TriedCode[]): number {
  return rows.reduce((sum, r) => sum + Math.max(0, (Number(r.attempts) || 0) - (r.verified_at ? 1 : 0)), 0);
}

/** The "try again tomorrow" sentence when the link or the address had too many wrong tries, or null. Pure. */
export function wrongTriesProblem(forLink: TriedCode[], forEmail: TriedCode[]): string | null {
  return wrongTriesIn(forLink) >= MAX_WRONG_TRIES_PER_LINK_PER_DAY || wrongTriesIn(forEmail) >= MAX_WRONG_TRIES_PER_EMAIL_PER_DAY
    ? TOO_MANY_WRONG_CODES_TEXT
    : null;
}

/** 429 when the last 24 hours had too many wrong tries; 500 when they cannot be read; null = go on. */
async function wrongTriesBlock(
  supabase: Supabase,
  requestId: string,
  email: string
): Promise<{ ok: false; status: number; error: string; message: string } | null> {
  const since = new Date(Date.now() - WRONG_TRIES_WINDOW_MS).toISOString();
  const table = () => supabase.from(VAT_FILE_EMAIL_CODES_TABLE);
  const [byLink, byEmail] = await Promise.all([
    table().select('attempts, verified_at').eq('request_id', requestId).gte('created_at', since),
    table().select('attempts, verified_at').eq('email', email).gte('created_at', since),
  ]);
  if (byLink.error || byEmail.error) {
    console.error('[vat-files/code] reading wrong tries failed:', (byLink.error || byEmail.error)?.message);
    return { ok: false, status: 500, error: 'code_failed', message: 'Something went wrong. Please try again.' };
  }
  const problem = wrongTriesProblem((byLink.data ?? []) as TriedCode[], (byEmail.data ?? []) as TriedCode[]);
  return problem ? { ok: false, status: 429, error: 'too_many_wrong_codes', message: problem } : null;
}

// ------------------------------------------------------------------
// Send a code
// ------------------------------------------------------------------

export type CodeResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string; message: string };

interface RecentCode {
  id: string;
  email: string;
  created_at: string;
}

/**
 * Why no code may go out now, or null. Per address: one a minute, 5 an hour.
 * Per link: 10 an hour. Per browser IP: 20 an hour over all links. Pure.
 */
export function codeLimitProblem(forLink: RecentCode[], fromIp: RecentCode[], email: string, now: number = Date.now()): string | null {
  const mine = forLink.filter((r) => r.email === email);
  if (mine.some((r) => now - (Date.parse(r.created_at) || 0) < RESEND_WAIT_MS)) {
    return 'A code was just sent. Please wait a minute before asking for a new one.';
  }
  if (
    mine.length >= MAX_CODES_PER_EMAIL_PER_HOUR ||
    forLink.length >= MAX_CODES_PER_LINK_PER_HOUR ||
    fromIp.length >= MAX_CODES_PER_IP_PER_HOUR
  ) {
    return 'Too many codes were asked for. Please try again in an hour.';
  }
  return null;
}

const failed = (message = 'We could not send the code. Please try again.'): CodeResult => ({
  ok: false,
  status: 500,
  error: 'code_failed',
  message,
});

/**
 * Mint a code for this address on this link and mail it, within the limits.
 * The limits are checked again after the insert, the new row left out:
 * requests fired in parallel all see each other then, and none of them mails.
 */
export async function sendVatFilesCode(
  supabase: Supabase,
  args: { requestId: string; email: string; ip: string | null; companyName: string | null }
): Promise<CodeResult<{ devCode?: string }>> {
  const table = () => supabase.from(VAT_FILE_EMAIL_CODES_TABLE);
  const recent = async (): Promise<{ forLink: RecentCode[]; fromIp: RecentCode[] } | null> => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [byLink, byIp] = await Promise.all([
      table().select('id, email, created_at').eq('request_id', args.requestId).gte('created_at', hourAgo),
      args.ip
        ? table().select('id, email, created_at').eq('sent_ip', args.ip).gte('created_at', hourAgo)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (byLink.error || byIp.error) {
      console.error('[vat-files/code] reading earlier codes failed:', (byLink.error || byIp.error)?.message);
      return null;
    }
    return { forLink: (byLink.data ?? []) as RecentCode[], fromIp: (byIp.data ?? []) as RecentCode[] };
  };

  const blocked = await wrongTriesBlock(supabase, args.requestId, args.email);
  if (blocked) return blocked;

  const before = await recent();
  if (!before) return failed();
  const problem = codeLimitProblem(before.forLink, before.fromIp, args.email);
  if (problem) return { ok: false, status: 429, error: 'too_many_codes', message: problem };

  const code = String(randomInt(0, 10 ** VAT_FILES_CODE_LENGTH)).padStart(VAT_FILES_CODE_LENGTH, '0');
  const { data: inserted, error: insertError } = await table()
    .insert({
      request_id: args.requestId,
      email: args.email,
      code_hash: codeHash(args.requestId, args.email, code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      sent_ip: args.ip,
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    console.error('[vat-files/code] storing the code failed:', insertError?.message);
    return failed();
  }
  const ownId = (inserted as { id: string }).id;
  const drop = () => table().delete().eq('id', ownId);

  const after = await recent();
  const others = (rows: RecentCode[]) => rows.filter((r) => r.id !== ownId);
  const raced = after ? codeLimitProblem(others(after.forLink), others(after.fromIp), args.email) : 'failed';
  if (raced) {
    await drop();
    return after ? { ok: false, status: 429, error: 'too_many_codes', message: raced } : failed();
  }

  if (!(await mailCode(args.email, code, args.companyName))) {
    await drop();
    return {
      ok: false,
      status: 502,
      error: 'mail_failed',
      message: 'We could not send the code. Please try again, or reply to our email.',
    };
  }

  // Housekeeping without a cron: this link's code rows older than 30 days go.
  const old = new Date(Date.now() - CODE_ROWS_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: cleanError } = await table().delete().eq('request_id', args.requestId).lt('created_at', old);
  if (cleanError) console.error('[vat-files/code] deleting old code rows failed:', cleanError.message);
  return vatFilesDevCodeOnPage() ? { ok: true, devCode: code } : { ok: true };
}

// ------------------------------------------------------------------
// Check a code
// ------------------------------------------------------------------

/**
 * Check a typed code against the newest code for this address. 5 wrong tries
 * end that code. A right code returns the proof for the cookie.
 */
export async function checkVatFilesCode(
  supabase: Supabase,
  args: { requestId: string; email: string; code: string }
): Promise<CodeResult<{ proof: string; expiresAt: string }>> {
  const table = () => supabase.from(VAT_FILE_EMAIL_CODES_TABLE);
  const bad = (status: number, error: string, message: string) => ({ ok: false as const, status, error, message });
  const blocked = await wrongTriesBlock(supabase, args.requestId, args.email);
  if (blocked) return blocked;
  const { data, error } = await table()
    .select('id, code_hash, expires_at, attempts, verified_at')
    .eq('request_id', args.requestId)
    .eq('email', args.email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[vat-files/code] reading the code failed:', error.message);
    return bad(500, 'code_failed', 'We could not check the code. Please try again.');
  }
  const row = data as { id: string; code_hash: string; expires_at: string; attempts: number; verified_at: string | null } | null;
  if (!row || row.verified_at) return bad(400, 'code_new_needed', 'Please ask for a new code.');
  if (Date.parse(row.expires_at) < Date.now()) {
    return bad(400, 'code_expired', 'This code has expired. Please ask for a new one.');
  }
  if (row.attempts >= MAX_WRONG_TRIES) {
    return bad(400, 'code_too_many_tries', 'Too many wrong tries. Please ask for a new code.');
  }

  // Count the try first, only if nobody else counted one meanwhile, so two
  // parallel guesses cannot both slip under the limit.
  const { data: counted, error: countError } = await table()
    .update({ attempts: row.attempts + 1 })
    .eq('id', row.id)
    .eq('attempts', row.attempts)
    .is('verified_at', null)
    .select('id');
  if (countError || !counted || counted.length === 0) return bad(409, 'code_retry', 'Please try again.');

  if (!sameHash(codeHash(args.requestId, args.email, args.code), row.code_hash)) {
    const left = MAX_WRONG_TRIES - row.attempts - 1;
    return left > 0
      ? bad(400, 'code_wrong', 'This code is not right. Please check the email and try again.')
      : bad(400, 'code_too_many_tries', 'Too many wrong tries. Please ask for a new code.');
  }

  const proof = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PROOF_TTL_MS).toISOString();
  // Only the first right check wins: a second one at the same moment must
  // not overwrite the first browser's proof.
  const { data: verified, error: verifyError } = await table()
    .update({ verified_at: new Date().toISOString(), proof_hash: proofHash(args.requestId, proof), proof_expires_at: expiresAt })
    .eq('id', row.id)
    .is('verified_at', null)
    .select('id');
  if (verifyError) {
    console.error('[vat-files/code] storing the check failed:', verifyError.message);
    return bad(500, 'code_failed', 'We could not check the code. Please try again.');
  }
  if (!verified || verified.length === 0) return bad(409, 'code_retry', 'Please try again.');
  return { ok: true, proof, expiresAt };
}

/**
 * The address a still-valid proof of this link belongs to, or null. The
 * address must still be on the row's list (the portal never removes one; if
 * someone did by hand, the proof stops working).
 */
export async function emailForProof(supabase: Supabase, requestId: string, allowed: string[], proof: unknown): Promise<string | null> {
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(proof)) return null;
  const { data, error } = await supabase
    .from(VAT_FILE_EMAIL_CODES_TABLE)
    .select('email, verified_at, proof_expires_at')
    .eq('request_id', requestId)
    .eq('proof_hash', proofHash(requestId, proof))
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { email: string; verified_at: string | null; proof_expires_at: string | null };
  if (!row.verified_at || !row.proof_expires_at || Date.parse(row.proof_expires_at) < Date.now()) return null;
  return allowed.includes(row.email) ? row.email : null;
}

// ------------------------------------------------------------------
// The gate every page route runs
// ------------------------------------------------------------------

/** The API folder of one link: the cookie's Path. */
export function proofCookiePath(token: string): string {
  return `/api/vat-files/${token}`;
}

export type VatFilesViewer =
  /** `email` null = no code needed (switch off, or a row without a list). */
  | { ok: true; email: string | null }
  | { ok: false; status: 401; body: { error: 'email_code_required'; addresses: VatFilesCodeAddress[] } };

/**
 * Who is calling: the confirmed address when the row needs a code, null when
 * it does not; 401 `email_code_required` (with the masked list for "Who are
 * you?") when it needs one and the browser has no valid proof.
 */
export async function vatFilesViewer(req: NextRequest, row: VatFileRequestRow): Promise<VatFilesViewer> {
  if (!vatFilesEmailCodeOn()) return { ok: true, email: null };
  const allowed = allowedEmailsOf(row);
  if (allowed.length === 0) return { ok: true, email: null };
  const proof = req.cookies.get(VAT_FILES_PROOF_COOKIE)?.value;
  const email = proof ? await emailForProof(getSupabaseAdmin(), row.id, allowed, proof) : null;
  if (email) return { ok: true, email };
  return { ok: false, status: 401, body: { error: 'email_code_required', addresses: maskedAddresses(row.id, allowed) } };
}

/** Store the proof in the browser: httpOnly, only sent to this link's API, 7 days. */
export function setProofCookie(res: NextResponse, token: string, proof: string): void {
  res.cookies.set(VAT_FILES_PROOF_COOKIE, proof, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: proofCookiePath(token),
    maxAge: Math.floor(PROOF_TTL_MS / 1000),
  });
}

/**
 * "Not you?": the proof stops working on the server too (a copied cookie
 * cannot be used any more). Best effort: the cookie is cleared either way.
 */
export async function revokeProof(supabase: Supabase, requestId: string, proof: unknown): Promise<void> {
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(proof)) return;
  const { error } = await supabase
    .from(VAT_FILE_EMAIL_CODES_TABLE)
    .update({ proof_hash: null, proof_expires_at: null })
    .eq('request_id', requestId)
    .eq('proof_hash', proofHash(requestId, proof));
  if (error) console.error('[vat-files/code] revoking the proof failed:', error.message);
}

/** "Not you?": forget the proof in this browser. */
export function clearProofCookie(res: NextResponse, token: string): void {
  res.cookies.set(VAT_FILES_PROOF_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: proofCookiePath(token),
    maxAge: 0,
  });
}

/**
 * A POST from another site (CSRF, someone making the page mail codes): the
 * browser says so in Sec-Fetch-Site / Origin. Missing headers (curl, old
 * browsers) pass; the code limits still hold.
 */
export function isCrossSitePost(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== (req.headers.get('host') || req.nextUrl.host);
  } catch {
    return true;
  }
}
