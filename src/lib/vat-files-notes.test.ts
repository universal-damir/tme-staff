import { describe, it, expect } from 'vitest';
import {
  applyCustomsAnswersUpdate,
  customsLineConflict,
  customsLineSavedAs,
  describeLineAnswer,
  dropClosedDraftNotes,
  isRefusedNoteKey,
  refusedNoteKey,
  refusedReplyTexts,
  vatCustomsSendStamp,
  initialPageAnswers,
  newCustomsNoteId,
  reconcileAfterReload,
  replyStatusLine,
  shownCustomsNotes,
  withSavedReplyMeta,
} from './vat-customs';
import { scrubVatFilesRow, vatFilesPageVersion, vatFilesPeopleNames } from './vat-files';
import {
  VAT_CUSTOMS_MAX_NOTES_PER_QUESTION,
  isVatCustomsNoteId,
  isVatCustomsReplySent,
  type VatCustomsLineAnswer,
  type VatCustomsPageLine,
  type VatFileRequestRow,
} from '@/types/vat-files';

// Round 5 item 8 (11.10.2026): "Add a note" under a sent reply.

const LINES: VatCustomsPageLine[] = [
  { id: 501, lineNo: 1, declarationDate: '2026-08-03', declarationNo: 'B1', transactionRefNo: null, totalValue: 10, totalVat: 0.5, hasBoe: false, hasInvoice: false, answer: null, questions: [] },
  {
    id: 502,
    lineNo: 2,
    declarationDate: '2026-08-19',
    declarationNo: 'B2',
    transactionRefNo: null,
    totalValue: 20,
    totalVat: 1,
    hasBoe: false,
    hasInvoice: false,
    answer: null,
    questions: [
      { id: 31, text: 'Samples?', askedAt: '2026-10-10T08:00:00Z' },
      { id: 32, text: 'Paid by whom?', askedAt: '2026-10-10T08:01:00Z' },
    ],
  },
];
const FULL = { purpose: 'sale_stock', payment: 'paid', incoterm: 'CIF', delivery: 'dubai_port_dz' } as const;
const T0 = '2026-10-11T08:00:00.000Z'; // reply saved
const T1 = '2026-10-11T09:00:00.000Z'; // Send
const T2 = '2026-10-11T10:00:00.000Z'; // note saved (draft)
const T3 = '2026-10-11T11:00:00.000Z'; // second Send
const NOW = '2026-10-11T12:00:00.000Z';
const ANNA = 'anna@client.com';

/** Line 502: reply to question 31 sent at T1 (saved T0), plus the given notes. */
function stored(notes?: VatCustomsLineAnswer['notes'], updatedAt = T0): Record<string, VatCustomsLineAnswer> {
  return {
    '502': {
      parts: [FULL],
      replies: { '31': 'Yes, samples' },
      replyMeta: { '31': { sentAt: T0, sentBy: ANNA, savedAt: T0 } },
      ...(notes ? { notes } : {}),
      updatedAt,
      savedBy: ANNA,
    },
  };
}
const body = (notes: unknown, extra: Record<string, unknown> = {}) => ({
  '502': { parts: [FULL], replies: { '31': 'Yes, samples' }, notes, ...extra },
});
function ok(r: ReturnType<typeof applyCustomsAnswersUpdate>) {
  if (!r.ok) throw new Error(`not ok: ${r.error}`);
  return r;
}

describe('shared helpers', () => {
  it('note ids: 4 to 40 of A-Z a-z 0-9 _ -; the page makes valid, different ones', () => {
    expect(isVatCustomsNoteId('n123')).toBe(true);
    expect(isVatCustomsNoteId('abc')).toBe(false);
    expect(isVatCustomsNoteId('a b c d')).toBe(false);
    expect(isVatCustomsNoteId(12345)).toBe(false);
    const a = newCustomsNoteId();
    expect(isVatCustomsNoteId(a)).toBe(true);
    expect(newCustomsNoteId(1, () => 0.1)).not.toBe(newCustomsNoteId(1, () => 0.2));
  });
});

describe('server: a note under a sent reply', () => {
  it('a new note is saved as a draft with who / when; the line changes', () => {
    const r = ok(applyCustomsAnswersUpdate(stored(), body({ '31': [{ id: 'n0001', text: '  Second invoice came later.  ' }] }), LINES, T2, ANNA, { answersSentAt: T1 }));
    expect(r.changed).toEqual(['502']);
    const note = r.answers['502'].notes?.['31']?.[0];
    expect(note).toEqual({ id: 'n0001', text: 'Second invoice came later.', sentAt: T2, sentBy: ANNA, savedAt: T2 });
    // Saved after the last Send: a draft (editable), "Saved by ... Not sent yet."
    expect(isVatCustomsReplySent(note, r.answers['502'].updatedAt, T1)).toBe(false);
    expect(replyStatusLine(note, { [ANNA]: 'Anna Keller' }, false)).toMatch(/^Saved by Anna Keller \(anna@client\.com\) on 11\.10\.2026 14:00\. Not sent yet\.$/);
    // The reply itself is untouched.
    expect(r.answers['502'].replies).toEqual({ '31': 'Yes, samples' });
    expect(r.lockedReplies).toEqual([]);
  });

  it('a draft note can be changed (same person within 10 min = same version) and removed by emptying or leaving it out', () => {
    const draft = { id: 'n0001', text: 'Draft', sentAt: T2, sentBy: ANNA, savedAt: T2 };
    const later = '2026-10-11T10:05:00.000Z';
    const changed = ok(applyCustomsAnswersUpdate(stored({ '31': [draft] }, T2), body({ '31': [{ id: 'n0001', text: 'Draft, more' }] }), LINES, later, ANNA, { answersSentAt: T1 }));
    expect(changed.answers['502'].notes?.['31']).toEqual([{ id: 'n0001', text: 'Draft, more', sentAt: T2, sentBy: ANNA, savedAt: later }]);
    const emptied = ok(applyCustomsAnswersUpdate(stored({ '31': [draft] }, T2), body({ '31': [{ id: 'n0001', text: '   ' }] }), LINES, later, ANNA, { answersSentAt: T1 }));
    expect(emptied.answers['502'].notes).toBeUndefined();
    expect(emptied.changed).toEqual(['502']);
    const left = ok(applyCustomsAnswersUpdate(stored({ '31': [draft] }, T2), body({}), LINES, later, ANNA, { answersSentAt: T1 }));
    expect(left.answers['502'].notes).toBeUndefined();
  });

  it('after the next Send the note is locked: a change is refused (lockedReplies), leaving it out keeps it', () => {
    const sentNote = { id: 'n0001', text: 'Sent note', sentAt: T2, sentBy: ANNA, savedAt: T2 };
    const s = stored({ '31': [sentNote] }, T2);
    const changed = ok(applyCustomsAnswersUpdate(s, body({ '31': [{ id: 'n0001', text: 'Other text' }] }), LINES, NOW, ANNA, { answersSentAt: T3 }));
    expect(changed.lockedReplies).toEqual(['502']);
    expect(changed.changed).toEqual([]);
    expect(changed.answers['502'].notes?.['31']).toEqual([sentNote]);
    const emptied = ok(applyCustomsAnswersUpdate(s, body({ '31': [{ id: 'n0001', text: '' }] }), LINES, NOW, ANNA, { answersSentAt: T3 }));
    expect(emptied.lockedReplies).toEqual(['502']);
    expect(emptied.answers['502'].notes?.['31']).toEqual([sentNote]);
    const leftOut = ok(applyCustomsAnswersUpdate(s, body({}), LINES, NOW, ANNA, { answersSentAt: T3 }));
    expect(leftOut.lockedReplies).toEqual([]);
    expect(leftOut.changed).toEqual([]);
    expect(leftOut.answers['502'].notes?.['31']).toEqual([sentNote]);
  });

  it('several notes per question, in order: the sent one stays, a new one is added after it', () => {
    const sentNote = { id: 'n0001', text: 'First', sentAt: T2, sentBy: ANNA, savedAt: T2 };
    const r = ok(
      applyCustomsAnswersUpdate(stored({ '31': [sentNote] }, T2), body({ '31': [{ id: 'n0001', text: 'First' }, { id: 'n0002', text: 'Second' }] }), LINES, NOW, 'bob@client.com', { answersSentAt: T3 })
    );
    expect(r.answers['502'].notes?.['31']?.map((n) => [n.id, n.text, n.sentBy])).toEqual([
      ['n0001', 'First', ANNA],
      ['n0002', 'Second', 'bob@client.com'],
    ]);
  });

  it('no note under a reply that is not sent yet, or without a reply (the page offers none)', () => {
    const draftReply = stored(undefined, T2);
    draftReply['502'].replyMeta = { '31': { sentAt: T2, sentBy: ANNA, savedAt: T2 } };
    const r = ok(applyCustomsAnswersUpdate(draftReply, body({ '31': [{ id: 'n0001', text: 'Note' }] }), LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(r.answers['502'].notes).toBeUndefined();
    const noSend = ok(applyCustomsAnswersUpdate(stored(), body({ '31': [{ id: 'n0001', text: 'Note' }] }), LINES, NOW, ANNA));
    expect(noSend.answers['502'].notes).toBeUndefined();
    const noReply = ok(applyCustomsAnswersUpdate(stored(), body({ '32': [{ id: 'n0001', text: 'Note' }] }), LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(noReply.answers['502'].notes).toBeUndefined();
  });

  it('a note to a question TME closed is refused (dropped, staleReplies); stored notes of closed questions stay', () => {
    const r = ok(applyCustomsAnswersUpdate(stored(), body({ '99': [{ id: 'n0001', text: 'Late note' }] }), LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(r.staleReplies).toEqual(['502']);
    expect(r.answers['502'].notes).toBeUndefined();
    // Question 31 closed by TME: its stored note stays as it was, a change of it is ignored.
    const closedLines = [LINES[0], { ...LINES[1], questions: [LINES[1].questions![1]] }];
    const kept = { id: 'n0001', text: 'Kept', sentAt: T0, savedAt: T0 };
    const r2 = ok(applyCustomsAnswersUpdate(stored({ '31': [kept] }), body({ '31': [{ id: 'n0001', text: 'Changed' }] }), closedLines, NOW, ANNA, { answersSentAt: T1 }));
    expect(r2.staleReplies).toEqual(['502']);
    expect(r2.answers['502'].notes?.['31']).toEqual([kept]);
  });

  it('an UNSENT draft note of a question TME closed is removed on the next save; a sent one stays', () => {
    const closedLines = [LINES[0], { ...LINES[1], questions: [LINES[1].questions![1]] }];
    const sentNote = { id: 'n0001', text: 'Sent note', sentAt: T0, savedAt: T0 };
    const draft = { id: 'n0002', text: 'Draft note', sentAt: T2, savedAt: T2 };
    // A save of the line (page sends nothing for the closed question).
    const r = ok(applyCustomsAnswersUpdate(stored({ '31': [sentNote, draft] }, T2), body({}), closedLines, NOW, ANNA, { answersSentAt: T1 }));
    expect(r.answers['502'].notes?.['31']).toEqual([sentNote]);
    // A page from before notes (no `notes` key): same.
    const r2 = ok(applyCustomsAnswersUpdate(stored({ '31': [draft] }, T2), { '502': { parts: [FULL] } }, closedLines, NOW, ANNA, { answersSentAt: T1 }));
    expect(r2.answers['502'].notes).toBeUndefined();
  });

  it('dropClosedDraftNotes (Send): every line loses unsent drafts of closed questions, keeps its updatedAt; open ones untouched', () => {
    const closedLines = [LINES[0], { ...LINES[1], questions: [LINES[1].questions![1]] }];
    const sentNote = { id: 'n0001', text: 'Sent note', sentAt: T0, savedAt: T0 };
    const draft = { id: 'n0002', text: 'Draft note', sentAt: T2, savedAt: T2 };
    const openDraft = { id: 'n0003', text: 'Open draft', sentAt: T2, savedAt: T2 };
    const s = stored({ '31': [sentNote, draft], '32': [openDraft] }, T2);
    const r = dropClosedDraftNotes(s, closedLines, T1);
    expect(r.changed).toEqual(['502']);
    expect(r.answers['502'].notes).toEqual({ '31': [sentNote], '32': [openDraft] });
    expect(r.answers['502'].updatedAt).toBe(T2);
    expect(s['502'].notes?.['31']).toHaveLength(2); // input untouched
    // Nothing to drop = nothing changed.
    expect(dropClosedDraftNotes(s, LINES, T1).changed).toEqual([]);
    // No Send yet: every note is a draft.
    expect(dropClosedDraftNotes(stored({ '31': [draft] }, T2), closedLines, null).answers['502'].notes).toBeUndefined();
  });

  it('vatCustomsSendStamp: never before the last save; "+00:00" compared as an instant; ISO out', () => {
    expect(vatCustomsSendStamp(NOW, null)).toBe(NOW);
    expect(vatCustomsSendStamp(NOW, T2)).toBe(NOW);
    expect(vatCustomsSendStamp(NOW, '2026-10-11T12:00:00+00:00')).toBe(NOW);
    expect(vatCustomsSendStamp(NOW, '2026-10-11T12:00:01.5+00:00')).toBe('2026-10-11T12:00:01.500Z');
    expect(vatCustomsSendStamp(NOW, 'not a date')).toBe(NOW);
  });

  it('refusedReplyTexts: a typed change to a note the other tab already sent is kept (note key); same text / draft / empty are not', () => {
    const sentNote = { id: 'n0001', text: 'Sent note', sentAt: T2, savedAt: T2 };
    const draft = { id: 'n0002', text: 'Draft', sentAt: NOW, savedAt: NOW };
    const saved = stored({ '31': [sentNote, draft] }, NOW);
    const typed = {
      '502': {
        parts: [FULL],
        replies: { '31': 'Yes, samples' },
        notes: { '31': [{ id: 'n0001', text: 'Typed in tab B' }, { id: 'n0002', text: 'Other draft text' }] },
      },
    };
    expect(refusedReplyTexts(['502'], typed, saved, T3)).toEqual({ '502': { [refusedNoteKey('31', 'n0001')]: 'Typed in tab B' } });
    expect(isRefusedNoteKey(refusedNoteKey('31', 'n0001'))).toBe(true);
    expect(isRefusedNoteKey('31')).toBe(false);
    const same = { '502': { parts: [FULL], notes: { '31': [{ id: 'n0001', text: 'Sent note' }] } } };
    expect(refusedReplyTexts(['502'], same, saved, T3)).toEqual({});
    // Not in the locked list = nothing.
    expect(refusedReplyTexts([], typed, saved, T3)).toEqual({});
  });

  it(`at most ${VAT_CUSTOMS_MAX_NOTES_PER_QUESTION} notes per question: extra new notes are left out (staleReplies), the rest of the batch is saved; bad shapes are refused`, () => {
    const many = Array.from({ length: VAT_CUSTOMS_MAX_NOTES_PER_QUESTION + 1 }, (_, i) => ({ id: `n000${i}x`, text: `Note ${i}` }));
    // Another line in the same batch is saved as usual.
    const batch = { ...body({ '31': many }), '501': { parts: [FULL] } };
    const r = ok(applyCustomsAnswersUpdate(stored(), batch, LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(r.answers['502'].notes?.['31'].map((n) => n.text)).toEqual(many.slice(0, VAT_CUSTOMS_MAX_NOTES_PER_QUESTION).map((n) => n.text));
    expect(r.staleReplies).toEqual(['502']);
    expect(r.changed.sort()).toEqual(['501', '502']);
    // Ten stored sent notes + one new: the new one is left out, the line stays as it was.
    const ten = Array.from({ length: VAT_CUSTOMS_MAX_NOTES_PER_QUESTION }, (_, i) => ({ id: `s000${i}x`, text: `Sent ${i}`, savedAt: T0 }));
    const r2 = ok(applyCustomsAnswersUpdate(stored({ '31': ten }), body({ '31': [{ id: 'n0001', text: 'Eleventh' }] }), LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(r2.answers['502'].notes?.['31']).toEqual(ten);
    expect(r2.staleReplies).toEqual(['502']);
    expect(r2.changed).toEqual([]);
    // Far past the limit = not the page: refused.
    const flood = Array.from({ length: VAT_CUSTOMS_MAX_NOTES_PER_QUESTION * 5 + 1 }, (_, i) => ({ id: `f000${i}x`, text: 'x' }));
    expect(applyCustomsAnswersUpdate(stored(), body({ '31': flood }), LINES, NOW, ANNA, { answersSentAt: T1 })).toMatchObject({ ok: false, error: 'invalid_answer' });
    for (const bad of [[], 'x', { '31': 'text' }, { '31': [{ id: 'x', text: 'a' }] }, { '31': [{ id: 'n0001', text: 5 }] }, { '31': [{ id: 'n0001', text: 'a' }, { id: 'n0001', text: 'b' }] }]) {
      expect(applyCustomsAnswersUpdate(stored(), body(bad), LINES, NOW, ANNA, { answersSentAt: T1 })).toMatchObject({ ok: false, error: 'invalid_answer' });
    }
  });

  it('text is cut to the shared maximum (500)', () => {
    const r = ok(applyCustomsAnswersUpdate(stored(), body({ '31': [{ id: 'n0001', text: 'x'.repeat(900) }] }), LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(r.answers['502'].notes?.['31']?.[0].text).toHaveLength(500);
  });

  it('a page from before notes (no `notes` key) keeps every stored note', () => {
    const draft = { id: 'n0001', text: 'Draft', sentAt: T2, savedAt: T2 };
    const r = ok(applyCustomsAnswersUpdate(stored({ '31': [draft] }, T2), { '502': { parts: [FULL], replies: { '31': 'Yes, samples' } } }, LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(r.changed).toEqual([]);
    expect(r.answers['502'].notes?.['31']).toEqual([draft]);
  });

  it('the conflict rule covers notes: a note saved by someone else since the page loaded the line refuses the line', () => {
    const s = stored({ '31': [{ id: 'n0001', text: 'Bob wrote this', sentAt: T2, sentBy: 'bob@client.com', savedAt: T2 }] }, T2);
    s['502'].savedBy = 'bob@client.com';
    expect(customsLineConflict(T0, s['502'], ANNA)).toBe(true);
    const r = ok(applyCustomsAnswersUpdate(s, body({ '31': [{ id: 'n0002', text: 'Anna wrote this' }] }, { baseUpdatedAt: T0 }), LINES, NOW, ANNA, { answersSentAt: T1 }));
    expect(Object.keys(r.conflicts)).toEqual(['502']);
    expect(r.changed).toEqual([]);
    expect(r.answers['502'].notes?.['31']?.map((n) => n.text)).toEqual(['Bob wrote this']);
    // With the right base (after a reload) it goes through: Anna sends both notes she sees.
    const r2 = ok(
      applyCustomsAnswersUpdate(s, body({ '31': [{ id: 'n0001', text: 'Bob wrote this' }, { id: 'n0002', text: 'Anna wrote this' }] }, { baseUpdatedAt: T2 }), LINES, NOW, ANNA, { answersSentAt: T1 })
    );
    expect(r2.changed).toEqual(['502']);
    expect(r2.answers['502'].notes?.['31']?.map((n) => n.text)).toEqual(['Bob wrote this', 'Anna wrote this']);
  });

  it('a note alone changes the line (customsLineSavedAs sees notes; describeLineAnswer names them)', () => {
    const s = stored({ '31': [{ id: 'n0001', text: 'Note A', savedAt: T2 }] }, T2)['502'];
    expect(customsLineSavedAs(LINES[1], { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': [{ id: 'n0001', text: 'Note A' }] } }, s)).toBe(true);
    expect(customsLineSavedAs(LINES[1], { parts: [FULL], replies: { '31': 'Yes, samples' }, notes: { '31': [{ id: 'n0001', text: 'Note B' }] } }, s)).toBe(false);
    expect(describeLineAnswer(s)).toContain('Note: "Note A"');
  });
});

function row(over: Partial<VatFileRequestRow> = {}): VatFileRequestRow {
  return {
    id: 'r1',
    link_token: 'TokenAbcdefghij0123456789',
    environment: 'sandbox',
    portal_filing_id: 7,
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
    created_at: T0,
    updated_at: T0,
    expires_at: null,
    customs_lines: LINES,
    ...over,
  };
}

describe('page data and version', () => {
  it('the version hash covers notes; the payload carries them (no savedBy)', () => {
    const without = row({ customs_answers: stored(undefined, T2), customs_answers_sent_at: T1 });
    const withNote = row({ customs_answers: stored({ '31': [{ id: 'n0001', text: 'A note', savedAt: T2 }] }, T2), customs_answers_sent_at: T1 });
    const other = row({ customs_answers: stored({ '31': [{ id: 'n0001', text: 'Another note', savedAt: T2 }] }, T2), customs_answers_sent_at: T1 });
    const v = (r: VatFileRequestRow) => vatFilesPageVersion(scrubVatFilesRow(r));
    expect(v(withNote)).not.toBe(v(without));
    expect(v(other)).not.toBe(v(withNote));
    // "+00:00" vs "Z" on the note stamp is the same version.
    const pg = row({ customs_answers: stored({ '31': [{ id: 'n0001', text: 'A note', savedAt: '2026-10-11T10:00:00+00:00' }] }, T2), customs_answers_sent_at: T1 });
    expect(v(pg)).toBe(v(withNote));
    const payload = scrubVatFilesRow(withNote);
    expect(payload.customsAnswers['502'].notes?.['31']?.[0].text).toBe('A note');
    expect(JSON.stringify(payload)).not.toContain('savedBy');
  });

  it('names: a note author is named for a confirmed viewer only', () => {
    const p = scrubVatFilesRow(row({ customs_answers: stored({ '31': [{ id: 'n0001', text: 'N', sentBy: 'bob@client.com', savedAt: T2 }] }, T2) }));
    const names = { 'bob@client.com': 'Bob Stone', [ANNA]: 'Anna Keller', 'carl@client.com': 'Carl' };
    expect(vatFilesPeopleNames(names, p, 'carl@client.com')).toEqual({ 'carl@client.com': 'Carl', 'bob@client.com': 'Bob Stone', [ANNA]: 'Anna Keller' });
    expect(vatFilesPeopleNames(names, p, null)).toEqual({});
  });
});

describe('page helpers', () => {
  it('initial answers carry the notes of open questions; a reload keeps typed notes', () => {
    const saved = stored({ '31': [{ id: 'n0001', text: 'N', savedAt: T2 }], '77': [{ id: 'n0002', text: 'old', savedAt: T0 }] }, T2);
    const a = initialPageAnswers(LINES, saved);
    expect(Object.keys(a['502'].notes ?? {})).toEqual(['31']);
    const typed = { ...a, '502': { ...a['502'], notes: { '31': [{ id: 'n0001', text: 'N' }, { id: 'n0009', text: 'typed' }] } } };
    const r = reconcileAfterReload(typed, ['502'], LINES, saved);
    expect(r.answers['502'].notes?.['31']?.map((n) => n.id)).toEqual(['n0001', 'n0009']);
  });

  it('shownCustomsNotes: sent ones first as stored; then drafts as typed, who / when only while the text is the saved one', () => {
    const saved = [
      { id: 'n0001', text: 'Sent one', sentBy: ANNA, savedAt: T0 },
      { id: 'n0002', text: 'Draft', sentBy: ANNA, savedAt: T2 },
    ];
    const shown = shownCustomsNotes([{ id: 'n0001', text: 'Sent one' }, { id: 'n0002', text: 'Draft' }, { id: 'n0003', text: 'New' }], saved, T2, T1);
    expect(shown.map((n) => [n.id, n.sent, !!n.meta])).toEqual([
      ['n0001', true, true],
      ['n0002', false, true],
      ['n0003', false, false],
    ]);
    const editing = shownCustomsNotes([{ id: 'n0002', text: 'Draft, typing' }], saved, T2, T1);
    expect(editing.map((n) => [n.id, n.text, n.sent, !!n.meta])).toEqual([
      ['n0001', 'Sent one', true, true],
      ['n0002', 'Draft, typing', false, false],
    ]);
    // No Send yet: nothing is sent.
    expect(shownCustomsNotes(undefined, saved, T2, null)).toEqual([]);
  });

  it('withSavedReplyMeta takes the stored notes of a saved line; {} removes them', () => {
    const current = stored({ '31': [{ id: 'n0001', text: 'old', savedAt: T2 }] }, T2);
    const note = { id: 'n0001', text: 'new', savedAt: NOW };
    const next = withSavedReplyMeta(current, { '502': { parts: [FULL] } }, { '502': {} }, { '502': { '31': [note] } });
    expect(next['502'].notes).toEqual({ '31': [note] });
    expect(withSavedReplyMeta(current, { '502': { parts: [FULL] } }, { '502': {} }, { '502': {} })['502'].notes).toBeUndefined();
    // No notes given (an older server): the line keeps what it had.
    expect(withSavedReplyMeta(current, { '502': { parts: [FULL] } }, { '502': {} })['502'].notes).toEqual(current['502'].notes);
  });
});
