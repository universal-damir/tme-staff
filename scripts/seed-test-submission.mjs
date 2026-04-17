#!/usr/bin/env node
/**
 * Seed a test staff_onboarding_submissions row in Supabase so you can jump
 * straight to any step of the onboarding flow without filling steps 1..N-1
 * every time.
 *
 * Usage:
 *   node scripts/seed-test-submission.mjs [--flag=value ...]
 *
 * Flags:
 *   --step=employer|employee|complete   Which step the flow should start at.
 *                                        Default: employer
 *   --nationality=pakistani|indian|other Nationality (drives Pakistan ID / Indian
 *                                        additional-page branches). Default: other
 *   --dmcc                               Set registered_authority to "DMCC" so the
 *                                        employer form shows the Job Offer Letter slot.
 *   --renewal                            onboarding_type = 'renewal' (default new_hire).
 *   --same-person                        is_same_person = true.
 *   --visa-category=VALUE                Pre-select visa_category for renewals.
 *                                        tourist_visa | visa_on_arrival | employment_visa
 *                                        | immigration_cancellation | other_na
 *   --applicant-in-uae                   applicant_in_uae = true.
 *   --label=STRING                       Staff name label ("Test Pakistani Renewal").
 *   --host=URL                           Override BASE_URL (default http://localhost:3002).
 *
 * Prints the URL to open in the browser.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Load .env.local manually (this script runs outside Next.js) ---
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  const raw = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

// --- Parse CLI args ---
function parseArgs(argv) {
  const args = { _: [] };
  for (const token of argv) {
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) args[body.slice(0, eq)] = body.slice(eq + 1);
    else args[body] = true;
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));

// --- Cleanup path ---
if (args.delete || args['delete-all-tests']) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  if (args.delete) {
    const { error } = await supabase
      .from('staff_onboarding_submissions')
      .delete()
      .eq('id', args.delete);
    if (error) {
      console.error('Delete failed:', error.message);
      process.exit(1);
    }
    console.log('✓ Deleted submission', args.delete);
    process.exit(0);
  }
  const { data, error } = await supabase
    .from('staff_onboarding_submissions')
    .delete()
    .eq('client_code', 'TEST001')
    .select('id');
  if (error) {
    console.error('Delete failed:', error.message);
    process.exit(1);
  }
  console.log(`✓ Deleted ${data?.length || 0} test submissions`);
  process.exit(0);
}

const step = args.step || 'employer';
const nationality = args.nationality || 'other';
const isDmcc = !!args.dmcc;
const isRenewal = !!args.renewal;
const isSamePerson = !!args['same-person'];
const visaCategory = args['visa-category'];
const applicantInUae = !!args['applicant-in-uae'];
const label = args.label || `TEST ${isRenewal ? 'RENEWAL' : 'ONBOARDING'} — ${nationality}${isDmcc ? ' + DMCC' : ''}`;
const baseUrl = args.host || 'http://localhost:3002';

if (!['employer', 'employee', 'complete'].includes(step)) {
  console.error(`Invalid --step: ${step}. Must be employer | employee | complete.`);
  process.exit(1);
}

// --- Build prefill payload ---
const nationalityLabel = {
  pakistani: 'Pakistani',
  indian: 'Indian',
  other: 'German',
}[nationality];

const prefillEmployerData = {
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
  annual_leave_days: 30,
  annual_leave_type: 'calendar',
  notice_period_value: 1,
  notice_period_unit: 'months',
  probation_period_value: 6,
  probation_period_unit: 'months',
  weekly_off: 'sunday',
  starting_date: new Date().toISOString().slice(0, 10),
  ...(isDmcc && { registered_authority: 'DMCC Free Zone Authority' }),
  ...(visaCategory && { visa_category: visaCategory }),
  ...(applicantInUae && { applicant_in_uae: true }),
};

const prefillEmployeeData = {
  nationality: nationalityLabel,
  first_name: 'Test',
  last_name: nationality === 'pakistani' ? 'Khan' : nationality === 'indian' ? 'Kumar' : 'Mueller',
};

// Fake employer_data for step=employee|complete so the form shows employer-side as done
const fakeEmployerData = {
  ...prefillEmployerData,
  payroll_salary_total: 15000,
  payroll_salary_basic: 10000,
  payroll_salary_accommodation: 3000,
  payroll_salary_transport: 1000,
  payroll_salary_currency: 'AED',
};

// Minimal employee_data for step=complete
const fakeEmployeeData = {
  title: 'Mr',
  first_name: 'Test',
  last_name: prefillEmployeeData.last_name,
  full_name: `Test ${prefillEmployeeData.last_name}`,
  nationality: nationalityLabel,
  father_full_name: 'Test Father',
  mother_full_name: 'Test Mother',
  religion: 'Other',
  marital_status: 'Single',
  home_street_address: '123 Test St',
  home_city: 'Test City',
  home_country: nationalityLabel,
  uae_presence: applicantInUae ? 'inside' : 'outside',
  personal_email: `test+${Date.now()}@example.com`,
  same_emails: true,
  mobile_uae: '+971501234567',
  educational_qualification: 'Bachelors',
  languages_spoken: ['English'],
  has_uae_bank: false,
};

// Status / current_step mapping
const statusFor = {
  employer: { status: 'pending', current_step: 'employer' },
  employee: { status: 'employer_completed', current_step: 'employee' },
  complete: { status: 'complete', current_step: 'complete' },
}[step];

const row = {
  tme_request_id: randomUUID(),
  client_code: 'TEST001',
  is_same_person: isSamePerson,
  staff_name: label,
  staff_email: `test+${Date.now()}@example.com`,
  prefill_employer_data: prefillEmployerData,
  prefill_employee_data: prefillEmployeeData,
  onboarding_type: isRenewal ? 'renewal' : 'new_hire',
  employer_data: step === 'employer' ? null : fakeEmployerData,
  employer_signature_data: step === 'employer' ? null : 'data:image/png;base64,iVBORw0KGgo=',
  employer_signed_at: step === 'employer' ? null : new Date().toISOString(),
  employee_data: step === 'complete' ? fakeEmployeeData : null,
  employee_signature_data: step === 'complete' ? 'data:image/png;base64,iVBORw0KGgo=' : null,
  employee_signed_at: step === 'complete' ? new Date().toISOString() : null,
  documents: null,
  existing_documents: null,
  synced_to_tme: false,
  ...statusFor,
};

// --- Insert ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const { data, error } = await supabase
  .from('staff_onboarding_submissions')
  .insert(row)
  .select()
  .single();

if (error) {
  console.error('Insert failed:', error.message);
  console.error(error);
  process.exit(1);
}

const url = `${baseUrl}/onboard/${data.id}${data.employee_access_token ? `?token=${data.employee_access_token}` : ''}`;

console.log('');
console.log('✓ Seeded submission');
console.log('  id:             ', data.id);
console.log('  status:         ', data.status);
console.log('  current_step:   ', data.current_step);
console.log('  onboarding_type:', data.onboarding_type);
console.log('  nationality:    ', nationalityLabel);
console.log('  DMCC:           ', isDmcc);
console.log('  visa_category:  ', visaCategory || '(none)');
console.log('');
console.log('Open in browser:');
console.log('  ' + url);
console.log('');
console.log('Cleanup:');
console.log(`  node scripts/seed-test-submission.mjs --delete=${data.id}`);
