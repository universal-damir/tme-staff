import { describe, it, expect } from 'vitest';
import {
  VAT_FILES_MAX_PER_ROUND,
  VAT_FILES_MAX_TOTAL,
  buildFinalizeEntries,
  buildStoragePath,
  clientPeriodLabel,
  cleanComment,
  decideVatFilesAccess,
  detectVatFile,
  displayFileName,
  formatBytes,
  formatDeadline,
  isUploadPathForLink,
  isValidVatFilesToken,
  parseFinalizeBody,
  scrubVatFilesRow,
  vatFilesRateLimited,
} from './vat-files';
import type { VatFileEntry, VatFileRequestRow } from '@/types/vat-files';

const TOKEN = 'Abc123_-xyzXYZ0987654321';
const ENV = 'production';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0x20)]);
const text = (s: string) => new TextEncoder().encode(s);

function row(over: Partial<VatFileRequestRow> = {}): VatFileRequestRow {
  return {
    id: 'row-id-1',
    link_token: TOKEN,
    environment: ENV,
    portal_filing_id: 42,
    company_code: '10039',
    company_name: 'Sample FZCO',
    period_key: '2606-2608',
    period_label: 'June to August 2026',
    kind: 'customs',
    requested_items: ['Bills of Entry', 'Import invoices'],
    customs_list_path: `${ENV}/${TOKEN}/fta-list.xlsx`,
    deadline: '2026-10-20',
    status: 'open',
    files: [],
    client_comment: null,
    last_submitted_at: null,
    created_at: '2026-10-09T08:00:00Z',
    updated_at: '2026-10-09T08:00:00Z',
    expires_at: null,
    ...over,
  };
}

describe('token', () => {
  it('accepts a uuid and a long url-safe token, refuses the rest', () => {
    expect(isValidVatFilesToken(UUID)).toBe(true);
    expect(isValidVatFilesToken(TOKEN)).toBe(true);
    expect(isValidVatFilesToken('short')).toBe(false);
    expect(isValidVatFilesToken('../../etc/passwd/aaaaaaaaaa')).toBe(false);
    expect(isValidVatFilesToken(`${TOKEN}/x`)).toBe(false);
  });
});

describe('detectVatFile', () => {
  it('accepts the types we ask for', () => {
    expect(detectVatFile(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), 'a.PDF')?.ext).toBe('.pdf');
    expect(detectVatFile(bytes(0x50, 0x4b, 0x03, 0x04), 'list.xlsx')?.ext).toBe('.xlsx');
    expect(detectVatFile(bytes(0x50, 0x4b, 0x03, 0x04), 'letter.docx')?.ext).toBe('.docx');
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    expect(detectVatFile(bytes(...ole), 'old.doc')).toBeNull(); // the portal does not store .doc
    expect(detectVatFile(bytes(...ole), 'old.xls')?.ext).toBe('.xls');
    expect(detectVatFile(bytes(...ole), 'mail.msg')?.mime).toBe('application/vnd.ms-outlook');
    expect(detectVatFile(text('date,amount\n01.07.2026,100\n'), 'sales.csv')?.ext).toBe('.csv');
    expect(detectVatFile(text('From: a@b.c\nSubject: x\n\nbody'), 'mail.eml')?.ext).toBe('.eml');
    expect(detectVatFile(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]), 'u.csv')?.ext).toBe('.csv');
    expect(detectVatFile(bytes(0xff, 0xd8, 0xff, 0xe0), 'scan.jpeg')?.mime).toBe('image/jpeg');
    expect(detectVatFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'p.png')?.ext).toBe('.png');
  });

  it('refuses a name that lies about the content and unknown types', () => {
    expect(detectVatFile(bytes(0x4d, 0x5a, 0x90, 0x00), 'virus.pdf')).toBeNull();
    expect(detectVatFile(bytes(0x4d, 0x5a, 0x90, 0x00), 'tool.exe')).toBeNull();
    expect(detectVatFile(bytes(0x50, 0x4b, 0x03, 0x04), 'archive.zip')).toBeNull();
    expect(detectVatFile(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), 'noext')).toBeNull();
    expect(detectVatFile(new Uint8Array([0x41, 0x00, 0x42, 0x43, 0x44]), 'bin.csv')).toBeNull();
    expect(detectVatFile(text('<html>'), 'page.html')).toBeNull();
  });
});

describe('names and paths', () => {
  it('storage path: shared safe name, no folders', () => {
    expect(buildStoragePath(ENV, TOKEN, UUID, 'Bill of Entry #1 (July).pdf')).toBe(`${ENV}/${TOKEN}/${UUID}-Bill_of_Entry_1_July.pdf`);
    const evil = buildStoragePath(ENV, TOKEN, UUID, '../../etc/passwd.pdf');
    expect(evil).toBe(`${ENV}/${TOKEN}/${UUID}-passwd.pdf`);
    expect(isUploadPathForLink(evil, ENV, TOKEN)).toBe(true);
    expect(isUploadPathForLink(buildStoragePath(ENV, TOKEN, UUID, 'فاتورة.pdf'), ENV, TOKEN)).toBe(true);
    expect(isUploadPathForLink(buildStoragePath(ENV, TOKEN, UUID, `${'a'.repeat(300)}.xlsx`), ENV, TOKEN)).toBe(true);
    // The portal's sync skips paths with '..': never make one.
    expect(buildStoragePath(ENV, TOKEN, UUID, 'Invoice..pdf')).toBe(`${ENV}/${TOKEN}/${UUID}-Invoice.pdf`);
    const cut = buildStoragePath(ENV, TOKEN, UUID, `${'a'.repeat(115)}.b${'c'.repeat(20)}.pdf`);
    expect(cut.includes('..')).toBe(false);
    expect(isUploadPathForLink(cut, ENV, TOKEN)).toBe(true);
  });

  it('display name keeps letters of any script, drops folders', () => {
    expect(displayFileName('C:\\fakepath\\فاتورة يوليو.pdf')).toBe('فاتورة يوليو.pdf');
    expect(displayFileName('a/b/<script>.pdf')).toBe('_script_.pdf');
  });

  it('a built path is this link’s upload path; nothing else is', () => {
    const path = buildStoragePath(ENV, TOKEN, UUID, 'Bill of Entry.pdf');
    expect(path).toBe(`${ENV}/${TOKEN}/${UUID}-Bill_of_Entry.pdf`);
    expect(isUploadPathForLink(path, ENV, TOKEN)).toBe(true);
    expect(isUploadPathForLink(path, ENV, 'Other_token_000000000000')).toBe(false);
    expect(isUploadPathForLink(path, 'sandbox', TOKEN)).toBe(false);
    expect(isUploadPathForLink(`${ENV}/${TOKEN}/fta-list.xlsx`, ENV, TOKEN)).toBe(false);
    expect(isUploadPathForLink(`${ENV}/${TOKEN}/${UUID}-../../x.pdf`, ENV, TOKEN)).toBe(false);
    expect(isUploadPathForLink(`${ENV}/${TOKEN}/${UUID}-a/b.pdf`, ENV, TOKEN)).toBe(false);
    expect(isUploadPathForLink(`_incoming/row/${UUID}`, ENV, TOKEN)).toBe(false);
    expect(isUploadPathForLink(42, ENV, TOKEN)).toBe(false);
  });
});

describe('decideVatFilesAccess', () => {
  it('open = ok; closed only for reads; expired = 410', () => {
    expect(decideVatFilesAccess(row()).ok).toBe(true);
    expect(decideVatFilesAccess(row({ status: 'closed' }))).toMatchObject({ ok: false, reason: 'closed', status: 410 });
    expect(decideVatFilesAccess(row({ status: 'closed' }), { allowClosed: true }).ok).toBe(true);
    expect(
      decideVatFilesAccess(row({ expires_at: '2026-10-01T00:00:00Z' }), {}, Date.parse('2026-10-09'))
    ).toMatchObject({ ok: false, reason: 'expired', status: 410 });
  });

  it('an environment that is not a plain segment = not found', () => {
    expect(decideVatFilesAccess(row({ environment: '../x' }))).toMatchObject({ ok: false, status: 404 });
  });
});

describe('scrubVatFilesRow', () => {
  it('never hands out ids, token, environment or paths', () => {
    const r = row({
      files: [{ path: `${ENV}/${TOKEN}/${UUID}-a.pdf`, name: 'a.pdf', size: 10, uploadedAt: 'x', comment: 'hi' }],
      client_comment: 'secret note',
    });
    const json = JSON.stringify(scrubVatFilesRow(r));
    for (const s of [TOKEN, ENV, 'row-id-1', `${ENV}/`, ':42', 'portal_filing_id']) {
      expect(json).not.toContain(s);
    }
    expect(scrubVatFilesRow(r)).toMatchObject({
      kind: 'customs',
      companyCode: '10039',
      hasCustomsList: true,
      requestedItems: ['Bills of Entry', 'Import invoices'],
      customsListName: 'fta-list.xlsx',
      files: [{ name: 'a.pdf', size: 10 }],
      clientComment: 'secret note',
      expired: false,
    });
  });

  it('offers the FTA list whenever the row has one (files request with the customs point too)', () => {
    expect(scrubVatFilesRow(row({ kind: 'files' })).hasCustomsList).toBe(true);
    expect(scrubVatFilesRow(row({ customs_list_path: null }))).toMatchObject({ hasCustomsList: false, customsListName: null });
  });

  it('marks an expired row', () => {
    expect(scrubVatFilesRow(row({ expires_at: '2026-10-01T00:00:00Z' }), Date.parse('2026-10-09')).expired).toBe(true);
  });
});

describe('send', () => {
  const p1 = buildStoragePath(ENV, TOKEN, UUID, 'a.pdf');
  const p2 = buildStoragePath(ENV, TOKEN, '1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'b.xlsx');
  const stored = new Map([
    [p1, 100],
    [p2, 200],
  ]);
  const now = '2026-10-09T10:00:00.000Z';

  it('parses the body and cleans the comment', () => {
    expect(parseFinalizeBody({ files: [{ path: p1, name: 'a.pdf' }], comment: ' hi\u0000\r\nthere ' })).toEqual({
      files: [{ path: p1, name: 'a.pdf' }],
      comment: 'hi\nthere',
    });
    expect(parseFinalizeBody({ files: 'x' })).toBeNull();
    expect(parseFinalizeBody({ files: [{ name: 'no path' }] })).toBeNull();
    expect(cleanComment('x'.repeat(5000)).length).toBe(2000);
  });

  it('builds entries with the stored size and the round comment', () => {
    const r = buildFinalizeEntries([], [{ path: p1, name: 'a.pdf' }, { path: p2, name: '' }], 'see list', stored, ENV, TOKEN, now);
    expect(r).toEqual({
      ok: true,
      entries: [
        { path: p1, name: 'a.pdf', size: 100, uploadedAt: now, comment: 'see list' },
        { path: p2, name: 'b.xlsx', size: 200, uploadedAt: now, comment: 'see list' },
      ],
    });
  });

  it('a name with another extension than the stored file falls back to the stored name', () => {
    const r = buildFinalizeEntries([], [{ path: p1, name: 'harmless.exe' }], '', stored, ENV, TOKEN, now);
    expect(r.ok && r.entries[0].name).toBe('a.pdf');
  });

  it('skips files already sent (double click) and duplicates', () => {
    const existing: VatFileEntry[] = [{ path: p1, name: 'a.pdf', size: 100, uploadedAt: now }];
    const r = buildFinalizeEntries(existing, [{ path: p1, name: 'a.pdf' }, { path: p2, name: 'b' }, { path: p2, name: 'b' }], '', stored, ENV, TOKEN, now);
    expect(r.ok && r.entries.map((e) => e.path)).toEqual([p2]);
    expect(r.ok && 'comment' in r.entries[0]).toBe(false);
  });

  it('refuses foreign paths, missing uploads, empty and oversized rounds', () => {
    const foreign = buildStoragePath(ENV, 'Other_token_000000000000', UUID, 'a.pdf');
    expect(buildFinalizeEntries([], [{ path: foreign, name: 'x' }], '', stored, ENV, TOKEN, now)).toEqual({ ok: false, error: 'invalid_path' });
    const missing = buildStoragePath(ENV, TOKEN, '6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'c.pdf');
    expect(buildFinalizeEntries([], [{ path: missing, name: 'x' }], '', stored, ENV, TOKEN, now)).toEqual({ ok: false, error: 'upload_not_received' });
    expect(buildFinalizeEntries([], [], '', stored, ENV, TOKEN, now)).toEqual({ ok: false, error: 'no_files' });
    const many = new Array(VAT_FILES_MAX_PER_ROUND + 1).fill({ path: p1, name: 'a' });
    expect(buildFinalizeEntries([], many, '', stored, ENV, TOKEN, now)).toEqual({ ok: false, error: 'too_many_files' });
    const full = new Array(VAT_FILES_MAX_TOTAL).fill(0).map((_, i) => ({ path: `x${i}`, name: 'x', size: 1, uploadedAt: now }));
    expect(buildFinalizeEntries(full, [{ path: p2, name: 'b' }], '', stored, ENV, TOKEN, now)).toEqual({ ok: false, error: 'too_many_files' });
  });
});

describe('display helpers', () => {
  it('formats the deadline as dd.mm.yyyy', () => {
    expect(formatDeadline('2026-10-28')).toBe('28.10.2026');
    expect(formatDeadline('2026-10-28T00:00:00Z')).toBe('28.10.2026');
    expect(formatDeadline(null)).toBe('');
  });

  it('drops the period key from the label', () => {
    expect(clientPeriodLabel('Jun - Aug 2026 (2606-2608)')).toBe('Jun - Aug 2026');
    expect(clientPeriodLabel('June to August 2026')).toBe('June to August 2026');
    expect(clientPeriodLabel(null)).toBe('');
  });

  it('formats sizes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(0)).toBe('0 KB');
  });
});

describe('rate limit', () => {
  it('blocks after 150 calls a minute per IP', () => {
    const t = 1_000_000;
    let blocked = false;
    for (let i = 0; i < 150; i++) blocked = vatFilesRateLimited('9.9.9.9', t);
    expect(blocked).toBe(false);
    expect(vatFilesRateLimited('9.9.9.9', t)).toBe(true);
    expect(vatFilesRateLimited('9.9.9.9', t + 61_000)).toBe(false);
  });
});
