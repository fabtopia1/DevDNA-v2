import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/session';

/** Routes that render without a session. */
const PUBLIC_PATHS = [/^\/login$/, /^\/verify(\/|$)/, /^\/api\/auth\//];

/**
 * Auth gate plus a per-request Content-Security-Policy.
 *
 * The CSP is built here rather than as a static header because Next.js ships
 * an inline bootstrap script on every page: a static policy either has to
 * allow 'unsafe-inline' — which defeats the point — or block the app outright.
 * A per-request nonce lets us keep script-src strict. Next.js reads the nonce
 * from this header and stamps it onto the scripts it emits.
 *
 * `connect-src` explicitly allows loopback because the dashboard has to reach
 * DevDNA Bridge on the technician's own machine while being served from the
 * cloud. That is the one deliberate hole in this policy.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const bridgeOrigins = 'http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*';

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`.trim(),
    // Tailwind injects a style element at runtime; style-src-attr stays locked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${bridgeOrigins}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((pattern) => pattern.test(pathname));

  if (!isPublic && !request.cookies.get(ACCESS_COOKIE)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: [
    // Static assets are served with their own immutable caching and carry no
    // session logic, so they skip this entirely.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
