#!/usr/bin/env node
/**
 * Full-flow onboarding/renewal test script.
 *
 * Exercises the real data path end-to-end for 4 scenarios:
 *   1. happy      — non-DMCC, German, new_hire
 *   2. dmcc       — DMCC, German, new_hire, Job Offer Letter
 *   3. pakistani  — non-DMCC, Pakistani, new_hire, Pakistan ID
 *   4. renewal    — non-DMCC, German, renewal, visa_document
 *
 * Per scenario:
 *   - Seed Supabase row
 *   - Upload fixture files to Supabase Storage (bypasses AI)
 *   - POST /api/submit-employer → status: employer_completed
 *   - POST /api/submit-employee → status: complete, triggers portal sync
 *   - Verify: status, documents JSON, storage URLs, synced_to_tme flag
 *   - Verify portal-side: files landed at public/uploads/staff-documents/…
 *
 * Usage:
 *   node scripts/test-full-onboarding.mjs                    # all 4
 *   node scripts/test-full-onboarding.mjs --scenario=dmcc    # one
 *   node scripts/test-full-onboarding.mjs --keep             # skip cleanup
 *   node scripts/test-full-onboarding.mjs --no-sync          # skip portal checks
 *
 * Prereqs: both dev servers running (tme-staff on :3002, tme-portal on :3000).
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = resolve(ROOT, 'e2e/fixtures/files');
// PORTAL_PUBLIC is defined later, after portalRoot resolves.

// ─── Env loading ─────────────────────────────────────────────────────────────
function loadEnv(envPath) {
  const raw = readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}
const staffEnv = loadEnv(resolve(ROOT, '.env.local'));

function resolvePortalRoot() {
  if (process.env.PORTAL_ROOT) return process.env.PORTAL_ROOT;
  const candidates = [
    resolve(ROOT, '..', 'tme-portal'),
    resolve(ROOT, '..', 'Desktop', 'tme-portal'),
    resolve(process.env.HOME || '', 'Desktop', 'tme-portal'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}
const portalRoot = resolvePortalRoot();
const portalEnvPath = portalRoot ? resolve(portalRoot, '.env') : null;
const portalEnv = portalEnvPath && existsSync(portalEnvPath) ? loadEnv(portalEnvPath) : {};
if (!portalRoot) {
  console.warn('⚠ Could not locate tme-portal directory — set PORTAL_ROOT env var to enable portal-side verification');
}
// tme-portal lives alongside tme-staff by default. Override via PORTAL_PUBLIC_DIR or PORTAL_ROOT env.
const PORTAL_PUBLIC = process.env.PORTAL_PUBLIC_DIR || (portalRoot ? resolve(portalRoot, 'public') : '');

const SUPABASE_URL = staffEnv.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = staffEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const STAFF_URL = 'http://localhost:3002';
const PORTAL_URL = 'http://localhost:3000';
const CRON_SECRET = portalEnv.CRON_SECRET;
const STAFF_API_SECRET = portalEnv.STAFF_PORTAL_API_SECRET || staffEnv.STAFF_PORTAL_API_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('✗ Missing Supabase env vars');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Portal DB (pg). Optional — if DATABASE_URL isn't reachable, script skips
// the portal-side onboarding_request linkage and the sync will treat our
// submissions as orphans (still a valid smoke test of the tme-staff path).
const PORTAL_DB_URL = portalEnv.DATABASE_URL;
let portalPg = null;
async function getPortalDb() {
  if (portalPg) return portalPg;
  if (!PORTAL_DB_URL) return null;
  try {
    const client = new pg.Client({ connectionString: PORTAL_DB_URL });
    await client.connect();
    portalPg = client;
    return client;
  } catch (e) {
    console.warn(`  ⚠ Portal DB unreachable (${e.message}) — portal disk verification will be skipped`);
    return null;
  }
}
async function closePortalDb() {
  if (portalPg) {
    try { await portalPg.end(); } catch {}
    portalPg = null;
  }
}


// ─── Arg parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {};
  for (const t of argv) {
    if (!t.startsWith('--')) continue;
    const b = t.slice(2);
    const eq = b.indexOf('=');
    if (eq >= 0) a[b.slice(0, eq)] = b.slice(eq + 1);
    else a[b] = true;
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const onlyScenario = args.scenario;
const keepData = !!args.keep;
const skipSync = !!args['no-sync'];
const TEST_CLIENT_ID = Number(args['client-id'] || 1); // clients_v2.id=1 ("Alliance") by default

// ─── Fixture files (auto-generated) ──────────────────────────────────────────
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
// Minimal 1-page PDF ("Hello" text). ~400 bytes.
const TINY_PDF_B64 =
  'JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbNCAwIFJdL0NvdW50IDE+PgplbmRvYmoKNCAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDMgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjE8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+Pj4+Pj4vQ29udGVudHMgNSAwIFI+PgplbmRvYmoKNSAwIG9iago8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMjQgVGYgNTAgMTAwIFRkIChIZWxsbykgVGogRVQKZW5kc3RyZWFtCmVuZG9iagoyIDAgb2JqCjw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAzIDAgUj4+CmVuZG9iagoxIDAgb2JqCjw8L1RpdGxlKFRlc3QpPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDMyOSAwMDAwMCBuIAowMDAwMDAwMjg0IDAwMDAwIG4gCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MyAwMDAwMCBuIAowMDAwMDAwMjAwIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA2L1Jvb3QgMiAwIFIvSW5mbyAxIDAgUj4+CnN0YXJ0eHJlZgozNjgKJSVFT0YK';

function ensureFixtures() {
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
  const pngPath = join(FIXTURES_DIR, 'tiny.png');
  const pdfPath = join(FIXTURES_DIR, 'tiny.pdf');
  if (!existsSync(pngPath)) writeFileSync(pngPath, Buffer.from(TINY_PNG_B64, 'base64'));
  if (!existsSync(pdfPath)) writeFileSync(pdfPath, Buffer.from(TINY_PDF_B64, 'base64'));
  return { pngPath, pdfPath };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function preflight() {
  const checks = [
    { name: 'tme-staff', url: `${STAFF_URL}/onboard/preflight-${randomUUID()}` },
    { name: 'tme-portal', url: `${PORTAL_URL}/api/health` },
  ];
  for (const c of checks) {
    try {
      const r = await fetch(c.url);
      if (r.status >= 500) throw new Error(`${c.name} returned ${r.status}`);
    } catch (e) {
      console.error(`✗ Preflight: ${c.name} unreachable at ${c.url} — ${e.message}`);
      console.error('  Start both dev servers before running this script.');
      process.exit(2);
    }
  }
}

async function uploadFile(submissionId, docType, filename, buffer, contentType) {
  const path = `${submissionId}/${docType}/${Date.now()}-${filename}`;
  const { error } = await supabase.storage
    .from('staff-documents')
    .upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Storage upload failed (${docType}): ${error.message}`);
  const { data } = supabase.storage.from('staff-documents').getPublicUrl(path);
  return { path, filename, publicUrl: data.publicUrl };
}

async function headUrl(url) {
  const r = await fetch(url, { method: 'GET' });
  return r.ok;
}

// ─── Data builders ───────────────────────────────────────────────────────────
function buildEmployerData(scenario) {
  const base = {
    job_title_visa: 'Test Engineer',
    job_title_company: 'Test Engineer',
    department: 'IT',
    working_location: 'Dubai',
    sponsor: 'Test Sponsor',
    salary_currency: 'AED',
    salary_total: 15000,
    salary_basic: 10000,
    salary_accommodation: 3000,
    salary_transport: 1000,
    payroll_salary_currency: 'AED',
    payroll_salary_total: 15000,
    payroll_salary_basic: 10000,
    payroll_salary_accommodation: 3000,
    payroll_salary_transport: 1000,
    annual_leave_days: 30,
    annual_leave_type: 'calendar',
    notice_period_value: 1,
    notice_period_unit: 'months',
    probation_period_value: 6,
    probation_period_unit: 'months',
    weekly_off: 'sunday',
    starting_date: new Date().toISOString().slice(0, 10),
  };
  if (scenario === 'dmcc') base.registered_authority = 'DMCC Free Zone Authority';
  if (scenario === 'renewal') {
    base.applicant_in_uae = true;
    base.visa_category = 'employment_visa';
  }
  return base;
}

function buildEmployeeData(scenario, docRefs) {
  const nationalityLabel = scenario === 'pakistani' ? 'Pakistani' : 'German';
  return {
    title: 'Mr',
    first_name: 'Test',
    middle_name: '',
    last_name: scenario === 'pakistani' ? 'Khan' : 'Mueller',
    full_name: scenario === 'pakistani' ? 'Test Khan' : 'Test Mueller',
    nationality: nationalityLabel,
    passport_number: 'X12345678',
    passport_issue_date: '01.01.2020',
    passport_expiry: '01.01.2030',
    date_of_birth: '01.01.1990',
    gender: 'male',
    father_full_name: 'Test Father',
    mother_full_name: 'Test Mother',
    religion: 'Other',
    marital_status: 'single',
    home_street_address: '123 Test St',
    home_city: 'Test City',
    home_country: nationalityLabel,
    uae_presence: 'outside',
    personal_email: `test+${Date.now()}@example.com`,
    company_email: '',
    same_emails: true,
    mobile_uae: '+971501234567',
    mobile_international: '',
    educational_qualification: 'Bachelors',
    languages_spoken: ['English'],
    has_uae_bank: false,
    other_information: '',
  };
}

// ─── Scenario runner ─────────────────────────────────────────────────────────
const FAKE_SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

async function runScenario(name) {
  const scenarioStart = Date.now();
  const log = (step, ok = true, detail = '') => {
    const mark = ok ? '✓' : '✗';
    const d = detail ? ` — ${detail}` : '';
    console.log(`  [${name.padEnd(9)}] ${mark} ${step}${d}`);
  };

  const { pngPath, pdfPath } = ensureFixtures();
  const pngBuf = readFileSync(pngPath);
  const pdfBuf = readFileSync(pdfPath);

  // 1. Seed submission ───────────────────────────────────────────────────────
  const isRenewal = name === 'renewal';
  const isDmcc = name === 'dmcc';
  const isPakistani = name === 'pakistani';
  const nationalityLabel = isPakistani ? 'Pakistani' : 'German';

  const prefillEmployer = {};
  if (isDmcc) prefillEmployer.registered_authority = 'DMCC Free Zone Authority';
  if (isRenewal) {
    prefillEmployer.applicant_in_uae = true;
    prefillEmployer.visa_category = 'employment_visa';
  }

  const { data: seed, error: seedErr } = await supabase
    .from('staff_onboarding_submissions')
    .insert({
      tme_request_id: randomUUID(),
      client_code: 'E2E_FULL',
      is_same_person: false,
      staff_name: `FULL-E2E ${name}`,
      staff_email: `e2e-full+${Date.now()}@example.com`,
      prefill_employer_data: prefillEmployer,
      prefill_employee_data: { nationality: nationalityLabel, first_name: 'Test' },
      onboarding_type: isRenewal ? 'renewal' : 'new_hire',
      status: 'pending',
      current_step: 'employer',
      synced_to_tme: false,
    })
    .select()
    .single();
  if (seedErr) throw new Error(`Seed failed: ${seedErr.message}`);
  log('seed', true, seed.id);

  const submissionId = seed.id;
  const storageUrls = [];

  // 1b. Create onboarding_request in portal DB so sync isn't orphan-dropped.
  let portalRequestId = null;
  const db = await getPortalDb();
  if (db) {
    const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { rows } = await db.query(
      `INSERT INTO staff_onboarding_requests
         (client_id, employer_email, token_expires_at, supabase_id, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [TEST_CLIENT_ID, `e2e-full+${Date.now()}@test.local`, expires, submissionId]
    );
    portalRequestId = rows[0].id;
    log('portal onboarding_request', true, portalRequestId);
  }

  // 2. Upload document fixtures ──────────────────────────────────────────────
  // Track each upload with its source buffer + portal-disk filename pattern
  // so we can byte-verify end-to-end later.
  const docEntries = [];
  const docs = {};

  const pushUpload = async (key, docType, buf, ext, diskPattern, assignTo) => {
    const fname = `tiny.${ext}`;
    const ct = ext === 'pdf' ? 'application/pdf' : 'image/png';
    const ref = await uploadFile(submissionId, docType, fname, buf, ct);
    docEntries.push({ key, buffer: buf, diskPattern, ...ref });
    assignTo(ref);
  };

  await pushUpload('photo', 'photo', pngBuf, 'png', /-photo\./, r => (docs.photo = r));
  docs.passportPages = {};
  await pushUpload('passport_cover', 'passport_cover', pngBuf, 'png', /-passport-cover\./, r => (docs.passportPages.cover = r));
  await pushUpload('passport_inside', 'passport_inside', pngBuf, 'png', /-passport-inside\./, r => (docs.passportPages.insidePages = r));

  if (isDmcc) {
    await pushUpload('job_offer_letter', 'job_offer_letter', pdfBuf, 'pdf', /-job-offer-letter\./, r => (docs.job_offer_letter = r));
  }
  if (isPakistani) {
    await pushUpload('pakistan_id_front', 'pakistan_id_front', pngBuf, 'png', /-pakistan-id-front\./, r => (docs.pakistan_id_front = r));
    await pushUpload('pakistan_id_back', 'pakistan_id_back', pngBuf, 'png', /-pakistan-id-back\./, r => (docs.pakistan_id_back = r));
  }
  if (isRenewal) {
    await pushUpload('visa_document', 'visa_document', pdfBuf, 'pdf', /-visa-document\./, r => (docs.visa_document = r));
  }

  storageUrls.push(...docEntries.map(e => e.publicUrl));
  log('uploads', true, `${docEntries.length} files`);

  // Persist documents JSON (matches updateDocumentReferences flow)
  const { error: docsErr } = await supabase
    .from('staff_onboarding_submissions')
    .update({ documents: docs })
    .eq('id', submissionId);
  if (docsErr) throw new Error(`Docs update failed: ${docsErr.message}`);

  // 3. Submit employer ──────────────────────────────────────────────────────
  const employerResp = await fetch(`${STAFF_URL}/api/submit-employer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: submissionId,
      employerData: buildEmployerData(name),
      signature: FAKE_SIG,
      ip: '127.0.0.1',
    }),
  });
  if (!employerResp.ok) {
    const txt = await employerResp.text();
    throw new Error(`submit-employer failed: ${employerResp.status} ${txt}`);
  }
  log('submit-employer', true);

  // 4. Submit employee ──────────────────────────────────────────────────────
  const employeeResp = await fetch(`${STAFF_URL}/api/submit-employee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: submissionId,
      employeeData: buildEmployeeData(name, docs),
      signature: FAKE_SIG,
      ip: '127.0.0.1',
    }),
  });
  if (!employeeResp.ok) {
    const txt = await employeeResp.text();
    throw new Error(`submit-employee failed: ${employeeResp.status} ${txt}`);
  }
  log('submit-employee', true);

  // 5. Verify Supabase state ────────────────────────────────────────────────
  const { data: final, error: finalErr } = await supabase
    .from('staff_onboarding_submissions')
    .select('*')
    .eq('id', submissionId)
    .single();
  if (finalErr) throw new Error(`Final fetch failed: ${finalErr.message}`);

  const assertions = [
    ['status=complete', final.status === 'complete'],
    ['employer_data present', !!final.employer_data],
    ['employee_data present', !!final.employee_data],
    ['employer_signed_at present', !!final.employer_signed_at],
    ['employee_signed_at present', !!final.employee_signed_at],
    ['documents.photo present', !!final.documents?.photo],
    ['documents.passportPages.cover present', !!final.documents?.passportPages?.cover],
    ['documents.passportPages.insidePages present', !!final.documents?.passportPages?.insidePages],
  ];
  if (isDmcc) assertions.push(['documents.job_offer_letter present', !!final.documents?.job_offer_letter]);
  if (isPakistani) {
    assertions.push(['documents.pakistan_id_front present', !!final.documents?.pakistan_id_front]);
    assertions.push(['documents.pakistan_id_back present', !!final.documents?.pakistan_id_back]);
  }
  if (isRenewal) assertions.push(['documents.visa_document present', !!final.documents?.visa_document]);

  for (const [desc, ok] of assertions) {
    if (!ok) {
      log(desc, false);
      throw new Error(`Assertion failed: ${desc}`);
    }
  }
  log('supabase state', true, `${assertions.length} assertions passed`);

  // 6. Verify Supabase Storage URLs reachable ───────────────────────────────
  for (const url of storageUrls) {
    const ok = await headUrl(url);
    if (!ok) throw new Error(`Storage URL not fetchable: ${url}`);
  }
  log('storage URLs', true, `${storageUrls.length} reachable`);

  // 6b. Byte-for-byte: download each doc from Supabase + compare with fixture.
  // Catches truncation, corruption, or wrong-file uploads.
  for (const e of docEntries) {
    const { data, error } = await supabase.storage.from('staff-documents').download(e.path);
    if (error) throw new Error(`Download failed (${e.key}): ${error.message}`);
    const downloaded = Buffer.from(await data.arrayBuffer());
    if (downloaded.length !== e.buffer.length) {
      throw new Error(`${e.key}: size mismatch (uploaded ${e.buffer.length}B, got ${downloaded.length}B)`);
    }
    if (!downloaded.equals(e.buffer)) {
      throw new Error(`${e.key}: byte content mismatch on Supabase`);
    }
  }
  log('supabase byte-check', true, `${docEntries.length} docs match fixtures`);

  // 7. Portal sync check ────────────────────────────────────────────────────
  if (skipSync) {
    log('portal sync', true, 'skipped');
  } else {
    // Give the webhook + sync service a moment
    await new Promise(r => setTimeout(r, 1500));

    let syncedRow = final;
    if (!syncedRow.synced_to_tme) {
      // Retry: poll for up to 10s
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const { data } = await supabase
          .from('staff_onboarding_submissions')
          .select('synced_to_tme')
          .eq('id', submissionId)
          .single();
        if (data?.synced_to_tme) {
          syncedRow = data;
          break;
        }
      }
    }

    if (!syncedRow.synced_to_tme) {
      log('synced_to_tme=true', false);
      throw new Error('Sync did not complete within 10s');
    }
    log('synced_to_tme=true', true);

    // 8. Verify portal-side files on disk.
    // Sync service writes to <PORTAL>/public/staff-photos/ with filename
    //   <companyCode>-<staffNumber>-<docType>.<ext>
    // We don't know staffNumber up front, so we filter by mtime to find files
    // this scenario just created (runtime is well under 60s per scenario).
    const photosDir = join(PORTAL_PUBLIC, 'staff-photos');
    if (!existsSync(photosDir)) {
      log('portal disk check', false, `${photosDir} missing`);
      throw new Error('Portal staff-photos dir not found — set PORTAL_PUBLIC_DIR env var');
    }
    const { readdirSync } = await import('node:fs');
    const recent = readdirSync(photosDir)
      .map(f => ({ f, mtime: statSync(join(photosDir, f)).mtimeMs }))
      .filter(x => x.mtime > scenarioStart)
      .sort((a, b) => b.mtime - a.mtime);
    if (recent.length < 3) {
      log('portal disk files', false, `only ${recent.length} recent files`);
      throw new Error(`Too few files landed on portal disk (${recent.length}) — sync may have failed silently`);
    }
    // All recent files should share the same <company>-<staffNumber> prefix.
    const prefix = recent[0].f.split('-').slice(0, 2).join('-');
    log('portal disk files', true, `${recent.length} files (prefix: ${prefix})`);

    // 8b. Byte-for-byte: open each portal file matching our doc patterns +
    // compare with the original fixture buffer. Proves the sync service
    // downloaded + wrote the exact bytes we uploaded — no corruption in the
    // Supabase-storage → portal-disk pipeline.
    for (const e of docEntries) {
      const match = recent.find(r => e.diskPattern.test(r.f));
      if (!match) {
        throw new Error(`${e.key}: no portal file matches pattern ${e.diskPattern} (scanned ${recent.length} recent)`);
      }
      const bytes = readFileSync(join(photosDir, match.f));
      if (bytes.length !== e.buffer.length) {
        throw new Error(`${e.key}: portal disk size mismatch (expected ${e.buffer.length}B, got ${bytes.length}B)`);
      }
      if (!bytes.equals(e.buffer)) {
        throw new Error(`${e.key}: portal disk byte mismatch (${match.f})`);
      }
    }
    log('portal byte-check', true, `${docEntries.length} disk files match fixtures`);
  }

  // 9. Cleanup ──────────────────────────────────────────────────────────────
  if (!keepData) {
    await supabase.from('staff_onboarding_submissions').delete().eq('id', submissionId);
    // Remove storage files
    const pathList = [];
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.path && typeof obj.path === 'string') pathList.push(obj.path);
      for (const v of Object.values(obj)) walk(v);
    };
    walk(docs);
    if (pathList.length > 0) {
      await supabase.storage.from('staff-documents').remove(pathList);
    }
    // Clean portal-side rows (if we created them)
    let portalCleaned = '';
    if (db && portalRequestId) {
      // The sync creates a client_staff row linked to this onboarding_request.
      // Delete both request and staff. Staff row also cascades its doc rows.
      await db.query(
        `DELETE FROM client_staff WHERE id IN (
           SELECT staff_id FROM staff_onboarding_requests WHERE id = $1 AND staff_id IS NOT NULL
         )`,
        [portalRequestId]
      );
      await db.query('DELETE FROM staff_onboarding_requests WHERE id = $1', [portalRequestId]);
      portalCleaned = ' + portal row + staff row';
    }
    log('cleanup', true, `row + ${pathList.length} storage files${portalCleaned}`);
  } else {
    log('cleanup', true, `skipped (--keep) — id=${submissionId}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
const SCENARIOS = ['happy', 'dmcc', 'pakistani', 'renewal'];
const toRun = onlyScenario ? [onlyScenario] : SCENARIOS;

console.log('');
console.log('Preflight…');
await preflight();
console.log('✓ Both servers reachable');
console.log('');
console.log(`Running ${toRun.length} scenario${toRun.length > 1 ? 's' : ''}: ${toRun.join(', ')}`);
console.log('');

const start = Date.now();
const failures = [];
for (const name of toRun) {
  try {
    await runScenario(name);
    console.log(`  [${name.padEnd(9)}] ✓ PASSED\n`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`  [${name.padEnd(9)}] ✗ FAILED — ${e.message}\n`);
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s`);
await closePortalDb();
if (failures.length > 0) {
  console.log(`✗ ${failures.length} scenario${failures.length > 1 ? 's' : ''} failed`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
console.log(`✓ All ${toRun.length} scenario${toRun.length > 1 ? 's' : ''} passed`);
