// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// In-memory stand-in for the service-role client: one table (select by
// token, update with .eq / .is filters + .select) and one storage bucket.
type Row = Record<string, unknown>;
const store: {
  rows: Row[];
  objects: Map<string, number>;
  uploads: string[];
  removed: string[];
  beforeUpdate?: () => void;
} = { rows: [], objects: new Map(), uploads: [], removed: [] };

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
              hits.forEach((r) => Object.assign(r, structuredClone(patch)));
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

import { GET } from '@/app/api/vat-files/[token]/route';
import { POST as UPLOAD, DELETE as REMOVE } from '@/app/api/vat-files/[token]/upload/route';
import { POST as SEND } from '@/app/api/vat-files/[token]/send/route';
import { GET as CUSTOMS } from '@/app/api/vat-files/[token]/customs-list/route';

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
  store.beforeUpdate = undefined;
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

beforeEach(() => seed());

describe('GET /api/vat-files/[token]', () => {
  it('unknown or malformed token = 404', async () => {
    expect((await GET(new NextRequest(url('', 'x')), params('x'))).status).toBe(404);
    const other = 'Unknown0000000000000000000';
    expect((await GET(new NextRequest(url('', other)), params(other))).status).toBe(404);
  });

  it('expired = 410 expired; closed still answers so the page can say so', async () => {
    seed({ expires_at: '2020-01-01T00:00:00Z' });
    const res = await GET(new NextRequest(url()), params());
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'expired' });
    seed({ status: 'closed' });
    const closed = await GET(new NextRequest(url()), params());
    expect(closed.status).toBe(200);
    expect((await closed.json()).status).toBe('closed');
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

  it('closed request: upload and send = 410 closed', async () => {
    seed({ status: 'closed' });
    const res = await upload('a.pdf', PDF);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect((await send({ files: [], comment: '' })).status).toBe(410);
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
});
