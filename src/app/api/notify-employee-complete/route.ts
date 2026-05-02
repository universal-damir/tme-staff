/**
 * Notify Employee Complete API
 *
 * POST: Called from the frontend when employee completes their section
 * - Proxies the request to the TME Portal API
 * - This triggers the staff sync (data import + confirmation emails)
 */

import { NextRequest, NextResponse } from 'next/server';
import { signWebhookBody } from '@/lib/webhook-signature';

// TME Portal API URL - defaults to production if not set
const TME_PORTAL_URL = process.env.TME_PORTAL_URL || 'https://portal.tme-services.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { supabaseId } = body;

    // Validate required fields
    if (!supabaseId) {
      return NextResponse.json(
        { error: 'Supabase ID is required' },
        { status: 400 }
      );
    }

    console.log(`[notify-employee-complete] Notifying TME Portal for supabaseId: ${supabaseId}`);

    const apiSecret = process.env.STAFF_PORTAL_API_SECRET;
    if (!apiSecret) {
      console.error('[notify-employee-complete] STAFF_PORTAL_API_SECRET not configured');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    const notifyBody = JSON.stringify({ supabaseId });
    const sigHeaders = signWebhookBody(apiSecret, notifyBody);

    // Call the TME Portal API to trigger sync
    const response = await fetch(
      `${TME_PORTAL_URL}/api/clients-v2/staff/onboarding/employee-complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...sigHeaders,
        },
        body: notifyBody,
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('[notify-employee-complete] TME Portal returned error:', result);
      return NextResponse.json(
        { error: result.error || 'Failed to notify TME Portal' },
        { status: response.status }
      );
    }

    console.log('[notify-employee-complete] TME Portal response:', result);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[notify-employee-complete] Error:', error);
    return NextResponse.json(
      { error: 'Failed to notify employee completion' },
      { status: 500 }
    );
  }
}
