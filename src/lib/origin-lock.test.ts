import { describe, it, expect } from 'vitest';
import { originLockDecision } from './origin-lock';

const base = { secret: 's3cret-value', header: null, method: 'GET', host: 'tme-staff.netlify.app', pathAndQuery: '/onboard/abc?token=1' };

describe('originLockDecision', () => {
  it('is off while ORIGIN_LOCK_SECRET is not set', () => {
    expect(originLockDecision({ ...base, secret: undefined })).toEqual({ kind: 'pass' });
    expect(originLockDecision({ ...base, secret: '  ' })).toEqual({ kind: 'pass' });
  });

  it('passes a request with the right header (came through Cloudflare)', () => {
    expect(originLockDecision({ ...base, header: 's3cret-value', host: 'clients.tme-services.com' })).toEqual({ kind: 'pass' });
    expect(originLockDecision({ ...base, header: 's3cret-value', host: 'staff.tme-services.com', method: 'POST' })).toEqual({ kind: 'pass' });
  });

  it('sends a GET on the Netlify address to the real address, path and query kept', () => {
    expect(originLockDecision(base)).toEqual({ kind: 'redirect', location: 'https://clients.tme-services.com/onboard/abc?token=1' });
    expect(originLockDecision({ ...base, header: 'wrong-value!' })).toEqual({ kind: 'redirect', location: 'https://clients.tme-services.com/onboard/abc?token=1' });
  });

  it('refuses a POST without the header', () => {
    expect(originLockDecision({ ...base, method: 'POST' })).toEqual({ kind: 'deny' });
  });

  it('refuses instead of looping when the real host has no header (Cloudflare rule missing)', () => {
    expect(originLockDecision({ ...base, host: 'clients.tme-services.com' })).toEqual({ kind: 'deny' });
  });
});
