import { NextRequest, NextResponse } from 'next/server';
import { verifySvpIntakeAccess, scrubRowForClient } from '@/lib/supplier-policy-token';

export const runtime = 'nodejs';

// GET /api/supplier-checks/[token]
// Resolve the Supplier Verification Policy link for the page: company block,
// suggested people, officer pick list, price, current status and (after
// submit) the answers. Never returns the row id, the token or the client id.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  // Reads allow an already-submitted row so the page can render the thank-you view.
  const access = await verifySvpIntakeAccess(token, { allowSubmitted: true });
  if (!access.ok || !access.row) {
    return NextResponse.json(
      { error: access.reason ?? 'not_found' },
      { status: access.status ?? 404 }
    );
  }

  return NextResponse.json(scrubRowForClient(access.row));
}
