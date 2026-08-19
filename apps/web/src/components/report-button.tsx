'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ExistingReport {
  id: string;
  publicId: string;
  createdAt: string;
}

export function ReportButton({
  inspectionId,
  existing,
}: {
  inspectionId: string;
  existing: ExistingReport[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = existing[0];

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/proxy/v1/inspections/${inspectionId}/report`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? 'Could not generate the report');
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="text-right">
      <div className="flex items-center gap-2">
        {latest ? (
          <a
            href={`/api/reports/${latest.id}/download`}
            className="rounded-md border border-hairline bg-white px-3 py-2 text-xs font-medium text-ink-soft"
          >
            Download PDF
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => void generate()}
          disabled={pending}
          className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Generating…' : latest ? 'Regenerate report' : 'Generate report'}
        </button>
      </div>
      {latest ? (
        <p className="mt-1 font-mono text-[11px] text-muted">Report {latest.publicId}</p>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-flagged">{error}</p> : null}
    </div>
  );
}
