import { describe, it, expect } from 'vitest';
import {
  applyCustomsAnswersUpdate,
  canonicalIso,
  customsLineConflict,
  customsLineSavedAs,
  refusedReplyTexts,
  mergeLineAnswer,
  sameInstant,
  describeLineAnswer,
  replyStatusLine,
  sentRepliesByLine,
} from './vat-customs';
import {
  scrubVatFilesRow,
  vatFilesChangeInfo,
  vatFilesChangeNotice,
  vatFilesConflictsForPage,
  vatFilesLastClientChange,
  vatFilesPageVersion,
  vatFilesViewerPayload,
} from './vat-files';
import { isVatCustomsReplySent, type VatCustomsPageLine, type VatFileRequestRow } from '@/types/vat-files';

// Round 5 (11.10.2026): a reply is read-only after Send; two people on one page.

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
const T2 = '2026-10-11T10:00:00.000Z'; // later save
const NOW = '2026-10-11T12:00:00.000Z';

/** Line 502 with a reply to question 31 saved at `savedAt`. */
function storedReply(savedAt: string, by = 'anna@client.com') {
  return {
    '502': {
      parts: [FULL],
      replies: { '31': 'Yes, samples' },
      replyMeta: { '31': { sentAt: savedAt, sentBy: by, savedAt } },
      updatedAt: savedAt,
      savedBy: by,
    },
  };
}

describe('isVatCustomsReplySent', () => {
  it('no Send yet = a draft', () => {
    expect(isVatCustomsReplySent({ savedAt: T0 }, T0, null)).toBe(false);
  });
  it('saved before (or with) the last Send = sent; saved after it = still a draft', () => {
    expect(isVatCustomsReplySent({ savedAt: T0 }, T0, T1)).toBe(true);
    expect(isVatCustomsReplySent({ savedAt: T1 }, T1, T1)).toBe(true);
    expect(isVatCustomsReplySent({ sentAt: T0, savedAt: T2 }, T2, T1)).toBe(false);
  });
  it('older rows: no savedAt -> the version stamp, then the line updatedAt; no stamp at all = sent', () => {
    expect(isVatCustomsReplySent({ sentAt: T0 }, T2, T1)).toBe(true);
    expect(isVatCustomsReplySent(undefined, T0, T1)).toBe(true);
    expect(isVatCustomsReplySent(undefined, T2, T1)).toBe(false);
    expect(isVatCustomsReplySent(undefined, undefined, T1)).toBe(true);
  });
});

describe('server: a sent reply is locked', () => {
  it('a change to a sent reply is refused: the sent text stays, the line is named, nothing changes', () => {
    const r = applyCustomsAnswersUpdate(
      storedReply(T0),
      { '502': { parts: [FULL], replies: { '31': 'No, for sale' } } },
      LINES,
      NOW,
      'anna@client.com',
      { answersSentAt: T1 }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lockedReplies).toEqual(['502']);
    expect(r.changed).toEqual([]);
    expect(r.answers['502'].replies).toEqual({ '31': 'Yes, samples' });
  });

  it('clearing a sent reply is refused too', () => {
    const r = applyCustomsAnswersUpdate(storedReply(T0), { '502': { parts: [FULL] } }, LINES, NOW, null, { answersSentAt: T1 });
    if (!r.ok) throw new Error('not ok');
    expect(r.lockedReplies).toEqual(['502']);
    expect(r.answers['502'].replies).toEqual({ '31': 'Yes, samples' });
  });

  it('other fields of the line stay editable; the sent reply keeps its text and who / when', () => {
    const r = applyCustomsAnswersUpdate(
      storedReply(T0),
      { '502': { parts: [{ ...FULL, payment: 'foc' }], replies: { '31': 'Yes, samples' } } },
      LINES,
      NOW,
      'anna@client.com',
      { answersSentAt: T1 }
    );
    if (!r.ok) throw new Error('not ok');
    expect(r.lockedReplies).toEqual([]);
    expect(r.changed).toEqual(['502']);
    expect(r.answers['502'].parts[0].payment).toBe('foc');
    expect(r.answers['502'].replyMeta?.['31']).toEqual({ sentAt: T0, sentBy: 'anna@client.com', savedAt: T0 });
  });

  it('a reply saved after the last Send (not sent yet) stays editable', () => {
    const r = applyCustomsAnswersUpdate(
      storedReply(T2),
      { '502': { parts: [FULL], replies: { '31': 'No, for sale' } } },
      LINES,
      '2026-10-11T10:05:00.000Z',
      'anna@client.com',
      { answersSentAt: T1 }
    );
    if (!r.ok) throw new Error('not ok');
    expect(r.lockedReplies).toEqual([]);
    expect(r.answers['502'].replies).toEqual({ '31': 'No, for sale' });
  });

  it('a NEW question on the same line (follow-up) can be answered while the first reply is locked', () => {
    const r = applyCustomsAnswersUpdate(
      storedReply(T0),
      { '502': { parts: [FULL], replies: { '31': 'Yes, samples', '32': 'We paid' } } },
      LINES,
      NOW,
      'anna@client.com',
      { answersSentAt: T1 }
    );
    if (!r.ok) throw new Error('not ok');
    expect(r.lockedReplies).toEqual([]);
    expect(r.answers['502'].replies).toEqual({ '31': 'Yes, samples', '32': 'We paid' });
    expect(r.answers['502'].replyMeta?.['32']).toMatchObject({ sentAt: NOW, sentBy: 'anna@client.com' });
  });

  it('without the Send stamp (old callers) nothing is locked', () => {
    const r = applyCustomsAnswersUpdate(storedReply(T0), { '502': { parts: [FULL], replies: { '31': 'Changed' } } }, LINES, NOW, null);
    if (!r.ok) throw new Error('not ok');
    expect(r.answers['502'].replies).toEqual({ '31': 'Changed' });
  });
});

describe('server: conflicts (two people on one page)', () => {
  const stored = { '501': { parts: [FULL], updatedAt: T1, savedBy: 'bob@client.com' } };
  const mine = { parts: [{ ...FULL, payment: 'foc' }] };

  it('the rule', () => {
    expect(customsLineConflict(undefined, stored['501'], null)).toBe(false); // old page: no base sent
    expect(customsLineConflict(T1, stored['501'], null)).toBe(false); // same base
    expect(customsLineConflict(T0, stored['501'], 'anna@client.com')).toBe(true); // somebody else
    expect(customsLineConflict(T0, stored['501'], 'bob@client.com')).toBe(false); // same person, two tabs
    expect(customsLineConflict(T0, stored['501'], null)).toBe(true); // switch off: a different stamp is enough
    expect(customsLineConflict(T0, { parts: [], updatedAt: T1 }, 'anna@client.com')).toBe(true); // who unknown
    expect(customsLineConflict(null, stored['501'], 'anna@client.com')).toBe(true); // loaded empty, now filled
    expect(customsLineConflict(null, undefined, null)).toBe(false);
  });

  it('another person saved the line since the page loaded it: refused, the other lines are saved', () => {
    const r = applyCustomsAnswersUpdate(
      stored,
      { '501': { ...mine, baseUpdatedAt: T0 }, '502': { parts: [FULL], baseUpdatedAt: null } },
      LINES,
      NOW,
      'anna@client.com'
    );
    if (!r.ok) throw new Error('not ok');
    expect(Object.keys(r.conflicts)).toEqual(['501']);
    expect(r.conflicts['501']).toMatchObject({ at: T1, savedBy: 'bob@client.com', answer: { parts: [FULL] } });
    expect(r.changed).toEqual(['502']);
    expect(r.answers['501'].parts).toEqual([FULL]);
    expect(r.bases).toEqual({ '502': NOW });
  });

  it('the same person (another tab): last one wins, as before', () => {
    const r = applyCustomsAnswersUpdate(stored, { '501': { ...mine, baseUpdatedAt: T0 } }, LINES, NOW, 'bob@client.com');
    if (!r.ok) throw new Error('not ok');
    expect(r.conflicts).toEqual({});
    expect(r.answers['501'].parts[0].payment).toBe('foc');
  });

  it('switch off (no address on either side): a different stamp is a conflict; the right base saves', () => {
    const anon = { '501': { parts: [FULL], updatedAt: T1 } };
    const refused = applyCustomsAnswersUpdate(anon, { '501': { ...mine, baseUpdatedAt: T0 } }, LINES, NOW, null);
    if (!refused.ok) throw new Error('not ok');
    expect(Object.keys(refused.conflicts)).toEqual(['501']);
    const ok = applyCustomsAnswersUpdate(anon, { '501': { ...mine, baseUpdatedAt: T1 } }, LINES, NOW, null);
    if (!ok.ok) throw new Error('not ok');
    expect(ok.conflicts).toEqual({});
    expect(ok.bases).toEqual({ '501': NOW });
  });

  it('the same text as stored is never a conflict (a retried save)', () => {
    const r = applyCustomsAnswersUpdate(stored, { '501': { parts: [FULL], baseUpdatedAt: T0 } }, LINES, NOW, null);
    if (!r.ok) throw new Error('not ok');
    expect(r.conflicts).toEqual({});
    expect(r.bases).toEqual({ '501': T1 });
  });

  it('for the page: never savedBy; who only for a code-confirmed viewer', () => {
    const r = applyCustomsAnswersUpdate(stored, { '501': { ...mine, baseUpdatedAt: T0 } }, LINES, NOW, 'anna@client.com');
    if (!r.ok) throw new Error('not ok');
    const names = { 'bob@client.com': 'Bob Stone', 'carl@client.com': 'Carl Other' };
    const confirmed = vatFilesConflictsForPage(r.conflicts, 'anna@client.com', names);
    expect(confirmed['501']).toEqual({ answer: { parts: [FULL], updatedAt: T1 }, at: T1, by: 'bob@client.com', byName: 'Bob Stone' });
    const anonymous = vatFilesConflictsForPage(r.conflicts, null, names);
    expect(anonymous['501'].by).toBeNull();
    expect(anonymous['501'].byName).toBeNull();
    expect(JSON.stringify(anonymous)).not.toContain('bob@');
    expect(JSON.stringify(confirmed)).not.toContain('savedBy');
    expect(JSON.stringify(confirmed)).not.toContain('Carl');
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

describe('the version (what the page shows)', () => {
  it('the same data in another key order gives the same version; a client save changes it', () => {
    const a = row({ customs_answers: { '501': { parts: [FULL], updatedAt: T1 } } });
    const b = row({ customs_answers: { '501': { updatedAt: T1, parts: [{ delivery: 'dubai_port_dz', incoterm: 'CIF', payment: 'paid', purpose: 'sale_stock' }] } } });
    expect(vatFilesPageVersion(scrubVatFilesRow(a))).toBe(vatFilesPageVersion(scrubVatFilesRow(b)));
    const c = row({ customs_answers: { '501': { parts: [FULL], updatedAt: T2 } } });
    expect(vatFilesPageVersion(scrubVatFilesRow(c))).not.toBe(vatFilesPageVersion(scrubVatFilesRow(a)));
  });

  it('the portal re-writing ticks / stamps is no change; a new question or a closed link is', () => {
    const base = vatFilesPageVersion(scrubVatFilesRow(row()));
    const ticks = row({ customs_lines: LINES.map((l) => ({ ...l, hasBoe: true })), updated_at: T2 });
    expect(vatFilesPageVersion(scrubVatFilesRow(ticks))).toBe(base);
    const asked = row({ customs_lines: [LINES[0], { ...LINES[1], questions: [...(LINES[1].questions ?? []), { id: 33, text: 'And the freight?', askedAt: T2 }] }] });
    expect(vatFilesPageVersion(scrubVatFilesRow(asked))).not.toBe(base);
    expect(vatFilesPageVersion(scrubVatFilesRow(row({ status: 'closed' })))).not.toBe(base);
  });

  it('the payload carries version + clientChangedAt', () => {
    const p = vatFilesViewerPayload(row({ customs_answers_saved_at: T1, customs_answers: { '501': { parts: [FULL], updatedAt: T1 } } }), null);
    expect(p.version).toBe(vatFilesPageVersion(p));
    expect(p.clientChangedAt).toBe(T1);
  });

  it('the last client change: the later of autosave and Send, with who', () => {
    expect(vatFilesLastClientChange(row())).toEqual({ at: null, by: null });
    const saved = row({ customs_answers_saved_at: T2, last_submitted_at: T1, last_submitted_by: 'anna@client.com', customs_answers: { '501': { parts: [FULL], updatedAt: T2, savedBy: 'bob@client.com' } } });
    expect(vatFilesLastClientChange(saved)).toEqual({ at: T2, by: 'bob@client.com' });
    const sent = row({ customs_answers_saved_at: T1, last_submitted_at: T2, last_submitted_by: 'anna@client.com' });
    expect(vatFilesLastClientChange(sent)).toEqual({ at: T2, by: 'anna@client.com' });
  });
});

describe('the poll answer respects the privacy rules', () => {
  const changed = row({
    updated_at: T2,
    customs_answers_saved_at: T2,
    customs_answers: { '501': { parts: [FULL], updatedAt: T2, savedBy: 'bob@client.com' } },
    allowed_names: { 'bob@client.com': 'Benedikt Klingler', 'carl@client.com': 'Carl Other' },
  });

  it('no code (switch off): no address, no name', () => {
    const info = vatFilesChangeInfo(changed, null, T1);
    expect(info).toMatchObject({ source: 'client', at: T2, by: null, byName: null, self: false });
    expect(JSON.stringify(info)).not.toContain('bob@');
    expect(JSON.stringify(info)).not.toContain('Benedikt');
  });

  it('a confirmed viewer: who changed it, with the contact name; nobody else', () => {
    const info = vatFilesChangeInfo(changed, 'anna@client.com', T1);
    expect(info).toMatchObject({ source: 'client', by: 'bob@client.com', byName: 'Benedikt Klingler', self: false });
    expect(JSON.stringify(info)).not.toContain('Carl');
  });

  it('the same person in another tab = self', () => {
    expect(vatFilesChangeInfo(changed, 'bob@client.com', T1).self).toBe(true);
  });

  it('no client change after `since` = TME (the portal), at its updated_at', () => {
    const info = vatFilesChangeInfo({ ...changed, updated_at: '2026-10-11T11:00:00.000Z' }, 'anna@client.com', T2);
    expect(info).toMatchObject({ source: 'tme', at: '2026-10-11T11:00:00.000Z', by: null, byName: null });
  });
});

describe('the page decides: note or not', () => {
  const change = { version: 'v2', status: 'open' as const, source: 'client' as const, at: '2026-10-11T13:10:00.000Z', by: null, byName: null, self: false };

  it('own saves never show it', () => {
    expect(vatFilesChangeNotice({ knownVersion: 'v2', pageStatus: 'open', change })).toBeNull();
    expect(vatFilesChangeNotice({ knownVersion: 'v1', ownVersions: ['v0', 'v2'], pageStatus: 'open', change })).toBeNull();
  });

  it('someone else: the name for a confirmed viewer, else "Someone else"; Dubai time', () => {
    expect(vatFilesChangeNotice({ knownVersion: 'v1', pageStatus: 'open', change })).toBe('Someone else changed the table at 17:10.');
    expect(
      vatFilesChangeNotice({ knownVersion: 'v1', pageStatus: 'open', change: { ...change, by: 'b@x.com', byName: 'Benedikt Klingler' } })
    ).toBe('Benedikt Klingler changed the table at 17:10.');
    expect(vatFilesChangeNotice({ knownVersion: 'v1', pageStatus: 'open', change: { ...change, by: 'b@x.com' } })).toBe(
      'b@x.com changed the table at 17:10.'
    );
    expect(vatFilesChangeNotice({ knownVersion: 'v1', pageStatus: 'open', change: { ...change, by: 'a@x.com', self: true } })).toBe(
      'You changed the table in another window at 17:10.'
    );
  });

  it('TME: updated, or closed the request (closed always shows)', () => {
    expect(vatFilesChangeNotice({ knownVersion: 'v1', pageStatus: 'open', change: { ...change, source: 'tme' } })).toBe(
      'TME updated the table at 17:10.'
    );
    expect(vatFilesChangeNotice({ knownVersion: 'v2', pageStatus: 'open', change: { ...change, status: 'closed', source: 'tme' } })).toBe(
      'TME closed this request at 17:10.'
    );
  });

  it('no version known (older server) = no note', () => {
    expect(vatFilesChangeNotice({ knownVersion: null, pageStatus: 'open', change })).toBeNull();
  });
});

describe('page helpers', () => {
  it('sentRepliesByLine: only replies with text saved before the last Send', () => {
    const saved = {
      '502': {
        parts: [],
        replies: { '31': 'Sent one', '32': 'Draft' },
        replyMeta: { '31': { sentAt: T0, savedAt: T0 }, '32': { sentAt: T2, savedAt: T2 } },
        updatedAt: T2,
      },
    };
    expect(sentRepliesByLine(saved, T1)).toEqual({ '502': { '31': 'Sent one' } });
    expect(sentRepliesByLine(saved, null)).toEqual({});
  });

  it('replyStatusLine: "Sent by Name (email) on ..." when sent; "Saved ... Not sent yet." before', () => {
    const meta = { sentAt: T0, sentBy: 'anna@client.com', savedAt: T0 };
    const names = { 'anna@client.com': 'Anna Keller' };
    expect(replyStatusLine(meta, names, true)).toBe('Sent by Anna Keller (anna@client.com) on 11.10.2026 12:00');
    expect(replyStatusLine(meta, null, false)).toBe('Saved by anna@client.com on 11.10.2026 12:00. Not sent yet.');
    expect(replyStatusLine(undefined, null, true, T1)).toBe('Sent on 11.10.2026 13:00');
    expect(replyStatusLine(undefined, null, false, T1)).toBe('');
  });

  it('describeLineAnswer: one short line for the conflict note', () => {
    expect(describeLineAnswer({ parts: [{ ...FULL }], replies: { '31': 'Yes' } })).toBe(
      'For sale / stock / trading, Paid, CIF, Dubai - seaport, airport or Designated Zone | Reply: "Yes"'
    );
    expect(describeLineAnswer({ parts: [] })).toBe('Nothing filled in');
  });
});

describe('review: timestamps are compared as moments, never as text', () => {
  const Z = '2026-10-11T07:13:06.207Z';
  const PG3 = '2026-10-11T07:13:06.207+00:00';
  const Z2 = '2026-10-11T13:37:31.980Z';
  const PG2 = '2026-10-11T13:37:31.98+00:00';

  it('canonicalIso / sameInstant: "Z" and "+00:00" with 2 or 3 fraction digits are the same moment', () => {
    expect(canonicalIso(PG3)).toBe(Z);
    expect(canonicalIso(PG2)).toBe(Z2);
    expect(canonicalIso('2026-10-11T13:37:31+00:00')).toBe('2026-10-11T13:37:31.000Z');
    expect(canonicalIso(null)).toBeNull();
    expect(canonicalIso('')).toBeNull();
    expect(canonicalIso('not a date')).toBeNull();
    expect(sameInstant(Z, PG3)).toBe(true);
    expect(sameInstant(Z2, PG2)).toBe(true);
    expect(sameInstant(Z, PG2)).toBe(false);
    expect(sameInstant(null, undefined)).toBe(true);
    expect(sameInstant(null, Z)).toBe(false);
  });

  it('the version: the Send stamp in either spelling hashes alike', () => {
    const payload = scrubVatFilesRow(row({ customs_lines: LINES, customs_answers_sent_at: Z }));
    expect(vatFilesPageVersion({ ...payload, customsAnswersSentAt: PG3 })).toBe(vatFilesPageVersion(payload));
    expect(vatFilesPageVersion(scrubVatFilesRow(row({ customs_lines: LINES, customs_answers_sent_at: PG2 })))).toBe(
      vatFilesPageVersion(scrubVatFilesRow(row({ customs_lines: LINES, customs_answers_sent_at: Z2 })))
    );
    expect(scrubVatFilesRow(row({ customs_lines: LINES, customs_answers_sent_at: PG2 })).customsAnswersSentAt).toBe(Z2);
  });

  it('the last client change finds who saved (column "+00:00", line stamp "Z")', () => {
    for (const [col, line] of [[PG3, Z], [PG2, Z2]]) {
      const last = vatFilesLastClientChange(
        row({ customs_answers_saved_at: col, customs_answers: { '501': { parts: [], updatedAt: line, savedBy: 'Bob@Client.com' } } })
      );
      expect(last).toEqual({ at: line, by: 'bob@client.com' });
    }
  });

  it('customsLineConflict: the same moment in another spelling is no conflict', () => {
    expect(customsLineConflict(PG3, { parts: [], updatedAt: Z }, null)).toBe(false);
    expect(customsLineConflict(Z2, { parts: [], updatedAt: PG2 }, null)).toBe(false);
    expect(customsLineConflict(PG2, { parts: [], updatedAt: Z }, null)).toBe(true);
  });

  it('mergeLineAnswer: the newer by moment, not by text', () => {
    const line = { ...LINES[0], answer: { parts: [{ purpose: 'sale_stock' as const }], updatedAt: '2026-10-11T07:13:06.5+00:00' } };
    // Text order would pick the client ("...06.207Z" > "...06.5+..."), the moment is the portal's.
    const merged = mergeLineAnswer(line, { parts: [{ purpose: 'office_use' as const }], updatedAt: Z });
    expect(merged.parts[0].purpose).toBe('sale_stock');
    // A tie (same moment): the client's wins.
    expect(mergeLineAnswer(line, { parts: [{ purpose: 'office_use' as const }], updatedAt: '2026-10-11T07:13:06.500Z' }).parts[0].purpose).toBe('office_use');
  });
});

describe('review: the page keeps refused text and survives a lost save answer', () => {
  const T0 = '2026-10-11T08:00:00.000Z';
  const T1 = '2026-10-11T09:00:00.000Z';
  const saved = {
    '502': {
      parts: [FULL],
      replies: { '31': 'Yes, samples', '32': 'Draft after Send' },
      replyMeta: { '31': { sentAt: T0, savedAt: T0 }, '32': { sentAt: '2026-10-11T10:00:00.000Z', savedAt: '2026-10-11T10:00:00.000Z' } },
      updatedAt: '2026-10-11T10:00:00.000Z',
    },
  };

  it('refusedReplyTexts: only the typed text of SENT replies that differs (trimmed); an emptied reply is not kept', () => {
    const typed = { '502': { parts: [FULL], replies: { '31': '  No, for sale ', '32': 'Changed draft' } } };
    expect(refusedReplyTexts(['502'], typed, saved, T1)).toEqual({ '502': { '31': 'No, for sale' } });
    expect(refusedReplyTexts(['502'], { '502': { replies: { '31': 'Yes, samples' } } }, saved, T1)).toEqual({});
    expect(refusedReplyTexts(['502'], { '502': { replies: { '31': '' } } }, saved, T1)).toEqual({});
    expect(refusedReplyTexts(['502'], typed, saved, null)).toEqual({});
    // The "+00:00" spelling of the Send stamp works the same.
    expect(refusedReplyTexts(['502'], typed, saved, '2026-10-11T09:00:00+00:00')).toEqual({ '502': { '31': 'No, for sale' } });
  });

  it('customsLineSavedAs: the stored line holds exactly what the lost save carried', () => {
    const line = LINES[1];
    const stored = { parts: [FULL], replies: { '31': 'Yes, samples', '99': 'old closed one' }, updatedAt: T1 };
    expect(customsLineSavedAs(line, { parts: [{ ...FULL, purposeOther: '' }], replies: { '31': ' Yes, samples ' } }, stored)).toBe(true);
    expect(customsLineSavedAs(line, { parts: [FULL], replies: { '31': 'Yes' } }, stored)).toBe(false);
    expect(customsLineSavedAs(line, { parts: [FULL] }, stored)).toBe(false);
    expect(customsLineSavedAs(line, { parts: [{ ...FULL, payment: 'foc' }], replies: { '31': 'Yes, samples' } }, stored)).toBe(false);
    expect(customsLineSavedAs(line, { parts: [FULL] }, null)).toBe(false);
  });

  it('switch off: a lost save answer + more typing = no conflict with itself once the base is refreshed', () => {
    // Save 1 (base null) landed at T1, its answer was lost.
    const first = applyCustomsAnswersUpdate({}, { '501': { parts: [FULL], baseUpdatedAt: null } }, LINES, T1, null, {});
    if (!first.ok) throw new Error('save 1');
    // Without the refresh, save 2 (base still null) would be refused.
    const stale = applyCustomsAnswersUpdate(first.answers, { '501': { parts: [FULL, FULL], baseUpdatedAt: null } }, LINES, '2026-10-11T09:01:00.000Z', null, {});
    expect(stale.ok && Object.keys(stale.conflicts)).toEqual(['501']);
    // The page reads the stored answer: it is what save 1 carried, so its stamp becomes the base.
    expect(customsLineSavedAs(LINES[0], { parts: [FULL] }, first.answers['501'])).toBe(true);
    const base = first.answers['501'].updatedAt;
    const next = applyCustomsAnswersUpdate(first.answers, { '501': { parts: [FULL, FULL], baseUpdatedAt: base } }, LINES, '2026-10-11T09:01:00.000Z', null, {});
    expect(next.ok && next.changed).toEqual(['501']);
  });
});
