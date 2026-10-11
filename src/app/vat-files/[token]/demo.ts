// Demo links for local development (no Supabase row needed):
//   /vat-files/demo-customs   accounting client, customs request
//   /vat-files/demo-files     non-accounting client, files request
//   /vat-files/demo-files-customs  files request with point 8 (customs) + the FTA list
//   /vat-files/demo-closed    a closed request, read-only: the customs table with
//                             the answers, a split import, a TME question with
//                             its reply, the files sent and the comment
//   /vat-files/demo-closed-files  a closed files request (no table), read-only
//   /vat-files/demo-customs-table       round 3: the customs table (7 imports,
//                                       real FTA CSV values of a Pennypress-like
//                                       client; one answered by TME, one with
//                                       two TME questions, "Same as last quarter")
//   /vat-files/demo-customs-table-sent  the table after a Send (4 SPG-like imports)
//   /vat-files/demo-customs-table-long  150 imports, to check the page stays fast
//   /vat-files/demo-code       round 4 B: "Who are you?" + email code first (code 123456),
//                              then the customs table page ("Not you?" goes back)
// Round 4 C: the questions name who asked (one old question without a name),
// the replies say who sent them and when (one changed later), line 1 says
// which TME colleague filled it in.
// Uploads, autosave and Send stay in the browser: no API call, nothing is saved.
// Only in `next dev`; a production build treats these like any unknown link.

import type { VatCustomsPageLine, VatFilesCodeAddress, VatFilesPagePayload } from '@/types/vat-files';

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

/** Round 3 points with the customs table (portal customsRequestItems('page', { table: true })). */
const CUSTOMS_TABLE_POINTS = [
  'Bill of Entry (BOE) of each shipment.',
  'Supplier invoices for each shipment. You can upload them next to each import in the table below.',
  'Please answer four short questions for each import in the table below: purpose, paid or free of charge, Incoterms and delivery point. You can also download the list as Excel.',
];

/** No customs columns: the round 2 pages. */
const NO_TABLE = {
  customsLines: [],
  customsAnswers: {},
  customsDefaults: null,
  customsAnswersSentAt: null,
  lineFiles: [],
} satisfies Partial<VatFilesPagePayload>;

type CsvLine = [date: string, declarationNo: string, transactionRef: string, value: number, vat: number];

function demoLines(firstId: number, rows: CsvLine[]): VatCustomsPageLine[] {
  return rows.map(([date, declarationNo, ref, value, vat], i) => ({
    id: firstId + i,
    lineNo: i + 1,
    declarationDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    declarationNo,
    transactionRefNo: ref,
    totalValue: value,
    totalVat: vat,
    hasBoe: false,
    hasInvoice: false,
    answer: null,
    questions: [],
  }));
}

// FTA CSV "260901 Pennypress customs details from FTA-CSV.csv" (2606-2608).
const PENNYPRESS_LINES = demoLines(5101, [
  ['20260602', '1020035196026', '6495973488', 17577.0, 878.85],
  ['20260620', '1010107019826', '6498757330', 5880.59, 294.03],
  ['20260626', '1010111084626', '6499634073', 3027.06, 151.35],
  ['20260706', '1010117406226', '6501352058', 1908.8, 95.44],
  ['20260728', '1020050830526', '6504352368', 52731.0, 2636.55],
  ['20260804', '1010136320226', '6505473181', 3856.12, 192.81],
  ['20260817', '1010144550726', '6507195392', 1214.68, 60.73],
]);
// Line 1: TME already holds the answer (staff typed it), BOE + invoice in the portal.
PENNYPRESS_LINES[0].hasBoe = true;
PENNYPRESS_LINES[0].hasInvoice = true;
PENNYPRESS_LINES[0].answer = {
  parts: [{ purpose: 'sale_stock', payment: 'paid', incoterm: 'CIF', delivery: 'uae_port' }],
  updatedAt: '2026-10-08T07:30:00.000Z',
  filledBy: { name: 'Anshad Muhammed' },
};
// Line 5: two open TME questions (each with its own reply box).
PENNYPRESS_LINES[4].hasBoe = true;
PENNYPRESS_LINES[4].questions = [
  {
    id: 901,
    text: 'The invoice shows two suppliers. Is this one shipment, or should we split it by invoice?',
    askedAt: '2026-10-10T08:15:00.000Z',
    askedBy: 'Anshad Muhammed',
  },
  {
    // Asked before round 4 C: no name, the page says "TME Services".
    id: 902,
    text: 'The invoice says "FCA Loughborough". Please check the delivery place.',
    askedAt: '2026-10-10T08:16:00.000Z',
  },
];

// FTA CSV "261009 SPG customs details from FTA 2607-2609 - CSV.csv".
const SPG_LINES = demoLines(6201, [
  ['20260803', '1010135960026', '6505210394', 252203.24, 12610.16],
  ['20260819', '1010146613726', '6507604297', 6472.57, 323.63],
  ['20260923', '1010169929426', '6511897684', 265416.02, 13270.8],
  ['20260924', '1010170952926', '6511904860', 228916.43, 11445.82],
]);
SPG_LINES[0].hasBoe = true;
SPG_LINES[0].hasInvoice = true;

const SPG_SENT_AT = '2026-10-10T11:42:00.000Z';

// demo-closed: the same SPG-like imports, all answered and sent, then closed by TME.
const CLOSED_LINES = demoLines(6301, [
  ['20260803', '1010135960026', '6505210394', 252203.24, 12610.16],
  ['20260819', '1010146613726', '6507604297', 6472.57, 323.63],
  ['20260923', '1010169929426', '6511897684', 265416.02, 13270.8],
  ['20260924', '1010170952926', '6511904860', 228916.43, 11445.82],
]);
CLOSED_LINES[0].hasBoe = true;
CLOSED_LINES[0].hasInvoice = true;
CLOSED_LINES[2].questions = [
  {
    id: 911,
    text: 'The invoice shows EXW Milan. Who paid the freight to Dubai?',
    askedAt: '2026-10-10T12:30:00.000Z',
    askedBy: 'Anshad Muhammed',
  },
];
const CLOSED_SENT_AT = '2026-10-10T11:42:00.000Z';
const CLOSED_REPLY_AT = '2026-10-10T14:05:00.000Z';

function longLines(): VatCustomsPageLine[] {
  const rows: CsvLine[] = [];
  for (let i = 0; i < 150; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    const month = String(7 + Math.floor(i / 50)).padStart(2, '0');
    const value = Math.round((1000 + ((i * 7919) % 90000)) * 100) / 100;
    rows.push([`2026${month}${day}`, `10101${String(40000000 + i * 137).padStart(8, '0')}`, `65${String(10000000 + i * 911)}`, value, Math.round(value * 5) / 100]);
  }
  return demoLines(7001, rows);
}

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
    ...NO_TABLE,
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
    ...NO_TABLE,
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
    ...NO_TABLE,
  },
  'demo-closed': {
    kind: 'customs',
    status: 'closed',
    companyCode: '99996',
    companyName: 'Sample Projects General Trading LLC',
    periodKey: '2607-2609',
    periodLabel: 'Jul - Sep 2026 (2607-2609)',
    deadline: '2026-10-20',
    requestedItems: CUSTOMS_TABLE_POINTS,
    hasCustomsList: true,
    customsListName: 'FTA import list 99996 2607-2609.xlsx',
    expired: false,
    files: [
      { name: 'BOE 1010146613726.pdf', size: 182_300, uploadedAt: CLOSED_SENT_AT },
      { name: 'Invoice INV-2207.pdf', size: 96_120, uploadedAt: CLOSED_SENT_AT },
      { name: 'Invoice INV-2208.pdf', size: 88_410, uploadedAt: CLOSED_SENT_AT },
      { name: 'BOE 1010169929426.pdf', size: 201_877, uploadedAt: CLOSED_REPLY_AT },
      { name: 'Freight invoice DHL 55120.pdf', size: 64_310, uploadedAt: CLOSED_REPLY_AT },
    ],
    clientComment: 'The September imports are machines for our own workshop. The freight for import 3 was paid by us to DHL, invoice attached.',
    customsLines: CLOSED_LINES,
    customsAnswers: {
      '6301': { parts: [{ purpose: 'sale_stock', payment: 'paid', incoterm: 'FOB', delivery: 'outside_uae', deliveryPlace: 'Shanghai, China' }], updatedAt: CLOSED_SENT_AT },
      '6302': {
        parts: [
          { invoiceRef: 'INV-2207', purpose: 'sale_stock', payment: 'paid', incoterm: 'DAP', delivery: 'uae_premises' },
          { invoiceRef: 'INV-2208', purpose: 'samples', payment: 'foc', incoterm: 'DAP', delivery: 'uae_premises' },
        ],
        updatedAt: CLOSED_SENT_AT,
      },
      '6303': {
        parts: [{ purpose: 'fixed_asset', payment: 'will_be_paid', incoterm: 'EXW', delivery: 'outside_uae', deliveryPlace: 'Milan, Italy' }],
        replies: { '911': 'We paid DHL directly. The DHL invoice is in the files.' },
        // Changed once: first sent 10.10 13:20, changed 10.10 18:05 (Dubai).
        replyMeta: {
          '911': {
            sentAt: '2026-10-10T09:20:00.000Z',
            sentBy: 'b.klingler@star-demo.com',
            changedAt: CLOSED_REPLY_AT,
            changedBy: 'b.klingler@star-demo.com',
            savedAt: CLOSED_REPLY_AT,
          },
        },
        updatedAt: CLOSED_REPLY_AT,
      },
      '6304': {
        parts: [{ purpose: 'other', purposeOther: 'Spare parts for a client project', payment: 'other', paymentOther: 'Paid 50% now, 50% on delivery', incoterm: 'not_stated' }],
        updatedAt: CLOSED_REPLY_AT,
      },
    },
    customsDefaults: null,
    customsAnswersSentAt: CLOSED_REPLY_AT,
    lineFiles: [
      { lineId: 6302, docKind: 'boe', name: 'BOE 1010146613726.pdf', uploadedAt: CLOSED_SENT_AT },
      { lineId: 6302, docKind: 'invoice', name: 'Invoice INV-2207.pdf', uploadedAt: CLOSED_SENT_AT },
      { lineId: 6302, docKind: 'invoice', name: 'Invoice INV-2208.pdf', uploadedAt: CLOSED_SENT_AT },
      { lineId: 6303, docKind: 'boe', name: 'BOE 1010169929426.pdf', uploadedAt: CLOSED_REPLY_AT },
      { lineId: 6303, docKind: 'other', name: 'Freight invoice DHL 55120.pdf', uploadedAt: CLOSED_REPLY_AT },
    ],
  },
  'demo-closed-files': {
    kind: 'files',
    status: 'closed',
    companyCode: '99998',
    companyName: 'Example Consulting LLC',
    periodKey: '2604-2606',
    periodLabel: 'Apr - Jun 2026 (2604-2606)',
    deadline: '2026-07-15',
    requestedItems: FILES_POINTS,
    hasCustomsList: false,
    customsListName: null,
    expired: false,
    files: [
      { name: 'Sales April - June 2026.xlsx', size: 48_211, uploadedAt: '2026-07-08T09:12:00.000Z' },
      { name: 'Expenses Q2 2026.pdf', size: 1_204_880, uploadedAt: '2026-07-08T09:13:00.000Z' },
      { name: 'Trial Balance 2604-2606.xlsx', size: 61_004, uploadedAt: '2026-07-10T06:40:00.000Z' },
    ],
    clientComment: 'No sales at 0% this quarter.',
    ...NO_TABLE,
  },
  'demo-customs-table': {
    kind: 'customs',
    status: 'open',
    companyCode: '99997',
    companyName: 'Sample Press Trading LLC',
    periodKey: '2606-2608',
    periodLabel: 'Jun - Aug 2026 (2606-2608)',
    deadline: '2026-10-20',
    requestedItems: CUSTOMS_TABLE_POINTS,
    hasCustomsList: true,
    customsListName: 'FTA import list 99997 2606-2608.xlsx',
    expired: false,
    files: [],
    clientComment: null,
    customsLines: PENNYPRESS_LINES,
    customsAnswers: {
      // Line 2: the client started (saved, not sent yet).
      '5102': { parts: [{ purpose: 'office_use', payment: 'paid' }], updatedAt: '2026-10-10T09:00:00.000Z' },
      // Line 3: a customer return, original BOE given.
      '5103': {
        parts: [{ purpose: 'customer_return', purposeOther: '302-06945947-21', payment: 'foc', incoterm: 'not_stated' }],
        updatedAt: '2026-10-10T09:05:00.000Z',
      },
      // Line 5: one of the two questions already has a reply.
      '5105': {
        parts: [],
        replies: { '901': 'One shipment, two invoices.' },
        replyMeta: { '901': { sentAt: '2026-10-10T09:09:00.000Z', sentBy: 'anna.k@pennypress-demo.com', savedAt: '2026-10-10T09:10:00.000Z' } },
        updatedAt: '2026-10-10T09:10:00.000Z',
      },
    },
    customsDefaults: { purpose: 'sale_stock', payment: 'paid', incoterm: 'CIF', delivery: 'uae_port' },
    customsAnswersSentAt: null,
    lineFiles: [],
  },
  'demo-customs-table-sent': {
    kind: 'customs',
    status: 'open',
    companyCode: '99996',
    companyName: 'Sample Projects General Trading LLC',
    periodKey: '2607-2609',
    periodLabel: 'Jul - Sep 2026 (2607-2609)',
    deadline: '2026-10-20',
    requestedItems: CUSTOMS_TABLE_POINTS,
    hasCustomsList: true,
    customsListName: 'FTA import list 99996 2607-2609.xlsx',
    expired: false,
    files: [
      { name: 'BOE 1010146613726.pdf', size: 182_300, uploadedAt: SPG_SENT_AT },
      { name: 'Invoice INV-2207.pdf', size: 96_120, uploadedAt: SPG_SENT_AT },
      { name: 'Invoice INV-2208.pdf', size: 88_410, uploadedAt: SPG_SENT_AT },
    ],
    clientComment: null,
    customsLines: SPG_LINES,
    customsAnswers: {
      '6201': { parts: [{ purpose: 'sale_stock', payment: 'paid', incoterm: 'FOB', delivery: 'outside_uae', deliveryPlace: 'Shanghai, China' }], updatedAt: SPG_SENT_AT },
      '6202': {
        parts: [
          { invoiceRef: 'INV-2207', purpose: 'sale_stock', payment: 'paid', incoterm: 'DAP', delivery: 'uae_premises' },
          { invoiceRef: 'INV-2208', purpose: 'samples', payment: 'foc', incoterm: 'DAP', delivery: 'uae_premises' },
        ],
        updatedAt: SPG_SENT_AT,
      },
      '6203': { parts: [{ purpose: 'fixed_asset', payment: 'will_be_paid', incoterm: 'EXW', delivery: 'outside_uae', deliveryPlace: 'Milan, Italy' }], updatedAt: SPG_SENT_AT },
    },
    customsDefaults: { purpose: 'sale_stock', payment: 'paid', incoterm: 'FOB', delivery: 'outside_uae', deliveryPlace: 'Shanghai, China' },
    customsAnswersSentAt: SPG_SENT_AT,
    lineFiles: [
      { lineId: 6202, docKind: 'boe', name: 'BOE 1010146613726.pdf', uploadedAt: SPG_SENT_AT },
      { lineId: 6202, docKind: 'invoice', name: 'Invoice INV-2207.pdf', uploadedAt: SPG_SENT_AT },
      { lineId: 6202, docKind: 'invoice', name: 'Invoice INV-2208.pdf', uploadedAt: SPG_SENT_AT },
    ],
  },
  // Round 4 B: the same table as demo-customs-table, behind the email code.
  get 'demo-code'(): VatFilesPagePayload {
    return { ...DEMOS['demo-customs-table'], viewerEmail: 'anna.k@pennypress-demo.com' };
  },
  'demo-customs-table-long': {
    kind: 'customs',
    status: 'open',
    companyCode: '99995',
    companyName: 'Sample Wholesale FZE',
    periodKey: '2607-2609',
    periodLabel: 'Jul - Sep 2026 (2607-2609)',
    deadline: '2026-10-20',
    requestedItems: CUSTOMS_TABLE_POINTS,
    hasCustomsList: true,
    customsListName: 'FTA import list 99995 2607-2609.xlsx',
    expired: false,
    files: [],
    clientComment: null,
    customsLines: longLines(),
    customsAnswers: {},
    customsDefaults: null,
    customsAnswersSentAt: null,
    lineFiles: [],
  },
};

export function isDemoToken(token: string): boolean {
  return process.env.NODE_ENV !== 'production' && token in DEMOS;
}

export function demoPayload(token: string): VatFilesPagePayload {
  return structuredClone(DEMOS[token]);
}

/** Round 4 B: demo tokens that ask for the email code first. */
export function isDemoCodeToken(token: string): boolean {
  return isDemoToken(token) && token === 'demo-code';
}

/** The masked list the demo shows under "Who are you?" (two look alike, so more letters show). */
export const DEMO_CODE_ADDRESSES: VatFilesCodeAddress[] = [
  { id: 'demo000000000001', masked: 'an***@pennypress-demo.com' },
  { id: 'demo000000000002', masked: 'al***@pennypress-demo.com' },
  { id: 'demo000000000003', masked: 'f***@pennypress-demo.com' },
];

/** Round 4 C: who the demo pages say sent a reply (no code on most demos). */
export const DEMO_REPLY_BY = 'anna.k@pennypress-demo.com';
