import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is not set (server-only secret)');
  cached = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const STORAGE_BUCKET = 'staff-documents';
