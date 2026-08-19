'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? 'Sign in failed');
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError('Could not reach the DevDNA API.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-lg font-semibold tracking-tight text-ink">DevDNA</p>
          <p className="mt-1 text-xs tracking-widest text-muted uppercase">SoftwareDNA</p>
        </div>

        <form onSubmit={onSubmit} className="rounded-lg border border-hairline bg-white p-6">
          <h1 className="text-sm font-semibold text-ink">Sign in to your workspace</h1>

          <label className="mt-5 block text-xs font-medium text-muted" htmlFor="email">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-hairline px-3 py-2 text-sm outline-none focus:border-brand"
          />

          <label className="mt-4 block text-xs font-medium text-muted" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-hairline px-3 py-2 text-sm outline-none focus:border-brand"
          />

          {error ? (
            <p role="alert" className="mt-4 rounded-md bg-flagged-soft px-3 py-2 text-xs text-flagged">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="mt-6 w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-muted">
          Demo workspace: owner@demoshop.test / DevDNA-demo-2026
        </p>
      </div>
    </main>
  );
}
