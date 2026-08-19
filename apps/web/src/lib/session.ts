import { cookies } from 'next/headers';

/**
 * Session handling.
 *
 * Tokens live in httpOnly cookies set by our own route handlers, never in
 * localStorage. The dashboard renders inspection evidence and can mint
 * verification reports; a single XSS that could read a bearer token from JS
 * would let an attacker issue fraudulent reports under a shop's name.
 *
 * The browser therefore never sees an access token: server components read the
 * cookie directly, and client-side mutations go through same-origin route
 * handlers that attach it.
 */

export const ACCESS_COOKIE = 'devdna_at';
export const REFRESH_COOKIE = 'devdna_rt';

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}
