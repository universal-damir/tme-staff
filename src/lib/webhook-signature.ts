/**
 * HMAC-SHA256 webhook authentication — sender side.
 *
 * Mirrors the verifier in tme-portal `src/lib/webhook-signature.ts`. Returns
 * the headers to attach to a fetch() call to a tme-portal webhook endpoint.
 *
 * Wire format (see verifier doc-comment for full details):
 *   x-timestamp        seconds-since-epoch
 *   x-webhook-nonce    random UUID (name avoids collision with the portal's
 *                      CSP `x-nonce` header that gets injected by middleware)
 *   x-signature        "sha256=<hex>" of HMAC-SHA256(secret, `${ts}.${nonce}.${rawBody}`)
 */

import crypto from 'crypto';

export function signWebhookBody(secret: string, rawBody: string): {
  'x-timestamp': string;
  'x-webhook-nonce': string;
  'x-signature': string;
} {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest('hex');
  return {
    'x-timestamp': timestamp,
    'x-webhook-nonce': nonce,
    'x-signature': `sha256=${sig}`,
  };
}
