/**
 * Reads the portal's employer-complete answer: true when the employee
 * invitation was sent (now or before), false when the portal answered but sent
 * nothing (e.g. no employee email on record, or the send failed), undefined
 * when the answer says nothing reliable (5xx or unreadable body).
 */
export function portalNotifiedEmployee(status: number, body: unknown): boolean | undefined {
  if (status >= 500) return undefined;
  if (status >= 400) return false;
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { emailSent?: unknown; alreadySent?: unknown };
  return b.emailSent === true || b.alreadySent === true;
}
