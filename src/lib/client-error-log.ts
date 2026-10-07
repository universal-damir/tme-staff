// ===================================================================
// CLIENT ERROR LOG (browser side)
// ===================================================================
//
// Upload and check failures used to live only in the person's browser, so
// the team learned about them from emails. Every named failure is now sent
// to /api/client-error, which stores it in the Supabase table
// `staff_portal_client_errors`. Fire-and-forget: logging must never break
// or slow the form.

import type { FailureKind } from './request-outcome';

/** Where in which form the failure happened. */
export interface FailureContext {
  /** Form name, e.g. 'employee', 'dependent', 'company-setup', 'ekyc'. */
  form: string;
  /** What was being done, e.g. 'check:passport-inside', 'upload:passport'. */
  action: string;
  /** Submission id or link token; lets the team find the person. */
  ref?: string | null;
  /** The file involved, when there was one. */
  file?: { size: number; type: string } | null;
}

export interface LoggedFailure {
  kind: FailureKind | 'check_unavailable' | 'too_large_for_check' | 'unreadable_file';
  status?: number | null;
  code?: string | null;
}

export function reportClientFailure(context: FailureContext, failure: LoggedFailure): void {
  try {
    const payload = JSON.stringify({
      form: context.form,
      action: context.action,
      ref: context.ref ?? null,
      kind: failure.kind,
      status: failure.status ?? null,
      code: failure.code ?? null,
      fileSize: context.file?.size ?? null,
      fileType: context.file?.type ?? null,
      page: typeof window !== 'undefined' ? window.location.pathname : null,
    });
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Logging is best effort.
  }
}
