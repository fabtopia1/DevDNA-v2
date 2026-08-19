import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { ACCESS_COOKIE, REFRESH_COOKIE, getRefreshToken } from '@/lib/session';

export async function POST() {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    // Revoke server-side as well as clearing the cookie; a cleared cookie
    // alone would leave a valid token in anyone's hands who had copied it.
    await fetch(`${API_BASE_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
