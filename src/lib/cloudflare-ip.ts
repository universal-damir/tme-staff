// ===================================================================
// REAL CLIENT IP BEHIND CLOUDFLARE
// ===================================================================
//
// Since 21.10.2026 clients.tme-services.com, staff. and sign. run through
// the Cloudflare proxy (Telecom Egypt could not reach Netlify directly).
// Netlify's `x-nf-client-connection-ip` is then a Cloudflare edge address,
// and the person's own address arrives in `cf-connecting-ip`.
//
// `cf-connecting-ip` is trusted ONLY when the connection really came from
// Cloudflare; a caller hitting tme-staff.netlify.app directly could type
// any value into that header.

// Published list: https://www.cloudflare.com/ips/
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4ToInt(ip: string): number | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** Expands an IPv6 address to 8 numbers; null when it is not one. */
function v6ToWords(ip: string): number[] | null {
  if (!ip.includes(':') || !/^[0-9a-fA-F:]+$/.test(ip)) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const words = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
    .map((w) => parseInt(w, 16));
  return words.some((w) => Number.isNaN(w) || w > 0xffff) ? null : words;
}

function inV4Range(ip: number, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const start = v4ToInt(base)!;
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return ((ip & mask) >>> 0) === ((start & mask) >>> 0);
}

function inV6Range(words: number[], cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const start = v6ToWords(base)!;
  let bits = Number(bitsText);
  for (let i = 0; i < 8 && bits > 0; i++) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((words[i] & mask) !== (start[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

export function isCloudflareIp(ip: string): boolean {
  const v4 = v4ToInt(ip);
  if (v4 !== null) return CLOUDFLARE_V4.some((c) => inV4Range(v4, c));
  const v6 = v6ToWords(ip);
  if (v6 !== null) return CLOUDFLARE_V6.some((c) => inV6Range(v6, c));
  return false;
}

/** The person's own IP when the request came through Cloudflare, else null
 *  (callers then fall back to their usual Netlify header order). */
export function cloudflareClientIp(headers: Headers): string | null {
  const edge = headers.get('x-nf-client-connection-ip')?.trim();
  if (!edge || !isCloudflareIp(edge)) return null;
  const real = headers.get('cf-connecting-ip')?.trim();
  if (!real) return null;
  return v4ToInt(real) !== null || v6ToWords(real) !== null ? real : null;
}
