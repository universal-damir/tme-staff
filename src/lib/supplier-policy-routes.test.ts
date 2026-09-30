// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A tiny in-memory stand-in for the service-role Supabase client: one table,
// select-by-token for reads, update with .eq filters + .select for writes.
type Row = Record<string, unknown>;
const store: { rows: Row[]; updates: Row[]; beforeUpdate?: () => void } = { rows: [], updates: [] };

function makeClient() {
  return {
    from(table: string) {
      if (table !== 'svp_intake_submissions') throw new Error(`unexpected table ${table}`);
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
              return { data: hit ? { ...hit } : null, error: null };
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
            async select() {
              store.beforeUpdate?.();
              const hits = store.rows.filter((r) => filters.every(([c, v]) => r[c] === v));
              hits.forEach((r) => Object.assign(r, patch));
              if (hits.length) store.updates.push(patch);
              return { data: hits.map((r) => ({ id: r.id })), error: null };
            },
          };
          return q;
        },
      };
    },
  };
}

vi.mock('@/lib/supabase-server', () => ({ getSupabaseAdmin: () => makeClient() }));

import { GET } from '@/app/api/supplier-checks/[token]/route';
import { POST } from '@/app/api/supplier-checks/[token]/submit/route';

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ROW_ID = '11111111-2222-3333-4444-555555555555';

function seed(over: Row = {}) {
  store.rows = [
    {
      id: ROW_ID,
      link_token: TOKEN,
      client_id: 10614,
      company_code: '10614',
      origin_env: 'sandbox',
      company_name: 'Cognit FZCO',
      status: 'invited',
      price_aed: 950,
      prefill_data: { companyName: 'Cognit FZCO', priceAed: 950 },
      submitted_data: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      submitted_at: null,
      ...over,
    },
  ];
  store.updates = [];
  store.beforeUpdate = undefined;
}

const good = {
  implementer: { name: 'Sara Lee', position: 'Accountant', email: '' },
  reviewer: { name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' },
  supervisor: { name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' },
  recordsLocationIsRegisteredOffice: true,
  recordsLocation: '',
  priceAgreed: true,
};

const params = (token: string) => ({ params: Promise.resolve({ token }) });
const get = (token = TOKEN) => GET(new NextRequest(`http://x/api/supplier-checks/${token}`), params(token));
const post = (body: unknown, token = TOKEN) =>
  POST(
    new NextRequest(`http://x/api/supplier-checks/${token}/submit`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params(token)
  );

beforeEach(() => seed());

describe('GET /api/supplier-checks/[token]', () => {
  it('bad UUID = 404', async () => {
    expect((await get('not-a-uuid')).status).toBe(404);
  });

  it('unknown token = 404', async () => {
    expect((await get('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('cancelled or expired = 410', async () => {
    seed({ status: 'cancelled' });
    expect((await get()).status).toBe(410);
    seed({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await get()).status).toBe(410);
  });

  it('never returns id, token, client id or origin env', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(ROW_ID);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('client_id');
    expect(text).not.toContain('10614');
    expect(text).not.toContain('sandbox');
    expect(JSON.parse(text)).toMatchObject({ status: 'invited', companyName: 'Cognit FZCO', priceAed: 950 });
  });

  it('a submitted row still opens (thank-you view)', async () => {
    seed({ status: 'submitted' });
    expect((await get()).status).toBe(200);
  });
});

describe('POST /api/supplier-checks/[token]/submit', () => {
  it('stores the answers and flips the row to submitted', async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    const r = store.rows[0];
    expect(r.status).toBe('submitted');
    expect(r.price_agreed).toBe(true);
    expect(r.synced_to_tme).toBe(false);
    expect(r.agreed_at).toBeTruthy();
    expect(r.submitted_at).toBeTruthy();
    expect(r.submitted_data).toEqual({ ...good, priceAgreed: true });
  });

  it('without the price agreement = 400 price_not_agreed', async () => {
    const res = await post({ ...good, priceAgreed: false });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'price_not_agreed' });
    expect(store.rows[0].status).toBe('invited');
  });

  it('the price changed while the form was open = 409 price_changed, nothing written', async () => {
    const res = await post({ ...good, shownPriceAed: 500 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'price_changed' });
    expect(store.rows[0].status).toBe('invited');
    expect((await post({ ...good, shownPriceAed: 950 })).status).toBe(200);
  });

  it('invalid answers = 400 with plain-English messages', async () => {
    const res = await post({ ...good, supervisor: { name: 'Ali Khan', position: 'Manager', email: '' } });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe('invalid_answers');
    expect(j.messages).toContain('Supervisor: the email is missing. The Supervisor signs the policy.');
  });

  it('folds names to English letters before storing', async () => {
    const res = await post({ ...good, implementer: { name: 'Mehmet Yılmaz', position: 'Müdür', email: '' } });
    expect(res.status).toBe(200);
    const stored = store.rows[0].submitted_data as typeof good;
    expect(stored.implementer).toEqual({ name: 'Mehmet Yilmaz', position: 'Mudur', email: '' });
  });

  it('drops unknown fields', async () => {
    await post({ ...good, status: 'synced', client_id: 1 });
    expect(Object.keys(store.rows[0].submitted_data as object)).not.toContain('client_id');
  });

  it('double submit = 409', async () => {
    expect((await post(good)).status).toBe(200);
    expect((await post(good)).status).toBe(409);
    expect(store.updates).toHaveLength(1);
  });

  it('a race that loses the status guard = 409, nothing written', async () => {
    // The access check saw 'invited', but another request won the update first.
    store.beforeUpdate = () => {
      store.rows[0].status = 'submitted';
    };
    const res = await post(good);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_submitted' });
    expect(store.updates).toHaveLength(0);
  });

  it('cancelled / expired = 410, bad UUID = 404, bad JSON = 400', async () => {
    seed({ status: 'cancelled' });
    expect((await post(good)).status).toBe(410);
    seed({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await post(good)).status).toBe(410);
    seed();
    expect((await post(good, 'nope')).status).toBe(404);
    expect((await post('{not json')).status).toBe(400);
  });
});
