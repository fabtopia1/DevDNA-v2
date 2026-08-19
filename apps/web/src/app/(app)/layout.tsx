import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/api';
import { DEV_USER, devAuthBypassEnabled } from '@/lib/dev-auth';
import { SignOutButton } from '@/components/sign-out-button';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/inspect', label: 'New inspection' },
  { href: '/inspections', label: 'Inspections' },
  { href: '/settings', label: 'Workstations' },
];

interface HeaderIdentity {
  name: string;
  email: string;
  role: string;
  organization: { name: string };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const bypass = devAuthBypassEnabled();

  // In bypass mode the identity is known locally, so the header renders without
  // a round trip. The API is still called for the organization name, because a
  // stale hard-coded workspace name is exactly the kind of small lie that makes
  // a dev environment untrustworthy — but a failure is not fatal here.
  const remote = await apiFetch<HeaderIdentity>('/v1/auth/me').catch(() => null);

  const me: HeaderIdentity | null = bypass
    ? {
        name: DEV_USER.name,
        email: DEV_USER.email,
        role: DEV_USER.role,
        organization: { name: remote?.organization.name ?? DEV_USER.workspaceId },
      }
    : remote;

  return (
    <div className="min-h-screen bg-panel">
      {bypass ? (
        <div className="bg-caution px-6 py-1 text-center text-[11px] font-medium tracking-wide text-white">
          Authentication is disabled (DEV_AUTH_BYPASS). Every request runs as{' '}
          <span className="font-mono">{DEV_USER.email}</span>.
        </div>
      ) : null}

      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight text-ink">DevDNA</span>
              <span className="text-[10px] tracking-widest text-muted uppercase">SoftwareDNA</span>
            </Link>
            {bypass ? (
              <span
                title="DEV_AUTH_BYPASS=true — authentication is disabled"
                className="rounded-md border border-caution/30 bg-caution-soft px-2 py-0.5 text-[10px] font-semibold tracking-widest text-caution uppercase"
              >
                Dev mode
              </span>
            ) : null}
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-panel"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {me ? (
              <div className="text-right">
                <p className="text-xs font-medium text-ink">{me.organization.name}</p>
                <p className="text-[11px] text-muted">
                  {me.name} · {me.role.toLowerCase()}
                </p>
              </div>
            ) : null}
            {/* Nothing to sign out of while the bypass is on. */}
            {bypass ? null : <SignOutButton />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
