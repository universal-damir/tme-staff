/**
 * Browser-side helpers for the onboarding flow.
 *
 * After the P0-3 hardening, this module no longer talks to Supabase
 * directly. Every read goes through `/api/onboarding/[id]` (server-side,
 * service-role + token gate) and every write goes through one of:
 *   - `/api/storage/upload`              — magic-byte-validated file upload
 *   - `/api/onboarding/[id]/autosave`    — partial employee_data save
 *   - `/api/onboarding/[id]/documents`   — patch the documents jsonb
 *   - `/api/submit-employer`             — final employer-step write
 *   - `/api/submit-employee`             — final employee-step write
 *
 * The bare anon `supabase` client export is gone; nothing in tme-staff
 * imports an anon Supabase JS instance any more. Anon RLS policies on
 * `staff_onboarding_submissions` were dropped in migration 0246.
 */

import type { StaffDocumentReferences, EmployeeFormData } from '@/types';
import { uploadFileToRoute } from './upload-client';
import { failureMessage, requestJson } from './request-outcome';

// ===================================================================
// AUTO-SAVE EMPLOYEE DATA (partial save without signature/completion)
// ===================================================================

export async function autoSaveEmployeeData(
  id: string,
  data: Partial<EmployeeFormData>,
  token?: string | null,
): Promise<boolean> {
  // requestJson never throws; a failure is named and logged (client-error-log).
  const outcome = await requestJson(
    `/api/onboarding/${encodeURIComponent(id)}/autosave`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token ?? null, employeeData: data }),
    },
    { form: 'staff-onboarding', action: 'autosave', ref: id }
  );
  if (!outcome.ok) {
    console.error('[autoSaveEmployeeData] save failed:', outcome.kind, outcome.status, outcome.code);
    return false;
  }
  return true;
}

// ===================================================================
// UPLOAD DOCUMENT (via server route — service-role + magic-byte validated)
// ===================================================================

/**
 * Netlify hard-caps request bodies around ~6MB, killing large uploads at the
 * edge before our route runs (the client just sees a failed fetch). Images
 * above this budget are transparently downscaled to a JPEG that fits — a
 * 2400px identity-document scan is more than TME review needs. PDFs can't be
 * shrunk client-side and fail the upload; callers surface the size hint.
 */
const UPLOAD_BYTE_BUDGET = 4 * 1024 * 1024;

export async function shrinkImageToBudget(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= UPLOAD_BYTE_BUDGET) return file;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // Quality alone doesn't always get a huge scan under budget — if the
    // 2400px attempts all exceed it, retry at smaller max dimensions before
    // giving up (returning the original would fail the upload at the edge).
    const attempts: Array<{ maxDim: number; qualities: number[] }> = [
      { maxDim: 2400, qualities: [0.85, 0.75, 0.6] },
      { maxDim: 1800, qualities: [0.6] },
      { maxDim: 1400, qualities: [0.6] },
    ];
    for (const { maxDim, qualities } of attempts) {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of qualities) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', quality)
        );
        if (blob && blob.size <= UPLOAD_BYTE_BUDGET) {
          const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          return new File([blob], name, { type: 'image/jpeg' });
        }
      }
    }
    return file;
  } catch {
    // Shrink is best-effort — fall back to the original file.
    return file;
  }
}

/** A stored file. Spread-safe: only the fields saved on a document ref. */
export interface UploadedRef {
  path: string;
  filename: string;
}

/** Why an upload failed, as a plain sentence for the person. */
export interface UploadFailure {
  error: string;
}

export type UploadResult = UploadedRef | UploadFailure;

export function isUploadFailure(result: UploadResult | null | undefined): result is UploadFailure {
  return !result || typeof (result as UploadFailure).error === 'string';
}

type DocumentType = 'photo' | 'passport' | 'eid' | 'degree_attested' | 'transcript_of_records' | 'education_additional' | 'job_offer_letter' | 'visa_document' | 'previous_visa_document' | 'eid_front' | 'eid_back' | 'pakistan_id_front' | 'pakistan_id_back' | 'sponsor_passport' | 'sponsor_visa' | 'sponsor_eid_front' | 'sponsor_eid_back' | 'visa' | 'employment_contract' | 'work_permit' | 'health_insurance' | 'iloe_insurance' | 'driving_license' | 'custom' | 'relationship_certificate' | 'previous_visa' | 'previous_eid_front' | 'previous_eid_back' | 'marriage_certificate' | 'divorce_certificate' | 'death_certificate' | 'noc_unmarried';

async function uploadToStorage(
  submissionId: string,
  fields: Record<string, string>,
  file: File,
  action: string
): Promise<UploadResult> {
  let toSend: File;
  try {
    toSend = await shrinkImageToBudget(file);
  } catch {
    toSend = file;
  }
  const outcome = await uploadFileToRoute<{ path: string; filename: string }>(
    '/api/storage/upload',
    { submissionId, ...fields },
    toSend,
    { form: 'staff-onboarding', action, ref: submissionId }
  );
  if (!outcome.ok) return { error: failureMessage(outcome) };
  return { path: outcome.data.path, filename: outcome.data.filename };
}

export async function uploadDocument(
  submissionId: string,
  type: DocumentType,
  file: File
): Promise<UploadResult> {
  return uploadToStorage(submissionId, { type }, file, `upload:${type}`);
}

// ===================================================================
// UPLOAD PASSPORT PAGE (via server route)
// ===================================================================

export type PassportPageKey = 'cover' | 'insidePages' | 'additionalPage';

export async function uploadPassportPage(
  submissionId: string,
  pageKey: PassportPageKey,
  file: File
): Promise<UploadResult> {
  return uploadToStorage(
    submissionId,
    { type: 'passport', passportPage: pageKey },
    file,
    `upload:passport-${pageKey}`
  );
}

// ===================================================================
// UPDATE DOCUMENT REFERENCES (via server route)
// ===================================================================

export async function updateDocumentReferences(
  id: string,
  documents: StaffDocumentReferences,
  token?: string | null,
  employerToken?: string | null,
): Promise<boolean> {
  const send = () =>
    requestJson(
      `/api/onboarding/${encodeURIComponent(id)}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token ?? null, employerToken: employerToken ?? null, documents }),
      },
      { form: employerToken ? 'employer' : 'staff-onboarding', action: 'save-documents', ref: id }
    );
  let outcome = await send();
  // A dropped connection or a busy server is usually gone a moment later:
  // retry once, so an upload is not left off the saved list. (The submit
  // route checks the saved list and names anything missing.)
  if (!outcome.ok && (outcome.kind === 'offline' || outcome.kind === 'timeout' || outcome.kind === 'server_error')) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    outcome = await send();
  }
  if (!outcome.ok) {
    console.error('[updateDocumentReferences] save failed:', outcome.kind, outcome.status, outcome.code);
    return false;
  }
  return true;
}

// ===================================================================
// GET DOCUMENT URL — returns a stable proxy URL that 302-redirects to a
// short-lived signed URL. Bucket is private; never call getPublicUrl here.
// ===================================================================

export function getDocumentUrl(path: string): string {
  return `/api/storage/file?path=${encodeURIComponent(path)}`;
}

// ===================================================================
// UTILITY: Get Client IP
// ===================================================================

export function getClientIP(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIP = headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  return null;
}
