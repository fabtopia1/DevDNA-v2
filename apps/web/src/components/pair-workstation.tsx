'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/primitives';

interface PairResult {
  id: string;
  name: string;
  token: string;
  secret: string;
}

export function PairWorkstation() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [workstation, setWorkstation] = useState('');
  const [result, setResult] = useState<PairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/proxy/v1/bridges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, workstation: workstation || undefined }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? 'Could not pair the workstation');
        return;
      }
      setResult(body);
      setName('');
      setWorkstation('');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Pair a workstation" description="Credentials are shown once and cannot be recovered." />
      <div className="p-5">
        {result ? (
          <div className="space-y-3">
            <p className="rounded-md bg-caution-soft px-3 py-2 text-[11px] text-caution">
              Copy these now. They are not stored in a recoverable form and will not be shown again.
            </p>
            <div>
              <p className="text-[11px] font-medium text-muted">Environment for the bridge</p>
              <pre className="mt-1 overflow-x-auto rounded-md bg-panel p-3 font-mono text-[10px] text-ink">
{`DEVDNA_API_URL=<your api url>
DEVDNA_BRIDGE_TOKEN=${result.token}
DEVDNA_BRIDGE_SECRET=${result.secret}

devdna-bridge serve`}
              </pre>
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-[11px] text-brand underline"
            >
              Pair another workstation
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-[11px] font-medium text-muted">Name</span>
              <input
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Counter bench 1"
                className="mt-1 w-full rounded-md border border-hairline px-3 py-2 text-xs outline-none focus:border-brand"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-muted">Hostname (optional)</span>
              <input
                value={workstation}
                onChange={(e) => setWorkstation(e.target.value)}
                placeholder="BENCH-01"
                className="mt-1 w-full rounded-md border border-hairline px-3 py-2 text-xs outline-none focus:border-brand"
              />
            </label>
            {error ? <p className="text-[11px] text-flagged">{error}</p> : null}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-brand px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
            >
              {pending ? 'Pairing…' : 'Pair workstation'}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}
