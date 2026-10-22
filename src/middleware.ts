import { NextRequest, NextResponse } from 'next/server';
import { ORIGIN_LOCK_HEADER, originLockDecision } from '@/lib/origin-lock';

// Origin lock: see src/lib/origin-lock.ts.
export function middleware(req: NextRequest) {
  const decision = originLockDecision({
    secret: process.env.ORIGIN_LOCK_SECRET,
    header: req.headers.get(ORIGIN_LOCK_HEADER),
    method: req.method,
    host: req.headers.get('host'),
    pathAndQuery: req.nextUrl.pathname + req.nextUrl.search,
  });
  if (decision.kind === 'pass') return NextResponse.next();
  if (decision.kind === 'redirect') return NextResponse.redirect(decision.location, 308);
  return new NextResponse('Forbidden', { status: 403 });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
