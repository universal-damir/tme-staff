// ===================================================================
// FILE UPLOAD (browser side): one function for every form
// ===================================================================
//
// Small files (up to DIRECT_UPLOAD_THRESHOLD) go to the form's upload route
// as multipart, as before. Larger ones would be refused by Netlify (request
// body limit ~6 MB, multipart overhead included), so they go by direct
// upload: the route hands out a one-time Supabase URL, the browser sends
// the file there, and the route checks and stores it (lib/direct-upload.ts).
// Either way the caller gets the route's normal answer, or a named failure.

import { MAX_FILE_BYTES } from './file-validation';
import {
  requestJson,
  type RequestFailure,
  type RequestOutcome,
} from './request-outcome';
import { reportClientFailure, type FailureContext } from './client-error-log';

/** Files above this size go by direct upload. Under Netlify's limit with room for multipart. */
export const DIRECT_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

function failure(kind: RequestFailure['kind'], status: number | null, code: string | null): RequestFailure {
  return { ok: false, kind, status, code, serverMessage: null };
}

/**
 * Upload `file` to a form's upload route. `fields` are the route's own
 * multipart fields (e.g. submissionId + type, or slot).
 */
export async function uploadFileToRoute<T = Record<string, unknown>>(
  routeUrl: string,
  fields: Record<string, string>,
  file: File,
  context: FailureContext,
  maxBytes: number = MAX_FILE_BYTES
): Promise<RequestOutcome<T>> {
  const ctx: FailureContext = { ...context, file: { size: file.size, type: file.type } };

  if (file.size > maxBytes) {
    const tooLarge = failure('too_large', null, 'file_size_out_of_range');
    reportClientFailure(ctx, tooLarge);
    return tooLarge;
  }

  if (file.size <= DIRECT_UPLOAD_THRESHOLD) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.append(key, value);
    fd.append('file', file);
    return requestJson<T>(routeUrl, { method: 'POST', body: fd }, ctx);
  }

  // 1. Ask the route for a one-time upload URL.
  const started = await requestJson<{ uploadUrl: string; uploadId: string }>(
    routeUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, step: 'start', size: file.size }),
    },
    ctx
  );
  if (!started.ok) return started;

  // 2. Send the file straight to Supabase.
  let put: Response;
  try {
    put = await fetch(started.data.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: file,
    });
  } catch {
    const offline = failure('offline', null, 'direct_upload_put');
    reportClientFailure(ctx, offline);
    return offline;
  }
  if (!put.ok) {
    const kind = put.status === 413 ? 'too_large' : put.status >= 500 ? 'timeout' : 'server_error';
    const putFailure = failure(kind, put.status, 'direct_upload_put');
    reportClientFailure(ctx, putFailure);
    return putFailure;
  }

  // 3. The route checks the file and stores it under its final name.
  return requestJson<T>(
    routeUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...fields,
        step: 'finish',
        uploadId: started.data.uploadId,
        filename: file.name,
      }),
    },
    ctx
  );
}
