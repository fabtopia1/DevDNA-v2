import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from '@/lib/session';

/**
 * Exchanges credentials for a session.
 *
 * The token pair is written to httpOnly cookies and never returned to the
 * page, so no script in the browser can read it.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ message: 'Email and password are required' }, { status: 400 });
  }

  const upstream = await fetch(`${API_BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { message: payload?.message ?? 'Sign in failed' },
      { status: upstream.status },
    );
  }

  const response = NextResponse.json({ user: payload.user });
  response.cookies.set(ACCESS_COOKIE, payload.accessToken, cookieOptions(payload.expiresIn ?? 900));
  response.cookies.set(REFRESH_COOKIE, payload.refreshToken, cookieOptions(30 * 24 * 60 * 60));
  return response;
}
