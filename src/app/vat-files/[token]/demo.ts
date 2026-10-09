// Demo links for local development (no Supabase row needed):
//   /vat-files/demo-customs   accounting client, customs request
//   /vat-files/demo-files     non-accounting client, files request
//   /vat-files/demo-files-customs  files request with point 8 (customs) + the FTA list
//   /vat-files/demo-closed    a closed request
// Uploads and Send stay in the browser: no API call, nothing is saved.
// Only in `next dev`; a production build treats these like any unknown link.

import type { VatFilesPagePayload } from '@/types/vat-files';

// The REAL points, as the portal writes them to requested_items (page
// wording: portal src/lib/vat-filing/email-templates.ts customsRequestItems('page')
// / filesRequestItems(..., 'page')). Copy again when the portal wording changes.
const CUSTOMS_POINTS = [
  'Bill of Entry (BOE) of each shipment.',
  'Supplier invoices for each shipment, as per the FTA import list below.',
  'Please fill in the yellow-highlighted columns in the Excel sheet (the FTA import list you can download on this page) and send the completed file back to us, or state the purpose of each shipment as per the list of imports.',
  'Please confirm whether all these import invoices are paid or will be paid, or whether any are free of charge (FOC) imports.',
];

const FILES_POINTS = [
  'Sales and output VAT details for VAT 5%, if any.',
  'Expenses and input VAT details for VAT 5%, with a clear description of the nature of each expense.',
  'Sales details for VAT 0%, if any.',
  'Import of services for the period, if any.',
  'Trial Balance for the period 2607-2609.',
  'Profit & Loss account for the period 2607-2609.',
  'VAT clearance account.',
];

/** Point 8, only when the files request asks for customs too. */
const FILES_CUSTOMS_POINT =
  'The FTA import list below shows the shipments that passed through the customs code linked to the TRN of the company during the period 2607-2609. In this regard: A. Please share with us the BOE and the respective invoices for these imports. B. Please state the purpose of these imports. C. Please confirm whether all supplier invoices are being paid, or whether there are any free of charge (FOC) imports.';

const DEMOS: Record<string, VatFilesPagePayload> = {
  'demo-customs': {
    kind: 'customs',
    status: 'open',
    companyCode: '99999',
    companyName: 'Sample Trading FZCO',
    periodKey: '2606-2608',
    periodLabel: 'Jun - Aug 2026 (2606-2608)',
    deadline: '2026-10-20',
    requestedItems: CUSTOMS_POINTS,
    hasCustomsList: true,
    customsListName: 'FTA import list 99999 2606-2608.xlsx',
    expired: false,
    files: [],
    clientComment: null,
  },
  'demo-files': {
    kind: 'files',
    status: 'open',
    companyCode: '99998',
    companyName: 'Example Consulting LLC',
    periodKey: '2607-2609',
    periodLabel: 'Jul - Sep 2026 (2607-2609)',
    deadline: '2026-10-15',
    requestedItems: FILES_POINTS,
    hasCustomsList: false,
    customsListName: null,
    expired: false,
    files: [
      { name: 'Sales July 2026.xlsx', size: 48_211, uploadedAt: '2026-10-05T09:12:00.000Z' },
    ],
    clientComment: null,
  },
  'demo-files-customs': {
    kind: 'files',
    status: 'open',
    companyCode: '99998',
    companyName: 'Example Consulting LLC',
    periodKey: '2607-2609',
    periodLabel: 'Jul - Sep 2026 (2607-2609)',
    deadline: '2026-10-15',
    requestedItems: [...FILES_POINTS, FILES_CUSTOMS_POINT],
    hasCustomsList: true,
    customsListName: 'FTA import list 99998 2607-2609.xlsx',
    expired: false,
    files: [],
    clientComment: null,
  },
  'demo-closed': {
    kind: 'files',
    status: 'closed',
    companyCode: '99998',
    companyName: 'Example Consulting LLC',
    periodKey: '2604-2606',
    periodLabel: 'Apr - Jun 2026 (2604-2606)',
    deadline: '2026-07-15',
    requestedItems: [],
    hasCustomsList: false,
    customsListName: null,
    expired: false,
    files: [],
    clientComment: null,
  },
};

export function isDemoToken(token: string): boolean {
  return process.env.NODE_ENV !== 'production' && token in DEMOS;
}

export function demoPayload(token: string): VatFilesPagePayload {
  return structuredClone(DEMOS[token]);
}
