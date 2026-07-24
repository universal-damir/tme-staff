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

// ===================================================================
// AUTO-SAVE EMPLOYEE DATA (partial save without signature/completion)
// ===================================================================

export async function autoSaveEmployeeData(
  id: string,
  data: Partial<EmployeeFormData>,
  token?: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/onboarding/${encodeURIComponent(id)}/autosave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token ?? null, employeeData: data }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[autoSaveEmployeeData] save failed:', res.status, detail);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[autoSaveEmployeeData] network error:', err);
    return false;
  }
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

async function shrinkImageToBudget(file: File): Promise<File> {
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

export async function uploadDocument(
  submissionId: string,
  type: 'photo' | 'passport' | 'eid' | 'degree_attested' | 'transcript_of_records' | 'education_additional' | 'job_offer_letter' | 'visa_document' | 'previous_visa_document' | 'eid_front' | 'eid_back' | 'pakistan_id_front' | 'pakistan_id_back' | 'sponsor_passport' | 'sponsor_visa' | 'sponsor_eid_front' | 'sponsor_eid_back' | 'visa' | 'employment_contract' | 'work_permit' | 'health_insurance' | 'iloe_insurance' | 'driving_license' | 'custom',
  file: File
): Promise<{ path: string; filename: string } | null> {
  const fd = new FormData();
  fd.append('submissionId', submissionId);
  fd.append('type', type);
  fd.append('file', await shrinkImageToBudget(file));

  const res = await fetch('/api/storage/upload', { method: 'POST', body: fd });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Error uploading document:', res.status, detail);
    return null;
  }
  const json = await res.json();
  return { path: json.path as string, filename: json.filename as string };
}

// ===================================================================
// UPLOAD PASSPORT PAGE (via server route)
// ===================================================================

export type PassportPageKey = 'cover' | 'insidePages' | 'additionalPage';

export async function uploadPassportPage(
  submissionId: string,
  pageKey: PassportPageKey,
  file: File
): Promise<{ path: string; filename: string } | null> {
  const fd = new FormData();
  fd.append('submissionId', submissionId);
  fd.append('type', 'passport');
  fd.append('passportPage', pageKey);
  fd.append('file', await shrinkImageToBudget(file));

  const res = await fetch('/api/storage/upload', { method: 'POST', body: fd });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Error uploading passport page:', res.status, detail);
    return null;
  }
  const json = await res.json();
  return { path: json.path as string, filename: json.filename as string };
}

// ===================================================================
// UPDATE DOCUMENT REFERENCES (via server route)
// ===================================================================

export async function updateDocumentReferences(
  id: string,
  documents: StaffDocumentReferences,
  token?: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/onboarding/${encodeURIComponent(id)}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token ?? null, documents }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[updateDocumentReferences] save failed:', res.status, detail);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[updateDocumentReferences] network error:', err);
    return false;
  }
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
