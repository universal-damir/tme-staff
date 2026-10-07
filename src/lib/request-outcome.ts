// ===================================================================
// REQUEST OUTCOMES: one name per failure, one plain message per name
// ===================================================================
//
// Before this file every form read `await res.json()` straight away. When
// the answer was not JSON (Netlify's own "request too large" or "timed out"
// page) that line threw, the catch said "could not check right now, please
// try again", and the person retried forever. Here every way a request can
// fail gets its own name and its own message, and the failure is recorded
// (client-error-log) so the team sees it without waiting for an email.

import { reportClientFailure, type FailureContext } from './client-error-log';

export type FailureKind =
  /** The request never got an answer: internet dropped or blocked. */
  | 'offline'
  /** The file is bigger than we can receive. */
  | 'too_large'
  /** Not a PDF / JPG / PNG, or the file is damaged. */
  | 'wrong_file'
  /** Too many attempts in a short time (429). */
  | 'busy'
  /** The form is already submitted, cancelled or expired (409 / 410). */
  | 'form_closed'
  /** The link is wrong or replaced by a newer one (401 / 403 / 404). */
  | 'link_invalid'
  /** The server took too long or was briefly unavailable (408 / 502 / 503 / 504). */
  | 'timeout'
  /** The server refused this request with its own reason (400 / 422). */
  | 'rejected'
  /** Anything else on our side (500, or an answer we cannot read). */
  | 'server_error';

export interface RequestSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export interface RequestFailure {
  ok: false;
  kind: FailureKind;
  /** HTTP status, or null when no answer came back. */
  status: number | null;
  /** The short code the server sent (`error` field), when there was one. */
  code: string | null;
  /** A human sentence from the server (`errorMessage` / `error`), when it sent one. */
  serverMessage: string | null;
  /** The parsed JSON answer, when there was one (e.g. a submit's field-error list). */
  body?: Record<string, unknown> | null;
}

export type RequestOutcome<T> = RequestSuccess<T> | RequestFailure;

const HELP_EMAIL = 'portal@tme-services.com';

/** One plain-English message per failure. */
export const FAILURE_MESSAGES: Record<FailureKind, string> = {
  offline:
    'Your internet connection dropped while sending. Please check your connection and try again.',
  too_large: 'This file is too large. Please upload a file smaller than 10 MB.',
  wrong_file: 'We can only accept PDF, JPG or PNG files. Please choose another file.',
  busy: 'Too many tries in a short time. Please wait one minute and try again.',
  form_closed: `This form is already submitted or closed. If you need to change something, please email ${HELP_EMAIL}.`,
  link_invalid: `This link is no longer valid. Please open the form again from the latest email we sent you, or email ${HELP_EMAIL}.`,
  timeout: 'Our server took too long to answer. Please try again.',
  rejected: `We could not accept this. Please try again. If it happens again, please email ${HELP_EMAIL}.`,
  server_error: `Something went wrong on our side. Please try again. If it happens again, please email ${HELP_EMAIL}.`,
};

/** Message shown when the automatic document check itself could not run. */
export const CHECK_UNAVAILABLE_MESSAGE =
  'Our automatic check is not working right now. Please try again in a moment. ' +
  'If it fails again, you can send the file to our team to check by hand.';

/** Message shown when even a smaller copy of the file is too large for the check. */
export const FILE_TOO_LARGE_FOR_CHECK_MESSAGE =
  'This file is too large for our automatic check. Please upload a smaller file, ' +
  'for example a PDF with only the page we ask for.';

/** The message for a failure: the server's own sentence when it is meant for people. */
export function failureMessage(failure: RequestFailure): string {
  if (failure.kind === 'rejected' && failure.serverMessage) return failure.serverMessage;
  return FAILURE_MESSAGES[failure.kind];
}

function kindForStatus(status: number): FailureKind {
  if (status === 413) return 'too_large';
  if (status === 415) return 'wrong_file';
  if (status === 429) return 'busy';
  if (status === 409 || status === 410) return 'form_closed';
  if (status === 401 || status === 403 || status === 404) return 'link_invalid';
  if (status === 408 || status === 502 || status === 503 || status === 504) return 'timeout';
  if (status === 400 || status === 422) return 'rejected';
  return 'server_error';
}

/** A server text is a sentence for people (not a code like `invalid_slot`). */
function looksLikeSentence(text: unknown): text is string {
  return typeof text === 'string' && /\s/.test(text.trim()) && /[.!?]$/.test(text.trim());
}

/**
 * fetch + JSON parse that never throws. Every failure is named, and
 * recorded when `context` is given.
 */
export async function requestJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit,
  context?: FailureContext
): Promise<RequestOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    const failure: RequestFailure = {
      ok: false,
      kind: 'offline',
      status: null,
      code: null,
      serverMessage: null,
    };
    if (context) reportClientFailure(context, failure);
    return failure;
  }

  let body: unknown = null;
  let readable = true;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    readable = false;
  }

  if (res.ok && readable) {
    return { ok: true, status: res.status, data: body as T };
  }

  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof obj.error === 'string' ? obj.error : null;
  const sentence = looksLikeSentence(obj.errorMessage)
    ? obj.errorMessage
    : looksLikeSentence(obj.error)
      ? obj.error
      : null;

  const failure: RequestFailure = {
    ok: false,
    // A 200 we cannot read is still our fault, never "try again forever".
    kind: res.ok ? 'server_error' : kindForStatus(res.status),
    status: res.status,
    code,
    serverMessage: sentence,
    body: body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
  };
  if (context) reportClientFailure(context, failure);
  return failure;
}
