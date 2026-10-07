// ===================================================================
// AI CHECK CALL (browser side): one function for every check / extraction
// ===================================================================
//
// Prepares the file (prepareFileForAI keeps it under Netlify's limit), calls
// the route, and turns every way it can fail into a named result with a
// plain message. Every failure is recorded (client-error-log).
//
// `countsAsStrike`: a failed attempt counts toward the "send to our team to
// check by hand" option (MANUAL_REVIEW_THRESHOLD), so a person whose check
// keeps failing is never stuck. Only failures that a hand check cannot fix
// (closed form, wrong link, too many tries) do not count.

import {
  prepareFileForAI,
  FileTooLargeForCheckError,
} from './ai-payload';
import {
  requestJson,
  failureMessage,
  CHECK_UNAVAILABLE_MESSAGE,
  FILE_TOO_LARGE_FOR_CHECK_MESSAGE,
  type FailureKind,
} from './request-outcome';
import { reportClientFailure, type FailureContext } from './client-error-log';

export const UNREADABLE_FILE_MESSAGE =
  'We could not open this file. Please upload a PDF, JPG or PNG that opens on your computer.';

export type AiCheckFailureKind =
  | FailureKind
  | 'check_unavailable'
  | 'too_large_for_check'
  | 'unreadable_file';

export interface AiCheckFailure {
  ok: false;
  kind: AiCheckFailureKind;
  message: string;
  countsAsStrike: boolean;
}

export type AiCheckOutcome<T> = { ok: true; data: T } | AiCheckFailure;

const NO_STRIKE: ReadonlySet<AiCheckFailureKind> = new Set<AiCheckFailureKind>([
  'form_closed',
  'link_invalid',
  'busy',
]);

function checkFailure(kind: AiCheckFailureKind, message: string): AiCheckFailure {
  return { ok: false, kind, message, countsAsStrike: !NO_STRIKE.has(kind) };
}

/**
 * POST `{ ...body, image }` to an AI route. `dataUrl` is the file as a data
 * URL; it is made small enough first. A 200 answer flagged `infra: true`
 * (the check could not run) is a failure here, never a pass.
 */
export async function callAiCheck<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
  dataUrl: string,
  context: FailureContext
): Promise<AiCheckOutcome<T>> {
  let image: string;
  try {
    image = await prepareFileForAI(dataUrl);
  } catch (err) {
    const tooLarge = err instanceof FileTooLargeForCheckError;
    const kind = tooLarge ? 'too_large_for_check' : 'unreadable_file';
    reportClientFailure(context, { kind });
    return checkFailure(kind, tooLarge ? FILE_TOO_LARGE_FOR_CHECK_MESSAGE : UNREADABLE_FILE_MESSAGE);
  }

  const outcome = await requestJson<T & { infra?: boolean }>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, image }),
    },
    context
  );

  if (outcome.ok) {
    if (outcome.data && (outcome.data as { infra?: boolean }).infra === true) {
      reportClientFailure(context, { kind: 'check_unavailable', status: outcome.status });
      return checkFailure('check_unavailable', CHECK_UNAVAILABLE_MESSAGE);
    }
    return { ok: true, data: outcome.data };
  }

  // The route answered "the check could not run" (500 + infra), or the
  // server/AI timed out: the check is unavailable, not the file's fault.
  if (outcome.kind === 'server_error' || outcome.kind === 'timeout') {
    return checkFailure('check_unavailable', CHECK_UNAVAILABLE_MESSAGE);
  }
  if (outcome.kind === 'too_large') {
    return checkFailure('too_large_for_check', FILE_TOO_LARGE_FOR_CHECK_MESSAGE);
  }
  return checkFailure(outcome.kind, failureMessage(outcome));
}
