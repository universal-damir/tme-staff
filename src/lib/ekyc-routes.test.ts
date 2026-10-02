// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// In-memory stand-in for the service-role Supabase client: one table
// (select / update with eq + in filters) and one storage bucket.
type Row = Record<string, unknown>;
const store: {
  rows: Row[];
  objects: Map<string, Uint8Array>;
  removed: string[];
  tick: number;
  /** Runs once before the next update: simulates a write that lands in between. */
  beforeUpdate?: () => void;
} = { rows: [], objects: new Map(), removed: [], tick: 0 };

function matches(row: Row, filters: Array<(r: Row) => boolean>) {
  return filters.every((f) => f(row));
}

function makeClient() {
  return {
    from(table: string) {
      if (table !== 'ekyc_submissions') throw new Error(`unexpected table ${table}`);
      return {
        select(cols: string) {
          const filters: Array<(r: Row) => boolean> = [];
          const q = {
            eq(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return q;
            },
            async maybeSingle() {
              const hit = store.rows.find((r) => matches(r, filters));
              if (!hit) return { data: null, error: null };
              const picked: Row = {};
              for (const c of cols.split(',').map((x) => x.trim())) picked[c] = structuredClone(hit[c]);
              return { data: picked, error: null };
            },
          };
          return q;
        },
        update(patch: Row) {
          const filters: Array<(r: Row) => boolean> = [];
          const run = () => {
            const hook = store.beforeUpdate;
            store.beforeUpdate = undefined;
            hook?.();
            const hits = store.rows.filter((r) => matches(r, filters));
            for (const r of hits) {
              Object.assign(r, structuredClone(patch));
              // Every write moves updated_at, like the real column default + trigger.
              store.tick += 1;
              r.updated_at = `t${store.tick}`;
            }
            return hits;
          };
          const q = {
            eq(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return q;
            },
            in(col: string, vals: unknown[]) {
              filters.push((r) => vals.includes(r[col]));
              return q;
            },
            async select() {
              return { data: run().map((r) => ({ id: r.id })), error: null };
            },
            then(resolve: (v: { error: null }) => void) {
              run();
              resolve({ error: null });
            },
          };
          return q;
        },
      };
    },
    storage: {
      from(bucket: string) {
        if (bucket !== 'ekyc-documents') throw new Error(`unexpected bucket ${bucket}`);
        return {
          async upload(path: string, buf: Uint8Array) {
            store.objects.set(path, buf);
            return { error: null };
          },
          async remove(paths: string[]) {
            for (const p of paths) {
              store.objects.delete(p);
              store.removed.push(p);
            }
            return { error: null };
          },
          async createSignedUrl(path: string) {
            return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
          },
        };
      },
    },
  };
}

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: () => makeClient(),
  EKYC_BUCKET: 'ekyc-documents',
}));
vi.mock('@/lib/ai-route-guard', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimitCheck: () => ({ blocked: false }),
}));

import { GET } from '@/app/api/kyc/[token]/route';
import { POST as AUTOSAVE } from '@/app/api/kyc/[token]/autosave/route';
import { POST as SUBMIT } from '@/app/api/kyc/[token]/submit/route';
import { POST as UPLOAD } from '@/app/api/kyc/[token]/upload/route';
import { GET as FILE } from '@/app/api/kyc/[token]/file/route';
import { emptyIndividualKyc, type IndividualKycData } from '@/types/ekyc';

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ROW_ID = '11111111-2222-3333-4444-555555555555';
const PORTAL_ID = '99999999-8888-7777-6666-555555555555';
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

function ref(slot: string) {
  return { path: `${ROW_ID}/${slot}-x.pdf`, filename: `${slot}.pdf`, mimeType: 'application/pdf', size: 10, uploadedAt: 't' };
}

function seed(over: Row = {}) {
  store.rows = [
    {
      id: ROW_ID,
      link_token: TOKEN,
      origin_env: 'sandbox',
      portal_request_id: PORTAL_ID,
      type: 'individual',
      status: 'invited',
      display_name: 'Jürgen Müller',
      client_code: '10614',
      bilingual: true,
      prefill_data: { prefilledFieldIds: [] },
      form_data: null,
      documents: {},
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      submitted_at: null,
      synced_to_tme: false,
      updated_at: 't0',
      ...over,
    },
  ];
  store.objects = new Map();
  store.removed = [];
  store.beforeUpdate = undefined;
}

function completeIndividual(): IndividualKycData {
  return {
    ...emptyIndividualKyc(),
    fullName: 'Jürgen Müller',
    nationality: 'Germany',
    dualNationality: 'no',
    uaeResident: 'no',
    homeAddress: { street: 'Hauptstraße 5', city: 'München', postalCode: '80331', country: 'Germany' },
    homePhone: '+49 89 1234567',
    gccNational: 'no',
    incomeSources: ['investments'],
    isPep: 'no',
    rcaIsPep: 'no',
    sanctioned: 'no',
    highRisk: 'no',
    trustCharity: 'no',
    modesOfPayment: ['bank_transfer'],
    declaration: { authorizedPersonName: 'Jürgen Müller', signature: SIGNATURE, date: '2026-10-02' },
  };
}

const row = () => store.rows[0];
const params = (token: string) => ({ params: Promise.resolve({ token }) });
const get = (token = TOKEN) => GET(new NextRequest(`http://x/api/kyc/${token}`), params(token));
const postJson = (handler: typeof AUTOSAVE, name: string, body: unknown, token = TOKEN) =>
  handler(
    new NextRequest(`http://x/api/kyc/${token}/${name}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params(token)
  );
const upload = (slot: string, bytes: Uint8Array, name = 'pass.png') => {
  const form = new FormData();
  form.append('slot', slot);
  form.append('file', new File([bytes as BlobPart], name, { type: 'image/png' }));
  return UPLOAD(new NextRequest(`http://x/api/kyc/${TOKEN}/upload`, { method: 'POST', body: form }), params(TOKEN));
};
const file = (slot: string) => FILE(new NextRequest(`http://x/api/kyc/${TOKEN}/file?slot=${slot}`), params(TOKEN));

beforeEach(() => seed());

describe('GET /api/kyc/[token]', () => {
  it('bad UUID or unknown token = 404', async () => {
    expect((await get('not-a-uuid')).status).toBe(404);
    expect((await get('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('cancelled or expired = 410 and says whether the form was bilingual', async () => {
    seed({ status: 'cancelled' });
    let res = await get();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'cancelled', bilingual: true });
    seed({ expires_at: new Date(Date.now() - 1000).toISOString(), bilingual: false });
    res = await get();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'expired', bilingual: false });
  });

  it('never returns the id, token, portal id, client code or origin env', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const secret of [ROW_ID, TOKEN, PORTAL_ID, 'sandbox', '10614']) expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toMatchObject({ type: 'individual', status: 'open', displayName: 'Jürgen Müller', bilingual: true });
  });

  it('first open flips invited to in_progress', async () => {
    await get();
    expect(row().status).toBe('in_progress');
  });

  it('a submitted form still opens read-only, even after the link date', async () => {
    seed({ status: 'submitted', expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('submitted');
  });

  it('individual: never sends pre-fill; file paths never leave the server', async () => {
    seed({ prefill_data: { prefilledFieldIds: ['fullName'], fullName: 'x' }, documents: { passport: ref('passport') } });
    const body = await (await get()).json();
    expect(body.prefill).toBeNull();
    expect(body.documents.passport).toEqual({ filename: 'passport.pdf', mimeType: 'application/pdf', size: 10, uploadedAt: 't' });
    expect(JSON.stringify(body)).not.toContain(ROW_ID);
  });
});

describe('POST /api/kyc/[token]/autosave', () => {
  it('stores the draft with umlauts intact (names in Latin, D8) and never touches documents', async () => {
    seed({ documents: { passport: ref('passport') } });
    const res = await postJson(AUTOSAVE, 'autosave', {
      formData: { fullName: 'Jürgen <b>Müller</b>', junk: 'x' },
      documents: { passport: { path: 'other/evil.pdf' } },
    });
    expect(res.status).toBe(200);
    const saved = row().form_data as Record<string, unknown>;
    expect(saved.fullName).toBe('Juergen bMueller/b');
    expect(saved.junk).toBeUndefined();
    expect(row().documents).toEqual({ passport: ref('passport') });
    expect(row().status).toBe('in_progress');
  });

  it('the leave-page save without the signature keeps the stored one only when it says so', async () => {
    seed({ form_data: completeIndividual() });
    const { signature: _drop, ...rest } = completeIndividual().declaration;
    void _drop;
    const body = { ...completeIndividual(), fullName: 'Anna Berg', declaration: rest };
    expect((await postJson(AUTOSAVE, 'autosave', { formData: body, keepSignature: true })).status).toBe(200);
    let saved = row().form_data as IndividualKycData;
    expect(saved.fullName).toBe('Anna Berg');
    expect(saved.declaration.signature).toBe(SIGNATURE);
    // Without the flag a missing signature means the client cleared it.
    expect((await postJson(AUTOSAVE, 'autosave', { formData: body })).status).toBe(200);
    saved = row().form_data as IndividualKycData;
    expect(saved.declaration.signature).toBe('');
  });

  it('rejects oversized bodies and bad JSON', async () => {
    expect((await postJson(AUTOSAVE, 'autosave', 'x'.repeat(300 * 1024))).status).toBe(413);
    expect((await postJson(AUTOSAVE, 'autosave', '{nope')).status).toBe(400);
    expect((await postJson(AUTOSAVE, 'autosave', { formData: [] })).status).toBe(400);
  });

  it('a submitted form can no longer be changed (409); a closed link answers 410', async () => {
    seed({ status: 'submitted' });
    expect((await postJson(AUTOSAVE, 'autosave', { formData: {} })).status).toBe(409);
    seed({ status: 'cancelled' });
    expect((await postJson(AUTOSAVE, 'autosave', { formData: {} })).status).toBe(410);
  });
});

describe('POST /api/kyc/[token]/submit', () => {
  it('an incomplete form = 400 with every missing field named', async () => {
    const res = await postJson(SUBMIT, 'submit', { formData: {} });
    expect(res.status).toBe(400);
    const body = await res.json();
    const ids = body.errors.map((e: { fieldId: string }) => e.fieldId);
    expect(ids).toContain('fullName');
    expect(ids).toContain('documents.passport');
    expect(body.errors[0].message.en).toBeTruthy();
    expect(row().status).toBe('invited');
  });

  it('a complete form locks the row; extra files are left out; a second submit = 409', async () => {
    seed({
      documents: {
        passport: ref('passport'),
        photo: ref('photo'),
        proof_of_address: ref('proof_of_address'),
        second_passport: ref('second_passport'),
      },
    });
    const res = await postJson(SUBMIT, 'submit', { formData: completeIndividual() });
    expect(res.status).toBe(200);
    expect(row().status).toBe('submitted');
    expect(row().submitted_at).toBeTruthy();
    expect(Object.keys(row().documents as object).sort()).toEqual(['passport', 'photo', 'proof_of_address']);
    expect((row().form_data as IndividualKycData).homeAddress.city).toBe('München');
    expect((await postJson(SUBMIT, 'submit', { formData: completeIndividual() })).status).toBe(409);
  });

  it('stores person names in Latin letters (Müller = Mueller), addresses unchanged', async () => {
    seed({ documents: { passport: ref('passport'), photo: ref('photo'), proof_of_address: ref('proof_of_address') } });
    const res = await postJson(SUBMIT, 'submit', { formData: { ...completeIndividual(), fullName: ' Jürgen Müller ' } });
    expect(res.status).toBe(200);
    const stored = row().form_data as IndividualKycData;
    expect(stored.fullName).toBe('Juergen Mueller');
    expect(stored.declaration.authorizedPersonName).toBe('Juergen Mueller');
    expect(stored.homeAddress.street).toBe('Hauptstraße 5');
  });

  it('a Cyrillic name is refused with an error by the field', async () => {
    seed({ documents: { passport: ref('passport'), photo: ref('photo'), proof_of_address: ref('proof_of_address') } });
    const res = await postJson(SUBMIT, 'submit', { formData: { ...completeIndividual(), fullName: 'Иван Петров' } });
    expect(res.status).toBe(400);
    const ids = (await res.json()).errors.map((e: { fieldId: string }) => e.fieldId);
    expect(ids).toEqual(['fullName']);
    expect(row().status).toBe('invited');
  });

  it('a write that lands between the check and the lock = 409 changed, row stays open', async () => {
    seed({ documents: { passport: ref('passport'), photo: ref('photo'), proof_of_address: ref('proof_of_address') } });
    store.beforeUpdate = () => {
      row().updated_at = 't-other-write';
    };
    const res = await postJson(SUBMIT, 'submit', { formData: completeIndividual() });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('changed');
    expect(row().status).toBe('invited');
    // Pressing Submit again works.
    expect((await postJson(SUBMIT, 'submit', { formData: completeIndividual() })).status).toBe(200);
  });

  it('autosave stores person names converted too', async () => {
    const res = await postJson(AUTOSAVE, 'autosave', { formData: { ...completeIndividual(), fullName: 'Jürgen Müller' } });
    expect(res.status).toBe(200);
    expect((row().form_data as IndividualKycData).fullName).toBe('Juergen Mueller');
  });

  it('a corporate form uses the corporate validator', async () => {
    seed({ type: 'corporate' });
    const res = await postJson(SUBMIT, 'submit', { formData: { companyName: 'Bäckerei FZCO' } });
    expect(res.status).toBe(400);
    const ids = (await res.json()).errors.map((e: { fieldId: string }) => e.fieldId);
    expect(ids).toContain('licenses'); // no license block at all
    expect(ids).not.toContain('companyName');
    expect(ids).not.toContain('website'); // 18 to 20 are optional
  });
});

describe('POST /api/kyc/[token]/upload', () => {
  it('stores a PNG under the row folder, records it, and never returns the path', async () => {
    const res = await upload('passport', PNG, 'Paß Kopie.png');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(ROW_ID);
    expect(body.document.filename).toBe('Paß Kopie.png');
    const stored = (row().documents as Record<string, { path: string }>).passport;
    expect(stored.path).toMatch(new RegExp(`^${ROW_ID}/passport-[0-9a-f-]{36}\\.png$`));
    expect(store.objects.has(stored.path)).toBe(true);
  });

  it('a replaced file is removed from the bucket', async () => {
    await upload('passport', PNG);
    const first = (row().documents as Record<string, { path: string }>).passport.path;
    await upload('passport', PNG);
    const second = (row().documents as Record<string, { path: string }>).passport.path;
    expect(second).not.toBe(first);
    expect(store.removed).toEqual([first]);
  });

  it('rejects other file types, unknown slots, corporate forms and locked rows', async () => {
    expect((await upload('passport', new Uint8Array(20).fill(65), 'a.png')).status).toBe(415);
    expect((await upload('selfie', PNG)).status).toBe(400);
    seed({ type: 'corporate' });
    expect((await upload('passport', PNG)).status).toBe(400);
    seed({ status: 'submitted' });
    expect((await upload('passport', PNG)).status).toBe(409);
  });
});

describe('GET /api/kyc/[token]/file', () => {
  it('opens only a file recorded on this row', async () => {
    expect((await file('passport')).status).toBe(404);
    expect((await file('../x')).status).toBe(400);
    seed({ documents: { passport: ref('passport') } });
    const res = await file('passport');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://signed.example/${ROW_ID}/passport-x.pdf`);
    seed({ documents: { passport: { ...ref('passport'), path: 'other-row/passport-x.pdf' } } });
    expect((await file('passport')).status).toBe(400);
  });
});
