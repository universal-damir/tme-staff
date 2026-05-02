import type { NextConfig } from "next";

/**
 * Strict baseline security headers (P2-1).
 *
 * The form is hosted on Netlify at staff.tme-services.com and only renders
 * a single onboarding flow. There is no third-party JS, no analytics, no
 * embedded widgets. The CSP is therefore as tight as Next.js will allow:
 *
 *   - script-src: self + 'unsafe-inline' for Next 15 hydration scripts
 *     (rsc payload + chunk loader). No CDN scripts.
 *   - style-src:  self + 'unsafe-inline' for inline Tailwind styles.
 *   - img-src:    self + data: + Supabase signed URLs (the `/api/storage/file`
 *     route returns a 302 to a Supabase /object/sign/... URL, so the final
 *     image origin is supabase.co even though the request leaves as same-origin).
 *   - connect-src: self + Supabase signed URLs for the same reason — XHR/fetch
 *     follows the redirect to the supabase host.
 *     All onboarding READS/WRITES go through same-origin `/api/*` server routes
 *     after the P0-2 / P0-3 hardening, so the browser never speaks directly to
 *     the Supabase REST or Storage API.
 *   - frame-ancestors 'none' — clickjacking protection (signature pad +
 *     PII fields must not be embeddable).
 *
 * If a future feature needs to call out to a third-party domain from the
 * browser, add it explicitly to `connect-src` here. Wildcard CSP is a P0
 * regression — do not allow it back.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lbsxtpdihjnoyskstzdz.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://lbsxtpdihjnoyskstzdz.supabase.co",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lbsxtpdihjnoyskstzdz.supabase.co',
        pathname: '/storage/v1/object/sign/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
