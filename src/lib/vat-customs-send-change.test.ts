import { describe, it, expect } from 'vitest';
import {
  applyCustomsAnswersUpdate,
  customsAnswerContentKey,
  customsLinesToSave,
  customsPageHasUnsent,
  customsPageSavedKeys,
  customsSentKey,
  customsUnsentLineIds,
  withCustomsSentKeys,
} from './vat-customs';
import { vatFilesSendResult } from './vat-files';
import type { VatCustomsAnswers, VatCustomsLineAnswer, VatCustomsPageLine } from '@/types/vat-files';

// 11.10: the Send button is active only when the content really differs from
// what was last sent: never because a box was opened, typed in and emptied.

const LINE: VatCustomsPageLine = {
  id: 502,
  lineNo: 2,
  declarationDate: '2026-08-19',
  declarationNo: '1010146613726',
  transactionRefNo: '6507604297',
  totalValue: 6472.57,
  totalVat: 323.63,
  hasBoe: false,
  hasInvoice: false,
  answer: null,
  questions: [{ id: 31, text: 'Samples?', askedAt: '2026-10-10T08:00:00Z' }],
} as VatCustomsPageLine;
const LINES = [LINE];
const FULL = { purpose: 'sale_stock', payment: 'paid', incoterm: 'CIF', delivery: 'dubai_port_dz' } as const;
const SENT_AT = '2026-10-11T09:00:00.000Z';

/** What the server holds after a Send: a sent reply, its sentKey stamped. */
function sentStored(): VatCustomsAnswers {
  const a: VatCustomsLineAnswer = {
    parts: [{ ...FULL }],
    replies: { '31': 'Yes, samples' },
    replyMeta: { '31': { sentAt: '2026-10-11T08:59:00.000Z', savedAt: '2026-10-11T08:59:00.000Z' } },
    updatedAt: '2026-10-11T08:59:00.000Z',
  };
  return withCustomsSentKeys({ '502': a });
}

/** The page right after loading `stored`. */
function pageAt(stored: VatCustomsAnswers) {
  const savedKeys = customsPageSavedKeys(LINES, stored);
  const serverUnsent = customsUnsentLineIds(stored, SENT_AT);
  const shown = (answers: VatCustomsAnswers) => customsPageHasUnsent({ lines: LINES, answers, savedKeys, serverUnsent });
  return { savedKeys, serverUnsent, shown };
}

const withNotes = (notes: VatCustomsLineAnswer['notes']): VatCustomsAnswers => {
  const a = sentStored()['502'];
  return { '502': { parts: a.parts, replies: a.replies, ...(notes ? { notes } : {}) } };
};

describe('11.10: the page Send button compares content', () => {
  it('nothing touched after a Send: nothing to send', () => {
    const { shown, serverUnsent } = pageAt(sentStored());
    expect(serverUnsent).toEqual([]);
    expect(shown(withNotes(undefined))).toBe(false);
  });

  it('"Add a note" opened and closed again (no note, or an empty list left behind): nothing to send', () => {
    const { shown } = pageAt(sentStored());
    expect(shown(withNotes({}))).toBe(false);
    expect(shown(withNotes({ '31': [] }))).toBe(false);
  });

  it('typed into a note and deleted it again (the empty note stays in the list): nothing to send', () => {
    const { shown } = pageAt(sentStored());
    expect(shown(withNotes({ '31': [{ id: 'note-abc1', text: '' }] }))).toBe(false);
  });

  it('whitespace only in a note, a reply or a text field: nothing to send', () => {
    const { shown } = pageAt(sentStored());
    expect(shown(withNotes({ '31': [{ id: 'note-abc1', text: '   \n ' }] }))).toBe(false);
    expect(shown({ '502': { parts: [{ ...FULL, invoiceRef: '  ' }], replies: { '31': '  Yes, samples ' } } })).toBe(false);
  });

  it('purpose chosen and cleared again, a split nobody filled in: nothing to send', () => {
    const { shown } = pageAt({});
    expect(shown({ '502': { parts: [{}] } })).toBe(false);
    expect(shown({ '502': { parts: [{ purpose: undefined, invoiceRef: '' }, {}] } })).toBe(false);
  });

  it('a real change enables Send: a note with text, a changed field, a new reply', () => {
    const { shown } = pageAt(sentStored());
    expect(shown(withNotes({ '31': [{ id: 'note-abc1', text: 'Also: two cartons.' }] }))).toBe(true);
    expect(shown({ '502': { parts: [{ ...FULL, payment: 'foc' }], replies: { '31': 'Yes, samples' } } })).toBe(true);
    expect(pageAt({}).shown({ '502': { parts: [], replies: { '31': 'No' } } })).toBe(true);
  });

  it('a draft saved on the server that differs from what was sent stays unsent (also after a reload)', () => {
    const stored = sentStored();
    stored['502'] = { ...stored['502'], notes: { '31': [{ id: 'note-abc1', text: 'More', savedAt: '2026-10-11T09:10:00.000Z' }] }, updatedAt: '2026-10-11T09:10:00.000Z' };
    const { serverUnsent, shown } = pageAt(stored);
    expect(serverUnsent).toEqual(['502']);
    expect(shown(customsPageAnswers(stored))).toBe(true);
  });

  it('a draft saved and taken out again (the line saved twice after the Send): not unsent, stamps ignored', () => {
    const stored = sentStored();
    // Two autosaves later the content is the sent one again; only updatedAt / meta moved.
    stored['502'] = { ...stored['502'], updatedAt: '2026-10-11T09:20:00.000Z' };
    expect(customsUnsentLineIds(stored, SENT_AT)).toEqual([]);
  });
});

/** The answers the page shows for stored answers (savedKeys are built from the same). */
function customsPageAnswers(stored: VatCustomsAnswers): VatCustomsAnswers {
  const keys = customsPageSavedKeys(LINES, stored);
  expect(Object.keys(keys)).toEqual(['502']);
  return { '502': { parts: stored['502'].parts, replies: stored['502'].replies, notes: stored['502'].notes } };
}

describe('11.10: customsUnsentLineIds (server and page alike)', () => {
  it('no Send yet: a line with content is unsent, an empty one is not', () => {
    expect(customsUnsentLineIds({ '1': { parts: [{ ...FULL }] }, '2': { parts: [{}], updatedAt: SENT_AT } }, null)).toEqual(['1']);
  });

  it('a Send from before sentKey: the old stamp rule (saved after the Send = unsent)', () => {
    const answers: VatCustomsAnswers = {
      '1': { parts: [{ ...FULL }], updatedAt: '2026-10-11T08:00:00.000Z' },
      '2': { parts: [{ ...FULL }], updatedAt: '2026-10-11T10:00:00.000Z' },
    };
    expect(customsUnsentLineIds(answers, SENT_AT)).toEqual(['2']);
  });

  it('after a Send with sentKeys, a new line without one counts from "nothing"', () => {
    const answers: VatCustomsAnswers = {
      ...sentStored(),
      '7': { parts: [{}], updatedAt: '2026-10-11T10:00:00.000Z' },
      '8': { parts: [{ purpose: 'sale_stock' }], updatedAt: '2026-10-11T10:00:00.000Z' },
    };
    expect(customsUnsentLineIds(answers, SENT_AT)).toEqual(['8']);
  });

  it('the key ignores stamps and cleans texts like the server', () => {
    const a: VatCustomsLineAnswer = { parts: [{ ...FULL, invoiceRef: ' INV-1 ' }], replies: { '31': 'Yes ' } };
    const b: VatCustomsLineAnswer = { parts: [{ ...FULL, invoiceRef: 'INV-1' }, {}], replies: { '31': 'Yes', '32': ' ' }, updatedAt: SENT_AT, savedBy: 'x@y.com' };
    expect(customsAnswerContentKey(a)).toBe(customsAnswerContentKey(b));
    expect(customsSentKey(a)).toBe(customsSentKey(b));
    expect(customsSentKey(a)).toMatch(/^[0-9a-f]{14}$/);
  });
});

describe('11.10: customsLinesToSave (no write when nothing changed)', () => {
  it('a line marked changed whose content is what the server holds is not saved', () => {
    const { savedKeys } = pageAt(sentStored());
    expect(customsLinesToSave(['502'], withNotes({ '31': [{ id: 'note-abc1', text: ' ' }] }), savedKeys)).toEqual([]);
  });

  it('a real change is saved; a line of a save that got no answer is saved anyway', () => {
    const { savedKeys } = pageAt(sentStored());
    expect(customsLinesToSave(['502'], withNotes({ '31': [{ id: 'note-abc1', text: 'More' }] }), savedKeys)).toEqual(['502']);
    expect(customsLinesToSave(['502'], withNotes(undefined), savedKeys, new Set(['502']))).toEqual(['502']);
  });
});

// 11.10 review: TME's newer answer is what the page shows. A client undoing
// TME's correction (back to their stored answer, or clearing a line TME
// filled) is a real change: written, wins on reload, and Send turns on.
describe('11.10 review: changes over TME\'s newer answer', () => {
  const A = { ...FULL, invoiceRef: 'INV-A' };
  const B = { ...FULL, invoiceRef: 'INV-B' };
  const NOW = '2026-10-11T12:00:00.000Z';
  const tmeLine = (answer: VatCustomsLineAnswer | null): VatCustomsPageLine => ({ ...LINE, answer });
  // Supabase spelling ("+00:00"), later than the client's stored answer.
  const TME_B: VatCustomsLineAnswer = { parts: [{ ...B }], updatedAt: '2026-10-11T10:00:00+00:00' };

  function save(stored: VatCustomsAnswers, line: VatCustomsPageLine, pageAnswer: VatCustomsLineAnswer) {
    const lines = [line];
    const savedKeys = customsPageSavedKeys(lines, stored);
    const toSave = customsLinesToSave(['502'], { '502': pageAnswer }, savedKeys);
    const update = applyCustomsAnswersUpdate(
      stored,
      toSave.length ? { '502': { ...pageAnswer, baseUpdatedAt: stored['502']?.updatedAt ?? null } } : {},
      lines,
      NOW,
      null,
      { answersSentAt: SENT_AT }
    );
    if (!update.ok) throw new Error(update.error);
    return { toSave, update, lines };
  }

  it('client restores their stored A over TME\'s newer B: written, beats B on reload, counts as unsent', () => {
    const stored = withCustomsSentKeys({ '502': { parts: [{ ...A }], updatedAt: '2026-10-11T08:00:00.000Z' } });
    const line = tmeLine(TME_B);
    expect(customsPageSavedKeys([line], stored)['502']).toBe(customsAnswerContentKey({ parts: [{ ...B }] }));
    const { toSave, update, lines } = save(stored, line, { parts: [{ ...A }] });
    expect(toSave).toEqual(['502']);
    expect(update.changed).toEqual(['502']);
    expect(update.answers['502'].updatedAt).toBe(NOW);
    expect(customsUnsentLineIds(update.answers, SENT_AT)).toEqual(['502']);
    // On reload the page shows A, and holds A as saved (page and server agree).
    expect(customsPageSavedKeys(lines, update.answers)['502']).toBe(customsAnswerContentKey({ parts: [{ ...A }] }));
    // The Send stamps it; afterwards nothing is unsent.
    expect(customsUnsentLineIds(withCustomsSentKeys(update.answers), NOW)).toEqual([]);
  });

  it('client clears a line TME filled (never saved by the client): an empty answer is stored and wins', () => {
    const line = tmeLine(TME_B);
    const { toSave, update, lines } = save({}, line, { parts: [] });
    expect(toSave).toEqual(['502']);
    expect(update.changed).toEqual(['502']);
    expect(update.answers['502']).toMatchObject({ parts: [], updatedAt: NOW });
    expect(customsUnsentLineIds(update.answers, SENT_AT)).toEqual(['502']);
    expect(customsPageSavedKeys(lines, update.answers)['502']).toBe(customsAnswerContentKey(null));
  });

  it('client agrees with TME\'s B (no edit): nothing to save, the server writes nothing', () => {
    const stored = withCustomsSentKeys({ '502': { parts: [{ ...A }], updatedAt: '2026-10-11T08:00:00.000Z' } });
    const { toSave, update } = save(stored, tmeLine(TME_B), { parts: [{ ...B }] });
    expect(toSave).toEqual([]);
    expect(update.changed).toEqual([]);
    // Even when such a line arrives (an older page), the server writes nothing.
    const direct = applyCustomsAnswersUpdate(stored, { '502': { parts: [{ ...B }] } }, [tmeLine(TME_B)], NOW, null, {
      answersSentAt: SENT_AT,
    });
    expect(direct.ok && direct.changed).toEqual([]);
  });

  it('TME\'s answer older than the client\'s: compared with the client\'s stored answer, as before', () => {
    const stored = withCustomsSentKeys({ '502': { parts: [{ ...A }], updatedAt: '2026-10-11T11:00:00.000Z' } });
    const { toSave, update } = save(stored, tmeLine(TME_B), { parts: [{ ...A }] });
    expect(toSave).toEqual([]);
    expect(update.changed).toEqual([]);
  });
});

describe('11.10 review: the confirmation follows what the server sent', () => {
  it('answers stamped: thank-you page with answers', () => {
    expect(vatFilesSendResult({ answersSent: true, filesSent: 0, locked: false })).toEqual({ stay: false, answersSent: true });
  });
  it('files only (the page thought answers were unsent, the server stamped none): files only', () => {
    expect(vatFilesSendResult({ answersSent: false, filesSent: 2, locked: false })).toEqual({ stay: false, answersSent: false });
  });
  it('nothing stamped, no files: stay with "Nothing new to send."', () => {
    expect(vatFilesSendResult({ answersSent: false, filesSent: 0, locked: false })).toEqual({
      stay: true,
      reason: 'nothing_new',
      message: 'Nothing new to send.',
    });
  });
  it('only a locked reply changed: stay, the locked note is the message', () => {
    expect(vatFilesSendResult({ answersSent: false, filesSent: 0, locked: true })).toEqual({ stay: true, reason: 'locked', message: null });
  });
});
