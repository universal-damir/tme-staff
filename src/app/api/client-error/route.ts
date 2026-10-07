import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getClientIp } from '@/lib/ai-route-guard';

export const runtime = 'nodejs';

// POST /api/client-error
// Stores one upload/check failure from a form (see lib/client-error-log.ts)
// in `staff_portal_client_errors`, so the team sees failures without waiting
// for an email. Public like the forms themselves, so it only takes short,
// plain fields and has its own small per-IP budget (separate from the AI
// routes' budget, so logging can never block a real check).

const LOG_WINDOW_MS = 60_000;
const LOG_MAX_PER_WINDOW = 20;
const logRate = new Map<string, { count: number; resetAt: number }>();

function logRateBlocked(ip: string): boolean {
  const now = Date.now();
  const bucket = logRate.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    logRate.set(ip, { count: 1, resetAt: now + LOG_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > LOG_MAX_PER_WINDOW;
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function smallInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 2_000_000_000
    ? Math.round(value)
    : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  if (logRateBlocked(ip)) return new NextResponse(null, { status: 204 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const form = shortText(body.form, 40);
  const action = shortText(body.action, 80);
  const kind = shortText(body.kind, 40);
  if (!form || !action || !kind) return new NextResponse(null, { status: 204 });

  try {
    const { error } = await getSupabaseAdmin()
      .from('staff_portal_client_errors')
      .insert({
        form,
        action,
        kind,
        ref: shortText(body.ref, 80),
        http_status: smallInt(body.status),
        code: shortText(body.code, 120),
        file_size: smallInt(body.fileSize),
        file_type: shortText(body.fileType, 80),
        page: shortText(body.page, 200),
        user_agent: shortText(req.headers.get('user-agent'), 300),
      });
    if (error) console.error('client-error: insert failed', error.message);
  } catch (err) {
    console.error('client-error: unexpected', err instanceof Error ? err.message : err);
  }
  // Always quiet: the form never waits on or reacts to logging.
  return new NextResponse(null, { status: 204 });
}
