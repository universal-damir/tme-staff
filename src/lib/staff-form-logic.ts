/**
 * Pure helpers shared between EmployerForm and EmployeeForm.
 * Factored out so they can be unit-tested without mounting the components.
 */

import type { StaffDocumentReferences } from '@/types';

/**
 * Merge existing submission documents with employee-side uploaded docs.
 * The existing docs spread FIRST so that employer-uploaded documents
 * (e.g. job_offer_letter) survive when the employee form saves its own docs.
 */
export function mergeStaffDocRefs(
  existing: StaffDocumentReferences | null | undefined,
  employeeDocs: Partial<StaffDocumentReferences>
): StaffDocumentReferences {
  return { ...(existing ?? {}), ...employeeDocs };
}

/**
 * Detect whether the visa applicant is a Pakistani national. Accepts either
 * the demonym ("Pakistani") or the country name ("Pakistan"), case-insensitive.
 */
export function isPakistaniNationality(nationality: string | null | undefined): boolean {
  if (!nationality) return false;
  const n = nationality.trim().toLowerCase();
  return n === 'pakistani' || n === 'pakistan';
}

/**
 * Detect whether the registered authority (from the portal's prefill data) is
 * DMCC. The portal may pass either short-form "DMCC" or the full name
 * "DMCC Free Zone Authority", so we match on substring, case-insensitive.
 */
export function isDmccAuthority(registeredAuthority: string | null | undefined): boolean {
  if (!registeredAuthority) return false;
  return registeredAuthority.toUpperCase().includes('DMCC');
}
