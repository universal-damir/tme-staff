import { describe, it, expect } from 'vitest';
import { portalNotifiedEmployee } from './portal-notify';

describe('portalNotifiedEmployee', () => {
  it('true when the invitation went out now or before', () => {
    expect(portalNotifiedEmployee(200, { success: true, emailSent: true })).toBe(true);
    expect(portalNotifiedEmployee(200, { success: true, emailSent: false, alreadySent: true })).toBe(true);
  });
  it('false when the portal answered but sent nothing', () => {
    expect(portalNotifiedEmployee(400, { error: 'No employee email address on record' })).toBe(false);
    expect(portalNotifiedEmployee(200, { success: true, emailSent: false })).toBe(false);
  });
  it('unknown on a portal error or an unreadable answer (the cron retries)', () => {
    expect(portalNotifiedEmployee(500, { error: 'x' })).toBeUndefined();
    expect(portalNotifiedEmployee(200, null)).toBeUndefined();
  });
});
