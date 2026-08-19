import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { STATUS_LABEL, STATUS_STYLE, formatDate, scoreTone } from '@/lib/format';
import type { InspectionList, VerificationStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES: Array<VerificationStatus | 'ALL'> = [
  'ALL',
  'VERIFIED',
  'VERIFIED_WITH_NOTES',
  'CAUTION',
  'FLAGGED',
  'INCONCLUSIVE',
];

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; search?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ page: params.page ?? '1', pageSize: '25' });
  if (params.status && params.status !== 'ALL') query.set('status', params.status);
  if (params.search) query.set('search', params.search);

  const list = await apiFetch<InspectionList>(`/v1/inspections?${query.toString()}`);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Inspections</h1>
          <p className="mt-1 text-xs text-muted">{list.total} total</p>
        </div>
        <Link href="/inspect" className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white">
          Start an inspection
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1.5">
        {STATUSES.map((status) => {
          const active = (params.status ?? 'ALL') === status;
          return (
            <Link
              key={status}
              href={status === 'ALL' ? '/inspections' : `/inspections?status=${status}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                active ? 'border-brand bg-brand text-white' : 'border-hairline bg-white text-ink-soft'
              }`}
            >
              {status === 'ALL' ? 'All' : STATUS_LABEL[status]}
            </Link>
          );
        })}
      </nav>

      <Card>
        {list.items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Nothing here yet"
              description="Inspections appear once a paired workstation submits one."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-hairline text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Trust</th>
                  <th className="px-3 py-2.5 font-medium">Device</th>
                  <th className="px-3 py-2.5 font-medium">Battery</th>
                  <th className="px-3 py-2.5 font-medium">Parts</th>
                  <th className="px-3 py-2.5 font-medium">Software</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Inspected</th>
                  <th className="px-5 py-2.5 font-medium">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {list.items.map((item) => (
                  <tr key={item.id} className="hover:bg-panel">
                    <td className="px-5 py-3">
                      <Link
                        href={`/inspections/${item.id}`}
                        className={`tabular text-base font-semibold ${scoreTone(item.trustScore)}`}
                      >
                        {item.trustScore}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/inspections/${item.id}`} className="block">
                        <span className="font-medium text-ink">{item.device.marketingName}</span>
                        <span className="block text-[11px] text-muted">
                          {item.device.capacityGb ? `${item.device.capacityGb} GB` : '—'}
                          {item.device.regionName ? ` · ${item.device.regionName}` : ''}
                        </span>
                      </Link>
                    </td>
                    <td className="tabular px-3 py-3 text-muted">
                      {item.batteryHealthPercent !== null ? `${item.batteryHealthPercent}%` : '—'}
                      {item.batteryCycleCount !== null ? (
                        <span className="block text-[11px]">{item.batteryCycleCount} cycles</span>
                      ) : null}
                    </td>
                    <td className={`tabular px-3 py-3 font-medium ${scoreTone(item.partsScore)}`}>
                      {item.partsScore}
                    </td>
                    <td className={`tabular px-3 py-3 font-medium ${scoreTone(item.softwareScore)}`}>
                      {item.softwareScore}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={STATUS_STYLE[item.verificationStatus]}>
                        {STATUS_LABEL[item.verificationStatus]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-muted">{formatDate(item.createdAt)}</td>
                    <td className="px-5 py-3 text-muted">
                      {item.reportCount > 0 ? `${item.reportCount} issued` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {list.totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            Page {list.page} of {list.totalPages}
          </span>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link
                href={`/inspections?page=${list.page - 1}${params.status ? `&status=${params.status}` : ''}`}
                className="rounded-md border border-hairline bg-white px-3 py-1.5 font-medium text-ink-soft"
              >
                Previous
              </Link>
            ) : null}
            {list.page < list.totalPages ? (
              <Link
                href={`/inspections?page=${list.page + 1}${params.status ? `&status=${params.status}` : ''}`}
                className="rounded-md border border-hairline bg-white px-3 py-1.5 font-medium text-ink-soft"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
