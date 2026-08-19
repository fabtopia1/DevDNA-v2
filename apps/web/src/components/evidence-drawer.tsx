'use client';

import { useState } from 'react';
import { Badge, Card, CardHeader, cn } from '@/components/ui/primitives';
import {
  componentLabel,
  kindLabel,
  methodLabel,
  moduleLabel,
  reliabilityLabel,
  sourceLabel,
} from '@/lib/format';
import type { EvidenceResponse } from '@/lib/types';

/**
 * The evidence drawer.
 *
 * Loaded on demand and rendered below the conclusions, never mixed into them.
 * A technician arguing with a supplier needs to point at the specific
 * observation behind a verdict, and this is where that lives: every record with
 * its authority, its collection method, and how far that channel can be
 * believed.
 *
 * Collection failures are shown alongside successful reads rather than filtered
 * out. "We asked and the device refused" is why a verdict abstained, and hiding
 * it would make an abstention look like an oversight.
 */
export function EvidenceDrawer({
  inspectionId,
  ledgerDigest,
  evidenceCount,
  inferenceCount,
  auditCount,
}: {
  inspectionId: string;
  ledgerDigest: string;
  evidenceCount: number;
  inferenceCount: number;
  auditCount: number;
}) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [tab, setTab] = useState<'evidence' | 'inferences'>('evidence');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (data) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/proxy/v1/inspections/${inspectionId}/evidence`);
      if (!response.ok) {
        setError('Could not load the evidence for this inspection.');
        return;
      }
      setData(await response.json());
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Evidence and reasoning"
        description={`${evidenceCount} observed records · ${inferenceCount} inferences · ${auditCount} audit steps`}
        action={
          data ? (
            <div className="flex gap-1">
              {(['evidence', 'inferences'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    tab === value ? 'bg-brand text-white' : 'text-ink-soft hover:bg-panel',
                  )}
                >
                  {value === 'evidence' ? 'Observed' : 'Derived'}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void load()}
              disabled={pending}
              className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-soft disabled:opacity-60"
            >
              {pending ? 'Loading…' : 'Show evidence'}
            </button>
          )
        }
      />

      <p className="border-b border-hairline px-5 py-2 font-mono text-[10px] text-muted">
        ledger {ledgerDigest}
      </p>

      {error ? <p className="px-5 py-4 text-xs text-flagged">{error}</p> : null}

      {!data ? (
        <p className="px-5 py-4 text-xs text-muted">
          Every conclusion above cites the records behind it. Open this to see what was observed,
          which authority reported it, and how far that channel can be believed.
        </p>
      ) : tab === 'evidence' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-hairline text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Observation</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Authority</th>
                <th className="px-5 py-2 font-medium">Channel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {data.evidence.map((record) => {
                const failure = record.kind === 'COLLECTION_FAILURE';
                return (
                  <tr key={record.id} className={failure ? 'bg-flagged-soft/30' : undefined}>
                    <td className="px-5 py-2 whitespace-nowrap text-muted">
                      {componentLabel(record.subject)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-ink">{record.key}</span>
                      <span className="ml-1.5 text-[10px] text-muted">{kindLabel(record.kind)}</span>
                    </td>
                    <td className="tabular px-3 py-2 text-ink">
                      {failure ? (
                        <span className="text-flagged">could not read: {String(record.value)}</span>
                      ) : (
                        String(record.value)
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">{sourceLabel(record.sourceAuthority)}</td>
                    <td className="px-5 py-2 text-muted">
                      {methodLabel(record.method)}
                      <span className="block text-[10px]">
                        {reliabilityLabel(record.reliability)} reliability
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {data.inferences.map((inference) => (
            <li key={inference.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink">{inference.statement}</span>
                <span className="flex items-center gap-2">
                  <Badge
                    className={
                      inference.direction === 'SUPPORTS_NEGATIVE'
                        ? 'bg-flagged-soft text-flagged border-flagged/25'
                        : inference.direction === 'SUPPORTS_POSITIVE'
                          ? 'bg-verified-soft text-verified border-verified/25'
                          : 'bg-panel text-muted border-hairline'
                    }
                  >
                    {inference.direction.replace('SUPPORTS_', '').toLowerCase()}
                  </Badge>
                  <span className="tabular text-[11px] text-muted">
                    {Math.round(inference.confidence * 100)}%
                  </span>
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-muted">
                {moduleLabel(inference.module)} · {inference.rule} · cites{' '}
                {inference.evidenceIds.length} record
                {inference.evidenceIds.length === 1 ? '' : 's'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
