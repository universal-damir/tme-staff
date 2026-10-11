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
  nextReplyMeta,
  questionAskedLine,
  replyWhoLine,
  filledByLine,
  formatDubaiDate,
  withSavedReplyMeta,
  shownReplyMeta,
  demoReplyMeta,
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
    expect(r.ok && r.answers['2']).toEqual({
      parts: [],
      replies: { '77': 'Yes, samples', '78': 'We did' },
      // Round 4 C: who / when per reply (no code = no address).
      replyMeta: { '77': { sentAt: NOW, savedAt: NOW }, '78': { sentAt: NOW, savedAt: NOW } },
      updatedAt: NOW,
    });
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

// ------------------------------------------------------------------
// Round 4 C (11.10.2026): who asked, who replied
// ------------------------------------------------------------------

describe('round 4 C: who asked, who replied', () => {
  const T0 = '2026-10-11T09:09:00.000Z'; // 13:09 Dubai
  const T5 = '2026-10-11T09:14:00.000Z'; // 5 minutes later
  const T60 = '2026-10-11T10:09:00.000Z'; // an hour later

  it('nextReplyMeta: first save = sent; same person within 10 minutes = same version; later = changed', () => {
    const first = nextReplyMeta(undefined, undefined, T0, 'b.klingler@star.de.com');
    expect(first).toEqual({ sentAt: T0, sentBy: 'b.klingler@star.de.com', savedAt: T0 });
    const typing = nextReplyMeta('Yes', first, T5, 'b.klingler@star.de.com');
    expect(typing).toEqual({ sentAt: T0, sentBy: 'b.klingler@star.de.com', savedAt: T5 });
    const later = nextReplyMeta('Yes, one', typing, T60, 'b.klingler@star.de.com');
    expect(later).toEqual({ sentAt: T0, sentBy: 'b.klingler@star.de.com', changedAt: T60, changedBy: 'b.klingler@star.de.com', savedAt: T60 });
    // Someone else right away = a change too.
    expect(nextReplyMeta('Yes', first, T5, 'anna@x.com')).toMatchObject({ changedAt: T5, changedBy: 'anna@x.com' });
    // A reply stored before round 4 C (no stamps) that is edited = a change.
    expect(nextReplyMeta('Old', undefined, T0, null)).toEqual({ changedAt: T0, savedAt: T0 });
  });

  it('autosave: unchanged replies keep their stamps; a changed reply gets new ones; the address comes from the code', () => {
    const stored = {
      '2': {
        parts: [],
        replies: { '77': 'Yes', '78': 'We did' },
        replyMeta: { '77': { sentAt: EARLIER, sentBy: 'a@x.com', savedAt: EARLIER }, '78': { sentAt: EARLIER, sentBy: 'a@x.com', savedAt: EARLIER } },
        updatedAt: EARLIER,
      },
    };
    const r = applyCustomsAnswersUpdate(stored, { '2': { parts: [], replies: { '77': 'Yes', '78': 'We did not' } } }, LINES, NOW, 'b@x.com');
    expect(r.ok && r.answers['2'].replyMeta).toEqual({
      '77': { sentAt: EARLIER, sentBy: 'a@x.com', savedAt: EARLIER },
      '78': { sentAt: EARLIER, sentBy: 'a@x.com', changedAt: NOW, changedBy: 'b@x.com', savedAt: NOW },
    });
    // replyMeta from the browser is never trusted.
    const forged = applyCustomsAnswersUpdate({}, { '2': { parts: [], replies: { '77': 'Hi' }, replyMeta: { '77': { sentBy: 'boss@x.com' } } } }, LINES, NOW, null);
    expect(forged.ok && forged.answers['2'].replyMeta).toEqual({ '77': { sentAt: NOW, savedAt: NOW } });
  });

  it('page payload: questions keep the asker name, answers keep replyMeta (savedBy stays out), staff answer keeps filledBy', () => {
    const p = scrubVatFilesRow({
      id: 'row-1',
      link_token: 'Abc123_-xyzXYZ0987654321',
      environment: 'production',
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
      customs_lines: [
        line(1, { answer: { parts: [FULL], updatedAt: EARLIER, filledBy: { name: 'Anshad Muhammed' } } }),
        line(2, { questions: [{ ...Q77, askedBy: 'Anshad Muhammed' }, Q78] }),
      ],
      customs_answers: {
        '2': { parts: [], replies: { '77': 'Yes' }, replyMeta: { '77': { sentAt: T0, sentBy: 'B@X.com', savedAt: T0 }, '99': { sentAt: T0 } }, savedBy: 'b@x.com', updatedAt: T0 },
      },
    });
    expect(p.customsLines[1].questions).toEqual([{ ...Q77, askedBy: 'Anshad Muhammed' }, Q78]);
    // '99' = a cleared reply: its last who / when stays (no text).
    expect(p.customsAnswers['2']).toEqual({
      parts: [],
      replies: { '77': 'Yes' },
      replyMeta: { '77': { sentAt: T0, sentBy: 'b@x.com', savedAt: T0 }, '99': { sentAt: T0 } },
      updatedAt: T0,
    });
    expect(p.customsLines[0].answer?.filledBy).toEqual({ name: 'Anshad Muhammed' });
    // The page shows TME's answer (no client answer on line 1): with who typed it.
    const merged = initialPageAnswers(p.customsLines, p.customsAnswers);
    expect(merged['1'].filledBy).toEqual({ name: 'Anshad Muhammed' });
    expect(filledByLine(merged['1'])).toBe('Filled in by Anshad Muhammed, TME Services, on 10.10.2026');
  });

  it('a newer client answer wins: no "filled in by"', () => {
    const l = line(1, { answer: { parts: [FULL], updatedAt: EARLIER, filledBy: { name: 'Anshad Muhammed' } } });
    expect(mergeLineAnswer(l, { parts: [{ ...FULL, payment: 'foc' }], updatedAt: NOW }).filledBy).toBeUndefined();
    expect(filledByLine({ filledBy: { name: null }, updatedAt: EARLIER })).toBe('Filled in by TME Services on 10.10.2026');
    expect(filledByLine({})).toBe('');
  });

  it('wording: who asked (old rows without a name or a date)', () => {
    expect(questionAskedLine({ askedAt: T0, askedBy: 'Anshad Muhammed' })).toBe('Anshad Muhammed, TME Services, asked on 11.10.2026');
    expect(questionAskedLine({ askedAt: T0 })).toBe('TME Services asked on 11.10.2026');
    expect(questionAskedLine({ askedAt: '' })).toBe('TME Services asks');
    // Dubai date: 21:30 UTC is the next day in the UAE.
    expect(formatDubaiDate('2026-10-10T21:30:00.000Z')).toBe('11.10.2026');
  });

  it('wording: who replied (Dubai time; no address = "Sent on")', () => {
    expect(replyWhoLine({ sentAt: T0, sentBy: 'b.klingler@star.de.com', savedAt: T0 })).toBe('Sent by b.klingler@star.de.com on 11.10.2026 13:09');
    expect(replyWhoLine({ sentAt: T0, sentBy: 'a@x.com', changedAt: T60, changedBy: 'b@x.com', savedAt: T60 })).toBe('Changed by b@x.com on 11.10.2026 14:09');
    expect(replyWhoLine({ sentAt: T0, savedAt: T5 })).toBe('Sent on 11.10.2026 13:14');
    expect(replyWhoLine(undefined)).toBe('');
  });

  it('page state after a save: replies + stamps of the saved lines, others untouched; demo stamps like the server', () => {
    const current = { '1': { parts: [FULL] }, '2': { parts: [], replies: { '77': 'Yes' }, replyMeta: { '77': { sentAt: T0, savedAt: T0 } } } };
    const meta = demoReplyMeta(current, { '2': { parts: [], replies: { '77': 'Yes ', '78': 'Paid by us' } } }, T5, 'anna@x.com');
    expect(meta).toEqual({ '2': { '77': { sentAt: T0, savedAt: T0 }, '78': { sentAt: T5, sentBy: 'anna@x.com', savedAt: T5 } } });
    const next = withSavedReplyMeta(current, { '2': { parts: [], replies: { '77': 'Yes ', '78': 'Paid by us' } } }, meta);
    expect(next['1']).toBe(current['1']);
    expect(next['2'].replies).toEqual({ '77': 'Yes', '78': 'Paid by us' });
    expect(next['2'].replyMeta?.['78']?.sentBy).toBe('anna@x.com');
  });

  it('clear then retype: the cleared reply keeps its meta; same person within 10 minutes = the same version', () => {
    const T3 = '2026-10-11T09:12:00.000Z';
    const sent = applyCustomsAnswersUpdate({}, { '2': { parts: [], replies: { '77': 'Yes' } } }, LINES, T0, 'a@x.com');
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    // Cleared (the page sends an empty text, or leaves the key out): no text, meta kept, savedAt moved.
    const cleared = applyCustomsAnswersUpdate(sent.answers, { '2': { parts: [], replies: { '77': '' } } }, LINES, T3, 'a@x.com');
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.changed).toEqual(['2']);
    expect(cleared.answers['2'].replies).toBeUndefined();
    expect(cleared.answers['2'].replyMeta).toEqual({ '77': { sentAt: T0, sentBy: 'a@x.com', savedAt: T3 } });
    const left = applyCustomsAnswersUpdate(sent.answers, { '2': { parts: [] } }, LINES, T3, 'a@x.com');
    expect(left.ok && left.answers['2'].replyMeta).toEqual({ '77': { sentAt: T0, sentBy: 'a@x.com', savedAt: T3 } });
    // Retyped within the window: the same version ("Sent by"), like the portal's in-place update.
    const retyped = applyCustomsAnswersUpdate(cleared.answers, { '2': { parts: [], replies: { '77': 'Yes, two' } } }, LINES, T5, 'a@x.com');
    expect(retyped.ok && retyped.answers['2'].replyMeta).toEqual({ '77': { sentAt: T0, sentBy: 'a@x.com', savedAt: T5 } });
    expect(replyWhoLine(retyped.ok ? retyped.answers['2'].replyMeta?.['77'] : undefined)).toMatch(/^Sent by a@x.com/);
    // Retyped after the window: a change.
    const late = applyCustomsAnswersUpdate(cleared.answers, { '2': { parts: [], replies: { '77': 'Yes, two' } } }, LINES, T60, 'a@x.com');
    expect(late.ok && late.answers['2'].replyMeta).toEqual({ '77': { sentAt: T0, sentBy: 'a@x.com', changedAt: T60, changedBy: 'a@x.com', savedAt: T60 } });
    // nextReplyMeta: a cleared reply (meta, no text) is not a new one.
    expect(nextReplyMeta(undefined, { sentAt: T0, sentBy: 'a@x.com', savedAt: T3 }, T5, 'a@x.com')).toEqual({ sentAt: T0, sentBy: 'a@x.com', savedAt: T5 });
    // A clear after the window is itself a change.
    expect(nextReplyMeta('Yes', { sentAt: T0, sentBy: 'a@x.com', savedAt: T0 }, T60, 'a@x.com')).toMatchObject({ changedAt: T60 });
  });

  it('demo stamps a cleared reply like the server', () => {
    const current = { '2': { parts: [], replies: { '77': 'Yes' }, replyMeta: { '77': { sentAt: T0, sentBy: 'a@x.com', savedAt: T0 } } } };
    expect(demoReplyMeta(current, { '2': { parts: [], replies: { '77': ' ' } } }, T5, 'a@x.com')).toEqual({
      '2': { '77': { sentAt: T0, sentBy: 'a@x.com', savedAt: T5 } },
    });
  });

  it('the line under a reply is hidden while the typed text is not the saved one', () => {
    const meta77 = { sentAt: T0, savedAt: T0 };
    const meta78 = { sentAt: T0, savedAt: T0 };
    const saved = {
      '1': { parts: [], replies: { '70': 'Ok' }, replyMeta: { '70': meta77 } },
      '2': { parts: [], replies: { '77': 'Yes', '78': 'No' }, replyMeta: { '77': meta77, '78': meta78 } },
    };
    const typed = { '1': { parts: [], replies: { '70': 'Ok ' } }, '2': { parts: [], replies: { '77': 'Yes, b', '78': 'No' } } };
    const shown = shownReplyMeta(saved, typed);
    expect(shown['1']).toBe(saved['1'].replyMeta);
    expect(shown['2']).toEqual({ '78': meta78 });
    expect(shownReplyMeta(saved, {})['2']).toBe(saved['2'].replyMeta);
    expect(shownReplyMeta(undefined, typed)).toEqual({});
  });
});
