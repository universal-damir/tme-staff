// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// In-memory stand-in for the service-role client: one table (select by
// token, update with .eq / .is filters + .select) and one storage bucket.
type Row = Record<string, unknown>;
const store: {
  rows: Row[];
  objects: Map<string, number>;
  uploads: string[];
  removed: string[];
  patches: Row[];
  beforeUpdate?: () => void;
  /** Like Supabase: timestamptz columns come back as "...06.2+00:00" (fraction trimmed), whatever was written. */
  pgStamps?: boolean;
} = { rows: [], objects: new Map(), uploads: [], removed: [], patches: [] };

const STAMP_COLUMNS = ['created_at', 'updated_at', 'expires_at', 'last_submitted_at', 'customs_answers_saved_at', 'customs_answers_sent_at'];
/** "2026-10-11T07:13:06.200Z" -> "2026-10-11T07:13:06.2+00:00" (PostgREST's spelling). */
function pgStamp(iso: string): string {
  const [whole, frac] = new Date(iso).toISOString().slice(0, -1).split('.');
  const f = (frac ?? '').replace(/0+$/, '');
  return `${whole}${f ? `.${f}` : ''}+00:00`;
}
function pgize(r: Row) {
  if (!store.pgStamps) return;
  for (const c of STAMP_COLUMNS) if (typeof r[c] === 'string') r[c] = pgStamp(r[c] as string);
}

function makeClient() {
  return {
    from(table: string) {
      if (table !== 'vat_file_requests') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          const q = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return q;
            },
            async maybeSingle() {
              const hit = store.rows.find((r) => filters.every(([c, v]) => r[c] === v));
              return { data: hit ? structuredClone(hit) : null, error: null };
            },
          };
          return q;
        },
        update(patch: Row) {
          const filters: Array<[string, unknown]> = [];
          const q = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return q;
            },
            is(col: string, val: unknown) {
              filters.push([col, val]);
              return q;
            },
            async select() {
              store.beforeUpdate?.();
              store.beforeUpdate = undefined;
              const hits = store.rows.filter((r) => filters.every(([c, v]) => r[c] === v));
              if (hits.length > 0) store.patches.push(structuredClone(patch));
              hits.forEach((r) => {
                Object.assign(r, structuredClone(patch));
                pgize(r);
              });
              return { data: hits.map((r) => ({ id: r.id })), error: null };
            },
          };
          return q;
        },
      };
    },
    storage: {
      from(bucket: string) {
        if (bucket !== 'vat-files') throw new Error(`unexpected bucket ${bucket}`);
        return {
          async upload(path: string, bytes: Uint8Array) {
            store.objects.set(path, bytes.length);
            store.uploads.push(path);
            return { data: { path }, error: null };
          },
          async list(folder: string, opts: { limit?: number; offset?: number } = {}) {
            const all = [...store.objects.entries()]
              .filter(([p]) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes('/'))
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([p, size]) => ({ id: p, name: p.slice(folder.length + 1), metadata: { size } }));
            const offset = opts.offset ?? 0;
            const data = all.slice(offset, offset + (opts.limit ?? 100));
            return { data, error: null };
          },
          async remove(paths: string[]) {
            paths.forEach((p) => {
              store.objects.delete(p);
              store.removed.push(p);
            });
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

// Round 5: a code-confirmed viewer for the tests that need one (null = the real check).
const viewerOverride = vi.hoisted(() => ({ email: null as string | null }));
vi.mock('@/lib/vat-files-code', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/vat-files-code')>();
  return {
    ...real,
    vatFilesViewer: (...args: Parameters<typeof real.vatFilesViewer>) =>
      viewerOverride.email ? Promise.resolve({ ok: true as const, email: viewerOverride.email }) : real.vatFilesViewer(...args),
  };
});

import { GET } from '@/app/api/vat-files/[token]/route';
import { POST as UPLOAD, DELETE as REMOVE } from '@/app/api/vat-files/[token]/upload/route';
import { POST as SEND } from '@/app/api/vat-files/[token]/send/route';
import { GET as CUSTOMS } from '@/app/api/vat-files/[token]/customs-list/route';
import { POST as ANSWERS } from '@/app/api/vat-files/[token]/answers/route';
import { GET as VERSION } from '@/app/api/vat-files/[token]/version/route';
import { vatFilesChangeNotice } from '@/lib/vat-files';
import { isVatCustomsReplySent } from '@/types/vat-files';

const TOKEN = 'TokenAbcdefghij0123456789';
const ROW_ID = '11111111-2222-3333-4444-555555555555';
const ENV = 'sandbox';

function seed(over: Row = {}) {
  store.rows = [
    {
      id: ROW_ID,
      link_token: TOKEN,
      environment: ENV,
      portal_filing_id: 77,
      company_code: '10039',
      company_name: 'Sample FZCO',
      period_key: '2606-2608',
      period_label: 'June to August 2026',
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
      ...over,
    },
  ];
  store.objects = new Map();
  store.uploads = [];
  store.removed = [];
  store.patches = [];
  store.beforeUpdate = undefined;
  store.rows.forEach(pgize);
}

const params = (token = TOKEN) => ({ params: Promise.resolve({ token }) });
const url = (suffix = '', token = TOKEN) => `http://x/api/vat-files/${token}${suffix}`;

function upload(name: string, content: Uint8Array<ArrayBuffer>, token = TOKEN) {
  const fd = new FormData();
  fd.append('file', new File([content], name));
  return UPLOAD(new NextRequest(url('/upload', token), { method: 'POST', body: fd }), params(token));
}
const send = (body: unknown) =>
  SEND(new NextRequest(url('/send'), { method: 'POST', body: JSON.stringify(body) }), params());

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x0a, 0x0a, 0x0a]);

beforeEach(() => {
  viewerOverride.email = null;
  store.pgStamps = false;
  seed();
});

describe('GET /api/vat-files/[token]', () => {
  it('unknown or malformed token = 404', async () => {
    expect((await GET(new NextRequest(url('', 'x')), params('x'))).status).toBe(404);
    const other = 'Unknown0000000000000000000';
    expect((await GET(new NextRequest(url('', other)), params(other))).status).toBe(404);
  });

  it('expired = 410 expired; closed still answers (the page shows it read-only)', async () => {
    seed({ expires_at: '2020-01-01T00:00:00Z' });
    const res = await GET(new NextRequest(url()), params());
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'expired' });
    seed({ status: 'closed' });
    const closed = await GET(new NextRequest(url()), params());
    expect(closed.status).toBe(200);
    expect((await closed.json()).status).toBe('closed');
  });

  it('round 4 D: no code (switch off) = no names, even when the row has allowed_names', async () => {
    seed({ allowed_names: { 'anna@client.com': 'Anna Keller' } } as Row);
    const res = await GET(new NextRequest(url()), params());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('Anna Keller');
    expect(JSON.parse(text).peopleNames).toEqual({});
  });

  it('never returns id, token, environment, filing id or paths', async () => {
    const text = await (await GET(new NextRequest(url()), params())).text();
    for (const s of [ROW_ID, TOKEN, ENV, `${ENV}/`, ':77', 'portal_filing_id']) expect(text).not.toContain(s);
    expect(JSON.parse(text)).toMatchObject({ companyCode: '10039', hasCustomsList: true, deadline: '2026-10-20' });
  });
});

describe('upload + send', () => {
  it('stores a checked file under {environment}/{token}/{uuid}-{safeName}, row untouched', async () => {
    const res = await upload('Bill of Entry 1.pdf', PDF);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toMatch(new RegExp(`^${ENV}/${TOKEN}/[0-9a-f-]{36}-Bill_of_Entry_1\\.pdf$`));
    expect(body).toMatchObject({ name: 'Bill of Entry 1.pdf', size: PDF.length });
    expect(store.rows[0].files).toEqual([]);
  });

  it('refuses a file whose content does not match its name', async () => {
    const res = await upload('invoice.pdf', new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0]));
    expect(res.status).toBe(415);
    expect(store.uploads).toEqual([]);
  });

  it('closed request: upload, delete and send = 410 closed, nothing written', async () => {
    const a = await (await upload('a.pdf', PDF)).json();
    store.rows[0].status = 'closed';
    const res = await upload('b.pdf', PDF);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect((await send({ files: [{ path: a.path, name: 'a.pdf' }], comment: 'late' })).status).toBe(410);
    const del = await REMOVE(new NextRequest(url(`/upload?path=${encodeURIComponent(a.path)}`), { method: 'DELETE' }), params());
    expect(del.status).toBe(410);
    expect(store.removed).toEqual([]);
    expect(store.patches).toEqual([]);
    expect(store.rows[0].files).toEqual([]);
    expect(store.rows[0].client_comment).toBeNull();
  });

  it('send appends the round, sets comment + time; a second round adds more', async () => {
    const a = await (await upload('a.pdf', PDF)).json();
    const b = await (await upload('b.pdf', PDF)).json();
    const res = await send({ files: [{ path: a.path, name: 'a.pdf' }, { path: b.path, name: 'b.pdf' }], comment: 'All July imports' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent.map((f: { name: string }) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    const r = store.rows[0] as { files: Array<Record<string, unknown>>; client_comment: string; last_submitted_at: string };
    expect(r.files).toHaveLength(2);
    expect(r.files[0]).toMatchObject({ path: a.path, name: 'a.pdf', size: PDF.length, comment: 'All July imports' });
    expect(r.client_comment).toBe('All July imports');
    expect(r.last_submitted_at).toBeTruthy();

    const c = await (await upload('c.pdf', PDF)).json();
    expect((await send({ files: [{ path: c.path, name: 'c.pdf' }] })).status).toBe(200);
    expect((store.rows[0].files as unknown[]).length).toBe(3);
    expect(store.rows[0].client_comment).toBe('All July imports');
  });

  it('send refuses a path of another link and a file that never arrived', async () => {
    const foreign = `${ENV}/Other0000000000000000000000/0f8fad5b-d9cb-469f-a165-70867728950e-a.pdf`;
    expect((await send({ files: [{ path: foreign, name: 'a' }] })).status).toBe(400);
    const missing = `${ENV}/${TOKEN}/0f8fad5b-d9cb-469f-a165-70867728950e-a.pdf`;
    const res = await send({ files: [{ path: missing, name: 'a' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'upload_not_received' });
    expect((await send({ files: [] })).status).toBe(400);
  });

  it('a write racing in between is re-read, not overwritten', async () => {
    const a = await (await upload('a.pdf', PDF)).json();
    const b = await (await upload('b.pdf', PDF)).json();
    store.beforeUpdate = () => {
      store.rows[0].files = [{ path: b.path, name: 'b.pdf', size: 1, uploadedAt: 'x' }];
      store.rows[0].updated_at = '2026-10-09T09:00:00Z';
    };
    expect((await send({ files: [{ path: a.path, name: 'a.pdf' }] })).status).toBe(200);
    expect((store.rows[0].files as Array<{ path: string }>).map((f) => f.path)).toEqual([b.path, a.path]);
  });

  it('uploads stop once the folder holds more than 350 objects, sent or not', async () => {
    for (let i = 0; i < 351; i++) store.objects.set(`${ENV}/${TOKEN}/!unsent-${String(i).padStart(4, '0')}.pdf`, 10);
    const res = await upload('a.pdf', PDF);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'too_many_files' });
    expect(store.uploads).toEqual([]);
    store.objects.delete(`${ENV}/${TOKEN}/!unsent-0000.pdf`);
    expect((await upload('a.pdf', PDF)).status).toBe(200);
  });

  it('send reads the whole folder, page by page (a file past the first 1000 is found)', async () => {
    const a = await (await upload('a.pdf', PDF)).json();
    // Sorted before every uuid name, so the real file lands on the third page.
    for (let i = 0; i < 2100; i++) store.objects.set(`${ENV}/${TOKEN}/!junk-${String(i).padStart(5, '0')}`, 1);
    const res = await send({ files: [{ path: a.path, name: 'a.pdf' }] });
    expect(res.status).toBe(200);
    expect((store.rows[0].files as unknown[]).length).toBe(1);
  });

  it('the portal closing the row mid-send = 410', async () => {
    const a = await (await upload('a.pdf', PDF)).json();
    store.beforeUpdate = () => {
      store.rows[0].status = 'closed';
    };
    expect((await send({ files: [{ path: a.path, name: 'a.pdf' }] })).status).toBe(410);
  });
});

describe('DELETE unsent file', () => {
  it('removes an unsent upload of this link only', async () => {
    const a = await (await upload('a.pdf', PDF)).json();
    const del = (p: string) =>
      REMOVE(new NextRequest(url(`/upload?path=${encodeURIComponent(p)}`), { method: 'DELETE' }), params());
    expect((await del(`${ENV}/${TOKEN}/customs-list.xlsx`)).status).toBe(400);
    expect((await del('../../other')).status).toBe(400);
    expect((await del(a.path)).status).toBe(200);
    expect(store.removed).toEqual([a.path]);
  });

  it('the FTA import list the portal put in the folder cannot be removed', async () => {
    const listPath = `${ENV}/${TOKEN}/0f8fad5b-d9cb-469f-a165-70867728950e-FTA_list.xlsx`;
    seed({ customs_list_path: listPath });
    store.objects.set(listPath, 100);
    const res = await REMOVE(
      new NextRequest(url(`/upload?path=${encodeURIComponent(listPath)}`), { method: 'DELETE' }),
      params()
    );
    expect(res.status).toBe(400);
    expect(store.removed).toEqual([]);
  });

  it('a sent file stays', async () => {
    const a = await (await upload('a.pdf', PDF)).json();
    await send({ files: [{ path: a.path, name: 'a.pdf' }] });
    const res = await REMOVE(
      new NextRequest(url(`/upload?path=${encodeURIComponent(a.path)}`), { method: 'DELETE' }),
      params()
    );
    expect(res.status).toBe(409);
  });
});

describe('GET customs-list', () => {
  it('redirects to a signed URL when the row has a list, 404 when not', async () => {
    const res = await CUSTOMS(new NextRequest(url('/customs-list')), params());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('customs-list.xlsx');
    seed({ kind: 'files', customs_list_path: null });
    expect((await CUSTOMS(new NextRequest(url('/customs-list')), params())).status).toBe(404);
  });

  it('a closed link may still download the FTA list; an expired one may not', async () => {
    seed({ status: 'closed' });
    expect((await CUSTOMS(new NextRequest(url('/customs-list')), params())).status).toBe(302);
    seed({ status: 'closed', expires_at: '2020-01-01T00:00:00Z' });
    expect((await CUSTOMS(new NextRequest(url('/customs-list')), params())).status).toBe(410);
  });
});

// ------------------------------------------------------------------
// Round 3: the customs table
// ------------------------------------------------------------------

const LINES = [
  { id: 501, lineNo: 1, declarationDate: '2026-08-03', declarationNo: '1010135960026', transactionRefNo: '6505210394', totalValue: 252203.24, totalVat: 12610.16, hasBoe: false, hasInvoice: false, answer: null, questions: [] },
  { id: 502, lineNo: 2, declarationDate: '2026-08-19', declarationNo: '1010146613726', transactionRefNo: '6507604297', totalValue: 6472.57, totalVat: 323.63, hasBoe: false, hasInvoice: false, answer: null, questions: [{ id: 31, text: 'Samples?', askedAt: '2026-10-10T08:00:00Z' }, { id: 32, text: 'Paid by whom?', askedAt: '2026-10-10T08:01:00Z' }] },
];
const FULL = { purpose: 'sale_stock', payment: 'paid', incoterm: 'CIF', delivery: 'dubai_port_dz' };
const answers = (body: unknown, raw = false) =>
  ANSWERS(new NextRequest(url('/answers'), { method: 'POST', body: raw ? (body as string) : JSON.stringify(body) }), params());

function uploadForLine(name: string, lineId: string, docKind: string) {
  const fd = new FormData();
  fd.append('file', new File([PDF], name));
  fd.append('lineId', lineId);
  fd.append('docKind', docKind);
  return UPLOAD(new NextRequest(url('/upload'), { method: 'POST', body: fd }), params());
}

describe('GET with the customs table', () => {
  it('fills customsLines, customsAnswers, defaults, sent time and per-line files', async () => {
    seed({
      customs_lines: LINES,
      customs_answers: { '501': { parts: [FULL], updatedAt: '2026-10-10T09:00:00Z' }, '999': { parts: [FULL] } },
      customs_defaults: FULL,
      customs_answers_sent_at: '2026-10-10T09:05:00Z',
      files: [{ path: `${ENV}/${TOKEN}/x-boe.pdf`, name: 'boe.pdf', size: 1, uploadedAt: 'x', lineId: 501, docKind: 'boe' }],
    });
    const body = await (await GET(new NextRequest(url()), params())).json();
    expect(body.customsLines).toHaveLength(2);
    expect(Object.keys(body.customsAnswers)).toEqual(['501']);
    expect(body.customsDefaults).toEqual(FULL);
    expect(body.customsAnswersSentAt).toBe('2026-10-10T09:05:00.000Z'); // one spelling (canonicalIso)
    expect(body.lineFiles).toEqual([{ lineId: 501, docKind: 'boe', name: 'boe.pdf', uploadedAt: 'x' }]);
  });
});

describe('POST answers (autosave)', () => {
  beforeEach(() => seed({ customs_lines: LINES }));

  it('saves the changed lines and writes ONLY the page columns', async () => {
    const res = await answers({ answers: { '501': { parts: [FULL] } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.updated)).toEqual(['501']);
    const r = store.rows[0] as Record<string, unknown>;
    expect((r.customs_answers as Record<string, { parts: unknown[]; updatedAt: string }>)['501']).toMatchObject({ parts: [FULL] });
    expect(r.customs_answers_saved_at).toBe(body.savedAt);
    expect(Object.keys(store.patches[0]).sort()).toEqual(['customs_answers', 'customs_answers_saved_at', 'updated_at']);
    expect(r.customs_answers_sent_at).toBeUndefined();
    expect(r.last_submitted_at).toBeNull();
  });

  it('nothing changed = no write', async () => {
    await answers({ answers: { '501': { parts: [FULL] } } });
    store.patches = [];
    const res = await answers({ answers: { '501': { parts: [FULL] } } });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toEqual({});
    expect(store.patches).toEqual([]);
  });

  it('refuses a bad option, a foreign line, bad replies and too many parts', async () => {
    expect((await answers({ answers: { '501': { parts: [{ purpose: 'nope' }] } } })).status).toBe(400);
    const foreign = await answers({ answers: { '777': { parts: [FULL] } } });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: 'unknown_line', lineId: '777' });
    expect((await answers({ answers: { '502': { parts: [], replies: { '31': 7 } } } })).status).toBe(400);
    const parts = new Array(21).fill({});
    expect((await answers({ answers: { '501': { parts } } })).status).toBe(400);
    expect((await answers({ nothing: 1 })).status).toBe(400);
    expect(store.patches).toEqual([]);
  });

  it('replies are kept per open question (two questions on one line)', async () => {
    const res = await answers({ answers: { '502': { parts: [], replies: { '31': 'Yes, samples', '32': 'We paid' } } } });
    expect(res.status).toBe(200);
    expect((await res.json()).staleReplies).toEqual([]);
    expect((store.rows[0].customs_answers as Record<string, Record<string, unknown>>)['502']).toMatchObject({
      replies: { '31': 'Yes, samples', '32': 'We paid' },
    });
  });

  it('a reply to a closed / unknown question is dropped (never moved) and the page is told to reload', async () => {
    const res = await answers({ answers: { '502': { parts: [FULL], replies: { '30': 'old reply', '31': 'Yes' } } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staleReplies).toEqual(['502']);
    expect(Object.keys(body.updated)).toEqual(['502']);
    const stored = (store.rows[0].customs_answers as Record<string, Record<string, unknown>>)['502'];
    expect(stored.replies).toEqual({ '31': 'Yes' });
    expect(stored.parts).toEqual([FULL]);
    expect(JSON.stringify(store.rows[0].customs_answers)).not.toContain('old reply');
    // Only a stale reply, nothing else changed: no write, still told.
    store.patches = [];
    const again = await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes', '29': 'x' } } } });
    expect((await again.json()).staleReplies).toEqual(['502']);
    expect(store.patches).toEqual([]);
  });

  it('after a staff "replace" the old ids are refused as unknown_line and nothing is written', async () => {
    seed({ customs_lines: [{ ...LINES[0], id: 601 }], status: 'open' });
    store.patches = [];
    const res = await answers({ answers: { '501': { parts: [FULL] }, '601': { parts: [FULL] } } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_line', lineId: '501' });
    expect(store.patches).toEqual([]);
  });

  it('a body over the cap = 413; closed / expired rows and rows without a table are refused', async () => {
    expect((await answers('x'.repeat(600 * 1024), true)).status).toBe(413);
    seed({ customs_lines: LINES, status: 'closed' });
    expect((await answers({ answers: {} })).status).toBe(410);
    seed({ customs_lines: LINES, expires_at: '2020-01-01T00:00:00Z' });
    expect((await answers({ answers: {} })).status).toBe(410);
    seed();
    const res = await answers({ answers: { '501': { parts: [FULL] } } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_customs_table' });
  });

  it('two writes at once: the second is re-read and merged, nothing lost', async () => {
    store.beforeUpdate = () => {
      store.rows[0].customs_answers = { '502': { parts: [{ purpose: 'samples' }], updatedAt: '2026-10-11T08:00:00Z' } };
      store.rows[0].updated_at = '2026-10-11T08:00:00Z';
    };
    expect((await answers({ answers: { '501': { parts: [FULL] } } })).status).toBe(200);
    const saved = store.rows[0].customs_answers as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['501', '502']);
  });
});

describe('upload + send with the customs table', () => {
  beforeEach(() => seed({ customs_lines: LINES }));

  it('upload takes a line of this row and echoes it; another row = 400 unknown_line', async () => {
    const ok = await uploadForLine('boe.pdf', '501', 'boe');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ lineId: 501, docKind: 'boe' });
    const other = await uploadForLine('boe.pdf', '9999', 'boe');
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: 'unknown_line' });
    expect((await uploadForLine('boe.pdf', '501', 'passport')).status).toBe(400);
    expect(store.uploads).toHaveLength(1);
  });

  it('send with answers and no files: stamps customs_answers_sent_at + last_submitted_at; a repeat stamps nothing', async () => {
    const res = await send({ files: [], comment: '', answers: { '501': { parts: [FULL] } } });
    expect(res.status).toBe(200);
    expect((await res.json()).answersSent).toBe(true);
    const r = store.rows[0] as Record<string, unknown>;
    expect(r.customs_answers_sent_at).toBeTruthy();
    expect(r.last_submitted_at).toBe(r.customs_answers_sent_at);
    expect(r.files).toEqual([]);
    const first = r.customs_answers_sent_at;

    store.patches = [];
    const again = await send({ files: [], comment: '', answers: {} });
    expect(again.status).toBe(200);
    expect(store.patches).toEqual([]);
    expect(store.rows[0].customs_answers_sent_at).toBe(first);
  });

  it('answers autosaved before: an answers-only Send still stamps them', async () => {
    await answers({ answers: { '501': { parts: [FULL] } } });
    const res = await send({ files: [], comment: 'see table', answers: {} });
    expect(res.status).toBe(200);
    expect(store.rows[0].customs_answers_sent_at).toBeTruthy();
    expect(store.rows[0].client_comment).toBe('see table');
  });

  it('nothing to send at all = 400 no_files; answers on a row without a table count for nothing', async () => {
    expect((await send({ files: [], comment: '', answers: {} })).status).toBe(400);
    seed();
    expect((await send({ files: [], comment: '', answers: { '501': { parts: [FULL] } } })).status).toBe(400);
  });

  it('files + answers: both stamped, the file keeps its line and kind', async () => {
    const up = await (await uploadForLine('inv.pdf', '502', 'invoice')).json();
    const res = await send({
      files: [{ path: up.path, name: 'inv.pdf', lineId: 502, docKind: 'invoice' }],
      comment: '',
      answers: { '502': { parts: [FULL] } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lineFiles).toEqual([expect.objectContaining({ lineId: 502, docKind: 'invoice' })]);
    const r = store.rows[0] as Record<string, unknown>;
    expect((r.files as Array<Record<string, unknown>>)[0]).toMatchObject({ lineId: 502, docKind: 'invoice' });
    expect(r.customs_answers_sent_at).toBeTruthy();
    expect(r.last_submitted_at).toBeTruthy();
  });

  it('send refuses a file for a line of another row', async () => {
    const up = await (await upload('a.pdf', PDF)).json();
    const res = await send({ files: [{ path: up.path, name: 'a.pdf', lineId: 9999, docKind: 'boe' }], comment: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_line' });
  });

  it('send: replies per open question; a reply to a closed question is dropped and named in staleReplies', async () => {
    const res = await send({ files: [], comment: '', answers: { '502': { parts: [FULL], replies: { '32': 'TME paid', '30': 'stale' } } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staleReplies).toEqual(['502']);
    expect(body.answersSent).toBe(true);
    expect((store.rows[0].customs_answers as Record<string, Record<string, unknown>>)['502'].replies).toEqual({ '32': 'TME paid' });
  });

  it('send with a bad answer = 400, nothing written', async () => {
    const res = await send({ files: [], comment: '', answers: { '501': { parts: [{ payment: 'barter' }] } } });
    expect(res.status).toBe(400);
    expect(store.patches).toEqual([]);
  });
});

describe('round 5: Send keeps viewerEmail + peopleNames (the page replaces its data with the answer)', () => {
  const NAMES = { 'anna@client.com': 'Anna Keller', 'bob@client.com': 'Bob Stone' };

  it('a confirmed viewer: GET and Send both carry the viewer and only the names shown', async () => {
    viewerOverride.email = 'anna@client.com';
    seed({ allowed_names: NAMES, allowed_emails: ['anna@client.com', 'bob@client.com'] } as Row);
    const page = await (await GET(new NextRequest(url()), params())).json();
    expect(page).toMatchObject({ viewerEmail: 'anna@client.com', peopleNames: { 'anna@client.com': 'Anna Keller' } });

    const a = await (await upload('a.pdf', PDF)).json();
    const res = await send({ files: [{ path: a.path, name: 'a.pdf' }], comment: '' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewerEmail).toBe('anna@client.com');
    expect(body.peopleNames).toEqual({ 'anna@client.com': 'Anna Keller' });
    expect(JSON.stringify(body)).not.toContain('Bob Stone');
  });

  it('the repeated Send with nothing new answers the same way', async () => {
    viewerOverride.email = 'anna@client.com';
    seed({ customs_lines: LINES, allowed_names: NAMES, allowed_emails: ['anna@client.com'] } as Row);
    expect((await send({ files: [], comment: '', answers: { '501': { parts: [FULL] } } })).status).toBe(200);
    const again = await send({ files: [], comment: '', answers: {} });
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.sent).toEqual([]);
    expect(body).toMatchObject({ viewerEmail: 'anna@client.com', peopleNames: { 'anna@client.com': 'Anna Keller' } });
  });

  it('no code needed: Send says so (viewerEmail null) and gives no names', async () => {
    seed({ allowed_names: NAMES } as Row);
    const a = await (await upload('a.pdf', PDF)).json();
    const body = await (await send({ files: [{ path: a.path, name: 'a.pdf' }], comment: '' })).json();
    expect(body.viewerEmail).toBeNull();
    expect(body.peopleNames).toEqual({});
  });
});

describe('round 5: a sent reply is read-only; two people on one page', () => {
  const T0 = '2026-10-11T08:00:00.000Z';
  const T1 = '2026-10-11T09:00:00.000Z';
  const sentReply = (savedAt: string) => ({
    '502': {
      parts: [FULL],
      replies: { '31': 'Yes, samples' },
      replyMeta: { '31': { sentAt: savedAt, sentBy: 'anna@client.com', savedAt } },
      updatedAt: savedAt,
      savedBy: 'anna@client.com',
    },
  });
  const version = (since?: string) =>
    VERSION(new NextRequest(url(`/version${since ? `?since=${encodeURIComponent(since)}` : ''}`)), params());

  it('answers: a change to a SENT reply is refused (named in lockedReplies), nothing is written', async () => {
    seed({ customs_lines: LINES, customs_answers: sentReply(T0), customs_answers_sent_at: T1, updated_at: T1 });
    const res = await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'No, for sale' } } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lockedReplies).toEqual(['502']);
    expect(body.updated).toEqual({});
    expect(store.patches).toEqual([]);
    expect((store.rows[0].customs_answers as Record<string, { replies: unknown }>)['502'].replies).toEqual({ '31': 'Yes, samples' });
  });

  it('answers: a reply saved after the last Send is still a draft and can be changed', async () => {
    const later = '2026-10-11T09:30:00.000Z';
    seed({ customs_lines: LINES, customs_answers: sentReply(later), customs_answers_sent_at: T1, updated_at: later });
    const res = await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'No, for sale' } } } });
    const body = await res.json();
    expect(body.lockedReplies).toEqual([]);
    expect(Object.keys(body.updated)).toEqual(['502']);
    expect((store.rows[0].customs_answers as Record<string, { replies: unknown }>)['502'].replies).toEqual({ '31': 'No, for sale' });
  });

  it('send: the sent reply stays; a reply to a new follow-up question goes through', async () => {
    seed({ customs_lines: LINES, customs_answers: sentReply(T0), customs_answers_sent_at: T1, updated_at: T1 });
    const res = await send({ files: [], comment: '', answers: { '502': { parts: [FULL], replies: { '31': 'Changed', '32': 'We paid' } } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lockedReplies).toEqual(['502']);
    expect(body.answersSent).toBe(true);
    expect((store.rows[0].customs_answers as Record<string, { replies: unknown }>)['502'].replies).toEqual({
      '31': 'Yes, samples',
      '32': 'We paid',
    });
  });

  it('answers: a line another person saved since the page loaded it is refused, the rest is saved', async () => {
    viewerOverride.email = 'anna@client.com';
    seed({
      customs_lines: LINES,
      customs_answers: { '501': { parts: [FULL], updatedAt: T1, savedBy: 'bob@client.com' } },
      allowed_names: { 'bob@client.com': 'Benedikt Klingler', 'carl@client.com': 'Carl Other' },
    } as Row);
    const res = await answers({
      answers: { '501': { parts: [{ ...FULL, payment: 'foc' }], baseUpdatedAt: T0 }, '502': { parts: [FULL], baseUpdatedAt: null } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.updated)).toEqual(['502']);
    expect(body.conflicts['501']).toEqual({ answer: { parts: [FULL], updatedAt: T1 }, at: T1, by: 'bob@client.com', byName: 'Benedikt Klingler' });
    expect(body.bases).toEqual({ '502': body.savedAt });
    const stored = store.rows[0].customs_answers as Record<string, { parts: Array<{ payment: string }> }>;
    expect(stored['501'].parts[0].payment).toBe('paid');
    expect(JSON.stringify(body)).not.toContain('Carl');
    expect(JSON.stringify(body)).not.toContain('savedBy');
  });

  it('answers: the same person (two tabs) is no conflict', async () => {
    viewerOverride.email = 'bob@client.com';
    seed({ customs_lines: LINES, customs_answers: { '501': { parts: [FULL], updatedAt: T1, savedBy: 'bob@client.com' } } });
    const body = await (await answers({ answers: { '501': { parts: [{ ...FULL, payment: 'foc' }], baseUpdatedAt: T0 } } })).json();
    expect(body.conflicts).toEqual({});
    expect(Object.keys(body.updated)).toEqual(['501']);
  });

  it('answers, switch off: a different stamp is a conflict, without a name or address', async () => {
    seed({
      customs_lines: LINES,
      customs_answers: { '501': { parts: [FULL], updatedAt: T1 } },
      allowed_names: { 'bob@client.com': 'Benedikt Klingler' },
    } as Row);
    const body = await (await answers({ answers: { '501': { parts: [{ ...FULL, payment: 'foc' }], baseUpdatedAt: T0 } } })).json();
    expect(body.conflicts['501']).toMatchObject({ by: null, byName: null, at: T1 });
    expect(store.patches).toEqual([]);
  });

  it('answers: the version it returns is the one the poll then reads (own save = no note)', async () => {
    seed({ customs_lines: LINES });
    const saved = await (await answers({ answers: { '501': { parts: [FULL], baseUpdatedAt: null } } })).json();
    const polled = await (await version(saved.clientChangedAt)).json();
    expect(polled.version).toBe(saved.version);
    expect(polled.clientChangedAt).toBe(saved.clientChangedAt);
  });

  it('answers: `seen` older than the row = otherChange (who changed it, for a confirmed viewer)', async () => {
    viewerOverride.email = 'anna@client.com';
    seed({ customs_lines: LINES, allowed_names: { 'bob@client.com': 'Benedikt Klingler' } } as Row);
    const page = await (await GET(new NextRequest(url()), params())).json();
    // Bob saves line 502 in another browser.
    store.rows[0].customs_answers = { '502': { parts: [FULL], updatedAt: T1, savedBy: 'bob@client.com' } };
    store.rows[0].customs_answers_saved_at = T1;
    store.rows[0].updated_at = T1;
    const body = await (
      await answers({ answers: { '501': { parts: [FULL], baseUpdatedAt: null } }, seen: { version: page.version, clientAt: page.clientChangedAt } })
    ).json();
    expect(body.otherChange).toMatchObject({ source: 'client', by: 'bob@client.com', byName: 'Benedikt Klingler', self: false });
    // Without a change in between there is none.
    const again = await (await answers({ answers: { '501': { parts: [FULL, FULL] } }, seen: { version: body.version, clientAt: body.clientChangedAt } })).json();
    expect(again.otherChange).toBeUndefined();
  });

  it('GET /version: gated, small, and names only for a confirmed viewer', async () => {
    seed({
      customs_lines: LINES,
      customs_answers: { '501': { parts: [FULL], updatedAt: T1, savedBy: 'bob@client.com' } },
      customs_answers_saved_at: T1,
      allowed_names: { 'bob@client.com': 'Benedikt Klingler' },
    } as Row);
    const anon = await (await version(T0)).json();
    expect(anon).toMatchObject({ source: 'client', at: T1, by: null, byName: null });
    expect(JSON.stringify(anon)).not.toContain('bob@');
    expect(Object.keys(anon).sort()).toEqual(['at', 'by', 'byName', 'clientChangedAt', 'self', 'source', 'status', 'version']);
    viewerOverride.email = 'anna@client.com';
    const named = await (await version(T0)).json();
    expect(named).toMatchObject({ by: 'bob@client.com', byName: 'Benedikt Klingler' });
    // The page payload and the poll agree on the version.
    const page = await (await GET(new NextRequest(url()), params())).json();
    expect(page.version).toBe(named.version);
    // A closed request still answers (the page says "TME closed this request").
    store.rows[0].status = 'closed';
    expect((await (await version(T0)).json()).status).toBe('closed');
    expect((await version(T0, )).status).toBe(200);
    expect((await VERSION(new NextRequest(url('/version', 'bad')), params('bad'))).status).toBe(404);
  });
});

describe('round 5 review: Supabase "+00:00" stamps and a Send with conflicts', () => {
  const T0 = '2026-10-11T08:00:00.000Z';
  const T1 = '2026-10-11T09:00:00.000Z';
  const version = (since?: string | null) =>
    VERSION(new NextRequest(url(`/version${since ? `?since=${encodeURIComponent(since)}` : ''}`)), params());
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const now of ['2026-10-11T07:13:06.207Z', '2026-10-11T13:37:31.980Z', '2026-10-11T13:37:31.000Z']) {
    it(`Send: its version is the one GET and the poll read back (no false "TME updated", now ${now})`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now));
      store.pgStamps = true;
      seed({ customs_lines: LINES });
      const sent = await (await send({ files: [], comment: '', answers: { '501': { parts: [FULL], baseUpdatedAt: null } } })).json();
      expect(sent.answersSent).toBe(true);
      expect(store.rows[0].customs_answers_sent_at).toMatch(/\+00:00$/);
      const polled = await (await version(sent.clientChangedAt)).json();
      expect(polled.version).toBe(sent.version);
      expect(vatFilesChangeNotice({ knownVersion: sent.version, pageStatus: 'open', change: polled })).toBeNull();
      const page = await (await GET(new NextRequest(url()), params())).json();
      expect(page.version).toBe(sent.version);
      // An autosave after the Send builds on the same version too.
      const saved = await (await answers({ answers: { '502': { parts: [FULL], baseUpdatedAt: null } }, seen: { version: page.version, clientAt: page.clientChangedAt } })).json();
      expect(saved.otherChange).toBeUndefined();
      expect((await (await version(saved.clientChangedAt)).json()).version).toBe(saved.version);
    });
  }

  it('the poll names who saved (the line stamp "Z" vs the column "+00:00")', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T13:37:31.980Z'));
    store.pgStamps = true;
    seed({ customs_lines: LINES, allowed_names: { 'bob@client.com': 'Benedikt Klingler' } } as Row);
    viewerOverride.email = 'bob@client.com';
    await answers({ answers: { '501': { parts: [FULL], baseUpdatedAt: null } } });
    expect(store.rows[0].customs_answers_saved_at).toBe('2026-10-11T13:37:31.98+00:00');
    const self = await (await version(T0)).json();
    expect(self).toMatchObject({ source: 'client', by: 'bob@client.com', self: true });
    viewerOverride.email = 'anna@client.com';
    const other = await (await version(T0)).json();
    expect(other).toMatchObject({ by: 'bob@client.com', byName: 'Benedikt Klingler', self: false });
    expect(vatFilesChangeNotice({ knownVersion: 'older', pageStatus: 'open', change: other })).toBe('Benedikt Klingler changed the table at 17:37.');
  });

  const bobDraft = {
    '502': {
      parts: [FULL],
      replies: { '31': 'Bob draft' },
      replyMeta: { '31': { sentAt: T1, sentBy: 'bob@client.com', savedAt: T1 } },
      updatedAt: T1,
      savedBy: 'bob@client.com',
    },
  };

  it('Send with a conflict: not sent (no Send stamp), the other lines saved, the other draft stays a draft', async () => {
    viewerOverride.email = 'anna@client.com';
    store.pgStamps = true;
    seed({ customs_lines: LINES, customs_answers: bobDraft, customs_answers_saved_at: T1, customs_answers_sent_at: T0, updated_at: T1 });
    const res = await send({
      files: [],
      comment: '',
      answers: {
        '501': { parts: [FULL], baseUpdatedAt: null },
        '502': { parts: [FULL], replies: { '31': 'Anna text' }, baseUpdatedAt: T0 },
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answersSent).toBe(false);
    expect(Object.keys(body.conflicts)).toEqual(['502']);
    const row = store.rows[0];
    expect(Date.parse(row.customs_answers_sent_at as string)).toBe(Date.parse(T0));
    expect(row.last_submitted_at).toBeNull();
    const stored = row.customs_answers as Record<string, { parts: unknown[]; replies?: Record<string, string>; replyMeta?: Record<string, { savedAt?: string }>; updatedAt?: string }>;
    expect(stored['501'].parts).toEqual([FULL]);
    expect(stored['502'].replies).toEqual({ '31': 'Bob draft' });
    expect(isVatCustomsReplySent(stored['502'].replyMeta?.['31'], stored['502'].updatedAt, row.customs_answers_sent_at as string)).toBe(false);
    expect(body.customsAnswersSentAt).toBe(T0);
    // "Use mine" (base = Bob's stamp) now saves; a second Send sends it all.
    const mine = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Anna text' }, baseUpdatedAt: T1 } } })).json();
    expect(Object.keys(mine.updated)).toEqual(['502']);
    expect(mine.lockedReplies).toEqual([]);
    const again = await (await send({ files: [], comment: '', answers: {} })).json();
    expect(again.answersSent).toBe(true);
    expect(again.conflicts).toEqual({});
  });

  it('Send with a conflict and a file: the file goes out, the answers are not stamped as sent', async () => {
    viewerOverride.email = 'anna@client.com';
    seed({ customs_lines: LINES, customs_answers: bobDraft, customs_answers_saved_at: T1, updated_at: T1 });
    const a = await (await upload('a.pdf', PDF)).json();
    const body = await (
      await send({ files: [{ path: a.path, name: 'a.pdf' }], comment: '', answers: { '502': { parts: [FULL], replies: { '31': 'Anna' }, baseUpdatedAt: null } } })
    ).json();
    expect(body.sent).toHaveLength(1);
    expect(body.answersSent).toBe(false);
    expect(Object.keys(body.conflicts)).toEqual(['502']);
    expect(store.rows[0].customs_answers_sent_at ?? null).toBeNull();
    expect(store.rows[0].last_submitted_at).toBeTruthy();
  });
});

describe('round 5 item 8: notes under a sent reply (routes)', () => {
  const T0 = '2026-10-11T08:00:00.000Z';
  const T1 = '2026-10-11T09:00:00.000Z';
  const sentReply = {
    '502': {
      parts: [FULL],
      replies: { '31': 'Yes, samples' },
      replyMeta: { '31': { sentAt: T0, sentBy: 'anna@client.com', savedAt: T0 } },
      updatedAt: T0,
      savedBy: 'anna@client.com',
    },
  };
  type Stored = Record<string, { notes?: Record<string, Array<Record<string, string>>> }>;
  const storedNotes = () => (store.rows[0].customs_answers as Stored)['502'].notes?.['31'] ?? [];

  for (const pg of [false, true]) {
    it(`autosave keeps a draft note, Send locks it, a later change is refused (Supabase stamps: ${pg ? '+00:00' : 'Z'})`, async () => {
      store.pgStamps = pg;
      viewerOverride.email = 'anna@client.com';
      seed({ customs_lines: LINES, customs_answers: sentReply, customs_answers_sent_at: T1, updated_at: T1, allowed_names: { 'anna@client.com': 'Anna Keller' } } as Row);
      const note = { '31': [{ id: 'n0001', text: 'Second invoice came later.' }] };
      const saved = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: note, baseUpdatedAt: T0 } } })).json();
      expect(Object.keys(saved.updated)).toEqual(['502']);
      expect(saved.notes['502']['31'][0]).toMatchObject({ id: 'n0001', text: 'Second invoice came later.', sentBy: 'anna@client.com' });
      expect(storedNotes()).toHaveLength(1);
      // Still a draft: the text can change.
      const base = saved.bases['502'];
      const changed = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': [{ id: 'n0001', text: 'Second invoice came on 02.09.' }] }, baseUpdatedAt: base } } })).json();
      expect(changed.lockedReplies).toEqual([]);
      expect(storedNotes()[0].text).toBe('Second invoice came on 02.09.');
      // Send (nothing new typed): stamps the answers, the draft note goes out.
      const sent = await (await send({ files: [], comment: '', answers: {} })).json();
      expect(sent.answersSent).toBe(true);
      const n = sent.customsAnswers['502'].notes['31'][0];
      expect(isVatCustomsReplySent(n, sent.customsAnswers['502'].updatedAt, sent.customsAnswersSentAt)).toBe(true);
      expect(sent.peopleNames).toEqual({ 'anna@client.com': 'Anna Keller' });
      // After the Send: a change is refused, the sent text stays, nothing is written.
      store.patches = [];
      const locked = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': [{ id: 'n0001', text: 'Edited' }] }, baseUpdatedAt: changed.bases['502'] } } })).json();
      expect(locked.lockedReplies).toEqual(['502']);
      expect(store.patches).toEqual([]);
      expect(storedNotes()[0].text).toBe('Second invoice came on 02.09.');
    });
  }

  it('a note to a closed question is dropped (staleReplies); too many notes: the extra ones are left out, the rest saved (no 400)', async () => {
    seed({ customs_lines: LINES, customs_answers: sentReply, customs_answers_sent_at: T1, updated_at: T1 });
    const stale = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '99': [{ id: 'n0001', text: 'Late' }] } } } })).json();
    expect(stale.staleReplies).toEqual(['502']);
    expect(store.patches).toEqual([]);
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `n00${i}xx`, text: `N${i}` }));
    const res = await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': many } } } });
    expect(res.status).toBe(200);
    const got = await res.json();
    expect(got.staleReplies).toEqual(['502']);
    expect(Object.keys(got.updated)).toEqual(['502']);
    expect(storedNotes().map((n) => n.text)).toEqual(many.slice(0, 10).map((n) => n.text));
  });

  it('Send removes an unsent draft note of a question TME closed (it never turns sent); a sent note stays', async () => {
    const T2 = '2026-10-11T10:00:00.000Z';
    const sentNote = { id: 'n0001', text: 'Sent note', sentAt: T0, savedAt: T0 };
    const draft = { id: 'n0002', text: 'Draft note', sentAt: T2, savedAt: T2 };
    const closedLines = [LINES[0], { ...LINES[1], questions: (LINES[1].questions ?? []).filter((q) => q.id !== 31) }];
    seed({
      customs_lines: closedLines,
      customs_answers: { '502': { ...sentReply['502'], notes: { '31': [sentNote, draft] }, updatedAt: T2 } },
      customs_answers_sent_at: T1,
      customs_answers_saved_at: T2,
      updated_at: T2,
    } as Row);
    const sent = await (await send({ files: [], comment: '', answers: {} })).json();
    expect(sent.answersSent).toBe(true);
    expect(storedNotes()).toEqual([sentNote]);
    expect((store.rows[0].customs_answers as Record<string, { updatedAt?: string }>)['502'].updatedAt).toBe(T2);
  });

  it('Send stamp is never before customs_answers_saved_at (another instance with a fast clock): its draft counts as sent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-11T12:00:00.000Z'));
      const fast = '2026-10-11T12:00:02.000Z';
      const draft = { id: 'n0001', text: 'Draft', sentAt: fast, savedAt: fast };
      seed({
        customs_lines: LINES,
        customs_answers: { '502': { ...sentReply['502'], notes: { '31': [draft] }, updatedAt: fast } },
        customs_answers_sent_at: T1,
        customs_answers_saved_at: '2026-10-11T12:00:02+00:00',
        updated_at: fast,
      } as Row);
      const sent = await (await send({ files: [], comment: '', answers: {} })).json();
      expect(sent.answersSent).toBe(true);
      expect(store.rows[0].customs_answers_sent_at).toBe(fast);
      expect(store.rows[0].last_submitted_at).toBe(fast);
      expect(sent.customsAnswersSentAt).toBe(fast);
      expect(isVatCustomsReplySent(draft, fast, store.rows[0].customs_answers_sent_at as string)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('switch off (no code): a note works, without any address or name', async () => {
    seed({ customs_lines: LINES, customs_answers: sentReply, customs_answers_sent_at: T1, updated_at: T1, allowed_names: { 'anna@client.com': 'Anna Keller' } } as Row);
    const saved = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': [{ id: 'n0001', text: 'No code' }] }, baseUpdatedAt: T0 } } })).json();
    expect(saved.notes['502']['31'][0]).toEqual({ id: 'n0001', text: 'No code', sentAt: saved.savedAt, savedAt: saved.savedAt });
    const body = await (await GET(new NextRequest(url()), params())).json();
    expect(body.customsAnswers['502'].notes['31'][0].text).toBe('No code');
    expect(body.peopleNames).toEqual({});
  });
});

describe('11.10: Send only on a real change (content, not "touched")', () => {
  // Each request a second later (a save in the same millisecond as the Send would count as sent).
  let clock = Date.parse('2026-10-11T10:00:00.000Z');
  const tick = () => vi.setSystemTime((clock += 1000));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick();
    seed({ customs_lines: LINES });
  });
  afterEach(() => vi.useRealTimers());
  const NOTE_ID = 'note-abc1';
  type Stored = Record<string, { sentKey?: string; notes?: unknown; updatedAt?: string }>;

  it('a note added and removed again: the autosaves write it and take it out, then nothing is unsent and a Send stamps nothing', async () => {
    tick();
    const first = await send({ files: [], comment: '', answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' } } } });
    expect((await first.json()).answersSent).toBe(true);
    const sentAt = store.rows[0].customs_answers_sent_at;
    expect((store.rows[0].customs_answers as Stored)['502'].sentKey).toMatch(/^[0-9a-f]{14}$/);

    tick();

    const added = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': [{ id: NOTE_ID, text: 'More' }] } } } })).json();
    expect(added.unsentLines).toEqual(['502']);
    tick();
    const removed = await (await answers({ answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': [] } } } })).json();
    expect(Object.keys(removed.updated)).toEqual(['502']);
    expect(removed.unsentLines).toEqual([]);

    store.patches = [];
    tick();
    const again = await send({ files: [], comment: '', answers: {} });
    expect(again.status).toBe(200);
    expect((await again.json()).answersSent).toBe(false);
    expect(store.patches).toEqual([]);
    expect(store.rows[0].customs_answers_sent_at).toBe(sentAt);
  });

  it('an empty note box, whitespace, an emptied split: the autosave writes nothing (no saved_at, no updated_at)', async () => {
    tick();
    await send({ files: [], comment: '', answers: { '502': { parts: [FULL], replies: { '31': 'Yes, samples' } } } });
    const before = { saved: store.rows[0].customs_answers_saved_at, updated: store.rows[0].updated_at };
    store.patches = [];
    tick();
    const res = await (
      await answers({
        answers: {
          '502': {
            parts: [{ ...FULL, invoiceRef: '   ' }, {}],
            replies: { '31': '  Yes, samples  ', '32': '   ' },
            notes: { '31': [{ id: NOTE_ID, text: '  ' }] },
          },
        },
      })
    ).json();
    expect(res.updated).toEqual({});
    expect(res.unsentLines).toEqual([]);
    expect(store.patches).toEqual([]);
    expect(store.rows[0].customs_answers_saved_at).toBe(before.saved);
    expect(store.rows[0].updated_at).toBe(before.updated);
  });

  it('a real change is unsent until the next Send, which writes the new sentKey', async () => {
    tick();
    await send({ files: [], comment: '', answers: { '501': { parts: [FULL] } } });
    const key1 = (store.rows[0].customs_answers as Stored)['501'].sentKey;
    tick();
    const changed = await (await answers({ answers: { '501': { parts: [{ ...FULL, invoiceRef: 'INV-7' }] } } })).json();
    expect(changed.unsentLines).toEqual(['501']);
    tick();
    const res = await send({ files: [], comment: '', answers: {} });
    expect((await res.json()).answersSent).toBe(true);
    const key2 = (store.rows[0].customs_answers as Stored)['501'].sentKey;
    expect(key2).toBeTruthy();
    expect(key2).not.toBe(key1);
  });

  it('typed and changed back before the Send: the Send saves it like an autosave, without a Send stamp', async () => {
    tick();
    await send({ files: [], comment: '', answers: { '501': { parts: [FULL] } } });
    const sentAt = store.rows[0].customs_answers_sent_at;
    tick();
    await answers({ answers: { '501': { parts: [{ ...FULL, invoiceRef: 'INV-7' }] } } });
    tick();
    const res = await send({ files: [], comment: '', answers: { '501': { parts: [FULL] } } });
    expect(res.status).toBe(200);
    expect((await res.json()).answersSent).toBe(false);
    expect(store.rows[0].customs_answers_sent_at).toBe(sentAt);
    expect((store.rows[0].customs_answers as Record<string, { parts: unknown }>)['501'].parts).toEqual([FULL]);
  });
});
