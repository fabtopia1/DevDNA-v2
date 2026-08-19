import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/session';

/**
 * Streams a report PDF through the origin so the browser never needs a bearer
 * token to fetch it. The API still scopes the lookup to the caller's
 * organization, so this handler adds no authority of its own.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ message: 'Not signed in' }, { status: 401 });

  const upstream = await fetch(`${API_BASE_URL}/v1/reports/${encodeURIComponent(id)}/download`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    return NextResponse.json({ message: 'Report not found' }, { status: upstream.status });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        upstream.headers.get('content-disposition') ?? `attachment; filename="devdna-report-${id}.pdf"`,
    },
  });
}
