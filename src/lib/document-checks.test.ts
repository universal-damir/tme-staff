// @vitest-environment node
//
// STAFF-001: the AI document check can no longer be bypassed from the
// browser. Covers the pure rules (document-checks.ts), the documents route,
// the photo AI route reading the STORED file, and the submit gates.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  applyCheckRecord,
  finalizeDocumentsPatch,
  isPathForKind,
  isServerAccepted,
  SERVER_CHECKS_KEY,
} from './document-checks';
import {
  missingRequiredDocuments,
  missingRequestedDocuments,
  missingDependentRequirements,
} from './submit-validation';
import type { StaffDocumentReferences } from '@/types';

const ROW_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ROW = '99999999-8888-7777-6666-555555555555';
const LINK = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PHOTO = `${ROW_ID}/photo/a.jpg`;
const PHOTO2 = `${ROW_ID}/photo/b.jpg`;
const COVER = `${ROW_ID}/passport/cover/c.jpg`;
const INSIDE = `${ROW_ID}/passport/insidePages/d.jpg`;

// ---------------------------------------------------------------------------
// In-memory Supabase: one table + one bucket, update with eq/is + select.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const store: { rows: Row[]; objects: Map<string, Uint8Array>; tick: number; beforeUpdate?: () => void } = {
  rows: [],
  objects: new Map(),
  tick: 0,
};

function makeClient() {
  return {
    from(table: string) {
      if (table !== 'staff_onboarding_submissions') throw new Error(`unexpected table ${table}`);
      return {
        select(cols: string) {
          const filters: Array<(r: Row) => boolean> = [];
          const q = {
            eq(col: string, val: unknown) {
              filters.push((r) => r[col] === val);
              return q;
            },
            async maybeSingle() {
              const hit = store.rows.find((r) => filters.every((f) => f(r)));
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
              const hook = store.beforeUpdate;
              store.beforeUpdate = undefined;
              hook?.();
              const hits = store.rows.filter((r) => filters.every((f) => f(r)));
              for (const r of hits) {
                Object.assign(r, structuredClone(patch));
                store.tick += 1;
                r.updated_at = `t${store.tick}`;
              }
              return { data: hits.map((r) => ({ id: r.id })), error: null };
            },
          };
          return q;
        },
      };
    },
    storage: {
      from() {
        return {
          async download(path: string) {
            const bytes = store.objects.get(path);
            if (!bytes) return { data: null, error: { message: 'not found' } };
            return { data: new Blob([bytes as BlobPart]), error: null };
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

vi.mock('@/lib/onboarding-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/onboarding-token')>();
  return {
    ...actual,
    verifyOnboardingAccess: async () => {
      const row = store.rows[0];
      return row ? { ok: true, row: structuredClone(row) } : { ok: false, reason: 'not_found' };
    },
  };
});

vi.mock('@/lib/ai-route-guard', () => ({
  guardAiRoute: async (req: NextRequest) => ({
    ok: true,
    body: await req.json(),
    submissionId: LINK,
    row: structuredClone(store.rows[0]),
  }),
}));

const validatePhotoMock = vi.fn();
vi.mock('@/lib/photo-validation', () => ({
  validatePhoto: (...args: unknown[]) => validatePhotoMock(...args),
}));

const validatePassportPageMock = vi.fn();
vi.mock('@/lib/passport-page-validation', () => ({
  validatePassportPage: (...args: unknown[]) => validatePassportPageMock(...args),
}));

const extractEidMock = vi.fn();
vi.mock('@/lib/eid-extraction', () => ({
  extractEid: (...args: unknown[]) => extractEidMock(...args),
}));

const comparePhotosMock = vi.fn();
vi.mock('@/lib/photo-compare', () => ({
  comparePhotos: (...args: unknown[]) => comparePhotosMock(...args),
}));

import { POST as SAVE_DOCUMENTS } from '@/app/api/onboarding/[id]/documents/route';
import { POST as VALIDATE_PHOTO } from '@/app/api/validate-photo/route';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function seed(documents: Row = {}, over: Row = {}) {
  store.rows = [
    {
      id: ROW_ID,
      link_token: LINK,
      status: 'pending',
      current_step: 'employee',
      is_same_person: false,
      onboarding_type: 'onboarding',
      documents,
      updated_at: 't0',
      ...over,
    },
  ];
  store.tick = 0;
}

function storedDocs(): StaffDocumentReferences {
  return store.rows[0].documents as StaffDocumentReferences;
}

async function save(documents: unknown) {
  const req = new NextRequest(`http://localhost/api/onboarding/${LINK}/documents`, {
    method: 'POST',
    body: JSON.stringify({ token: 'tok', documents }),
  });
  return SAVE_DOCUMENTS(req, { params: Promise.resolve({ id: LINK }) });
}

async function checkPhoto(body: Record<string, unknown>) {
  const req = new NextRequest('http://localhost/api/validate-photo', {
    method: 'POST',
    body: JSON.stringify({ submissionId: LINK, token: 'tok', ...body }),
  });
  return VALIDATE_PHOTO(req);
}

beforeEach(() => {
  store.objects = new Map();
  store.beforeUpdate = undefined;
  validatePhotoMock.mockReset();
  validatePassportPageMock.mockReset();
  extractEidMock.mockReset();
  comparePhotosMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test';
  seed();
});

// ---------------------------------------------------------------------------
describe('documents route: browser flags are ignored', () => {
  it('stores validated=false for a new photo the server never checked', async () => {
    const res = await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true } });
    expect(res.status).toBe(200);
    expect(storedDocs().photo).toMatchObject({ path: PHOTO, validated: false });
  });

  it('ignores a server_checks map and serverCheck markers sent by the browser', async () => {
    const res = await save({
      photo: { path: PHOTO, filename: 'p.jpg', validated: true, serverCheck: { verdict: 'pass' } },
      [SERVER_CHECKS_KEY]: { [PHOTO]: { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x', at: 'now' } },
    });
    expect(res.status).toBe(200);
    const docs = storedDocs();
    expect(docs.photo).toMatchObject({ validated: false });
    expect((docs.photo as Row).serverCheck).toBeUndefined();
    expect(docs.server_checks).toBeUndefined();
    expect(missingRequiredDocuments({ documents: docs })).toContain(
      'ID photo (must pass validation or be submitted for manual review)'
    );
  });

  it('a passing server check makes the photo validated', async () => {
    seed({ [SERVER_CHECKS_KEY]: { [PHOTO]: { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x', at: 't' } } });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: false } });
    expect(storedDocs().photo).toMatchObject({ validated: true });
    expect(storedDocs().photo?.needsReview).toBeUndefined();
  });

  it('keeps the stored server_checks on every save', async () => {
    const checks = { [PHOTO]: { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x', at: 't' } };
    seed({ [SERVER_CHECKS_KEY]: checks });
    await save({ photo: { path: PHOTO, filename: 'p.jpg' } });
    expect(storedDocs().server_checks).toEqual(checks);
  });

  const failed = (path: string, kind = 'photo') => ({ [path]: { kind, verdict: 'fail', bound: true, sha256: 'x', at: 't' } });

  it('a hand-check request after two recorded failed checks is honoured and cannot be removed for the same file', async () => {
    seed({ [SERVER_CHECKS_KEY]: { ...failed(PHOTO), ...failed(PHOTO2) } });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true } });
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
  });

  it('client flags without a hand-check request are still ignored (no AI call)', async () => {
    store.objects.set(PHOTO, JPEG);
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true } });
    expect(storedDocs().photo).toMatchObject({ validated: false });
    expect(storedDocs().photo?.needsReview).toBeUndefined();
    expect(validatePhotoMock).not.toHaveBeenCalled();
    expect(storedDocs().server_checks).toBeUndefined();
  });

  it('a hand check with no server record runs the server check on the stored file first, then is honoured', async () => {
    store.objects.set(PHOTO, JPEG);
    validatePhotoMock.mockResolvedValue({ valid: false, errors: ['cut off'], suggestions: [], confidence: 90 });
    const res = await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(res.status).toBe(200);
    expect(validatePhotoMock).toHaveBeenCalledTimes(1);
    expect(validatePhotoMock.mock.calls[0][0]).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
    expect(storedDocs().server_checks?.[PHOTO]).toMatchObject({ kind: 'photo', verdict: 'fail', bound: true });
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
    // The answer carries the stored map (without server_checks) for the form.
    const body = await res.json();
    expect(body.documents.photo).toMatchObject({ validated: true, needsReview: true });
    expect(body.documents.server_checks).toBeUndefined();
  });

  it('a passport hand check with no server record runs the page check once and is honoured', async () => {
    store.objects.set(COVER, JPEG);
    validatePassportPageMock.mockResolvedValue({ page_type: 'INVALID', details: 'blurry' });
    await save({ passportPages: { cover: { path: COVER, filename: 'c.jpg', validated: true, needsReview: true } } });
    expect(validatePassportPageMock).toHaveBeenCalledTimes(1);
    expect(validatePassportPageMock.mock.calls[0][1]).toBe('COVER');
    expect(storedDocs().server_checks?.[COVER]).toMatchObject({ kind: 'passport:COVER', verdict: 'fail' });
    expect(storedDocs().passportPages?.cover).toMatchObject({ validated: true, needsReview: true });
  });

  it('a hand check whose server check cannot run records infra and is honoured', async () => {
    // The stored file cannot be read: no AI call, an infra record, accepted.
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(validatePhotoMock).not.toHaveBeenCalled();
    expect(storedDocs().server_checks?.[PHOTO]).toMatchObject({ kind: 'photo', infra: true });
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
    // The AI service down: infra as well.
    seed();
    store.objects.set(PHOTO, JPEG);
    validatePhotoMock.mockResolvedValue({ valid: false, errors: [], suggestions: [], confidence: 0, infra: true });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(storedDocs().server_checks?.[PHOTO]).toMatchObject({ kind: 'photo', infra: true });
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
  });

  it('a hand check after one recorded check of that kind is honoured without a new AI call', async () => {
    seed({ [SERVER_CHECKS_KEY]: { ...failed(PHOTO2) } });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(validatePhotoMock).not.toHaveBeenCalled();
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
    // A passing record of a replaced file counts too.
    seed({ [SERVER_CHECKS_KEY]: { [PHOTO2]: { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x', at: 't' } } });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
  });

  it('a record of another kind does not count, and a path outside the kind folder is never checked', async () => {
    seed({ [SERVER_CHECKS_KEY]: { ...failed(COVER, 'passport:COVER') } });
    store.objects.set(PHOTO, JPEG);
    validatePhotoMock.mockResolvedValue({ valid: true, errors: [], suggestions: [], confidence: 90 });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(validatePhotoMock).toHaveBeenCalledTimes(1);
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });

    seed();
    const ELSEWHERE = `${ROW_ID}/other/x.jpg`;
    store.objects.set(ELSEWHERE, JPEG);
    validatePhotoMock.mockClear();
    await save({ photo: { path: ELSEWHERE, filename: 'x.jpg', validated: true, needsReview: true } });
    expect(validatePhotoMock).not.toHaveBeenCalled();
    expect(storedDocs().photo).toMatchObject({ validated: false });
    expect(storedDocs().photo?.needsReview).toBeUndefined();
  });

  it('a check the server recorded as not able to run allows the hand check', async () => {
    seed({ [SERVER_CHECKS_KEY]: { [PHOTO]: { kind: 'photo', infra: true, bound: false, sha256: 'x', at: 't' } } });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true, needsReview: true } });
    expect(storedDocs().photo).toMatchObject({ validated: true, needsReview: true });
  });

  it('passport hand check: the new upload is accepted after two failed checks of earlier files', async () => {
    const OLD1 = `${ROW_ID}/passport/cover/old1.jpg`;
    const OLD2 = `${ROW_ID}/passport/cover/old2.jpg`;
    seed({ [SERVER_CHECKS_KEY]: { ...failed(OLD1, 'passport:COVER'), ...failed(OLD2, 'passport:COVER') } });
    await save({ passportPages: { cover: { path: COVER, filename: 'c.jpg', validated: true, needsReview: true } } });
    expect(storedDocs().passportPages?.cover).toMatchObject({ validated: true, needsReview: true });
  });

  it('a save after the form was submitted is refused and changes nothing (410)', async () => {
    seed({ photo: { path: PHOTO, filename: 'p.jpg', validated: false } }, { status: 'complete', current_step: 'complete' });
    const res = await save({ photo: { path: PHOTO2, filename: 'q.jpg' } });
    expect(res.status).toBe(410);
    expect(storedDocs().photo?.path).toBe(PHOTO);
  });

  it('a submit landing between read and write: the save misses the row and answers 410', async () => {
    store.beforeUpdate = () => {
      Object.assign(store.rows[0], { status: 'complete', current_step: 'complete', updated_at: 'submitted' });
    };
    const res = await save({ photo: { path: PHOTO2, filename: 'q.jpg' } });
    expect(res.status).toBe(410);
    expect(storedDocs()).toEqual({});
  });

  it('does not lose a verdict that lands between read and write', async () => {
    store.beforeUpdate = () => {
      const docs = applyCheckRecord(store.rows[0].documents, PHOTO, { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x' }, 'onboarding');
      store.rows[0].documents = docs;
      store.rows[0].updated_at = 'moved';
    };
    const res = await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true } });
    expect(res.status).toBe(200);
    expect(storedDocs().photo).toMatchObject({ validated: true });
    expect(storedDocs().server_checks?.[PHOTO]?.verdict).toBe('pass');
  });
});

describe('documents route: paths must be in the row', () => {
  it('refuses a path in another row', async () => {
    const res = await save({ photo: { path: `${OTHER_ROW}/photo/x.jpg`, filename: 'x.jpg' } });
    expect(res.status).toBe(400);
    expect(storedDocs().photo).toBeUndefined();
  });

  it('refuses a nested or extra-document path outside the row, and path climbing', async () => {
    for (const docs of [
      { passportPages: { cover: { path: `${OTHER_ROW}/passport/cover/x.jpg`, filename: 'x' } } },
      { extra_documents: { visa: { path: 'other/visa/x.pdf', filename: 'x', needsReview: true } } },
      { photo: { path: `${ROW_ID}/../${OTHER_ROW}/photo/x.jpg`, filename: 'x' } },
      { photo: { path: 42, filename: 'x' } },
      // Deeper than the slots, inside arrays, and *_path fields.
      { extra_documents: { visa: { pages: { front: { path: `${OTHER_ROW}/visa/x.pdf` } } } } },
      { extra_documents: { certificates: [{ path: `${ROW_ID}/c/ok.pdf` }, { path: `${OTHER_ROW}/c/x.pdf` }] } },
      { photo: { path: `${ROW_ID}/photo/a.jpg`, thumbnail_path: `${OTHER_ROW}/photo/t.jpg` } },
      { photo: { path: PHOTO, preview_path: 7 } },
    ]) {
      const res = await save(docs);
      expect(res.status).toBe(400);
    }
  });

  it('accepts row paths at any depth and keeps an unchanged legacy path deep in an array', async () => {
    const legacyDeep = { extra_documents: { certificates: [{ path: 'old-token/c/x.pdf', filename: 'x' }] } };
    seed(legacyDeep);
    const res = await save({
      extra_documents: {
        certificates: [{ path: 'old-token/c/x.pdf', filename: 'x' }, { path: `${ROW_ID}/c/new.pdf`, filename: 'n' }],
      },
    });
    expect(res.status).toBe(200);
    // The legacy value must sit at the same place: moved to another index it is refused.
    const moved = await save({ extra_documents: { certificates: [{ path: `${ROW_ID}/c/new.pdf` }, { path: 'old-token/c/x.pdf' }] } });
    expect(moved.status).toBe(400);
  });

  it('keeps an unchanged legacy path from before the rule', async () => {
    const legacy = { path: 'old-token-folder/photo/x.jpg', filename: 'x.jpg', validated: true };
    seed({ photo: legacy });
    const res = await save({ photo: { ...legacy } });
    expect(res.status).toBe(200);
    expect(storedDocs().photo).toMatchObject({ path: legacy.path, validated: true });
  });
});

describe('verdict follows the path', () => {
  it('drops the verdict when the path changes', async () => {
    seed({
      photo: { path: PHOTO, filename: 'p.jpg', validated: true },
      [SERVER_CHECKS_KEY]: { [PHOTO]: { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x', at: 't' } },
    });
    await save({ photo: { path: PHOTO2, filename: 'q.jpg', validated: true } });
    expect(storedDocs().photo).toMatchObject({ path: PHOTO2, validated: false });
    expect(missingRequiredDocuments({ documents: storedDocs() })).toContain(
      'ID photo (must pass validation or be submitted for manual review)'
    );
  });

  it('a verdict for one slot does not count for another', async () => {
    seed({ [SERVER_CHECKS_KEY]: { [PHOTO]: { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x', at: 't' } } });
    await save({ passportPages: { cover: { path: PHOTO, filename: 'p.jpg', validated: true } } });
    expect(storedDocs().passportPages?.cover).toMatchObject({ validated: false });
  });

  it('a pass on a copy not bound to the stored file goes to a human', () => {
    const out = finalizeDocumentsPatch({
      rowId: ROW_ID,
      incoming: { photo: { path: PHOTO, filename: 'p', validated: true } },
      stored: { [SERVER_CHECKS_KEY]: { [PHOTO]: { kind: 'photo', verdict: 'pass', bound: false, sha256: 'x', at: 't' } } },
      onboardingType: 'onboarding',
    });
    expect(out.ok && out.documents.photo).toMatchObject({ validated: true, needsReview: true });
  });

  it('a same-photo comparison stops the pass and is stamped on a hand check', () => {
    const stored = {
      [SERVER_CHECKS_KEY]: { [PHOTO]: { kind: 'photo', verdict: 'pass', bound: true, samePhoto: true, sha256: 'x', at: 't' } },
    };
    const plain = finalizeDocumentsPatch({ rowId: ROW_ID, incoming: { photo: { path: PHOTO, filename: 'p', validated: true } }, stored, onboardingType: 'renewal' });
    expect(plain.ok && plain.documents.photo).toMatchObject({ validated: false, samePhotoSuspected: true });
    // The AI ran on this kind (one record): a hand check is honoured and keeps the label.
    const hand = finalizeDocumentsPatch({ rowId: ROW_ID, incoming: { photo: { path: PHOTO, filename: 'p', needsReview: true } }, stored, onboardingType: 'renewal' });
    expect(hand.ok && hand.documents.photo).toMatchObject({ validated: true, needsReview: true, samePhotoSuspected: true });
  });

  it('a verdict recorded after the path was saved updates the slot', () => {
    const docs = applyCheckRecord(
      { photo: { path: PHOTO, filename: 'p', validated: false } },
      PHOTO,
      { kind: 'photo', verdict: 'pass', bound: true, sha256: 'x' },
      'onboarding'
    );
    expect(docs.photo).toMatchObject({ validated: true });
  });

  it('the comparison never marks a record as bound', () => {
    const docs = applyCheckRecord({}, PHOTO, { kind: 'photo', samePhoto: false, sha256: 'x' }, 'onboarding');
    expect((docs[SERVER_CHECKS_KEY] as Record<string, Row>)[PHOTO]).toMatchObject({ bound: false });
    const after = applyCheckRecord(docs, PHOTO, { kind: 'photo', verdict: 'pass', bound: false, sha256: 'x' }, 'onboarding');
    const again = applyCheckRecord(after, PHOTO, { kind: 'photo', samePhoto: false, sha256: 'x' }, 'onboarding');
    expect((again[SERVER_CHECKS_KEY] as Record<string, Row>)[PHOTO]).toMatchObject({ verdict: 'pass', bound: false });
  });
});

describe('AI photo route checks the STORED file', () => {
  it('reads the stored bytes, records the verdict, and the slot becomes validated', async () => {
    store.objects.set(PHOTO, JPEG);
    validatePhotoMock.mockResolvedValue({ valid: true, errors: [], suggestions: [], confidence: 90 });
    const res = await checkPhoto({ image: 'data:image/jpeg;base64,BROWSERCOPY', path: PHOTO });
    expect(res.status).toBe(200);
    const sent = validatePhotoMock.mock.calls[0][0] as string;
    expect(sent).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
    expect(storedDocs().server_checks?.[PHOTO]).toMatchObject({ kind: 'photo', verdict: 'pass', bound: true });

    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true } });
    expect(storedDocs().photo).toMatchObject({ validated: true });
    expect(missingRequiredDocuments({ documents: storedDocs() })).not.toContain(
      'ID photo (must pass validation or be submitted for manual review)'
    );
  });

  it('a real passport shown to the AI cannot validate a forged stored file', async () => {
    store.objects.set(PHOTO, JPEG); // the forged upload
    validatePhotoMock.mockResolvedValue({ valid: false, errors: ['not a passport photo'], suggestions: [], confidence: 90 });
    await checkPhoto({ image: 'data:image/jpeg;base64,REALPHOTO', path: PHOTO });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true } });
    expect(storedDocs().photo).toMatchObject({ validated: false });
  });

  it('refuses a path outside the row or in another document folder', async () => {
    for (const path of [`${OTHER_ROW}/photo/x.jpg`, `${ROW_ID}/passport/cover/x.jpg`, `${ROW_ID}/photo/../../x`]) {
      const res = await checkPhoto({ image: 'data:image/jpeg;base64,AAAA', path });
      expect(res.status).toBe(400);
    }
    expect(validatePhotoMock).not.toHaveBeenCalled();
  });

  it('records no verdict when the check could not run, only that it could not run', async () => {
    store.objects.set(PHOTO, JPEG);
    validatePhotoMock.mockResolvedValue({ valid: false, errors: [], suggestions: [], confidence: 0, infra: true });
    await checkPhoto({ image: 'data:image/jpeg;base64,AAAA', path: PHOTO });
    const rec = storedDocs().server_checks?.[PHOTO];
    expect(rec).toMatchObject({ kind: 'photo', infra: true });
    expect(rec?.verdict).toBeUndefined();
  });

  it('renewal: compares the stored upload with the photo on file and records a same-photo verdict', async () => {
    const ON_FILE = `${ROW_ID}/existing/photo.jpg`;
    seed({}, { onboarding_type: 'renewal', existing_documents: { photo: { path: ON_FILE } } });
    store.objects.set(PHOTO, JPEG);
    store.objects.set(ON_FILE, JPEG);
    validatePhotoMock.mockResolvedValue({ valid: true, errors: [], suggestions: [], confidence: 90 });
    comparePhotosMock.mockResolvedValue({ samePhoto: true, confidence: 95 });
    const res = await checkPhoto({ image: 'data:image/jpeg;base64,AAAA', path: PHOTO });
    expect(await res.json()).toMatchObject({ valid: true, samePhoto: true });
    expect(comparePhotosMock).toHaveBeenCalledTimes(1);
    expect(storedDocs().server_checks?.[PHOTO]).toMatchObject({ verdict: 'pass', samePhoto: true });
    await save({ photo: { path: PHOTO, filename: 'p.jpg', validated: true } });
    expect(storedDocs().photo).toMatchObject({ validated: false, samePhotoSuspected: true });
  });

  it('cancel copy: no comparison with the photo on file', async () => {
    const ON_FILE = `${ROW_ID}/existing/photo.jpg`;
    seed({}, { onboarding_type: 'cancel_copy', existing_documents: { photo: { path: ON_FILE } } });
    store.objects.set(PHOTO, JPEG);
    store.objects.set(ON_FILE, JPEG);
    validatePhotoMock.mockResolvedValue({ valid: true, errors: [], suggestions: [], confidence: 90 });
    await checkPhoto({ image: 'data:image/jpeg;base64,AAAA', path: PHOTO });
    expect(comparePhotosMock).not.toHaveBeenCalled();
    expect(storedDocs().server_checks?.[PHOTO]).toMatchObject({ verdict: 'pass' });
  });

  it('without a path it checks the browser copy and records nothing', async () => {
    validatePhotoMock.mockResolvedValue({ valid: true, errors: [], suggestions: [], confidence: 90 });
    await checkPhoto({ image: 'data:image/jpeg;base64,AAAA' });
    expect(storedDocs().server_checks).toBeUndefined();
  });
});

describe('submit gates use the server verdict for the current path', () => {
  const passing = (path: string, kind: string) => ({ [path]: { kind, verdict: 'pass' as const, bound: true, sha256: 'x', at: 't' } });

  it('blocks the photo when the server verdict is missing for the current path', () => {
    const docs: StaffDocumentReferences = {
      photo: { path: PHOTO2, filename: 'p', validated: false },
      server_checks: passing(PHOTO, 'photo'),
    };
    expect(missingRequiredDocuments({ documents: docs })).toContain(
      'ID photo (must pass validation or be submitted for manual review)'
    );
    expect(missingDependentRequirements({ documents: docs }, {})).toContain(
      'ID photo (must pass validation or be submitted for manual review)'
    );
  });

  it('blocks a record with validated=true that the server verdict contradicts', () => {
    const docs: StaffDocumentReferences = {
      photo: { path: PHOTO, filename: 'p', validated: true },
      server_checks: { [PHOTO]: { kind: 'photo', verdict: 'fail', bound: true, sha256: 'x', at: 't' } },
    };
    expect(isServerAccepted(docs, docs.photo, 'photo')).toBe(false);
  });

  it('blocks uploaded passport pages without a passing check', () => {
    const docs: StaffDocumentReferences = {
      photo: { path: PHOTO, filename: 'p', validated: true },
      passportPages: {
        cover: { path: COVER, filename: 'c', validated: false },
        insidePages: { path: INSIDE, filename: 'd', validated: true },
      },
      server_checks: { ...passing(PHOTO, 'photo'), ...passing(INSIDE, 'passport:INSIDE_PAGES') },
    };
    const missing = missingRequiredDocuments({ documents: docs });
    expect(missing).toContain('Passport cover page (must pass the check or be submitted for manual review)');
    expect(missing.some((m) => m.startsWith('Passport data page'))).toBe(false);
  });

  it('document request: photo, passport and Emirates ID need the server verdict', () => {
    const eid = `${ROW_ID}/eid_front/e.jpg`;
    const docs: StaffDocumentReferences = {
      photo: { path: PHOTO, filename: 'p', validated: true },
      passportPages: { cover: { path: COVER, filename: 'c', validated: true } },
      eid_front: { path: eid, filename: 'e', validated: true },
      server_checks: {
        ...passing(PHOTO, 'photo'),
        [COVER]: { kind: 'passport:COVER', verdict: 'fail', bound: true, sha256: 'x', at: 't' },
        [eid]: { kind: 'eid:front', verdict: 'fail', bound: true, sha256: 'x', at: 't' },
      },
    };
    expect(
      missingRequestedDocuments({ requested_documents: ['photo', 'passport_cover', 'eid_front'], documents: docs })
    ).toEqual(['passport_cover', 'eid_front']);
  });

  it('a hand check (server-written needsReview) is accepted', () => {
    const docs: StaffDocumentReferences = { photo: { path: PHOTO, filename: 'p', validated: true, needsReview: true } };
    expect(isServerAccepted(docs, docs.photo, 'photo')).toBe(true);
  });

  it('legacy: a validated photo stored before server checks existed still submits', () => {
    // The documents route never stores validated=true without a record or a
    // hand check, so only data from before the change looks like this.
    const docs: StaffDocumentReferences = { photo: { path: PHOTO, filename: 'p', validated: true } };
    expect(isServerAccepted(docs, docs.photo, 'photo')).toBe(true);
  });
});

describe('isPathForKind', () => {
  it('accepts only the row folder of that document', () => {
    expect(isPathForKind(ROW_ID, 'photo', PHOTO)).toBe(true);
    expect(isPathForKind(ROW_ID, 'passport:COVER', COVER)).toBe(true);
    expect(isPathForKind(ROW_ID, 'passport:COVER', INSIDE)).toBe(false);
    expect(isPathForKind(ROW_ID, 'photo', `${OTHER_ROW}/photo/a.jpg`)).toBe(false);
    expect(isPathForKind(ROW_ID, 'photo', `${ROW_ID}/photo//a.jpg`)).toBe(false);
    expect(isPathForKind(ROW_ID, 'photo', 123)).toBe(false);
  });
});
