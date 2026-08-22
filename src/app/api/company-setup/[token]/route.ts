import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { verifyCompanySetupAccess, scrubRowForClient } from '@/lib/company-setup-token';

export const runtime = 'nodejs';

// GET /api/company-setup/[token]
// Resolve the intake token for the page: status, prefill data, any draft the
// client already autosaved, and the uploaded document refs. Marks the row
// in_progress on first open so the portal tracker shows the client started.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // Reads allow an already-submitted row so the page can render the thank-you view.
  const access = await verifyCompanySetupAccess(token, { allowSubmitted: true });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }

  const row = access.row;

  // First open: invited -> in_progress. Best-effort — a failed flip never
  // blocks the client from seeing the form (the next autosave flips it too).
  if (row.status === 'invited') {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('company_setup_intake_submissions')
      .update({ status: 'in_progress' })
      .eq('id', row.id)
      .eq('status', 'invited');
    if (!error) row.status = 'in_progress';
  }

  return NextResponse.json(scrubRowForClient(row));
}
