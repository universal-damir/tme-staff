// TEMPORARY demo link for the team (30.09.2026). Delete this file and the two
// `isDemoToken` guards in page.tsx when the team has seen the form.
// Opening /supplier-checks/<DEMO_TOKEN> shows made-up sample data; Submit only
// shows the thank-you screen. No API call, no Supabase row, nothing is saved.

import type { SvpPrefill } from '@/types/supplier-policy';

const DEMO_TOKEN = 'demo-ef1fb13773bd7bd600fd71bb';

export function isDemoToken(token: string): boolean {
  return token === DEMO_TOKEN;
}

const manager = { name: 'John Sample', position: 'Manager', email: 'john.sample@example.com' };

const prefill: SvpPrefill = {
  companyName: 'Sample Trading FZCO',
  companyCode: '99999',
  trn: '100000000000003',
  registeredAddress: 'Office 101, Building A, Dubai Silicon Oasis, Dubai, UAE',
  vatPeriodsText: 'January to March, April to June, July to September and October to December',
  priceAed: 950,
  suggested: { implementer: { ...manager }, reviewer: { ...manager }, supervisor: { ...manager } },
  officers: [
    manager,
    { name: 'Anna Example', position: 'Director', email: 'anna.example@example.com' },
  ],
};

export const DEMO_INTAKE = {
  status: 'invited',
  companyName: prefill.companyName,
  priceAed: prefill.priceAed,
  prefill,
  submitted: null,
  expiresAt: null,
};
