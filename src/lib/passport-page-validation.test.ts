import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('./anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: createMock } }),
  withTimeout: <T,>(p: Promise<T>) => p,
}));

import {
  judgePassportDataPage,
  isRealQualityIssue,
  validatePassportPage,
  DATA_PAGE_REJECT_REASONS,
} from './passport-page-validation';

// The exact scan Tina uploaded on 27.09: a clean German spread that was
// rejected, with this very text shown to her as the "reason".
const TINA_OBSERVATION =
  'This is a German passport (Bundesrepublik Deutschland Reisepass) spread open showing two pages: the top half is a residence/personal details page (partially filled) and the bottom half is the biodata page with photo, personal details, and a two-line MRZ at the bottom. Background is plain scanner bed, image is clean and flat. Both halves are fully visible with all corners/edges in frame.';

const tinaObservations = {
  observation: TINA_OBSERVATION,
  pages_fully_visible: 2,
  fold_visible: true,
  is_uae_passport: false,
  holder_photo_visible: true,
  mrz_visible: true,
  all_corners_visible: true,
  quality_issue: '',
};

function toolResponse(input: Record<string, unknown>, stop_reason = 'tool_use') {
  return {
    stop_reason,
    content: [{ type: 'tool_use', id: 't1', name: 'validate_passport_page', input }],
  };
}

describe('judgePassportDataPage', () => {
  it('accepts the clean German spread whatever the model said in `valid`', () => {
    expect(judgePassportDataPage({ ...tinaObservations, valid: false })).toEqual({ kind: 'accept' });
    expect(judgePassportDataPage({ ...tinaObservations })).toEqual({ kind: 'accept' });
  });

  it('rejects a lone data page unless UAE', () => {
    const single = { ...tinaObservations, pages_fully_visible: 1, fold_visible: false };
    expect(judgePassportDataPage(single)).toEqual({
      kind: 'reject',
      reason: DATA_PAGE_REJECT_REASONS.singlePage,
    });
    expect(judgePassportDataPage({ ...single, is_uae_passport: true })).toEqual({ kind: 'accept' });
  });

  it('rejects when photo or MRZ is not visible, cut corners, or a real quality issue', () => {
    expect(judgePassportDataPage({ ...tinaObservations, mrz_visible: false })).toMatchObject({
      kind: 'reject',
      reason: DATA_PAGE_REJECT_REASONS.notDataPage,
    });
    expect(judgePassportDataPage({ ...tinaObservations, all_corners_visible: false })).toMatchObject({
      reason: DATA_PAGE_REJECT_REASONS.corners,
    });
    expect(
      judgePassportDataPage({ ...tinaObservations, quality_issue: 'Heavy glare over the MRZ' })
    ).toMatchObject({ reason: DATA_PAGE_REJECT_REASONS.quality });
  });

  it('treats missing observations as infra, never as a rejection', () => {
    const { mrz_visible: _m, ...rest } = tinaObservations;
    void _m;
    expect(judgePassportDataPage(rest)).toEqual({ kind: 'infra', missing: ['mrz_visible'] });
  });

  it('no reason contains an em dash', () => {
    for (const r of Object.values(DATA_PAGE_REJECT_REASONS)) expect(r).not.toContain('—');
  });
});

describe('isRealQualityIssue', () => {
  it('reads "no problem" phrasings as no issue', () => {
    for (const t of ['', '  ', 'None', 'none.', 'N/A', 'No issues', 'No quality issues found', 'None - the scan is clean', 'The scan is clean', '-']) {
      expect(isRealQualityIssue(t)).toBe(false);
    }
    expect(isRealQualityIssue(undefined)).toBe(false);
  });
  it('keeps real problems', () => {
    expect(isRealQualityIssue('Passport photographed on a wooden table')).toBe(true);
    expect(isRealQualityIssue('Not all corners visible')).toBe(true);
  });
});

describe('validatePassportPage (company-setup data page, requireSpread)', () => {
  beforeEach(() => createMock.mockReset());

  it('PASSES Tina\'s scan even when the model returns valid=false', async () => {
    createMock.mockResolvedValue(toolResponse({ ...tinaObservations, valid: false }));
    const r = await validatePassportPage('data:image/jpeg;base64,AAAA', 'INSIDE_PAGES', undefined, {
      requireSpread: true,
    });
    expect(r.page_type).toBe('INSIDE_PAGES');
    expect(r.infra).toBeUndefined();
    expect(r.details).not.toContain('Bundesrepublik');
  });

  it('PASSES when the model leaves `valid` out entirely', async () => {
    createMock.mockResolvedValue(toolResponse({ ...tinaObservations }));
    const r = await validatePassportPage('data:image/jpeg;base64,AAAA', 'INSIDE_PAGES', undefined, {
      requireSpread: true,
    });
    expect(r.page_type).toBe('INSIDE_PAGES');
  });

  it('never shows the model observation as the rejection reason', async () => {
    createMock.mockResolvedValue(
      toolResponse({ ...tinaObservations, pages_fully_visible: 1, fold_visible: false, valid: false })
    );
    const r = await validatePassportPage('data:image/jpeg;base64,AAAA', 'INSIDE_PAGES', undefined, {
      requireSpread: true,
    });
    expect(r.page_type).toBe('INVALID');
    expect(r.details).toBe(DATA_PAGE_REJECT_REASONS.singlePage);
  });

  it('a cut-off answer (max_tokens) or no tool_use block is infra, not a rejection', async () => {
    createMock.mockResolvedValue(toolResponse({ observation: 'German passport' }, 'max_tokens'));
    const cut = await validatePassportPage('data:image/jpeg;base64,AAAA', 'INSIDE_PAGES', undefined, {
      requireSpread: true,
    });
    expect(cut.infra).toBe(true);

    // No tool_use block (refusal / API shape change): same infra path as an API error.
    createMock.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] });
    const err = await validatePassportPage('data:image/jpeg;base64,AAAA', 'INSIDE_PAGES', undefined, {
      requireSpread: true,
    });
    expect(err.infra).toBe(true);
  });
});
