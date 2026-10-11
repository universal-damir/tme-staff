// @vitest-environment node
// getClientIp keys every per-IP limit (AI routes, uploads, VAT link codes).
// The first x-forwarded-for value is typed by the caller, so it must never win.
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('./onboarding-token', () => ({ verifyOnboardingAccess: vi.fn() }));
vi.mock('./pdf-page-count-server', () => ({ countPdfPagesServer: vi.fn() }));

import { getClientIp } from './ai-route-guard';

const reqWith = (headers: Record<string, string>) => new NextRequest('https://x.test/api/a', { headers });

describe('getClientIp', () => {
  it('Netlify connection IP wins over anything in x-forwarded-for', () => {
    expect(
      getClientIp(reqWith({ 'x-nf-client-connection-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))
    ).toBe('203.0.113.7');
  });

  it('without the Netlify header: the LAST x-forwarded-for hop, never the first (typed by the caller)', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 198.51.100.2' }))).toBe('198.51.100.2');
    expect(getClientIp(reqWith({ 'x-forwarded-for': '198.51.100.2' }))).toBe('198.51.100.2');
  });

  it('a spoofed first hop changes nothing: two calls with different fakes get the same key', () => {
    const a = getClientIp(reqWith({ 'x-nf-client-connection-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }));
    const b = getClientIp(reqWith({ 'x-nf-client-connection-ip': '203.0.113.7', 'x-forwarded-for': '2.2.2.2' }));
    expect(a).toBe(b);
  });

  it('IPv6, junk values and fallbacks', () => {
    expect(getClientIp(reqWith({ 'x-nf-client-connection-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(getClientIp(reqWith({ 'x-nf-client-connection-ip': 'nonsense', 'x-forwarded-for': 'a, 198.51.100.9' }))).toBe('198.51.100.9');
    expect(getClientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, junk', 'x-real-ip': '192.0.2.5' }))).toBe('192.0.2.5');
    expect(getClientIp(reqWith({}))).toBe('unknown');
  });
});
