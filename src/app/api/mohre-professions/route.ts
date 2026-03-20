/**
 * MOHRE Professions Proxy API
 *
 * Fetches the dynamic professions list from tme-portal.
 * Falls back to hardcoded JOB_TITLES if portal is unreachable.
 */

import { NextResponse } from 'next/server';
import { JOB_TITLES } from '@/lib/constants';

const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function GET() {
  try {
    const response = await fetch(`${TME_PORTAL_URL}/api/mohre-professions`, {
      headers: {
        'x-api-secret': process.env.STAFF_PORTAL_API_SECRET || '',
      },
      cache: 'no-store', // Always fetch fresh from portal
    });

    if (!response.ok) {
      throw new Error(`Portal responded with ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('Failed to fetch professions from portal, using fallback:', err);
    // Fallback to hardcoded list (excluding "Other" — hook adds it client-side)
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
