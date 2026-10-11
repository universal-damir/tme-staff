import { describe, it, expect } from 'vitest';
import {
  applyCustomsAnswersUpdate,
  fillEmptyLines,
  filterCustomsLineIds,
  formatAed,
  formatDubaiDateTime,
  formatPageDate,
  initialPageAnswers,
  isCustomsAnswerEmpty,
  mergeLineAnswer,
  reconcileAfterReload,
  readDefaults,
  sanitizeCustomsPart,
  sanitizePageLines,
} from './vat-customs';
import { buildFinalizeEntries, buildStoragePath, parseFinalizeBody, scrubVatFilesRow } from './vat-files';
import {
  VAT_CUSTOMS_MAX_PARTS,
  VAT_CUSTOMS_MAX_TEXT_CHARS,
  type VatCustomsPageLine,
  type VatFileRequestRow,
} from '@/types/vat-files';

const NOW = '2026-10-11T10:00:00.000Z';
const EARLIER = '2026-10-10T10:00:00.000Z';

function line(id: number, over: Partial<VatCustomsPageLine> = {}): VatCustomsPageLine {
  return {
    id,
    lineNo: id,
    declarationDate: '2026-08-03',
    declarationNo: `10101359600${id}`,
    transactionRefNo: '6505210394',
    totalValue: 1000,
    totalVat: 50,
    hasBoe: false,
    hasInvoice: false,
    answer: null,
    questions: [],
    ...over,
  };
}

const Q77 = { id: 77, text: 'Is this a sample?', askedAt: EARLIER };
const Q78 = { id: 78, text: 'Who paid the invoice?', askedAt: EARLIER };
const LINES = [line(1), line(2, { questions: [Q77, Q78] }), line(3)];
const FULL = { purpose: 'sale_stock', payment: 'paid', incoterm: 'CIF', delivery: 'uae_port' } as const;

describe('answers validation (autosave + Send)', () => {
  it('stores a valid line, stamps updatedAt on the server, keeps other lines', () => {
    const stored = { '3': { parts: [{ purpose: 'office_use' }], updatedAt: EARLIER } };
    const r = applyCustomsAnswersUpdate(stored, { '1': { parts: [FULL], updatedAt: '1999-01-01T00:00:00Z' } }, LINES, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toEqual(['1']);
    expect(r.answers['1']).toEqual({ parts: [FULL], updatedAt: NOW });
    expect(r.answers['3']).toEqual({ parts: [{ purpose: 'office_use' }], updatedAt: EARLIER });
  });

  it('an unchanged line keeps its old updatedAt (no change counted)', () => {
    const stored = { '1': { parts: [FULL], updatedAt: EARLIER } };
    const r = applyCustomsAnswersUpdate(stored, { '1': { parts: [{ ...FULL, comment: '  ' }] } }, LINES, NOW);
    expect(r.ok && r.changed).toEqual([]);
    expect(r.ok && r.answers['1'].updatedAt).toBe(EARLIER);
  });

  it('refuses an option value that is not on the shared list', () => {
    expect(applyCustomsAnswersUpdate({}, { '1': { parts: [{ purpose: 'smuggling' }] } }, LINES, NOW)).toEqual({
      ok: false,
      error: 'invalid_answer',
      lineId: '1',
    });
    expect(applyCustomsAnswersUpdate({}, { '1': { parts: [{ incoterm: 'cif' }] } }, LINES, NOW)).toMatchObject({ ok: false, error: 'invalid_answer' });
    expect(applyCustomsAnswersUpdate({}, { '1': { parts: [{ purposeOther: 5 }] } }, LINES, NOW)).toMatchObject({ ok: false, error: 'invalid_answer' });
    expect(applyCustomsAnswersUpdate({}, { '1': { parts: 'x' } }, LINES, NOW)).toMatchObject({ ok: false, error: 'invalid_answer' });
    expect(applyCustomsAnswersUpdate({}, [], LINES, NOW)).toMatchObject({ ok: false, error: 'invalid_answers' });
  });

  it('refuses a line id that is not on this row', () => {
    expect(applyCustomsAnswersUpdate({}, { '999': { parts: [FULL] } }, LINES, NOW)).toEqual({ ok: false, error: 'unknown_line', lineId: '999' });
    expect(applyCustomsAnswersUpdate({}, { __proto__x: { parts: [] } }, LINES, NOW)).toMatchObject({ ok: false, error: 'unknown_line' });
  });

  it('replies are stored per open question of the line', () => {
    const r = applyCustomsAnswersUpdate({}, { '2': { parts: [], replies: { '77': 'Yes, samples', '78': ' We did ' } } }, LINES, NOW);
    expect(r.ok && r.answers['2']).toEqual({ parts: [], replies: { '77': 'Yes, samples', '78': 'We did' }, updatedAt: NOW });
    expect(r.ok && r.staleReplies).toEqual([]);
  });

  it('a reply to a closed / unknown question is dropped silently and reported, never moved (S4)', () => {
    // 76 is not open on line 2; 77 is.
    const r = applyCustomsAnswersUpdate({}, { '2': { parts: [FULL], replies: { '76': 'old reply', '77': 'Yes' } } }, LINES, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers['2'].replies).toEqual({ '77': 'Yes' });
    expect(r.answers['2'].parts).toEqual([FULL]);
    expect(r.staleReplies).toEqual(['2']);
    // Line 1 has no question: the reply goes, the answer is still saved.
    const r1 = applyCustomsAnswersUpdate({}, { '1': { parts: [FULL], replies: { '77': 'x' } } }, LINES, NOW);
    expect(r1.ok && r1.answers['1']).toEqual({ parts: [FULL], updatedAt: NOW });
    expect(r1.ok && r1.staleReplies).toEqual(['1']);
    // Junk keys: dropped too; an empty stale reply is not reported.
    const r2 = applyCustomsAnswersUpdate({}, { '2': { parts: [], replies: { abc: 'x', '76': '  ' } } }, LINES, NOW);
    expect(r2.ok && r2.staleReplies).toEqual(['2']);
    const r3 = applyCustomsAnswersUpdate({}, { '2': { parts: [FULL], replies: { '76': '  ' } } }, LINES, NOW);
    expect(r3.ok && r3.staleReplies).toEqual([]);
  });

  it('a page loaded before the change (reply + replyToQuestionId) is kept only for an open question', () => {
    const ok = applyCustomsAnswersUpdate({}, { '2': { parts: [], reply: 'Yes', replyToQuestionId: 78 } }, LINES, NOW);
    expect(ok.ok && ok.answers['2'].replies).toEqual({ '78': 'Yes' });
    const stale = applyCustomsAnswersUpdate({}, { '2': { parts: [FULL], reply: 'Yes', replyToQuestionId: 70 } }, LINES, NOW);
    expect(stale.ok && stale.answers['2']).toEqual({ parts: [FULL], updatedAt: NOW });
    expect(stale.ok && stale.staleReplies).toEqual(['2']);
  });

  it('refuses replies that are not an object of texts', () => {
    expect(applyCustomsAnswersUpdate({}, { '2': { parts: [], replies: ['x'] } }, LINES, NOW)).toMatchObject({ ok: false, error: 'invalid_answer' });
    expect(applyCustomsAnswersUpdate({}, { '2': { parts: [], replies: { '77': 5 } } }, LINES, NOW)).toMatchObject({ ok: false, error: 'invalid_answer' });
  });

  it('a stored reply to a question that is no longer open stays; clearing an open reply removes it', () => {
    const stored = { '2': { parts: [], replies: { '50': 'answer to a closed question', '77': 'Yes' }, updatedAt: EARLIER } };
    const r = applyCustomsAnswersUpdate(stored, { '2': { parts: [FULL], replies: { '77': '' } } }, LINES, NOW);
    expect(r.ok && r.answers['2'].replies).toEqual({ '50': 'answer to a closed question' });
    expect(r.ok && r.changed).toEqual(['2']);
  });

  it('the same replies in another key order count as unchanged', () => {
    const stored = { '2': { parts: [], replies: { '78': 'b', '77': 'a' }, updatedAt: EARLIER } };
    const r = applyCustomsAnswersUpdate(stored, { '2': { parts: [], replies: { '77': 'a', '78': 'b' } } }, LINES, NOW);
    expect(r.ok && r.changed).toEqual([]);
  });

  it('cuts texts to the shared maximum and drops control characters', () => {
    const long = 'a'.repeat(VAT_CUSTOMS_MAX_TEXT_CHARS + 100);
    const r = applyCustomsAnswersUpdate({}, { '1': { parts: [{ purpose: 'other', purposeOther: `x\u0000${long}` }] } }, LINES, NOW);
    expect(r.ok && r.answers['1'].parts[0].purposeOther?.length).toBe(VAT_CUSTOMS_MAX_TEXT_CHARS);
    expect(r.ok && r.answers['1'].parts[0].purposeOther?.startsWith('xa')).toBe(true);
  });

  it(`caps the parts at ${VAT_CUSTOMS_MAX_PARTS}`, () => {
    const parts = new Array(VAT_CUSTOMS_MAX_PARTS).fill(0).map((_, i) => ({ invoiceRef: `INV-${i}` }));
    expect(applyCustomsAnswersUpdate({}, { '1': { parts } }, LINES, NOW).ok).toBe(true);
    expect(applyCustomsAnswersUpdate({}, { '1': { parts: [...parts, {}] } }, LINES, NOW)).toMatchObject({ ok: false, error: 'too_many_parts' });
  });

  it('drops unknown keys of a part', () => {
    expect(sanitizeCustomsPart({ purpose: 'samples', evil: '<script>' })).toEqual({ ok: true, part: { purpose: 'samples' } });
  });
});

describe('merge rule', () => {
  const portal = { parts: [{ purpose: 'sale_stock' as const }], updatedAt: '2026-10-10T08:00:00.000Z' };
  const client = { parts: [{ purpose: 'samples' as const }], updatedAt: '2026-10-10T09:00:00.000Z' };

  it('per line the newer updatedAt wins; a tie goes to the client', () => {
    expect(mergeLineAnswer({ answer: portal, questions: [] }, client).parts[0].purpose).toBe('samples');
    expect(mergeLineAnswer({ answer: { ...portal, updatedAt: '2026-10-10T10:00:00.000Z' }, questions: [] }, client).parts[0].purpose).toBe('sale_stock');
    expect(mergeLineAnswer({ answer: { ...portal, updatedAt: client.updatedAt }, questions: [] }, client).parts[0].purpose).toBe('samples');
    expect(mergeLineAnswer({ answer: portal, questions: [] }, undefined).parts[0].purpose).toBe('sale_stock');
    expect(mergeLineAnswer({ answer: null, questions: [] }, undefined).parts).toEqual([]);
  });

  it('S3: a newer staff clear ({ parts: [], updatedAt }) wins over the client\'s older answer and reads as empty', () => {
    const cleared = sanitizePageLines([{ ...line(4), answer: { parts: [], updatedAt: '2026-10-10T10:00:00.000Z' } }])[0];
    expect(cleared.answer).toEqual({ parts: [], updatedAt: '2026-10-10T10:00:00.000Z' });
    const m = mergeLineAnswer(cleared, { parts: [FULL], updatedAt: client.updatedAt });
    expect(m.parts).toEqual([]);
    expect(isCustomsAnswerEmpty(m)).toBe(true);
    expect(initialPageAnswers([cleared], { '4': { parts: [FULL], updatedAt: client.updatedAt } })['4'].parts).toEqual([]);
    // The client answers again after the clear: theirs is newer and wins.
    expect(mergeLineAnswer(cleared, { parts: [FULL], updatedAt: '2026-10-10T11:00:00.000Z' }).parts).toEqual([FULL]);
  });

  it('replies come from the client, only for the open questions', () => {
    const withReplies = { ...client, updatedAt: '2026-10-01T00:00:00.000Z', replies: { '77': 'Yes', '70': 'old' } };
    const m = mergeLineAnswer({ answer: portal, questions: [Q77, Q78] }, withReplies);
    expect(m.parts[0].purpose).toBe('sale_stock');
    expect(m.replies).toEqual({ '77': 'Yes' });
    expect(mergeLineAnswer({ answer: portal, questions: [Q78] }, withReplies).replies).toBeUndefined();
  });

  it('initialPageAnswers has one entry per line', () => {
    const a = initialPageAnswers(LINES, { '3': client });
    expect(Object.keys(a)).toEqual(['1', '2', '3']);
    expect(a['3'].parts[0].purpose).toBe('samples');
  });
});

describe('Apply to all / Same as last quarter', () => {
  it('fills only empty lines, never a filled or split one', () => {
    const answers = {
      '1': { parts: [FULL] },
      '2': { parts: [{ purpose: 'office_use' as const }] },
      '3': { parts: [{ invoiceRef: 'A' }, { invoiceRef: 'B' }] },
      '4': { parts: [] },
    };
    const r = fillEmptyLines(answers, [1, 2, 3, 4, 5], { ...FULL, invoiceRef: 'X', comment: 'c' });
    expect(r.filled).toEqual(['4', '5']);
    expect(r.answers['4']).toEqual({ parts: [FULL] });
    expect(r.answers['5']).toEqual({ parts: [FULL] });
    expect(r.answers['2']).toBe(answers['2']);
    expect(r.answers['3']).toBe(answers['3']);
  });

  it('a line with only a reply counts as filled', () => {
    const r = fillEmptyLines({ '2': { parts: [], replies: { '77': 'Yes' } } }, [2], FULL);
    expect(r.filled).toEqual([]);
  });

  it('an empty source fills nothing; the other text only travels with "other"', () => {
    expect(fillEmptyLines({}, [1], {}).filled).toEqual([]);
    const r = fillEmptyLines({}, [1], { ...FULL, purposeOther: 'left over', deliveryPlace: 'Dubai' });
    expect(r.answers['1'].parts[0]).toEqual(FULL);
  });

  it('defaults: one part without invoice number, null when empty or bad', () => {
    expect(readDefaults({ ...FULL, invoiceRef: 'X' })).toEqual(FULL);
    expect(readDefaults({ purpose: 'nope' })).toBeNull();
    expect(readDefaults(null)).toBeNull();
    expect(readDefaults({})).toBeNull();
  });
});

describe('payload builder (round 3)', () => {
  const TOKEN = 'Abc123_-xyzXYZ0987654321';
  const ENV = 'production';
  const base: VatFileRequestRow = {
    id: 'row-1',
    link_token: TOKEN,
    environment: ENV,
    portal_filing_id: 42,
    company_code: '10039',
    company_name: 'Sample FZCO',
    period_key: '2606-2608',
    period_label: null,
    kind: 'customs',
    requested_items: [],
    customs_list_path: null,
    deadline: null,
    status: 'open',
    files: [],
    client_comment: null,
    last_submitted_at: null,
    created_at: NOW,
    updated_at: NOW,
    expires_at: null,
  };

  it('columns missing (Supabase not migrated yet) = no table', () => {
    expect(scrubVatFilesRow(base)).toMatchObject({
      customsLines: [],
      customsAnswers: {},
      customsDefaults: null,
      customsAnswersSentAt: null,
      lineFiles: [],
    });
  });

  it('cleans the lines, keeps answers of known lines only, lists per-line files', () => {
    const p = scrubVatFilesRow({
      ...base,
      customs_lines: [
        { ...line(5), questions: [{ id: 9, text: 'Q?', askedAt: EARLIER }, { id: 10, text: 'Q2?', askedAt: NOW }] },
        { id: 'x' } as unknown as VatCustomsPageLine,
        line(5),
      ],
      customs_answers: { '5': { parts: [FULL], updatedAt: EARLIER }, '6': { parts: [FULL] } },
      customs_defaults: FULL,
      customs_answers_sent_at: EARLIER,
      files: [
        { path: 'a', name: 'BOE.pdf', size: 1, uploadedAt: NOW, lineId: 5, docKind: 'boe' },
        { path: 'b', name: 'x.pdf', size: 1, uploadedAt: NOW, lineId: 6, docKind: 'boe' },
        { path: 'c', name: 'general.pdf', size: 1, uploadedAt: NOW },
      ],
    });
    expect(p.customsLines.map((l) => l.id)).toEqual([5]);
    expect(p.customsLines[0].questions).toEqual([
      { id: 9, text: 'Q?', askedAt: EARLIER },
      { id: 10, text: 'Q2?', askedAt: NOW },
    ]);
    expect(Object.keys(p.customsAnswers)).toEqual(['5']);
    expect(p.customsDefaults).toEqual(FULL);
    expect(p.customsAnswersSentAt).toBe(EARLIER);
    expect(p.lineFiles).toEqual([{ lineId: 5, docKind: 'boe', name: 'BOE.pdf', uploadedAt: NOW }]);
    expect(JSON.stringify(p)).not.toContain('"path"');
  });

  it('sanitizePageLines: questions cleaned (bad ids / empty texts / repeats out); an older single `question` still reads', () => {
    const [l] = sanitizePageLines([
      { id: 1, declarationNo: '1', questions: [{ id: 3, text: 'A' }, { id: 0, text: 'B' }, { id: 4, text: '  ' }, { id: 3, text: 'again' }, null] },
    ]);
    expect(l.questions).toEqual([{ id: 3, text: 'A', askedAt: '' }]);
    const [old] = sanitizePageLines([{ id: 2, declarationNo: '2', question: { id: 8, text: 'Old', askedAt: EARLIER } }]);
    expect(old.questions).toEqual([{ id: 8, text: 'Old', askedAt: EARLIER }]);
    expect(sanitizePageLines([{ id: 3, declarationNo: '3' }])[0].questions).toEqual([]);
  });

  it('sanitizePageLines: amounts as numbers, a date cut to YYYY-MM-DD', () => {
    const [l] = sanitizePageLines([{ id: 1, lineNo: 1, declarationNo: ' 1010 ', declarationDate: '2026-08-03T00:00:00Z', totalValue: '252203.24', totalVat: null }]);
    expect(l).toMatchObject({ declarationNo: '1010', declarationDate: '2026-08-03', totalValue: 252203.24, totalVat: null, hasBoe: false });
  });

  it('Send keeps lineId + docKind on the entry; a line of another row is refused', () => {
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const p1 = buildStoragePath(ENV, TOKEN, uuid, 'boe.pdf');
    const stored = new Map([[p1, 10]]);
    const parsed = parseFinalizeBody({ files: [{ path: p1, name: 'boe.pdf', lineId: 5, docKind: 'boe' }], comment: '' });
    expect(parsed?.files[0]).toEqual({ path: p1, name: 'boe.pdf', lineId: 5, docKind: 'boe' });
    const ok = buildFinalizeEntries([], parsed!.files, '', stored, ENV, TOKEN, NOW, { lineIds: new Set([5]) });
    expect(ok.ok && ok.entries[0]).toMatchObject({ lineId: 5, docKind: 'boe' });
    expect(buildFinalizeEntries([], parsed!.files, '', stored, ENV, TOKEN, NOW, { lineIds: new Set([6]) })).toEqual({ ok: false, error: 'unknown_line' });
    expect(parseFinalizeBody({ files: [{ path: p1, lineId: 5, docKind: 'passport' }] })).toBeNull();
    expect(buildFinalizeEntries([], [], '', stored, ENV, TOKEN, NOW, { allowNoFiles: true })).toEqual({ ok: true, entries: [] });
  });
});

describe('display', () => {
  it('formats AED and dates like the deadline on the page (dd.mm.yyyy)', () => {
    expect(formatAed(1234.5)).toBe('AED 1,234.50');
    expect(formatAed(-20)).toBe('AED (20.00)');
    expect(formatAed(null)).toBe('');
    expect(formatPageDate('2026-08-03')).toBe('03.08.2026');
    expect(formatPageDate(null)).toBe('');
    expect(formatDubaiDateTime('2026-10-10T11:42:00.000Z')).toBe('10.10.2026 15:42');
  });
});

describe('reload after TME changed the lines (S2)', () => {
  const typed = { parts: [{ purpose: 'samples' as const }] };

  it('keeps the typed, unsaved answers of lines that still exist, drops gone ids, saves the rest again', () => {
    // Staff replaced the list: line 1 is gone, 2 and 3 stay, 9 is new.
    const fresh = [line(2, { questions: [Q77] }), line(3), line(9)];
    const current = {
      '1': { parts: [FULL] },
      '2': { parts: [FULL], replies: { '77': 'Yes', '78': 'typed for a closed question' } },
      '3': { parts: [{ purpose: 'office_use' as const }], updatedAt: EARLIER },
    };
    const r = reconcileAfterReload(current, ['1', '2'], fresh, { '3': { parts: [{ purpose: 'office_use' }], updatedAt: EARLIER } });
    expect(Object.keys(r.answers)).toEqual(['2', '3', '9']);
    expect(r.answers['2']).toEqual({ parts: [FULL], replies: { '77': 'Yes' } });
    expect(r.answers['3'].parts).toEqual([{ purpose: 'office_use' }]);
    expect(r.answers['9']).toEqual({ parts: [] });
    expect(r.dirty).toEqual(['2']);
    expect(r.droppedLines).toEqual(['1']);
    expect(r.listChanged).toBe(true);
    expect(r.repliesDropped).toBe(true);
  });

  it('nothing typed and nothing changed: the fresh merge, no note', () => {
    const r = reconcileAfterReload({ '1': { parts: [] }, '3': typed }, [], [line(1), line(3)], { '3': { ...typed, updatedAt: EARLIER } });
    expect(r.listChanged).toBe(false);
    expect(r.repliesDropped).toBe(false);
    expect(r.dirty).toEqual([]);
    expect(r.answers['3'].parts).toEqual(typed.parts);
  });

  it('a not-dirty line takes TME\'s newer answer (staff typed or cleared it meanwhile)', () => {
    const fresh = [line(3, { answer: { parts: [], updatedAt: NOW } })];
    const r = reconcileAfterReload({ '3': { ...typed, updatedAt: EARLIER } }, [], fresh, { '3': { ...typed, updatedAt: EARLIER } });
    expect(r.answers['3'].parts).toEqual([]);
  });
});

describe('filters (U6)', () => {
  it('still open = not complete; TME questions = lines with an open question; all = null', () => {
    const lines = [line(1), line(2, { questions: [Q77] }), line(3)];
    const answers = { '1': { parts: [FULL] } };
    expect(filterCustomsLineIds('all', lines, answers)).toBeNull();
    expect([...(filterCustomsLineIds('open', lines, answers) ?? [])]).toEqual(['2', '3']);
    expect([...(filterCustomsLineIds('questions', lines, answers) ?? [])]).toEqual(['2']);
  });
});
