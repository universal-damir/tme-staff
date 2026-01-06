import { createClient } from '@supabase/supabase-js';
import type {
  StaffOnboardingSubmission,
  EmployerFormData,
  EmployeeFormData,
  StaffDocumentReferences,
} from '@/types';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ===================================================================
// GET STAFF ONBOARDING
// ===================================================================

export async function getStaffOnboarding(id: string): Promise<StaffOnboardingSubmission | null> {
  const { data, error } = await supabase
    .from('staff_onboarding_submissions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching staff onboarding:', error);
    return null;
  }

  return data as StaffOnboardingSubmission;
}

// ===================================================================
// UPDATE EMPLOYER DATA
// ===================================================================

export async function updateEmployerData(
  id: string,
  data: EmployerFormData,
  signature: string,
  ip?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('staff_onboarding_submissions')
    .update({
      employer_data: data,
      employer_signature_data: signature,
      employer_signed_at: new Date().toISOString(),
      employer_signer_ip: ip || null,
      current_step: 'employee',
      status: 'employer_completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating employer data:', error);
    return false;
  }

  return true;
}

// ===================================================================
// UPDATE EMPLOYEE DATA
// ===================================================================

export async function updateEmployeeData(
  id: string,
  data: EmployeeFormData,
  signature: string,
  ip?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('staff_onboarding_submissions')
    .update({
      employee_data: data,
      employee_signature_data: signature,
      employee_signed_at: new Date().toISOString(),
      employee_signer_ip: ip || null,
      current_step: 'complete',
      status: 'complete',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating employee data:', error);
    return false;
  }

  return true;
}

// ===================================================================
// UPDATE SAME-PERSON DATA (Both employer and employee in one go)
// ===================================================================

export async function updateSamePersonData(
  id: string,
  employerData: EmployerFormData,
  employeeData: EmployeeFormData,
  signature: string,
  ip?: string
): Promise<boolean> {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('staff_onboarding_submissions')
    .update({
      employer_data: employerData,
      employer_signature_data: signature,
      employer_signed_at: now,
      employer_signer_ip: ip || null,
      employee_data: employeeData,
      employee_signature_data: signature, // Same signature for both
      employee_signed_at: now,
      employee_signer_ip: ip || null,
      current_step: 'complete',
      status: 'complete',
      updated_at: now,
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating same-person data:', error);
    return false;
  }

  return true;
}

// ===================================================================
// UPLOAD DOCUMENT
// ===================================================================

export async function uploadDocument(
  submissionId: string,
  type: 'photo' | 'passport' | 'eid',
  file: File
): Promise<{ path: string; filename: string } | null> {
  const timestamp = Date.now();
  const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${submissionId}/${type}/${timestamp}-${sanitizedFilename}`;

  const { error } = await supabase.storage
    .from('staff-documents')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (error) {
    console.error('Error uploading document:', error);
    return null;
  }

  return { path, filename: file.name };
}

// ===================================================================
// UPLOAD PASSPORT PAGE (for multi-page passport upload)
// ===================================================================

export type PassportPageKey = 'cover' | 'insidePages';

export async function uploadPassportPage(
  submissionId: string,
  pageKey: PassportPageKey,
  file: File
): Promise<{ path: string; filename: string } | null> {
  const timestamp = Date.now();
  const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${submissionId}/passport/${pageKey}/${timestamp}-${sanitizedFilename}`;

  const { error } = await supabase.storage
    .from('staff-documents')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (error) {
    console.error('Error uploading passport page:', error);
    return null;
  }

  return { path, filename: file.name };
}

// ===================================================================
// UPDATE DOCUMENT REFERENCES
// ===================================================================

export async function updateDocumentReferences(
  id: string,
  documents: StaffDocumentReferences
): Promise<boolean> {
  const { error } = await supabase
    .from('staff_onboarding_submissions')
    .update({
      documents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating document references:', error);
    return false;
  }

  return true;
}

// ===================================================================
// GET DOCUMENT URL
// ===================================================================

export function getDocumentUrl(path: string): string {
  const { data } = supabase.storage.from('staff-documents').getPublicUrl(path);
  return data.publicUrl;
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
