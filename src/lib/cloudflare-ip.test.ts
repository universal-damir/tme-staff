import { describe, expect, it } from 'vitest';
import { cloudflareClientIp, isCloudflareIp } from './cloudflare-ip';

const headers = (h: Record<string, string>) => new Headers(h);

describe('cloudflare-ip', () => {
  it('knows Cloudflare edge addresses', () => {
    expect(isCloudflareIp('162.158.22.136')).toBe(true);
    expect(isCloudflareIp('172.71.1.1')).toBe(true);
    expect(isCloudflareIp('2a06:98c1::1')).toBe(true);
    expect(isCloudflareIp('2606:4700:10::6816:1')).toBe(true);
    expect(isCloudflareIp('176.204.69.19')).toBe(false);
    expect(isCloudflareIp('2001:db8::1')).toBe(false);
    expect(isCloudflareIp('not-an-ip')).toBe(false);
  });

  it('uses cf-connecting-ip when the request came through Cloudflare', () => {
    expect(cloudflareClientIp(headers({
      'x-nf-client-connection-ip': '162.158.22.136',
      'cf-connecting-ip': '41.33.1.2',
    }))).toBe('41.33.1.2');
  });

  it('ignores cf-connecting-ip typed by a caller that skipped Cloudflare', () => {
    expect(cloudflareClientIp(headers({
      'x-nf-client-connection-ip': '176.204.69.19',
      'cf-connecting-ip': '1.2.3.4',
    }))).toBeNull();
  });

  it('ignores a missing or broken cf-connecting-ip', () => {
    expect(cloudflareClientIp(headers({ 'x-nf-client-connection-ip': '162.158.22.136' }))).toBeNull();
    expect(cloudflareClientIp(headers({
      'x-nf-client-connection-ip': '162.158.22.136',
      'cf-connecting-ip': 'evil',
    }))).toBeNull();
  });
});
