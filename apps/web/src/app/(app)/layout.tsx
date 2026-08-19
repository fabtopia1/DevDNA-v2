import Link from 'next/link';
import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/api';
import { SignOutButton } from '@/components/sign-out-button';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/inspect', label: 'New inspection' },
  { href: '/inspections', label: 'Inspections' },
  { href: '/settings', label: 'Workstations' },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await apiFetch<{
    name: string;
    email: string;
    role: string;
    organization: { name: string };
  }>('/v1/auth/me').catch(() => null);

  return (
    <div className="min-h-screen bg-panel">
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight text-ink">DevDNA</span>
              <span className="text-[10px] tracking-widest text-muted uppercase">SoftwareDNA</span>
            </Link>
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
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
