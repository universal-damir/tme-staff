import { describe, it, expect } from 'vitest';
import { deflateRawSync, inflateRawSync } from 'zlib';
import {
  VAT_FILES_MAX_PER_ROUND,
  VAT_FILES_MAX_TOTAL,
  VAT_ZIP_PART_MAX_BYTES,
  buildFinalizeEntries,
  buildStoragePath,
  clientPeriodLabel,
  cleanComment,
  checkVatFile,
  isRiskyAttachmentName,
  xlsHasMacroSheet,
  decideVatFilesAccess,
  detectVatFile,
  displayFileName,
  formatBytes,
  formatDeadline,
  isUploadPathForLink,
  isValidVatFilesToken,
  parseFinalizeBody,
  scrubVatFilesRow,
  vatFilesPeopleNames,
  vatFilesRateLimited,
} from './vat-files';
import type { VatFileEntry, VatFileRequestRow } from '@/types/vat-files';

const TOKEN = 'Abc123_-xyzXYZ0987654321';
const ENV = 'production';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0x20)]);
const text = (s: string) => new TextEncoder().encode(s);
const inflateRaw = (d: Uint8Array) => new Uint8Array(inflateRawSync(d));

// --- A tiny zip writer (CRC left 0: the check never reads it) ---------
function zip(files: Record<string, string>, deflate = true): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(enc.encode(name));
    const raw = Buffer.from(enc.encode(content));
    const data = deflate ? deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cdBuf, eocd]));
}

const XLSX_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const XLSM_MAIN = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
const DOCX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const contentTypes = (main: string, part: string, extra = '') =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Override PartName="/${part}" ContentType="${main}"/>${extra}</Types>`;
const xlsx = (extra: Record<string, string> = {}, main = XLSX_MAIN, deflate = true) =>
  zip(
    {
      '[Content_Types].xml': contentTypes(main, 'xl/workbook.xml'),
      'xl/workbook.xml': '<workbook/>',
      'xl/worksheets/sheet1.xml': '<worksheet/>',
      ...extra,
    },
    deflate
  );
const docx = () => zip({ '[Content_Types].xml': contentTypes(DOCX_MAIN, 'word/document.xml'), 'word/document.xml': '<document/>' });

// --- A tiny OLE file: header + one directory sector of 4 entries ------
function ole(names: string[], tail: Uint8Array = new Uint8Array(0)): Uint8Array {
  const buf = Buffer.alloc(512 + 512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  ['Root Entry', ...names].slice(0, 4).forEach((name, i) => {
    const o = 512 + i * 128;
    buf.write(name, o, 'utf16le');
    buf.writeUInt16LE((name.length + 1) * 2, o + 64);
    buf[o + 66] = i === 0 ? 5 : 1;
    buf[o + 67] = 1;
  });
  return new Uint8Array(Buffer.concat([buf, Buffer.from(tail)]));
}
/** A 64-byte mini-stream slot holding one UTF-16LE string. */
function slot(s: string): Uint8Array {
  const b = Buffer.alloc(Math.ceil(((s.length + 1) * 2) / 64) * 64);
  b.write(s, 0, 'utf16le');
  return new Uint8Array(b);
}

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
    expect(detectVatFile(xlsx(), 'list.xlsx', { inflateRaw })?.ext).toBe('.xlsx');
    expect(detectVatFile(docx(), 'letter.docx', { inflateRaw })?.ext).toBe('.docx');
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
    expect(detectVatFile(xlsx(), 'archive.zip')).toBeNull();
    expect(detectVatFile(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), 'noext')).toBeNull();
    expect(detectVatFile(new Uint8Array([0x41, 0x00, 0x42, 0x43, 0x44]), 'bin.csv')).toBeNull();
    expect(detectVatFile(text('<html>'), 'page.html')).toBeNull();
  });
});

describe('file content check (STAFF-004)', () => {
  it('xlsx: a real package passes, stored or deflated', () => {
    expect(checkVatFile(xlsx(), 'list.xlsx', { inflateRaw }).ok).toBe(true);
    expect(checkVatFile(xlsx({}, XLSX_MAIN, false), 'list.xlsx').ok).toBe(true);
    // Without an inflater the part names still decide.
    expect(checkVatFile(xlsx(), 'list.xlsx').ok).toBe(true);
  });

  it('xlsx with macros is refused with a plain message', () => {
    const vba = checkVatFile(xlsx({ 'xl/vbaProject.bin': 'x' }), 'renamed.xlsx', { inflateRaw });
    expect(vba).toEqual({
      ok: false,
      reason: 'macros',
      message: "This file contains macros and can't be uploaded. Please save it as a normal .xlsx or PDF.",
    });
    // .xlsm renamed to .xlsx: the content type says macroEnabled.
    const xlsm = checkVatFile(xlsx({}, XLSM_MAIN), 'renamed.xlsx', { inflateRaw });
    expect(xlsm.ok === false && xlsm.reason).toBe('macros');
    // Excel 4.0 macro sheet.
    const xlm = checkVatFile(xlsx({ 'xl/macrosheets/sheet1.xml': '<x/>' }), 'a.xlsx', { inflateRaw });
    expect(xlm.ok === false && xlm.reason).toBe('macros');
    // docx with a VBA project.
    const docm = checkVatFile(
      zip({ '[Content_Types].xml': contentTypes(DOCX_MAIN, 'word/document.xml'), 'word/document.xml': '<d/>', 'word/vbaProject.bin': 'x' }),
      'a.docx',
      { inflateRaw }
    );
    expect(docm.ok === false && docm.reason).toBe('macros');
  });

  it('a fake zip or a zip that is not Office is refused', () => {
    expect(checkVatFile(bytes(0x50, 0x4b, 0x03, 0x04), 'list.xlsx', { inflateRaw })).toMatchObject({ ok: false, reason: 'wrong_type' });
    expect(checkVatFile(zip({ 'readme.txt': 'hi' }), 'list.xlsx', { inflateRaw })).toMatchObject({ ok: false, reason: 'wrong_type' });
    // A docx renamed .xlsx is not a workbook.
    expect(checkVatFile(docx(), 'list.xlsx', { inflateRaw })).toMatchObject({ ok: false, reason: 'wrong_type' });
    // Content types present but no workbook part.
    expect(
      checkVatFile(zip({ '[Content_Types].xml': contentTypes(XLSX_MAIN, 'xl/workbook.xml') }), 'list.xlsx', { inflateRaw })
    ).toMatchObject({ ok: false, reason: 'wrong_type' });
  });

  it('xls with a VBA project is refused; a plain xls and msg pass', () => {
    expect(checkVatFile(ole(['Workbook', 'SummaryInformation']), 'old.xls').ok).toBe(true);
    expect(checkVatFile(ole(['Workbook', '_VBA_PROJECT_CUR', 'VBA']), 'old.xls')).toMatchObject({ ok: false, reason: 'macros' });
    expect(checkVatFile(ole(['Workbook', '_VBA_PROJECT']), 'old.xls')).toMatchObject({ ok: false, reason: 'macros' });
    expect(checkVatFile(ole(['WordDocument', 'Macros']), 'old.xls')).toMatchObject({ ok: false, reason: 'macros' });
    // The words in cell text are not a directory entry.
    const cellText = new Uint8Array(Buffer.from('VBA _VBA_PROJECT Macros', 'utf16le'));
    expect(checkVatFile(ole(['Workbook'], cellText), 'old.xls').ok).toBe(true);
    // A normal Outlook mail: property streams, a PDF attachment.
    const mail = ole(['__substg1.0_0037001F', '__attach_version1.0_#00000000', '__substg1.0_3707001F'], slot('Invoice July.pdf'));
    expect(checkVatFile(mail, 'mail.msg').ok).toBe(true);
  });

  it('a zip bomb in [Content_Types].xml is refused, not inflated (sizes in the zip lie)', () => {
    const bomb = Buffer.from(zip({ '[Content_Types].xml': ' '.repeat(VAT_ZIP_PART_MAX_BYTES + 1024), 'xl/workbook.xml': '<w/>' }));
    // Claim a tiny uncompressed size in the local and central headers.
    for (let o = 0; o + 4 <= bomb.length; o++) {
      const sig = bomb.readUInt32LE(o);
      if (sig === 0x04034b50 && bomb.readUInt32LE(o + 22) > 1000) bomb.writeUInt32LE(100, o + 22);
      if (sig === 0x02014b50 && bomb.readUInt32LE(o + 24) > 1000) bomb.writeUInt32LE(100, o + 24);
    }
    const capped = (d: Uint8Array) => new Uint8Array(inflateRawSync(d, { maxOutputLength: VAT_ZIP_PART_MAX_BYTES }));
    expect(checkVatFile(new Uint8Array(bomb), 'list.xlsx', { inflateRaw: capped })).toMatchObject({ ok: false, reason: 'wrong_type' });
  });

  it('xls with an Excel 4.0 macro sheet (XLM) is refused; a normal sheet list passes', () => {
    // BOUNDSHEET: 0x0085, len, lbPlyPos(4), visibility, sheet type, cch, flags, name.
    const boundsheet = (name: string, type: number, hidden = 0) => {
      const body = Buffer.concat([Buffer.from([0, 0, 0, 0, hidden, type, name.length, 0]), Buffer.from(name, 'latin1')]);
      const head = Buffer.alloc(4);
      head.writeUInt16LE(0x0085, 0);
      head.writeUInt16LE(body.length, 2);
      return Buffer.concat([head, body]);
    };
    const plain = new Uint8Array(Buffer.concat([boundsheet('Sheet1', 0x00), boundsheet('Chart1', 0x02)]));
    expect(checkVatFile(ole(['Workbook'], plain), 'old.xls').ok).toBe(true);
    const xlm = new Uint8Array(Buffer.concat([boundsheet('Sheet1', 0x00), boundsheet('Macro1', 0x01, 2)]));
    expect(xlsHasMacroSheet(ole(['Workbook'], xlm))).toBe(true);
    expect(checkVatFile(ole(['Workbook'], xlm), 'old.xls')).toMatchObject({ ok: false, reason: 'macros' });
  });

  it('an archive attachment is allowed unless a program name sits before .zip / .7z / .rar', () => {
    expect(isRiskyAttachmentName('Bank statements July.zip')).toBe(false);
    expect(isRiskyAttachmentName('invoices.pdf.zip')).toBe(false);
    expect(isRiskyAttachmentName('invoice.pdf.exe.zip')).toBe(true);
    expect(isRiskyAttachmentName('setup.JS.7z')).toBe(true);
    expect(isRiskyAttachmentName('tool.scr.rar')).toBe(true);
    const zipped = EML_HEAD + part('Content-Type: application/zip; name="payment.exe.zip"');
    expect(checkVatFile(text(zipped), 'mail.eml')).toMatchObject({ ok: false, reason: 'risky_attachment' });
    const statements = EML_HEAD + part('Content-Type: application/zip; name="statements.zip"');
    expect(checkVatFile(text(statements), 'mail.eml').ok).toBe(true);
  });

  it('msg with a program attached is refused (best effort)', () => {
    const exe = ole(['__substg1.0_3707001F'], slot('invoice.pdf.exe'));
    expect(checkVatFile(exe, 'mail.msg')).toMatchObject({ ok: false, reason: 'risky_attachment' });
    const ext = ole(['__substg1.0_3703001F'], slot('.JS'));
    expect(checkVatFile(ext, 'mail.msg')).toMatchObject({ ok: false, reason: 'risky_attachment' });
    // A sender called "Amazon.com" or an address is not an attachment.
    expect(checkVatFile(ole(['__substg1.0_0C1A001F'], slot('Amazon.com')), 'mail.msg').ok).toBe(true);
    expect(checkVatFile(ole(['__substg1.0_0C1F001F'], slot('billing@shop.com')), 'mail.msg').ok).toBe(true);
  });

  const EML_HEAD = 'From: a@b.ae\r\nSubject: Invoices\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n';
  const part = (headers: string, body = 'QUJD') => `--b1\r\n${headers}\r\n\r\n${body}\r\n`;

  it('eml: a normal mail with a PDF passes', () => {
    const mail =
      EML_HEAD +
      part('Content-Type: text/plain; charset=utf-8', 'Please run the numbers on www.example.com, name=report.exe is only text.') +
      part('Content-Type: application/pdf; name="Invoice.pdf"\r\nContent-Disposition: attachment; filename="Invoice.pdf"') +
      '--b1--\r\n';
    expect(checkVatFile(text(mail), 'mail.eml').ok).toBe(true);
  });

  it('eml with a program attached is refused', () => {
    const plain =
      EML_HEAD + part('Content-Type: application/octet-stream; name="setup.exe"\r\nContent-Disposition: attachment; filename="setup.exe"');
    expect(checkVatFile(text(plain), 'mail.eml')).toMatchObject({ ok: false, reason: 'risky_attachment' });
    // Unquoted, upper case, folded header.
    const folded = EML_HEAD + part('Content-Disposition: attachment;\r\n\tFILENAME=Report.XLSM');
    expect(checkVatFile(text(folded), 'mail.eml')).toMatchObject({ ok: false, reason: 'risky_attachment' });
    // RFC 2231 split name: "invoice." + "js"
    const split = EML_HEAD + part("Content-Disposition: attachment; filename*0*=utf-8''invoice.; filename*1*=js");
    expect(checkVatFile(text(split), 'mail.eml')).toMatchObject({ ok: false, reason: 'risky_attachment' });
    // RFC 2047 encoded name.
    const b64 = Buffer.from('payment.vbs').toString('base64');
    const encoded = EML_HEAD + part(`Content-Type: application/octet-stream; name="=?utf-8?B?${b64}?="`);
    expect(checkVatFile(text(encoded), 'mail.eml')).toMatchObject({ ok: false, reason: 'risky_attachment' });
  });

  it('csv stays allowed (also with formula-looking cells)', () => {
    expect(checkVatFile(text('=1+1,@SUM(A1)\n'), 'sales.csv').ok).toBe(true);
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

describe('vatFilesPeopleNames (round 4 D)', () => {
  const names = {
    'b.klingler@star.de.com': 'Bernd Klingler',
    'anna@client.com': 'Anna Keller',
    'never.shown@client.com': 'Secret Person',
  };
  const answers = {
    '1': { parts: [], replyMeta: { '7': { sentAt: 'x', sentBy: 'Anna@Client.com', changedBy: 'nobody@client.com', changedAt: 'y' } } },
  };

  it('only the viewer and the people under replies, never the whole list', () => {
    expect(vatFilesPeopleNames(names, { customsAnswers: answers }, 'b.klingler@star.de.com')).toEqual({
      'b.klingler@star.de.com': 'Bernd Klingler',
      'anna@client.com': 'Anna Keller',
    });
  });

  it('no confirmed viewer (code off) = no names; a missing column or junk = none', () => {
    expect(vatFilesPeopleNames(names, { customsAnswers: answers }, null)).toEqual({});
    expect(vatFilesPeopleNames(undefined, { customsAnswers: answers }, 'anna@client.com')).toEqual({});
    expect(vatFilesPeopleNames(['x'], { customsAnswers: {} }, 'anna@client.com')).toEqual({});
  });
});
