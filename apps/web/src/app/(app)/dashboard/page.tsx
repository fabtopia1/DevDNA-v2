import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Badge, Card, CardHeader, EmptyState, Stat, cn } from '@/components/ui/primitives';
import {
  AUTHENTICITY_LABEL,
  AUTHENTICITY_STYLE,
  SERVICE_LABEL,
  SERVICE_STYLE,
  TRUST_LABEL,
  TRUST_STYLE,
  componentLabel,
  confidenceTone,
  formatDate,
  moduleLabel,
  scoreTone,
} from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const summary = await apiFetch<DashboardSummary>('/v1/dashboard/summary?days=30');
  const { totals, averages } = summary;

  const serviced = summary.componentOutcomes
    .filter((row) => row.verdict === 'REPLACED_LIKELY')
    .sort((a, b) => b.count - a.count);

  // Where the engine is blind, per module. A rising abstention rate is the
  // signal that a data source has been closed off upstream, and it is worth
  // more operationally than any single inspection.
  const abstentions = aggregateAbstentions(summary);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-xs text-muted">
            Last {summary.windowDays} days of inspection activity.
          </p>
        </div>
        <Link href="/inspect" className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white">
          Start an inspection
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat
          label="Total inspections"
          value={totals.inspections}
          hint={`${totals.inspectionsInWindow} in window`}
        />
        <Stat label="Devices seen" value={totals.devices} />
        <Stat label="Trusted" value={totals.trusted} tone="text-verified" />
        <Stat
          label="Caution / untrusted"
          value={totals.flagged}
          tone={totals.flagged > 0 ? 'text-flagged' : undefined}
        />
        <Stat
          label="Average trust"
          value={averages.trustScore ?? '—'}
          tone={averages.trustScore ? scoreTone(averages.trustScore) : undefined}
          hint={
            averages.confidence !== null && averages.coverage !== null
              ? `${Math.round(averages.confidence * 100)}% confidence · ${Math.round(averages.coverage * 100)}% coverage`
              : undefined
          }
        />
      </div>

      {totals.insufficientEvidence > 0 ? (
        <p className="rounded-md border border-hairline bg-white px-4 py-3 text-xs text-muted">
          <span className="font-medium text-ink">
            {totals.insufficientEvidence} inspection
            {totals.insufficientEvidence === 1 ? '' : 's'} produced no verdict
          </span>{' '}
          — the evidence did not meet the reporting threshold. These are not failures of the device;
          they are gaps in what could be established. Re-run them unlocked with a Parts &amp;
          Service History attestation attached.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent inspections"
            description="Newest first"
            action={
              <Link href="/inspections" className="text-xs font-medium text-brand">
                View all
              </Link>
            }
          />
          {summary.recent.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No inspections yet"
                description="Connect an iPhone to a workstation running DevDNA Bridge and run your first inspection."
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {summary.recent.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/inspections/${item.id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-panel"
                  >
                    <span
                      className={cn(
                        'tabular w-10 text-lg font-semibold',
                        item.trustVerdict === 'INSUFFICIENT_EVIDENCE'
                          ? 'text-inconclusive'
                          : scoreTone(item.trustScore),
                      )}
                    >
                      {item.trustVerdict === 'INSUFFICIENT_EVIDENCE' ? '—' : item.trustScore}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {item.device.marketingName}
                        {item.device.capacityGb ? ` · ${item.device.capacityGb} GB` : ''}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {formatDate(item.createdAt)}
                        {item.user ? ` · ${item.user.name}` : ''}
                        {item.componentsReplacedCount > 0
                          ? ` · ${item.componentsReplacedCount} component${item.componentsReplacedCount === 1 ? '' : 's'} replaced`
                          : ''}
                      </span>
                    </span>
                    <Badge className={TRUST_STYLE[item.trustVerdict]}>
                      {TRUST_LABEL[item.trustVerdict]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Replaced components"
              description="Where the evidence supports a replacement"
            />
            <div className="p-5">
              {serviced.length === 0 ? (
                <p className="text-xs text-muted">
                  No component replacement was established in this window. That is not the same as
                  none having occurred.
                </p>
              ) : (
                <ul className="space-y-2">
                  {serviced.slice(0, 8).map((row) => (
                    <li
                      key={`${row.component}-${row.authenticity}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-xs text-ink">{componentLabel(row.component)}</span>
                      <span className="flex items-center gap-2">
                        <Badge className={AUTHENTICITY_STYLE[row.authenticity]}>
                          {AUTHENTICITY_LABEL[row.authenticity]}
                        </Badge>
                        <span className="tabular w-6 text-right text-xs font-medium text-ink">
                          {row.count}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Where the engine is blind"
              description="Share of verdicts that could not be determined"
            />
            <div className="space-y-2 p-5">
              {abstentions.length === 0 ? (
                <p className="text-xs text-muted">No verdicts recorded in this window.</p>
              ) : (
                abstentions.map((row) => (
                  <div key={row.module} className="flex items-center justify-between">
                    <span className="text-xs text-muted">{moduleLabel(row.module)}</span>
                    <span
                      className={cn(
                        'tabular text-xs font-semibold',
                        row.abstentionRate > 0.5
                          ? 'text-flagged'
                          : row.abstentionRate > 0.2
                            ? 'text-caution'
                            : 'text-verified',
                      )}
                    >
                      {Math.round(row.abstentionRate * 100)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          {summary.failingCollectors.length > 0 ? (
            <Card>
              <CardHeader
                title="Failing collectors"
                description="Channels the fleet could not read"
              />
              <ul className="space-y-1.5 p-5">
                {summary.failingCollectors.map((row) => (
                  <li key={row.collector} className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-muted">{row.collector}</span>
                    <span className="tabular text-xs font-medium text-ink">{row.failures}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      {summary.topFindings.length > 0 ? (
        <Card>
          <CardHeader title="Most frequent findings" description="Across the window" />
          <ul className="divide-y divide-hairline">
            {summary.topFindings.map((finding) => (
              <li key={finding.code} className="flex items-center justify-between gap-4 px-5 py-2.5">
                <span className="min-w-0">
                  <span className="block font-mono text-[11px] text-ink">{finding.code}</span>
                  <span className="block text-[11px] text-muted">
                    {moduleLabel(finding.module)} · {finding.severity.toLowerCase()}
                  </span>
                </span>
                <span className="tabular text-xs font-medium text-ink">{finding.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function aggregateAbstentions(summary: DashboardSummary) {
  const totals = new Map<string, { determined: number; indeterminate: number }>();
  for (const row of summary.moduleCoverage) {
    const entry = totals.get(row.module) ?? { determined: 0, indeterminate: 0 };
    if (row.determinacy === 'DETERMINED') entry.determined += row.count;
    else entry.indeterminate += row.count;
    totals.set(row.module, entry);
  }

  return [...totals.entries()]
    .map(([module, counts]) => ({
      module: module as DashboardSummary['moduleCoverage'][number]['module'],
      abstentionRate:
        counts.determined + counts.indeterminate > 0
          ? counts.indeterminate / (counts.determined + counts.indeterminate)
          : 0,
    }))
    .sort((a, b) => b.abstentionRate - a.abstentionRate);
}
