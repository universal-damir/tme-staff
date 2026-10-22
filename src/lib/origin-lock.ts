/**
 * Origin lock (STAFF-014, Damir 22.10.2026). The site must only be reached
 * through Cloudflare (clients.tme-services.com, staff.tme-services.com). A
 * Cloudflare Transform Rule adds the header `x-tme-origin-key` with a secret
 * value to every request; Netlify gets the same value as ORIGIN_LOCK_SECRET.
 * A request without the right header came straight to Netlify
 * (tme-staff.netlify.app, a preview link):
 *   - GET/HEAD on another host: redirected to the real address, so old
 *     links with the Netlify address keep working (through Cloudflare);
 *   - anything else: 403.
 * Off while ORIGIN_LOCK_SECRET is not set.
 */

export const ORIGIN_LOCK_HEADER = 'x-tme-origin-key';
export const CANONICAL_ORIGIN = 'https://clients.tme-services.com';

export type OriginLockDecision =
  | { kind: 'pass' }
  | { kind: 'redirect'; location: string }
  | { kind: 'deny' };

// Constant-time compare without node:crypto (middleware runs on the edge).
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function originLockDecision(input: {
  secret: string | undefined;
  header: string | null;
  method: string;
  host: string | null;
  pathAndQuery: string;
}): OriginLockDecision {
  const secret = input.secret?.trim();
  if (!secret) return { kind: 'pass' };
  if (input.header && sameSecret(input.header, secret)) return { kind: 'pass' };

  const canonicalHost = new URL(CANONICAL_ORIGIN).host;
  const host = (input.host || '').toLowerCase();
  const method = input.method.toUpperCase();
  // On the real host without the header = the Cloudflare rule is missing;
  // refuse instead of redirecting to itself in a loop.
  if ((method === 'GET' || method === 'HEAD') && host !== canonicalHost) {
    return { kind: 'redirect', location: CANONICAL_ORIGIN + input.pathAndQuery };
  }
  return { kind: 'deny' };
}
