import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Badge, Card, CardHeader, EmptyState, Stat } from '@/components/ui/primitives';
import {
  STATUS_LABEL,
  STATUS_STYLE,
  VERDICT_LABEL,
  VERDICT_STYLE,
  componentLabel,
  formatDate,
  scoreTone,
} from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const summary = await apiFetch<DashboardSummary>('/v1/dashboard/summary?days=30');
  const { totals, averages } = summary;

  const nonGenuine = summary.partBreakdown
    .filter((row) => row.verdict === 'UNKNOWN_PART' || row.verdict === 'USED_APPLE_PART')
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-xs text-muted">Last {summary.windowDays} days of inspection activity.</p>
        </div>
        <Link
          href="/inspect"
          className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white"
        >
          Start an inspection
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total inspections" value={totals.inspections} hint={`${totals.inspectionsInWindow} in window`} />
        <Stat label="Devices seen" value={totals.devices} />
        <Stat label="Verified" value={totals.verified} tone="text-verified" />
        <Stat label="Flagged / caution" value={totals.flagged} tone={totals.flagged > 0 ? 'text-flagged' : undefined} />
        <Stat
          label="Average trust"
          value={averages.trustScore ?? '—'}
          tone={averages.trustScore ? scoreTone(averages.trustScore) : undefined}
          hint={averages.confidence ? `${Math.round(averages.confidence * 100)}% mean confidence` : undefined}
        />
      </div>

      {totals.inconclusive > 0 ? (
        <p className="rounded-md border border-hairline bg-white px-4 py-3 text-xs text-muted">
          <span className="font-medium text-ink">{totals.inconclusive} inconclusive</span> inspection
          {totals.inconclusive === 1 ? '' : 's'} in this window. These devices did not yield enough evidence
          to certify — re-run them unlocked with a Parts &amp; Service History attestation attached.
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
                  <Link href={`/inspections/${item.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-panel">
                    <span className={`tabular w-10 text-lg font-semibold ${scoreTone(item.trustScore)}`}>
                      {item.trustScore}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {item.device.marketingName}
                        {item.device.capacityGb ? ` · ${item.device.capacityGb} GB` : ''}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {formatDate(item.createdAt)}
                        {item.user ? ` · ${item.user.name}` : ''}
                      </span>
                    </span>
                    <Badge className={STATUS_STYLE[item.verificationStatus]}>
                      {STATUS_LABEL[item.verificationStatus]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Component findings" description="Parts not original to the device" />
            <div className="p-5">
              {nonGenuine.length === 0 ? (
                <p className="text-xs text-muted">
                  No used or non-genuine components detected in this window.
                </p>
              ) : (
                <ul className="space-y-2">
                  {nonGenuine.slice(0, 8).map((row) => (
                    <li key={`${row.component}-${row.verdict}`} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink">{componentLabel(row.component)}</span>
                      <span className="flex items-center gap-2">
                        <Badge className={VERDICT_STYLE[row.verdict]}>{VERDICT_LABEL[row.verdict]}</Badge>
                        <span className="tabular w-6 text-right text-xs font-medium text-ink">{row.count}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Score averages" description="Across the window" />
            <div className="space-y-3 p-5">
              {[
                ['Battery', averages.batteryScore],
                ['Software', averages.softwareScore],
                ['Parts', averages.partsScore],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between">
                  <span className="text-xs text-muted">{label}</span>
                  <span
                    className={`tabular text-sm font-semibold ${
                      typeof value === 'number' ? scoreTone(value) : 'text-muted'
                    }`}
                  >
                    {value ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
