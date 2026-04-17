/**
 * Programmatic seeding for E2E tests.
 * Directly inserts into Supabase (same code path as scripts/seed-test-submission.mjs)
 * so tests are fast and don't depend on a pre-running background seeder.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;

  // Load .env.local — Next.js isn't running this, Playwright is
  const envPath = resolve(process.cwd(), '.env.local');
  const raw = readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
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

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars in .env.local');
  cachedClient = createClient(url, key);
  return cachedClient;
}

export type SeedOptions = {
  step?: 'employer' | 'employee' | 'complete';
  nationality?: 'pakistani' | 'indian' | 'other';
  dmcc?: boolean;
  renewal?: boolean;
  samePerson?: boolean;
  visaCategory?:
    | 'tourist_visa'
    | 'visa_on_arrival'
    | 'employment_visa'
    | 'immigration_cancellation'
    | 'other_na';
  applicantInUae?: boolean;
  label?: string;
};

export type SeededSubmission = {
  id: string;
  url: string;
  cleanup: () => Promise<void>;
};

export async function seedSubmission(opts: SeedOptions = {}): Promise<SeededSubmission> {
  const step = opts.step ?? 'employer';
  const nationality = opts.nationality ?? 'other';
  const nationalityLabel = {
    pakistani: 'Pakistani',
    indian: 'Indian',
    other: 'German',
  }[nationality];

  const prefillEmployerData: Record<string, unknown> = {
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
  };
  if (opts.dmcc) prefillEmployerData.registered_authority = 'DMCC Free Zone Authority';
  if (opts.visaCategory) prefillEmployerData.visa_category = opts.visaCategory;
  if (opts.applicantInUae) prefillEmployerData.applicant_in_uae = true;

  const fakeEmployerData = { ...prefillEmployerData };

  const fakeEmployeeData: Record<string, unknown> = {
    title: 'Mr',
    first_name: 'Test',
    last_name: 'User',
    full_name: 'Test User',
    nationality: nationalityLabel,
    father_full_name: 'Test Father',
    mother_full_name: 'Test Mother',
    religion: 'Other',
    marital_status: 'Single',
    home_street_address: '123 Test St',
    home_city: 'Test City',
    home_country: nationalityLabel,
    uae_presence: opts.applicantInUae ? 'inside' : 'outside',
    personal_email: `test+${Date.now()}@example.com`,
    same_emails: true,
    mobile_uae: '+971501234567',
    educational_qualification: 'Bachelors',
    languages_spoken: ['English'],
    has_uae_bank: false,
  };

  const statusFor = {
    employer: { status: 'pending', current_step: 'employer' },
    employee: { status: 'employer_completed', current_step: 'employee' },
    complete: { status: 'complete', current_step: 'complete' },
  }[step];

  const row = {
    tme_request_id: randomUUID(),
    client_code: 'E2E_TEST',
    is_same_person: !!opts.samePerson,
    staff_name: opts.label ?? `E2E ${step} ${nationality}`,
    staff_email: `e2e+${Date.now()}@example.com`,
    prefill_employer_data: prefillEmployerData,
    prefill_employee_data: { nationality: nationalityLabel, first_name: 'Test', last_name: 'User' },
    onboarding_type: opts.renewal ? 'renewal' : 'new_hire',
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

  const client = getSupabase();
  const { data, error } = await client
    .from('staff_onboarding_submissions')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(`Seed failed: ${error.message}`);

  const url = `/onboard/${data.id}${data.employee_access_token ? `?token=${data.employee_access_token}` : ''}`;

  return {
    id: data.id,
    url,
    cleanup: async () => {
      await client.from('staff_onboarding_submissions').delete().eq('id', data.id);
    },
  };
}

/** Delete all E2E-seeded test submissions — call in global teardown if needed. */
export async function cleanupAllE2ESubmissions(): Promise<number> {
  const client = getSupabase();
  const { data, error } = await client
    .from('staff_onboarding_submissions')
    .delete()
    .eq('client_code', 'E2E_TEST')
    .select('id');
  if (error) throw new Error(`Cleanup failed: ${error.message}`);
  return data?.length ?? 0;
}
