// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

// In-memory stand-in for the service-role Supabase client: the onboarding
// table (select + eq + single/maybeSingle) and the staff-documents bucket
// (list with folders, upload, signed URLs).
type Row = Record<string, unknown>;
const store: { rows: Row[]; objects: Set<string>; createdAt: Map<string, string> } = {
  rows: [],
  objects: new Set(),
  createdAt: new Map(),
};

function listFolder(folder: string) {
  const prefix = `${folder}/`;
  const seen = new Map<string, { name: string; id: string | null; created_at?: string }>();
  for (const path of store.objects) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) seen.set(rest, { name: rest, id: `id-${path}`, created_at: store.createdAt.get(path) });
    else seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
  }
  return [...seen.values()];
}

function makeClient() {
  return {
    from(table: string) {
      if (table !== 'staff_onboarding_submissions') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const filters: Array<(r: Row) => boolean> = [];
          const hit = () => store.rows.find((r) => filters.every((f) => f(r)));
          const q = {
            eq(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return q;
            },
            async single() {
              const h = hit();
              return h ? { data: structuredClone(h), error: null } : { data: null, error: { message: 'none' } };
            },
            async maybeSingle() {
              const h = hit();
              return { data: h ? structuredClone(h) : null, error: null };
            },
          };
          return q;
        },
      };
    },
    storage: {
      from(bucket: string) {
        if (bucket !== 'staff-documents') throw new Error(`unexpected bucket ${bucket}`);
        return {
          async list(folder: string, opts: { limit: number; offset: number }) {
            return { data: listFolder(folder).slice(opts.offset, opts.offset + opts.limit), error: null };
          },
          async upload(path: string) {
            store.objects.add(path);
            return { error: null };
          },
          async remove(paths: string[]) {
            for (const p of paths) store.objects.delete(p);
            return { data: [], error: null };
          },
          async createSignedUrl(path: string) {
            return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
          },
          async createSignedUploadUrl(path: string) {
            return { data: { signedUrl: `https://signed.example/upload/${path}` }, error: null };
          },
        };
      },
    },
  };
}

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: () => makeClient(),
  STORAGE_BUCKET: 'staff-documents',
}));

import { GET as FILE } from '@/app/api/storage/file/route';
import { POST as UPLOAD } from '@/app/api/storage/upload/route';
import { MAX_PENDING_PER_ROW, countPendingUploads } from '@/lib/direct-upload';

const LINK = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ROW_ID = '11111111-2222-3333-4444-555555555555';
const EMP_TOKEN = '22222222-3333-4444-5555-666666666666';
const EMPLOYER_TOKEN = '33333333-4444-5555-6666-777777777777';
// MAX_FILES_PER_ROW in the upload route (a route file may export handlers only).
const MAX_FILES_PER_ROW = 80;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

function seed(over: Row = {}) {
  store.rows = [
    {
      id: ROW_ID,
      link_token: LINK,
      status: 'employer_completed',
      current_step: 'employee',
      is_same_person: false,
      onboarding_type: 'new_hire',
      employer_access_token: EMPLOYER_TOKEN,
      employer_recall_count: 0,
      employee_access_token: EMP_TOKEN,
      ...over,
    },
  ];
  store.objects = new Set([`${ROW_ID}/passport/cover/a.png`, `${ROW_ID}/job_offer_letter/j.pdf`]);
  store.createdAt = new Map();
}

beforeEach(() => seed());

function fileReq(params: Record<string, string>) {
  return FILE(new NextRequest(`http://x/api/storage/file?${new URLSearchParams(params)}`));
}

function uploadReq(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new File([PNG as BlobPart], 'p.png', { type: 'image/png' }));
  return UPLOAD(new NextRequest('http://x/api/storage/upload', { method: 'POST', body: form }));
}

function startReq(fields: Record<string, unknown>) {
  return UPLOAD(
    new NextRequest('http://x/api/storage/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'start', size: 5_000_000, ...fields }),
    })
  );
}

describe('GET /api/storage/file', () => {
  const path = `${ROW_ID}/passport/cover/a.png`;

  it('serves a file with the link and the employee token', async () => {
    const res = await fileReq({ path, id: LINK, token: EMP_TOKEN });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://signed.example/${path}`);
  });

  it('refuses without the link token (row id + path alone are not enough)', async () => {
    expect((await fileReq({ path })).status).toBe(404);
    expect((await fileReq({ path, id: ROW_ID, token: EMP_TOKEN })).status).toBe(404);
  });

  it('refuses a missing or wrong employee token on the employee step', async () => {
    expect((await fileReq({ path, id: LINK })).status).toBe(403);
    expect((await fileReq({ path, id: LINK, token: EMPLOYER_TOKEN })).status).toBe(403);
  });

  it("refuses a path outside the row's own folder", async () => {
    const other = '99999999-8888-7777-6666-555555555555/passport/cover/a.png';
    expect((await fileReq({ path: other, id: LINK, token: EMP_TOKEN })).status).toBe(404);
  });

  it('refuses closed rows', async () => {
    for (const status of ['complete', 'cancelled', 'expired']) {
      seed({ status });
      expect((await fileReq({ path, id: LINK, token: EMP_TOKEN })).status).toBe(410);
    }
  });

  it('employer step of a two-person form: job offer letter only', async () => {
    seed({ status: 'pending', current_step: 'employer' });
    expect((await fileReq({ path: `${ROW_ID}/job_offer_letter/j.pdf`, id: LINK })).status).toBe(302);
    expect((await fileReq({ path, id: LINK })).status).toBe(404);
  });

  it('employer step after a recall needs the employer token', async () => {
    seed({ status: 'pending', current_step: 'employer', employer_recall_count: 1 });
    const jol = `${ROW_ID}/job_offer_letter/j.pdf`;
    expect((await fileReq({ path: jol, id: LINK })).status).toBe(403);
    expect((await fileReq({ path: jol, id: LINK, e: EMPLOYER_TOKEN })).status).toBe(302);
  });
});

describe('POST /api/storage/upload', () => {
  it('stores a file with the employee token', async () => {
    const res = await uploadReq({ submissionId: LINK, type: 'photo', token: EMP_TOKEN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path.startsWith(`${ROW_ID}/photo/`)).toBe(true);
  });

  it('refuses the employee step without the employee token', async () => {
    expect((await uploadReq({ submissionId: LINK, type: 'photo' })).status).toBe(403);
    expect((await uploadReq({ submissionId: LINK, type: 'photo', token: EMPLOYER_TOKEN })).status).toBe(403);
  });

  it('refuses closed rows', async () => {
    for (const status of ['complete', 'cancelled', 'expired']) {
      seed({ status });
      expect((await uploadReq({ submissionId: LINK, type: 'photo', token: EMP_TOKEN })).status).toBe(409);
    }
  });

  it('employer step: job offer letter only; after a recall with the employer token', async () => {
    seed({ status: 'pending', current_step: 'employer' });
    expect((await uploadReq({ submissionId: LINK, type: 'job_offer_letter' })).status).toBe(200);
    expect((await uploadReq({ submissionId: LINK, type: 'photo' })).status).toBe(403);
    seed({ status: 'pending', current_step: 'employer', employer_recall_count: 1 });
    expect((await uploadReq({ submissionId: LINK, type: 'job_offer_letter' })).status).toBe(403);
    expect(
      (await uploadReq({ submissionId: LINK, type: 'job_offer_letter', employerToken: EMPLOYER_TOKEN })).status
    ).toBe(200);
  });

  it('same-person form on the employer step uploads every type without a token', async () => {
    seed({ status: 'pending', current_step: 'employer', is_same_person: true, employee_access_token: null });
    expect((await uploadReq({ submissionId: LINK, type: 'photo' })).status).toBe(200);
  });

  it('caps the files one row may hold (stored + incoming)', async () => {
    for (let i = 0; i < MAX_FILES_PER_ROW - 3; i++) store.objects.add(`${ROW_ID}/photo/${i}.png`);
    store.objects.add(`_incoming/${ROW_ID}/x`);
    // 2 seeded + (MAX - 3) + 1 incoming = MAX
    const res = await uploadReq({ submissionId: LINK, type: 'photo', token: EMP_TOKEN });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'too_many_files' });
  });

  it('direct upload start: token checked, pending copies capped', async () => {
    expect((await startReq({ submissionId: LINK, type: 'passport', passportPage: 'cover' })).status).toBe(403);
    const ok = await startReq({ submissionId: LINK, type: 'passport', passportPage: 'cover', token: EMP_TOKEN });
    expect(ok.status).toBe(200);
    for (let i = 0; i < MAX_PENDING_PER_ROW; i++) store.objects.add(`_incoming/${ROW_ID}/p${i}`);
    const capped = await startReq({ submissionId: LINK, type: 'passport', passportPage: 'cover', token: EMP_TOKEN });
    expect(capped.status).toBe(409);
  });

  it('direct upload start: each minted URL leaves a slot marker that counts toward the cap', async () => {
    for (let i = 0; i < MAX_PENDING_PER_ROW; i++) {
      const res = await startReq({ submissionId: LINK, type: 'photo', token: EMP_TOKEN });
      expect(res.status).toBe(200);
    }
    // No file was PUT to any URL, yet the cap is reached.
    const markers = [...store.objects].filter((p) => p.startsWith(`_incoming/${ROW_ID}/.slot-`));
    expect(markers).toHaveLength(MAX_PENDING_PER_ROW);
    expect((await startReq({ submissionId: LINK, type: 'photo', token: EMP_TOKEN })).status).toBe(409);
    // A marker plus its arrived copy is one upload.
    const id = markers[0].split('.slot-')[1];
    store.objects.add(`_incoming/${ROW_ID}/${id}`);
    expect(await countPendingUploads('staff-documents', ROW_ID)).toBe(MAX_PENDING_PER_ROW);
  });

  it('leftovers older than 2 hours no longer count and are removed', async () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < MAX_PENDING_PER_ROW; i++) {
      store.objects.add(`_incoming/${ROW_ID}/p${i}`);
      store.createdAt.set(`_incoming/${ROW_ID}/p${i}`, old);
    }
    const res = await startReq({ submissionId: LINK, type: 'photo', token: EMP_TOKEN });
    expect(res.status).toBe(200);
    expect([...store.objects].filter((p) => p.startsWith(`_incoming/${ROW_ID}/p`))).toHaveLength(0);
    // The multipart cap does not count them either.
    for (let i = 0; i < MAX_PENDING_PER_ROW; i++) {
      store.objects.add(`_incoming/${ROW_ID}/q${i}`);
      store.createdAt.set(`_incoming/${ROW_ID}/q${i}`, old);
    }
    expect(await countPendingUploads('staff-documents', ROW_ID)).toBe(1); // the fresh marker only
  });
});

describe('removed routes', () => {
  it('the unauthenticated notify-employee/employer-complete routes are gone', () => {
    const api = join(__dirname, '..', 'app', 'api');
    expect(existsSync(join(api, 'notify-employee-complete', 'route.ts'))).toBe(false);
    expect(existsSync(join(api, 'notify-employer-complete', 'route.ts'))).toBe(false);
  });
});
