import { apiFetch } from '@/lib/api';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';
import { PairWorkstation } from '@/components/pair-workstation';
import type { BridgeRegistration } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const bridges = await apiFetch<BridgeRegistration[]>('/v1/bridges');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Workstations</h1>
        <p className="mt-1 text-xs text-muted">
          Each bench that runs DevDNA Bridge is paired once and can then submit inspections.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Paired workstations" description={`${bridges.length} registered`} />
          {bridges.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No workstations paired"
                description="Pair a bench to start submitting inspections from it."
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {bridges.map((bridge) => (
                <li key={bridge.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-xs font-medium text-ink">
                      {bridge.name}
                      {bridge.revokedAt ? <span className="ml-2 text-flagged">revoked</span> : null}
                    </p>
                    <p className="text-[11px] text-muted">
                      {bridge.workstation ?? 'unknown host'}
                      {bridge.version ? ` · bridge ${bridge.version}` : ''} · {bridge.inspectionCount}{' '}
                      inspection{bridge.inspectionCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-[11px] font-medium ${bridge.online ? 'text-verified' : 'text-muted'}`}
                    >
                      {bridge.online ? 'Online' : 'Offline'}
                    </span>
                    <p className="text-[11px] text-muted">
                      {bridge.lastSeenAt ? formatDate(bridge.lastSeenAt) : 'never seen'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <PairWorkstation />
      </div>
    </div>
  );
}
