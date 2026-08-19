'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, CardHeader, EmptyState, cn } from '@/components/ui/primitives';
import { STATUS_LABEL, STATUS_STYLE, VERDICT_LABEL, VERDICT_STYLE, componentLabel, scoreTone } from '@/lib/format';
import {
  BridgeUnavailableError,
  bridgeHealth,
  clearBridgePairing,
  getBridgeToken,
  listBridgeDevices,
  runBridgeInspection,
  saveBridgePairing,
  subscribeToBridge,
  type BridgeDevice,
  type BridgeHealth,
  type CollectionProgress,
  type InspectResponse,
} from '@/lib/bridge-client';
import type { VerificationStatus } from '@/lib/types';

const APPLE_LABELS = [
  'Genuine Apple Part',
  'Used Apple Part',
  'Unknown Part',
  'Unable to verify this part is a genuine Apple part',
] as const;

const ATTESTABLE_COMPONENTS = ['Display', 'Battery', 'Rear Camera', 'Front Camera', 'Face ID'] as const;

type AttestationDraft = Record<string, string>;

export function InspectFlow() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [paired, setPaired] = useState(false);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [devices, setDevices] = useState<BridgeDevice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationDraft>({});
  const [progress, setProgress] = useState<CollectionProgress[]>([]);
  const [result, setResult] = useState<InspectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [healthResult, deviceResult] = await Promise.all([bridgeHealth(), listBridgeDevices()]);
      setHealth(healthResult);
      setDevices(deviceResult.devices);
      setPaired(true);
    } catch (err) {
      setPaired(getBridgeToken() !== null && !(err instanceof BridgeUnavailableError));
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (getBridgeToken()) void refresh();
  }, [refresh]);

  // Live device attach/detach so a technician never has to hit reload while
  // swapping handsets across the bench.
  useEffect(() => {
    if (!paired) return;
    return subscribeToBridge(
      (event) => {
        if (event['type'] === 'device-connected' || event['type'] === 'device-disconnected') {
          void refresh();
        }
        if (event['type'] === 'progress') {
          setProgress((current) => [...current, event as unknown as CollectionProgress]);
        }
      },
      () => undefined,
    );
  }, [paired, refresh]);

  async function onPair(event: React.FormEvent) {
    event.preventDefault();
    saveBridgePairing(token);
    setToken('');
    await refresh();
  }

  async function onRun() {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    setProgress([]);
    setError(null);

    const entries = Object.entries(attestation)
      .filter(([, label]) => label)
      .map(([component, label]) => ({ component, label }));

    try {
      const response = await runBridgeInspection({
        udid: selected,
        upload: true,
        ...(entries.length > 0
          ? {
              attestation: {
                capturedBy: 'dashboard',
                method: 'MANUAL' as const,
                entries,
              },
            }
          : {}),
      });
      setResult(response);
      if (response.upload.uploaded) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  if (!paired) {
    return (
      <Card>
        <CardHeader
          title="Pair this browser with DevDNA Bridge"
          description="The agent prints a pairing token when it starts."
        />
        <div className="space-y-4 p-5">
          <ol className="space-y-1.5 text-xs text-muted">
            <li>1. Install DevDNA Bridge on this workstation.</li>
            <li>
              2. Run <code className="rounded bg-panel px-1 py-0.5 text-ink">devdna-bridge serve</code>{' '}
              (add <code className="rounded bg-panel px-1 py-0.5 text-ink">--simulator</code> to try it without a
              handset).
            </li>
            <li>3. Paste the pairing token it prints below.</li>
          </ol>

          <form onSubmit={onPair} className="flex gap-2">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Pairing token"
              className="flex-1 rounded-md border border-hairline px-3 py-2 font-mono text-xs outline-none focus:border-brand"
            />
            <button type="submit" className="rounded-md bg-brand px-4 py-2 text-xs font-medium text-white">
              Pair
            </button>
          </form>

          {error ? <p className="text-xs text-flagged">{error}</p> : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader
            title="Connected devices"
            description={
              health
                ? `Bridge ${health.version} on ${health.workstation} · ${health.mode === 'simulator' ? 'simulator mode' : 'USB'}`
                : undefined
            }
            action={
              <button type="button" onClick={() => void refresh()} className="text-xs font-medium text-brand">
                Refresh
              </button>
            }
          />
          {devices.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No iPhone detected"
                description="Connect a device by USB and unlock it. If it has never been connected to this machine, tap Trust This Computer on the handset."
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {devices.map((device) => (
                <li key={device.udid}>
                  <button
                    type="button"
                    onClick={() => setSelected(device.udid)}
                    className={cn(
                      'flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-panel',
                      selected === device.udid && 'bg-brand-soft',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        device.paired ? 'bg-verified' : 'bg-caution',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">
                        {device.deviceName ?? device.productType ?? device.udid}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted">
                        {device.productType ?? 'unknown model'}
                        {device.productVersion ? ` · iOS ${device.productVersion}` : ''} · {device.udid}
                      </span>
                    </span>
                    {!device.paired ? (
                      <Badge className="bg-caution-soft text-caution border-caution/25">Trust required</Badge>
                    ) : null}
                  </button>
                  {!device.paired ? (
                    <p className="px-5 pb-3 text-[11px] text-caution">{device.pairingMessage}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {running || progress.length > 0 ? (
          <Card>
            <CardHeader title="Collection progress" />
            <ol className="p-5 text-xs">
              {progress.map((step, index) => (
                <li key={`${step.stage}-${index}`} className="flex items-center gap-3 py-1">
                  <span className={cn('h-1.5 w-1.5 rounded-full', step.ok ? 'bg-verified' : 'bg-caution')} aria-hidden />
                  <span className="text-ink">{step.label}</span>
                  {step.detail ? <span className="text-muted">— {step.detail}</span> : null}
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        {result ? <InspectionSummary result={result} /> : null}

        {error ? (
          <p role="alert" className="rounded-md bg-flagged-soft px-4 py-3 text-xs text-flagged">
            {error}
          </p>
        ) : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Parts & Service History"
            description="Optional, and the single biggest boost to parts confidence."
          />
          <div className="space-y-3 p-5">
            <p className="text-[11px] text-muted">
              Apple exposes its own component verdicts only on the handset. Open{' '}
              <span className="text-ink">Settings › General › About</span> and copy what it shows. Leave a
              component blank if it is not listed.
            </p>
            {ATTESTABLE_COMPONENTS.map((component) => (
              <label key={component} className="block">
                <span className="text-[11px] font-medium text-muted">{component}</span>
                <select
                  value={attestation[component] ?? ''}
                  onChange={(e) =>
                    setAttestation((current) => ({ ...current, [component]: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-hairline px-2 py-1.5 text-xs outline-none focus:border-brand"
                >
                  <option value="">Not shown</option>
                  {APPLE_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Card>

        <button
          type="button"
          disabled={!selected || running}
          onClick={() => void onRun()}
          className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? 'Inspecting…' : 'Run SoftwareDNA inspection'}
        </button>

        <button
          type="button"
          onClick={() => {
            clearBridgePairing();
            setPaired(false);
          }}
          className="w-full text-[11px] text-muted underline"
        >
          Unpair this browser
        </button>
      </div>
    </div>
  );
}

function InspectionSummary({ result }: { result: InspectResponse }) {
  const { identity, trust, battery, software, parts } = result.result;
  const status = trust.status as VerificationStatus;
  const assessed = parts.results.filter((p) => p.verdict !== 'CANNOT_DETERMINE');

  return (
    <Card>
      <CardHeader
        title="Inspection result"
        description={`${identity.marketingName}${identity.marketingCapacityGb ? ` · ${identity.marketingCapacityGb} GB` : ''}${identity.iosVersion ? ` · iOS ${identity.iosVersion}` : ''}`}
        action={<Badge className={STATUS_STYLE[status]}>{STATUS_LABEL[status]}</Badge>}
      />
      <div className="grid grid-cols-4 gap-4 border-b border-hairline p-5">
        {[
          ['Trust', trust.score],
          ['Battery', battery.score],
          ['Software', software.score],
          ['Parts', parts.score],
        ].map(([label, score]) => (
          <div key={String(label)}>
            <p className="text-[11px] text-muted">{label}</p>
            <p className={cn('tabular text-2xl font-semibold', scoreTone(Number(score)))}>{score}</p>
          </div>
        ))}
      </div>

      {assessed.length > 0 ? (
        <ul className="divide-y divide-hairline">
          {assessed.map((part) => (
            <li key={part.component} className="flex items-center justify-between px-5 py-2.5">
              <span className="text-xs text-ink">{componentLabel(part.component)}</span>
              <Badge className={VERDICT_STYLE[part.verdict as keyof typeof VERDICT_STYLE]}>
                {VERDICT_LABEL[part.verdict as keyof typeof VERDICT_LABEL]}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="border-t border-hairline px-5 py-3 text-[11px] text-muted">
        {result.upload.uploaded ? (
          <span className="text-verified">Saved to your workspace.</span>
        ) : (
          <span className="text-caution">
            Not uploaded: {result.upload.reason ?? 'unknown reason'}. The result above was scored locally.
          </span>
        )}{' '}
        Battery health {battery.maximumCapacityPercent?.value ?? '—'}% · cycles{' '}
        {battery.cycleCount?.value ?? '—'} · parts coverage {Math.round(parts.coverage * 100)}%.
      </div>
    </Card>
  );
}
