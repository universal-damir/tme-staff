/**
 * Notify Employer Complete API
 *
 * POST: Called from the frontend when employer completes their section
 * - Proxies the request to the TME Portal API
 * - This triggers the employee invitation email
 */

import { NextRequest, NextResponse } from 'next/server';

// TME Portal API URL - defaults to production if not set
const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { supabaseId, jobTitle } = body;

    // Validate required fields
    if (!supabaseId) {
      return NextResponse.json(
        { error: 'Supabase ID is required' },
        { status: 400 }
      );
    }

    console.log(`[notify-employer-complete] Notifying TME Portal for supabaseId: ${supabaseId}`);

    // Call the TME Portal API
    const response = await fetch(
      `${TME_PORTAL_URL}/api/clients-v2/staff/onboarding/employer-complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          supabaseId,
          jobTitle,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('[notify-employer-complete] TME Portal returned error:', result);
      return NextResponse.json(
        { error: result.error || 'Failed to notify TME Portal' },
        { status: response.status }
      );
    }

    console.log('[notify-employer-complete] TME Portal response:', result);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[notify-employer-complete] Error:', error);
    return NextResponse.json(
      { error: 'Failed to notify employer completion' },
      { status: 500 }
    );
  }
}
