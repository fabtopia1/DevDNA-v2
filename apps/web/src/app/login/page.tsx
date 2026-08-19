import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { devAuthBypassEnabled } from '@/lib/dev-auth';

export const metadata = { title: 'Sign in · DevDNA' };

/**
 * Server component so the page renders on the server and picks up the CSP
 * nonce. Reading `next` here rather than with `useSearchParams` in the client
 * avoids a client-side-rendering bailout, which would ship a shell whose own
 * scripts the nonce policy then blocks.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Requirement of the bypass: the sign-in screen does not exist while it is
  // on. The middleware already redirects, but a direct render (a hard refresh,
  // a bookmarked link) must not paint a form that cannot authenticate.
  if (devAuthBypassEnabled()) redirect('/dashboard');

  const { next } = await searchParams;
  // Only same-origin relative paths are accepted, so a crafted link cannot
  // bounce a freshly signed-in technician to another site.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  return <LoginForm next={safeNext} />;
}
