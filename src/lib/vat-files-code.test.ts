// @vitest-environment node
// Round 4 B: email code on the VAT filing upload link. In-memory stand-in for
// the service-role client (vat_file_requests + vat_file_email_codes + the
// bucket) and a mocked nodemailer: no email ever leaves the test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db: { requests: Row[]; codes: Row[]; objects: Map<string, number>; nextId: number } = {
  requests: [],
  codes: [],
  objects: new Map(),
  nextId: 1,
};
const mails: Array<{ to: string; subject: string; text: string; from: string }> = [];
let mailFails = false;
/** Runs before an update is applied: lets a test play "another request got there first". */
let beforeUpdate: ((patch: Row) => void) | null = null;

vi.mock('nodemailer', () => ({
  createTransport: () => ({
    async sendMail(m: { to: string; subject: string; text: string; from: string }) {
      if (mailFails) throw new Error('smtp down');
      mails.push(m);
      return { messageId: 'x' };
    },
  }),
}));

type Filter = (r: Row) => boolean;

/** A tiny PostgREST-like builder: filters, then a terminal or a plain await. */
function builder(rows: () => Row[], tableName: string) {
  return {
    select() {
      const filters: Filter[] = [];
      let order: { col: string; asc: boolean } | null = null;
      let limit: number | null = null;
      const run = () => {
        let hits = rows().filter((r) => filters.every((f) => f(r)));
        if (order) {
          const { col, asc } = order;
          hits = [...hits].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        if (limit !== null) hits = hits.slice(0, limit);
        return hits.map((h) => structuredClone(h));
      };
      const q = {
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return q;
        },
        gte(col: string, val: string) {
          filters.push((r) => String(r[col]) >= val);
          return q;
        },
        order(col: string, opts: { ascending: boolean }) {
          order = { col, asc: opts.ascending };
          return q;
        },
        limit(n: number) {
          limit = n;
          return q;
        },
        async maybeSingle() {
          return { data: run()[0] ?? null, error: null };
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve({ data: run(), error: null }).then(resolve);
        },
      };
      return q;
    },
    insert(values: Row) {
      const row: Row = { id: `code-${db.nextId++}`, created_at: new Date().toISOString(), attempts: 0, verified_at: null, ...values };
      return {
        select() {
          return {
            async single() {
              rows().push(row);
              return { data: { id: row.id }, error: null };
            },
          };
        },
      };
    },
    update(patch: Row) {
      const filters: Filter[] = [];
      const apply = () => {
        beforeUpdate?.(patch);
        const hits = rows().filter((r) => filters.every((f) => f(r)));
        hits.forEach((r) => Object.assign(r, structuredClone(patch)));
        return hits;
      };
      const q = {
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return q;
        },
        is(col: string, val: unknown) {
          filters.push((r) => (r[col] ?? null) === val);
          return q;
        },
        async select() {
          return { data: apply().map((r) => ({ id: r.id })), error: null };
        },
        then(resolve: (v: { error: null }) => unknown) {
          apply();
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return q;
    },
    delete() {
      const filters: Filter[] = [];
      const q = {
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return q;
        },
        lt(col: string, val: string) {
          filters.push((r) => String(r[col]) < val);
          return q;
        },
        then(resolve: (v: { error: null }) => unknown) {
          const keep = rows().filter((r) => !filters.every((f) => f(r)));
          if (tableName === 'vat_file_email_codes') db.codes = keep;
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

function makeClient() {
  return {
    from(table: string) {
      if (table === 'vat_file_requests') return builder(() => db.requests, table);
      if (table === 'vat_file_email_codes') return builder(() => db.codes, table);
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from() {
        return {
          async upload(path: string, bytes: Uint8Array) {
            db.objects.set(path, bytes.length);
            return { data: { path }, error: null };
          },
          async list(folder: string) {
            const data = [...db.objects.entries()]
              .filter(([p]) => p.startsWith(`${folder}/`))
              .map(([p, size]) => ({ id: p, name: p.slice(folder.length + 1), metadata: { size } }));
            return { data, error: null };
          },
          async remove() {
            return { data: [], error: null };
          },
          async createSignedUrl(path: string) {
            return { data: { signedUrl: `https://supabase.test/sign/${path}` }, error: null };
          },
        };
      },
    },
  };
}

vi.mock('@/lib/supabase-server', () => ({ getSupabaseAdmin: () => makeClient() }));

import { GET } from '@/app/api/vat-files/[token]/route';
import { POST as UPLOAD, DELETE as UPLOAD_DELETE } from '@/app/api/vat-files/[token]/upload/route';
import { POST as SEND } from '@/app/api/vat-files/[token]/send/route';
import { POST as ANSWERS } from '@/app/api/vat-files/[token]/answers/route';
import { GET as CUSTOMS } from '@/app/api/vat-files/[token]/customs-list/route';
import { POST as CODE_SEND } from '@/app/api/vat-files/[token]/code/send/route';
import { POST as CODE_CHECK } from '@/app/api/vat-files/[token]/code/check/route';
import { DELETE as CODE_FORGET } from '@/app/api/vat-files/[token]/code/route';
import {
  RESEND_WAIT_MS,
  TOO_MANY_WRONG_CODES_TEXT,
  codeEmailContent,
  codeLimitProblem,
  maskedAddresses,
  wrongTriesIn,
  wrongTriesProblem,
  VAT_FILES_PROOF_COOKIE,
} from '@/lib/vat-files-code';
import { mergeVatAllowedEmails, maskVatFilesEmail, normaliseVatFilesEmail } from '@/types/vat-files';

const TOKEN = 'TokenAbcdefghij0123456789';
const ROW_ID = '11111111-2222-3333-4444-555555555555';
const ENV = 'sandbox';
const ANNA = 'anna@client.com';
const BEN = 'ben@client.com';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x0a, 0x0a, 0x0a]);

function seed(over: Row = {}) {
  db.requests = [
    {
      id: ROW_ID,
      link_token: TOKEN,
      environment: ENV,
      portal_filing_id: 77,
      company_code: '10039',
      company_name: 'Sample FZCO',
      period_key: '2606-2608',
      period_label: 'Jun - Aug 2026 (2606-2608)',
      kind: 'customs',
      requested_items: ['Bills of Entry'],
      customs_list_path: `${ENV}/${TOKEN}/customs-list.xlsx`,
      deadline: '2026-10-20',
      status: 'open',
      files: [],
      client_comment: null,
      last_submitted_at: null,
      created_at: '2026-10-09T08:00:00Z',
      updated_at: '2026-10-09T08:00:00Z',
      expires_at: null,
      customs_lines: [{ id: 501, lineNo: 1, declarationNo: '101', declarationDate: '2026-07-01', totalValue: 100, totalVat: 5 }],
      customs_answers: {},
      allowed_emails: [ANNA, BEN],
      ...over,
    },
  ];
  db.codes = [];
  db.objects = new Map();
  mails.length = 0;
  mailFails = false;
  beforeUpdate = null;
}

const params = () => ({ params: Promise.resolve({ token: TOKEN }) });
const url = (suffix = '') => `http://x/api/vat-files/${TOKEN}${suffix}`;
const withCookie = (proof?: string): Record<string, string> => (proof ? { cookie: `${VAT_FILES_PROOF_COOKIE}=${proof}` } : {});

const load = (proof?: string) => GET(new NextRequest(url(), { headers: withCookie(proof) }), params());
const idOf = (email: string) => maskedAddresses(ROW_ID, [email])[0].id;
const askCode = (email: string, headers: Record<string, string> = {}) =>
  CODE_SEND(
    new NextRequest(url('/code/send'), { method: 'POST', body: JSON.stringify({ choice: idOf(email) }), headers }),
    params()
  );
const check = (email: string, code: string) =>
  CODE_CHECK(new NextRequest(url('/code/check'), { method: 'POST', body: JSON.stringify({ choice: idOf(email), code }) }), params());
const lastCode = () => /\b(\d{6})\b/.exec(mails[mails.length - 1].text)?.[1] as string;
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

/** The proof cookie a right code set. */
function proofFrom(res: Response): string {
  const set = res.headers.get('set-cookie') || '';
  const m = new RegExp(`${VAT_FILES_PROOF_COOKIE}=([^;]+)`).exec(set);
  return m ? m[1] : '';
}

/** The whole flow for one person: code by email, right code, proof back. */
async function confirm(email: string): Promise<string> {
  expect((await askCode(email)).status).toBe(200);
  const res = await check(email, lastCode());
  expect(res.status).toBe(200);
  return proofFrom(res);
}

async function uploadAs(proof: string, name: string) {
  const fd = new FormData();
  fd.append('file', new File([PDF], name));
  const res = await UPLOAD(new NextRequest(url('/upload'), { method: 'POST', body: fd, headers: withCookie(proof) }), params());
  return (await res.json()) as { path: string };
}
const sendAs = (proof: string, body: unknown) =>
  SEND(new NextRequest(url('/send'), { method: 'POST', body: JSON.stringify(body), headers: withCookie(proof) }), params());

beforeEach(() => {
  seed();
  vi.stubEnv('VAT_FILES_EMAIL_CODE', 'on');
  vi.stubEnv('VAT_FILES_CODE_SECRET', 'test-secret');
  vi.stubEnv('BREVO_SMTP_USER', 'u');
  vi.stubEnv('BREVO_SMTP_PASSWORD', 'p');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('shared helpers (types mirror)', () => {
  it('normalise, merge (add only, lower case, each once), mask', () => {
    expect(normaliseVatFilesEmail(' Anna@Client.COM ')).toBe(ANNA);
    expect(normaliseVatFilesEmail('not an email')).toBeNull();
    expect(mergeVatAllowedEmails([ANNA, 'junk'], ['ANNA@client.com', BEN, null])).toEqual([ANNA, BEN]);
    expect(mergeVatAllowedEmails(null, [BEN])).toEqual([BEN]);
    expect(maskVatFilesEmail(ANNA)).toBe('a***@client.com');
    expect(maskVatFilesEmail('x@client.com')).toBe('x***@client.com');
  });

  it('masked list tells look-alike addresses apart, never shows the full address', () => {
    const list = maskedAddresses(ROW_ID, ['anna@c.com', 'alex@c.com', 'ben@c.com']);
    expect(list.map((a) => a.masked)).toEqual(['an***@c.com', 'al***@c.com', 'b***@c.com']);
    expect(new Set(list.map((a) => a.id)).size).toBe(3);
    expect(JSON.stringify(list)).not.toContain('anna@');
  });

  it('masks show at most 4 letters; still alike after that = numbered per domain', () => {
    expect(maskVatFilesEmail('annabel@c.com', 9)).toBe('anna***@c.com');
    const list = maskedAddresses(ROW_ID, ['annabel@c.com', 'annabeth@c.com', 'ben@c.com', 'annalisa@d.com']);
    expect(list.map((a) => a.masked)).toEqual(['address 1 at c.com', 'address 2 at c.com', 'b***@c.com', 'a***@d.com']);
    expect(JSON.stringify(list)).not.toContain('annab');
  });

  it('code email: plain, TME sender, the code only in the body, never in the subject', () => {
    const c = codeEmailContent('123456', 'Sample FZCO');
    expect(c.subject).toBe('Your TME Services code');
    expect(c.subject).not.toMatch(/\d/);
    expect(c.text).toContain('123456');
    expect(c.text).toContain('10 minutes');
    expect(c.html).not.toContain('<script');
  });

  it('limits: one a minute per address, 5 an hour per address, 10 per link, 20 per IP', () => {
    const now = Date.parse('2026-10-11T10:00:00Z');
    const at = (msAgo: number, email = ANNA, i = 0) => ({ id: `${email}-${msAgo}-${i}`, email, created_at: new Date(now - msAgo).toISOString() });
    expect(codeLimitProblem([at(RESEND_WAIT_MS - 1000)], [], ANNA, now)).toMatch(/wait a minute/);
    expect(codeLimitProblem([at(RESEND_WAIT_MS + 1000)], [], ANNA, now)).toBeNull();
    expect(codeLimitProblem([1, 2, 3, 4, 5].map((n) => at(n * 120_000)), [], ANNA, now)).toMatch(/Too many/);
    expect(codeLimitProblem(Array.from({ length: 9 }, (_, i) => at(120_000, BEN, i)), [], ANNA, now)).toBeNull();
    expect(codeLimitProblem(Array.from({ length: 10 }, (_, i) => at(120_000, BEN, i)), [], ANNA, now)).toMatch(/Too many/);
    expect(codeLimitProblem([], Array.from({ length: 20 }, (_, i) => at(120_000, BEN, i)), ANNA, now)).toMatch(/Too many/);
  });
});

describe('the code flow', () => {
  it('without a proof every page route answers 401 email_code_required; GET carries the masked list', async () => {
    const res = await load();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('email_code_required');
    expect(body.addresses.map((a: { masked: string }) => a.masked)).toEqual(['a***@client.com', 'b***@client.com']);
    expect(JSON.stringify(body)).not.toContain(ANNA);
    expect(JSON.stringify(body)).not.toContain('Sample FZCO');

    const fd = new FormData();
    fd.append('file', new File([PDF], 'a.pdf'));
    expect((await UPLOAD(new NextRequest(url('/upload'), { method: 'POST', body: fd }), params())).status).toBe(401);
    expect((await sendAs('', { files: [], comment: '' })).status).toBe(401);
    expect((await ANSWERS(new NextRequest(url('/answers'), { method: 'POST', body: '{"answers":{}}' }), params())).status).toBe(401);
    expect((await CUSTOMS(new NextRequest(url('/customs-list')), params())).status).toBe(401);
    expect(db.objects.size).toBe(0);
  });

  it('right code -> proof cookie (httpOnly, path of this link, 7 days) -> the page opens with viewerEmail', async () => {
    expect((await askCode(ANNA)).status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(ANNA);
    expect(mails[0].from).toContain('noreply@TME-Services.com');
    expect(mails[0].subject).toBe('Your TME Services code');
    // Only hashes are stored.
    expect(JSON.stringify(db.codes)).not.toContain(lastCode());

    const res = await check(ANNA, lastCode());
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') || '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain(`Path=/api/vat-files/${TOKEN}`);
    expect(cookie).toMatch(/Max-Age=604800/);
    const proof = proofFrom(res);
    expect(JSON.stringify(db.codes)).not.toContain(proof);

    const page = await load(proof);
    expect(page.status).toBe(200);
    expect((await page.json()).viewerEmail).toBe(ANNA);
    expect((await CUSTOMS(new NextRequest(url('/customs-list'), { headers: withCookie(proof) }), params())).status).toBe(302);
  });

  it('wrong code: 400 with a sentence; the 5th wrong try ends the code, even the right one then fails', async () => {
    await askCode(ANNA);
    const right = lastCode();
    for (let i = 1; i <= 4; i++) {
      const res = await check(ANNA, wrong(right));
      expect(res.status).toBe(400);
      expect((await res.json()).errorMessage).toMatch(/not right/);
    }
    const fifth = await check(ANNA, wrong(right));
    expect((await fifth.json()).errorMessage).toMatch(/Too many wrong tries/);
    const late = await check(ANNA, right);
    expect(late.status).toBe(400);
    expect((await late.json()).error).toBe('code_too_many_tries');
    expect(proofFrom(late)).toBe('');
  });

  it('expired code (after 10 minutes) is refused', async () => {
    await askCode(ANNA);
    db.codes[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await check(ANNA, lastCode());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('code_expired');
  });

  it('a used code cannot be used twice', async () => {
    await askCode(ANNA);
    const code = lastCode();
    expect((await check(ANNA, code)).status).toBe(200);
    expect((await (await check(ANNA, code)).json()).error).toBe('code_new_needed');
  });

  it('expired proof (after 7 days) asks for the code again', async () => {
    const proof = await confirm(ANNA);
    expect((await load(proof)).status).toBe(200);
    db.codes[0].proof_expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await load(proof);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('email_code_required');
  });

  it('a proof of another link, or made-up, does not open the page', async () => {
    const proof = await confirm(ANNA);
    db.codes[0].request_id = 'another-row';
    expect((await load(proof)).status).toBe(401);
    expect((await load('x'.repeat(43))).status).toBe(401);
  });

  it('an address not on the list gets no code (unknown_address), and nothing is mailed', async () => {
    const res = await askCode('eve@client.com');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_address');
    const raw = await CODE_SEND(
      new NextRequest(url('/code/send'), { method: 'POST', body: JSON.stringify({ choice: 'eve@client.com' }) }),
      params()
    );
    expect(raw.status).toBe(400);
    expect(mails).toHaveLength(0);
    expect(db.codes).toHaveLength(0);
  });

  it('a new code only after 60 s; a failed mail stores no code', async () => {
    expect((await askCode(ANNA)).status).toBe(200);
    const again = await askCode(ANNA);
    expect(again.status).toBe(429);
    expect((await again.json()).errorMessage).toMatch(/wait a minute/);
    expect(mails).toHaveLength(1);
    mailFails = true;
    const res = await askCode(BEN);
    expect(res.status).toBe(502);
    expect(db.codes.filter((c) => c.email === BEN)).toHaveLength(0);
  });

  it('a POST from another site is refused', async () => {
    const res = await askCode(ANNA, { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(mails).toHaveLength(0);
  });

  it('"Not you?" clears the cookie for this link', async () => {
    const res = await CODE_FORGET(new NextRequest(url('/code'), { method: 'DELETE' }), params());
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${VAT_FILES_PROOF_COOKIE}=;.*Max-Age=0`));
  });

  it('"Not you?" also ends the proof in Supabase: a copied cookie no longer opens the page', async () => {
    const anna = await confirm(ANNA);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + RESEND_WAIT_MS + 1000);
    const ben = await confirm(BEN);
    const res = await CODE_FORGET(new NextRequest(url('/code'), { method: 'DELETE', headers: withCookie(anna) }), params());
    expect(res.status).toBe(200);
    const annaRow = db.codes.find((c) => c.email === ANNA) as Row;
    expect(annaRow.proof_hash).toBeNull();
    expect(annaRow.proof_expires_at).toBeNull();
    expect((await load(anna)).status).toBe(401);
    expect((await load(ben)).status).toBe(200);
  });

  it('two right checks at once: only the first stores a proof, the second gets code_retry', async () => {
    await askCode(ANNA);
    const code = lastCode();
    beforeUpdate = (patch) => {
      if (!('proof_hash' in patch)) return;
      beforeUpdate = null;
      Object.assign(db.codes[0], { verified_at: new Date().toISOString(), proof_hash: 'first-browser' });
    };
    const res = await check(ANNA, code);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('code_retry');
    expect(proofFrom(res)).toBe('');
    expect(db.codes[0].proof_hash).toBe('first-browser');
  });

  it('a new code deletes this link\'s code rows older than 30 days, nothing else', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    db.codes.push(
      { id: 'old-own', request_id: ROW_ID, email: BEN, created_at: old, attempts: 0, verified_at: null },
      { id: 'recent-own', request_id: ROW_ID, email: BEN, created_at: recent, attempts: 0, verified_at: null },
      { id: 'old-other', request_id: 'other-row', email: BEN, created_at: old, attempts: 0, verified_at: null }
    );
    expect((await askCode(ANNA)).status).toBe(200);
    expect(db.codes.map((c) => c.id).filter((id) => !String(id).startsWith('code-')).sort()).toEqual(['old-other', 'recent-own']);
    expect(db.codes.filter((c) => c.email === ANNA)).toHaveLength(1);
  });

  it('wrong tries over 24 h: pure count (the right try of a used code is not wrong)', () => {
    expect(wrongTriesIn([{ attempts: 5, verified_at: null }, { attempts: 2, verified_at: 'x' }, { attempts: null, verified_at: null }])).toBe(6);
    const five = { attempts: 5, verified_at: null };
    expect(wrongTriesProblem([five, five], [five])).toBeNull();
    expect(wrongTriesProblem([five, five, five], [])).toBe(TOO_MANY_WRONG_CODES_TEXT);
    expect(wrongTriesProblem([], [five, five])).toBe(TOO_MANY_WRONG_CODES_TEXT);
  });

  it('15 wrong tries on the link in 24 h: no new code and no check for anyone on it', async () => {
    const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    for (const [i, email] of [BEN, BEN, 'carl@client.com'].entries()) {
      db.codes.push({ id: `w${i}`, request_id: ROW_ID, email, created_at: hourAgo, attempts: 5, verified_at: null });
    }
    const send = await askCode(ANNA);
    expect(send.status).toBe(429);
    expect((await send.json()).errorMessage).toBe(TOO_MANY_WRONG_CODES_TEXT);
    expect(mails).toHaveLength(0);
    const tried = await check(ANNA, '123456');
    expect(tried.status).toBe(429);
    expect((await tried.json()).error).toBe('too_many_wrong_codes');
  });

  it('10 wrong tries for one address in 24 h (any link): that address is refused, others are not', async () => {
    const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    db.codes.push(
      { id: 'x1', request_id: 'other-row', email: ANNA, created_at: hourAgo, attempts: 5, verified_at: null },
      { id: 'x2', request_id: 'other-row', email: ANNA, created_at: hourAgo, attempts: 5, verified_at: null }
    );
    expect((await askCode(ANNA)).status).toBe(429);
    expect((await askCode(BEN)).status).toBe(200);
  });

  it('wrong tries older than 24 h no longer count', async () => {
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 4; i++) {
      db.codes.push({ id: `o${i}`, request_id: ROW_ID, email: ANNA, created_at: dayAgo, attempts: 5, verified_at: null });
    }
    expect((await askCode(ANNA)).status).toBe(200);
  });

  it('closed request without a proof: "Who are you?" like an open one, never its data', async () => {
    seed({ status: 'closed', client_comment: 'Secret note' });
    const res = await load();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('email_code_required');
    expect(JSON.stringify(body)).not.toContain('Sample FZCO');
    expect(JSON.stringify(body)).not.toContain('Secret note');
    expect((await CUSTOMS(new NextRequest(url('/customs-list')), params())).status).toBe(401);
  });

  it('closed request: the code still works, the page data comes back read-only, every write is refused', async () => {
    seed({
      status: 'closed',
      client_comment: 'All imports are for stock.',
      files: [{ name: 'BOE 101.pdf', path: `${ENV}/${TOKEN}/aaaaaaaa-BOE 101.pdf`, size: 120, uploadedAt: '2026-10-09T09:00:00Z', lineId: 501, docKind: 'boe' }],
      customs_answers: { '501': { parts: [{ purpose: 'sale_stock', payment: 'paid', incoterm: 'CIF', delivery: 'dubai_port_dz' }] } },
    });
    const proof = await confirm(ANNA);
    const page = await load(proof);
    expect(page.status).toBe(200);
    const data = await page.json();
    expect(data.status).toBe('closed');
    expect(data.viewerEmail).toBe(ANNA);
    expect(data.clientComment).toBe('All imports are for stock.');
    expect(data.files.map((f: { name: string }) => f.name)).toEqual(['BOE 101.pdf']);
    expect(data.customsAnswers['501'].parts[0].purpose).toBe('sale_stock');
    expect(JSON.stringify(data)).not.toContain(TOKEN);
    // The FTA Excel may still be downloaded.
    expect((await CUSTOMS(new NextRequest(url('/customs-list'), { headers: withCookie(proof) }), params())).status).toBe(302);

    const before = JSON.stringify(db.requests[0]);
    const fd = new FormData();
    fd.append('file', new File([PDF], 'late.pdf'));
    const up = await UPLOAD(new NextRequest(url('/upload'), { method: 'POST', body: fd, headers: withCookie(proof) }), params());
    expect(up.status).toBe(410);
    expect(await up.json()).toEqual({ error: 'closed' });
    const del = await UPLOAD_DELETE(
      new NextRequest(url(`/upload?path=${encodeURIComponent(`${ENV}/${TOKEN}/bbbbbbbb-x.pdf`)}`), { method: 'DELETE', headers: withCookie(proof) }),
      params()
    );
    expect(del.status).toBe(410);
    const sent = await sendAs(proof, { files: [], comment: 'late', answers: { '501': { parts: [{ purpose: 'office_use' }] } } });
    expect(sent.status).toBe(410);
    const saved = await ANSWERS(
      new NextRequest(url('/answers'), {
        method: 'POST',
        body: JSON.stringify({ answers: { '501': { parts: [{ purpose: 'office_use' }], replies: { '1': 'late reply' } } } }),
        headers: withCookie(proof),
      }),
      params()
    );
    expect(saved.status).toBe(410);
    expect(JSON.stringify(db.requests[0])).toBe(before);
    expect(db.objects.size).toBe(0);
  });

  it('expired request: no code, no data', async () => {
    seed({ status: 'closed', expires_at: '2020-01-01T00:00:00Z' });
    const res = await load();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'expired' });
    expect((await askCode(ANNA)).status).toBe(410);
    expect(mails).toHaveLength(0);
  });
});

describe('switch off / old rows = as today', () => {
  it('switch off: the page opens without a code, nothing recorded, code routes say no code needed', async () => {
    vi.stubEnv('VAT_FILES_EMAIL_CODE', '');
    const res = await load();
    expect(res.status).toBe(200);
    expect((await res.json()).viewerEmail).toBeNull();
    expect((await askCode(ANNA)).status).toBe(400);
    const a = await uploadAs('', 'a.pdf');
    expect((await sendAs('', { files: [{ path: a.path, name: 'a.pdf' }], comment: '' })).status).toBe(200);
    const row = db.requests[0] as { files: Row[]; last_submitted_by?: unknown };
    expect(row.files[0].uploadedBy).toBeUndefined();
    expect(row.last_submitted_by).toBeUndefined();
    expect(mails).toHaveLength(0);
  });

  it('a row made before round 4 (no / empty allowed_emails) opens as today', async () => {
    seed({ allowed_emails: [] });
    expect((await load()).status).toBe(200);
    const { allowed_emails: _gone, ...old } = db.requests[0];
    void _gone;
    db.requests = [old];
    expect((await load()).status).toBe(200);
  });
});

describe('who did what', () => {
  it('two people on one link: each Send, file and answer carries its own address', async () => {
    const anna = await confirm(ANNA);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + RESEND_WAIT_MS + 1000);
    const ben = await confirm(BEN);

    const a = await uploadAs(anna, 'anna.pdf');
    expect((await sendAs(anna, { files: [{ path: a.path, name: 'anna.pdf' }], comment: '' })).status).toBe(200);
    expect(db.requests[0].last_submitted_by).toBe(ANNA);

    vi.setSystemTime(Date.now() + 1000);
    const b = await uploadAs(ben, 'ben.pdf');
    const res = await sendAs(ben, {
      files: [{ path: b.path, name: 'ben.pdf' }],
      comment: '',
      answers: { '501': { parts: [{ purpose: 'sale_stock', payment: 'paid', incoterm: 'EXW', delivery: 'dubai_mainland' }] } },
    });
    expect(res.status).toBe(200);
    const row = db.requests[0] as { files: Row[]; last_submitted_by: string; customs_answers: Record<string, Row> };
    expect(row.files.map((f) => [f.name, f.uploadedBy])).toEqual([
      ['anna.pdf', ANNA],
      ['ben.pdf', BEN],
    ]);
    expect(row.last_submitted_by).toBe(BEN);
    expect(row.customs_answers['501'].savedBy).toBe(BEN);
    // The page never shows who saved a line.
    expect(JSON.stringify(await res.json())).not.toContain('savedBy');

    // Anna's autosave of the same line takes it over; Ben's address leaves the line.
    vi.setSystemTime(Date.now() + 1000);
    const save = await ANSWERS(
      new NextRequest(url('/answers'), {
        method: 'POST',
        headers: withCookie(anna),
        body: JSON.stringify({ answers: { '501': { parts: [{ purpose: 'samples', payment: 'foc', incoterm: 'EXW', delivery: 'dubai_mainland' }] } } }),
      }),
      params()
    );
    expect(save.status).toBe(200);
    expect((db.requests[0].customs_answers as Record<string, Row>)['501'].savedBy).toBe(ANNA);
    const page = await (await load(anna)).json();
    expect(JSON.stringify(page.customsAnswers)).not.toContain(BEN);
  });
});
