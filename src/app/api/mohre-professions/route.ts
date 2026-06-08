/**
 * MOHRE Professions API
 *
 * Source of the job-title dropdown list. Resolution order:
 *
 *   1. Supabase mirror table `mohre_professions` — the internal TME portal
 *      pushes its full active professions list here (cron sync-mohre-professions).
 *      This is the real source in production: tme-staff runs on Netlify and
 *      CANNOT reach the air-gapped portal's private IP, so a direct portal call
 *      always fails. The Supabase mirror is the shared meeting point.
 *
 *   2. Direct portal call — only works from inside the TME network / local dev
 *      (TME_PORTAL_URL=http://localhost:3000). Harmless best-effort on Netlify.
 *
 *   3. Hardcoded JOB_TITLES — last-resort fallback so the form is never empty.
 *
 * Returns `{ professions: [...] }`; shape consumed by useMohreProfessions().
 */

import { NextResponse } from 'next/server';
import { JOB_TITLES } from '@/lib/constants';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function GET() {
  // 1) Primary: Supabase mirror (full list pushed by the portal).
  //    PostgREST caps each response at 1000 rows (db-max-rows), and the list
  //    is larger than that, so page through with .range() until exhausted —
  //    otherwise the dropdown silently loses everything past the 1000th
  //    alphabetical entry.
  try {
    const supabase = getSupabaseAdmin();
    const PAGE = 1000;
    type Row = {
      description_english: string;
      description_arabic: string | null;
      job_code: string | null;
      professional_level: number | null;
    };
    const professions: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('mohre_professions')
        .select('description_english, description_arabic, job_code, professional_level')
        .eq('is_active', true)
        .order('description_english', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      professions.push(...(data as Row[]));
      if (data.length < PAGE) break;
    }

    if (professions.length > 0) {
      return NextResponse.json({ professions });
    }
    // Empty mirror (not yet seeded) — fall through to the portal/fallback.
  } catch (err) {
    console.error('Supabase professions read failed, trying portal:', err);
  }

  // 2) Secondary: direct portal call (reachable only inside the network / dev).
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${TME_PORTAL_URL}/api/mohre-professions`, {
      headers: {
        'x-api-secret': process.env.STAFF_PORTAL_API_SECRET || '',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Portal responded with ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('Failed to fetch professions from portal, using fallback:', err);
    // 3) Last resort: hardcoded list (excluding "Other" — hook adds it client-side).
    const fallback = JOB_TITLES
      .filter((t) => t !== 'Other')
      .map((t) => ({
        id: 0,
        description_english: t,
        description_arabic: null,
        job_code: null,
        professional_level: null,
      }));
    return NextResponse.json({ professions: fallback });
  }
}
