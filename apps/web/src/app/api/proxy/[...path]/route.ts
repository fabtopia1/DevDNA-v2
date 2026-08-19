import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/session';

/**
 * Same-origin proxy for the handful of calls the browser genuinely has to
 * make itself (running an inspection, generating a report).
 *
 * The path is matched against an explicit allowlist rather than forwarded
 * blindly: this handler attaches the session's bearer token, so an open proxy
 * here would let any page on the origin call any API endpoint with the user's
 * full authority.
 */
const ALLOWED: Array<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^v1\/inspections\/ingest$/ },
  { method: 'POST', pattern: /^v1\/inspections\/[\w-]+\/report$/ },
  { method: 'POST', pattern: /^v1\/inspections\/[\w-]+\/rescore$/ },
  { method: 'POST', pattern: /^v1\/bridges$/ },
  { method: 'DELETE', pattern: /^v1\/bridges\/[\w-]+$/ },
  { method: 'GET', pattern: /^v1\/inspections(\?.*)?$/ },
  { method: 'GET', pattern: /^v1\/inspections\/[\w-]+$/ },
  { method: 'GET', pattern: /^v1\/bridges$/ },
];

async function forward(request: Request, path: string[], method: string) {
  const url = new URL(request.url);
  const joined = path.join('/') + (url.search || '');

  if (!ALLOWED.some((rule) => rule.method === method && rule.pattern.test(joined))) {
    return NextResponse.json({ message: 'Endpoint not permitted through the proxy' }, { status: 403 });
  }

  const token = await getAccessToken();
  if (!token) return NextResponse.json({ message: 'Not signed in' }, { status: 401 });

  const body = method === 'GET' || method === 'DELETE' ? undefined : await request.text();

  const upstream = await fetch(`${API_BASE_URL}/${joined}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body } : {}),
    cache: 'no-store',
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, 'GET');
}
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, 'POST');
}
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, 'DELETE');
}
