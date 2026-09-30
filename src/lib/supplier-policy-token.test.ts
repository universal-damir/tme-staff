import { describe, it, expect } from 'vitest';
import {
  decideSvpIntakeAccess,
  scrubRowForClient,
  svpRowPrice,
  SVP_SAFE_COLUMNS,
  type SvpIntakeRow,
} from './supplier-policy-token';

const NOW = Date.parse('2026-10-05T10:00:00Z');

function row(over: Partial<SvpIntakeRow> = {}): SvpIntakeRow {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    link_token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    company_name: 'Cognit FZCO',
    status: 'invited',
    price_aed: '950.00',
    prefill_data: {
      companyName: 'Cognit FZCO',
      companyCode: '10614',
      trn: '100000000000003',
      registeredAddress: 'IFZA Business Park, Dubai',
      vatPeriodsText: 'February to April, May to July, August to October and November to January',
      priceAed: 950,
      suggested: {
        implementer: { name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' },
        reviewer: { name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' },
        supervisor: { name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' },
      },
      officers: [{ name: 'Ali Khan', position: 'Manager', email: 'ali@example.com' }],
    },
    submitted_data: null,
    expires_at: '2026-11-29T10:00:00Z',
    submitted_at: null,
    ...over,
  };
}

describe('decideSvpIntakeAccess', () => {
  it('open invited row', () => {
    expect(decideSvpIntakeAccess(row(), {}, NOW)).toMatchObject({ ok: true });
  });

  it('cancelled = 410', () => {
    expect(decideSvpIntakeAccess(row({ status: 'cancelled' }), {}, NOW)).toMatchObject({
      ok: false,
      reason: 'cancelled',
      status: 410,
    });
  });

  it('past expiry = 410, even on reads', () => {
    expect(
      decideSvpIntakeAccess(row({ expires_at: '2026-10-01T00:00:00Z' }), { allowSubmitted: true }, NOW)
    ).toMatchObject({ ok: false, reason: 'expired', status: 410 });
  });

  it('submitted / synced = 409 on writes, ok on reads', () => {
    for (const status of ['submitted', 'synced'] as const) {
      expect(decideSvpIntakeAccess(row({ status }), {}, NOW)).toMatchObject({
        ok: false,
        reason: 'already_submitted',
        status: 409,
      });
      expect(decideSvpIntakeAccess(row({ status }), { allowSubmitted: true }, NOW).ok).toBe(true);
    }
  });
});

describe('scrubRowForClient', () => {
  it('never returns the row id, the token or the client id', () => {
    const payload = scrubRowForClient(row());
    const json = JSON.stringify(payload);
    expect(json).not.toContain('11111111-2222-3333-4444-555555555555');
    expect(json).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(Object.keys(payload).sort()).toEqual(
      ['companyName', 'expiresAt', 'prefill', 'priceAed', 'status', 'submitted'].sort()
    );
  });

  it('turns a NUMERIC string price into a number', () => {
    expect(scrubRowForClient(row()).priceAed).toBe(950);
    expect(svpRowPrice({ price_aed: null })).toBeNull();
    expect(svpRowPrice({ price_aed: 'abc' })).toBeNull();
  });

  it('fills a missing prefill block with empty people', () => {
    const payload = scrubRowForClient(row({ prefill_data: { companyName: 'X' } }));
    expect(payload.prefill?.suggested.supervisor).toEqual({ name: '', position: '', email: '' });
    expect(payload.prefill?.officers).toEqual([]);
  });

  it('server-only columns are not selected', () => {
    for (const col of ['client_id', 'company_code', 'origin_env', 'synced_to_tme']) {
      expect(SVP_SAFE_COLUMNS).not.toContain(col);
    }
  });
});
