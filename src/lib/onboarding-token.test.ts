import { describe, it, expect, vi } from 'vitest';

// The module imports the service-role client; the pure helpers under test
// never call it.
vi.mock('./supabase-server', () => ({ getSupabaseAdmin: vi.fn() }));

import {
  decideOnboardingAccess,
  employerTokenMatches,
  canEmployerRecall,
  scrubOnboardingForBrowser,
  type OnboardingRow,
} from './onboarding-token';

const EMPLOYER_TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EMPLOYEE_TOKEN = '11111111-2222-4333-8444-555555555555';
const NEW_EMPLOYEE_TOKEN = '99999999-8888-4777-8666-555555555555';
const OTHER_UUID = '12345678-1234-4234-8234-123456789012';

function row(overrides: Partial<OnboardingRow> = {}): OnboardingRow {
  return {
    id: 'row-id',
    status: 'employer_completed',
    current_step: 'employee',
    is_same_person: false,
    employer_data: { job_title_visa: 'Manager' },
    employee_data: null,
    employer_signature_data: 'data:image/png;base64,xx',
    employer_signed_at: '2026-09-20T08:00:00.000Z',
    employer_access_token: EMPLOYER_TOKEN,
    employer_recall_count: 0,
    employer_recalled_at: null,
    prefill_employer_data: null,
    prefill_employee_data: null,
    documents: null,
    existing_documents: null,
    staff_name: 'John Smith',
    staff_email: 'john@example.com',
    onboarding_type: 'new_hire',
    sponsorship_type: 'company',
    requested_documents: null,
    employee_access_token: EMPLOYEE_TOKEN,
    created_at: '2026-09-19T08:00:00.000Z',
    ...overrides,
  };
}

// Row as it looks right after a recall.
function recalledRow(overrides: Partial<OnboardingRow> = {}): OnboardingRow {
  return row({
    status: 'pending',
    current_step: 'employer',
    employer_signature_data: null,
    employer_signed_at: null,
    employer_recall_count: 1,
    employer_recalled_at: '2026-09-21T08:00:00.000Z',
    employee_access_token: NEW_EMPLOYEE_TOKEN,
    ...overrides,
  });
}

describe('employerTokenMatches', () => {
  it('false when the row has no employer token (legacy row)', () => {
    expect(employerTokenMatches(row({ employer_access_token: null }), EMPLOYER_TOKEN)).toBe(false);
  });

  it('false for a missing or non-UUID candidate', () => {
    expect(employerTokenMatches(row(), null)).toBe(false);
    expect(employerTokenMatches(row(), undefined)).toBe(false);
    expect(employerTokenMatches(row(), '')).toBe(false);
    expect(employerTokenMatches(row(), 'not-a-uuid')).toBe(false);
  });

  it('false for a different UUID', () => {
    expect(employerTokenMatches(row(), OTHER_UUID)).toBe(false);
    expect(employerTokenMatches(row(), EMPLOYEE_TOKEN)).toBe(false);
  });

  it('true for the matching token, case-insensitive', () => {
    expect(employerTokenMatches(row(), EMPLOYER_TOKEN)).toBe(true);
    expect(employerTokenMatches(row(), EMPLOYER_TOKEN.toUpperCase())).toBe(true);
    expect(
      employerTokenMatches(row({ employer_access_token: EMPLOYER_TOKEN.toUpperCase() }), EMPLOYER_TOKEN),
    ).toBe(true);
  });
});

describe('canEmployerRecall', () => {
  it('true for a signed two-person new hire waiting on the employee', () => {
    expect(canEmployerRecall(row())).toBe(true);
  });

  it('true for renewals and legacy null onboarding_type', () => {
    expect(canEmployerRecall(row({ onboarding_type: 'renewal' }))).toBe(true);
    expect(canEmployerRecall(row({ onboarding_type: null }))).toBe(true);
  });

  it('false without an employer token', () => {
    expect(canEmployerRecall(row({ employer_access_token: null }))).toBe(false);
  });

  it('false for same-person forms', () => {
    expect(canEmployerRecall(row({ is_same_person: true }))).toBe(false);
  });

  it('false for the Partner/Investor track', () => {
    expect(canEmployerRecall(row({ prefill_employer_data: { visa_track: 'partner_investor' } }))).toBe(false);
  });

  it('false for document requests and dependent flows', () => {
    for (const t of ['document_request', 'dependent', 'dependent_renewal', 'dependent_document_request']) {
      expect(canEmployerRecall(row({ onboarding_type: t }))).toBe(false);
    }
  });

  it('false on the wrong status or step', () => {
    expect(canEmployerRecall(row({ status: 'pending', current_step: 'employer' }))).toBe(false);
    expect(canEmployerRecall(row({ status: 'complete', current_step: 'complete' }))).toBe(false);
    expect(canEmployerRecall(row({ status: 'cancelled' }))).toBe(false);
    expect(canEmployerRecall(row({ status: 'employer_completed', current_step: 'employer' }))).toBe(false);
  });
});

describe('decideOnboardingAccess', () => {
  describe('status gates', () => {
    it('cancelled and expired -> 410', () => {
      expect(decideOnboardingAccess(row({ status: 'cancelled' }), EMPLOYEE_TOKEN)).toMatchObject({
        ok: false, reason: 'cancelled', status: 410,
      });
      expect(decideOnboardingAccess(row({ status: 'expired' }), EMPLOYEE_TOKEN)).toMatchObject({
        ok: false, reason: 'expired', status: 410,
      });
    });

    it('complete is readable, but blocked for writes', () => {
      const done = row({ status: 'complete', current_step: 'complete' });
      expect(decideOnboardingAccess(done, null).ok).toBe(true);
      expect(decideOnboardingAccess(done, null, { blockIfComplete: true })).toMatchObject({
        ok: false, reason: 'already_complete', status: 410,
      });
    });
  });

  describe('employer step, never recalled', () => {
    const fresh = row({ status: 'pending', current_step: 'employer', employer_signature_data: null });

    it('URL alone is enough (unchanged behaviour)', () => {
      expect(decideOnboardingAccess(fresh, null, { expectedStep: 'auto' }).ok).toBe(true);
    });

    it('a wrong e does not matter before a recall', () => {
      expect(
        decideOnboardingAccess(fresh, null, { expectedStep: 'auto', employerToken: OTHER_UUID }).ok,
      ).toBe(true);
    });
  });

  describe('employer step after a recall', () => {
    it('ok with the matching employer token', () => {
      expect(
        decideOnboardingAccess(recalledRow(), null, { expectedStep: 'auto', employerToken: EMPLOYER_TOKEN }).ok,
      ).toBe(true);
    });

    it('recalled without e (the employee holding the old link)', () => {
      expect(decideOnboardingAccess(recalledRow(), EMPLOYEE_TOKEN, { expectedStep: 'auto' })).toMatchObject({
        ok: false, reason: 'recalled', status: 403,
      });
    });

    it('recalled with a wrong e', () => {
      expect(
        decideOnboardingAccess(recalledRow(), null, { expectedStep: 'auto', employerToken: OTHER_UUID }),
      ).toMatchObject({ ok: false, reason: 'recalled', status: 403 });
    });

    it('legacy recalled row without an employer token is not gated', () => {
      expect(
        decideOnboardingAccess(recalledRow({ employer_access_token: null }), null, { expectedStep: 'auto' }).ok,
      ).toBe(true);
    });
  });

  describe('employee step', () => {
    it('ok with the right employee token', () => {
      expect(decideOnboardingAccess(row(), EMPLOYEE_TOKEN, { expectedStep: 'auto' }).ok).toBe(true);
    });

    it('missing token -> token_required', () => {
      expect(decideOnboardingAccess(row(), null, { expectedStep: 'auto' })).toMatchObject({
        ok: false, reason: 'token_required', status: 403,
      });
    });

    it('wrong or malformed token on a never-recalled row -> token_invalid', () => {
      expect(decideOnboardingAccess(row(), OTHER_UUID)).toMatchObject({ reason: 'token_invalid' });
      expect(decideOnboardingAccess(row(), 'garbage')).toMatchObject({ reason: 'token_invalid' });
    });

    it('employer token alone does not open the employee form', () => {
      expect(
        decideOnboardingAccess(row(), null, { expectedStep: 'auto', employerToken: EMPLOYER_TOKEN }),
      ).toMatchObject({ ok: false, reason: 'token_required' });
    });

    it('old token after recall + re-sign -> recalled (not the generic invalid-link message)', () => {
      const reSigned = row({ employer_recall_count: 1, employee_access_token: NEW_EMPLOYEE_TOKEN });
      expect(decideOnboardingAccess(reSigned, EMPLOYEE_TOKEN)).toMatchObject({
        ok: false, reason: 'recalled', status: 403,
      });
      expect(decideOnboardingAccess(reSigned, NEW_EMPLOYEE_TOKEN).ok).toBe(true);
    });

    it('explicit employee step (AI routes, autosave) with the old token after recall -> recalled', () => {
      expect(
        decideOnboardingAccess(recalledRow(), EMPLOYEE_TOKEN, { expectedStep: 'employee', blockIfComplete: true }),
      ).toMatchObject({ ok: false, reason: 'recalled' });
    });

    it('rows without an employee token (same-person, legacy) are not gated', () => {
      expect(
        decideOnboardingAccess(row({ is_same_person: true, employee_access_token: null }), null).ok,
      ).toBe(true);
    });
  });
});

describe('scrubOnboardingForBrowser', () => {
  it('never returns either token and flags a recalled employer form', () => {
    const out = scrubOnboardingForBrowser(recalledRow()) as Record<string, unknown>;
    expect(out.employer_access_token).toBeUndefined();
    expect(out.employee_access_token).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(EMPLOYER_TOKEN);
    expect(JSON.stringify(out)).not.toContain(NEW_EMPLOYEE_TOKEN);
    expect(out.employer_recalled).toBe(true);
    expect(out.employer_data).toEqual({ job_title_visa: 'Manager' });
  });

  it('employer_recalled is false before any recall and after the re-sign', () => {
    expect((scrubOnboardingForBrowser(row()) as Record<string, unknown>).employer_recalled).toBe(false);
    expect(
      (scrubOnboardingForBrowser(row({ employer_recall_count: 1 })) as Record<string, unknown>).employer_recalled,
    ).toBe(false);
  });

  it('hides the employee answers and uploads from a recalled employer', () => {
    const out = scrubOnboardingForBrowser(
      recalledRow({
        employee_data: { bank_iban: 'AE000', address: 'Somewhere' },
        documents: {
          job_offer_letter: { path: 'x/offer.pdf' },
          passport_cover: { path: 'x/passport.jpg' },
          photo: { path: 'x/photo.jpg' },
        },
      }),
    ) as Record<string, unknown>;
    expect(out.employee_data).toBeNull();
    expect(out.documents).toEqual({ job_offer_letter: { path: 'x/offer.pdf' } });
  });

  it('keeps employee answers and uploads on the employee step and for same-person rows', () => {
    const docs = { job_offer_letter: { path: 'a' }, photo: { path: 'b' } };
    const onEmployee = scrubOnboardingForBrowser(
      row({ employee_data: { a: 1 }, documents: docs }),
    ) as Record<string, unknown>;
    expect(onEmployee.employee_data).toEqual({ a: 1 });
    expect(onEmployee.documents).toEqual(docs);
    const samePerson = scrubOnboardingForBrowser(
      row({ current_step: 'employer', is_same_person: true, employee_data: { a: 1 }, documents: docs }),
    ) as Record<string, unknown>;
    expect(samePerson.employee_data).toEqual({ a: 1 });
    expect(samePerson.documents).toEqual(docs);
  });
});
