import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { Badge, Card, CardHeader, Field, ScoreBar, cn } from '@/components/ui/primitives';
import {
  SEVERITY_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  VERDICT_LABEL,
  VERDICT_STYLE,
  componentLabel,
  formatBytes,
  formatDate,
  scoreTone,
  sourceLabel,
} from '@/lib/format';
import { ReportButton } from '@/components/report-button';
import type { InspectionDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let inspection: InspectionDetail;
  try {
    inspection = await apiFetch<InspectionDetail>(`/v1/inspections/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { result } = inspection;
  const { identity, battery, software, parts, trust } = result;
  const assessed = parts.results.filter((p) => p.verdict !== 'CANNOT_DETERMINE');
  const undetermined = parts.results.filter((p) => p.verdict === 'CANNOT_DETERMINE');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/inspections" className="text-xs text-muted">
            ← Inspections
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {identity.marketingName}
            {identity.marketingCapacityGb ? ` · ${identity.marketingCapacityGb} GB` : ''}
          </h1>
          <p className="mt-1 text-xs text-muted">
            Inspected {formatDate(inspection.capturedAt)}
            {inspection.user ? ` by ${inspection.user.name}` : ''}
            {inspection.bridge ? ` on ${inspection.bridge.workstation ?? inspection.bridge.name}` : ''}
          </p>
        </div>
        <ReportButton inspectionId={inspection.id} existing={inspection.reports} />
      </div>

      {/* Verdict banner */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-8 p-6">
          <div>
            <p className={cn('tabular text-5xl font-semibold', scoreTone(trust.score))}>{trust.score}</p>
            <p className="mt-1 text-[11px] tracking-wide text-muted uppercase">Trust score / 100</p>
          </div>
          <div className="min-w-48">
            <Badge className={cn('text-sm', STATUS_STYLE[trust.status])}>{STATUS_LABEL[trust.status]}</Badge>
            <p className="mt-2 text-xs text-muted">
              {Math.round(trust.confidence * 100)}% confidence · uncapped score {trust.rawScore}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              engine {inspection.engineVersion} · algorithm {inspection.algorithmVersion}
            </p>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-6">
            <ScoreBar
              label="Battery"
              score={battery.score}
              confidence={battery.confidence}
              tone={scoreTone(battery.score)}
            />
            <ScoreBar
              label="Software"
              score={software.score}
              confidence={software.confidence}
              tone={scoreTone(software.score)}
            />
            <ScoreBar
              label="Parts"
              score={parts.score}
              confidence={parts.confidence}
              tone={scoreTone(parts.score)}
            />
          </div>
        </div>

        {trust.gatesApplied.length > 0 ? (
          <div className="border-t border-hairline bg-panel px-6 py-4">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Score caps applied</p>
            <ul className="mt-2 space-y-1">
              {trust.gatesApplied.map((gate) => (
                <li key={gate.code} className="text-xs text-ink">
                  <span className="tabular font-semibold">capped at {gate.cap}</span> — {gate.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* items-start so a short parts card does not stretch to the height of
          the identity column beside it. */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Parts & service verification"
            description={`${Math.round(parts.coverage * 100)}% of component weight assessed · ${
              parts.attestationPresent ? 'Apple service history attested' : 'no attestation captured'
            }`}
          />
          {assessed.length === 0 ? (
            <p className="p-5 text-xs text-muted">
              No component could be assessed on this device. This inspection makes no claim about the
              authenticity of any part.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {assessed.map((part) => (
                <li key={part.component} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-ink">{componentLabel(part.component)}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular text-[11px] text-muted">
                        {Math.round(part.confidence * 100)}% confidence
                      </span>
                      <Badge className={VERDICT_STYLE[part.verdict]}>{VERDICT_LABEL[part.verdict]}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{part.rationale}</p>
                  {part.signals.length > 0 ? (
                    <ul className="mt-2 space-y-1 border-l-2 border-hairline pl-3">
                      {part.signals.map((signal) => (
                        <li key={signal.id} className="text-[11px] text-muted">
                          <span className="font-medium text-ink-soft">{sourceLabel(signal.source)}</span> —{' '}
                          {signal.summary}
                          {signal.evidence ? (
                            <span className="ml-1 font-mono text-[10px]">({signal.evidence})</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {undetermined.length > 0 ? (
            <p className="border-t border-hairline px-5 py-3 text-[11px] text-muted">
              Not assessable on this device: {undetermined.map((p) => componentLabel(p.component)).join(', ')}.
              No claim is made about these components.
            </p>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Device identity" />
            <dl className="px-5 py-2">
              <Field label="Model" value={identity.marketingName} />
              <Field label="Product type" value={identity.productType} />
              <Field label="Model number" value={identity.modelNumber} />
              <Field label="Region" value={identity.regionName} />
              <Field
                label="iOS"
                value={`${identity.iosVersion ?? '—'}${identity.buildVersion ? ` (${identity.buildVersion})` : ''}`}
              />
              <Field label="Serial" value={identity.serialNumber} />
              <Field label="IMEI" value={identity.imei} />
              <Field
                label="Activation Lock"
                value={
                  identity.activation.activationLockEnabled === null
                    ? 'Not determinable'
                    : identity.activation.activationLockEnabled
                      ? 'Enabled'
                      : 'Off'
                }
              />
              <Field
                label="Supervision"
                value={identity.activation.supervised ? 'Supervised / MDM' : 'None detected'}
              />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Battery" description={`Rated ${battery.ratedCycleLife} cycles`} />
            <dl className="px-5 py-2">
              <Field
                label="Maximum capacity"
                value={
                  battery.maximumCapacityPercent
                    ? `${battery.maximumCapacityPercent.value}%`
                    : 'Not readable'
                }
              />
              <Field
                label="Cycle count"
                value={battery.cycleCount ? battery.cycleCount.value : 'Not readable'}
              />
              <Field label="Condition" value={battery.condition.replace(/_/g, ' ').toLowerCase()} />
              <Field
                label="Design capacity"
                value={battery.designCapacityMah ? `${battery.designCapacityMah.value} mAh` : '—'}
              />
              <Field label="Current charge" value={battery.currentChargePercent ? `${battery.currentChargePercent.value}%` : '—'} />
              <Field
                label="Data source"
                value={
                  battery.maximumCapacityPercent
                    ? sourceLabel(battery.maximumCapacityPercent.source)
                    : 'unavailable'
                }
              />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Software" />
            <dl className="px-5 py-2">
              <Field label="iOS version" value={software.iosVersion} />
              <Field label="Newest supported" value={software.latestKnownVersion} />
              <Field
                label="Storage used"
                value={
                  software.storage.usedPercent !== null
                    ? `${software.storage.usedPercent}% of ${formatBytes(software.storage.totalBytes)}`
                    : '—'
                }
              />
              <Field
                label="Diagnostics relay"
                value={software.diagnosticsAvailable ? 'Available' : 'Unavailable'}
              />
              <Field
                label="Integrity"
                value={
                  software.jailbreakSuspected
                    ? `Jailbreak indicators (${software.jailbreakIndicators.length})`
                    : 'No indicators'
                }
              />
            </dl>
          </Card>
        </div>
      </div>

      {inspection.findings.length > 0 ? (
        <Card>
          <CardHeader title="Findings" description={`${inspection.findings.length} raised`} />
          <ul className="divide-y divide-hairline">
            {inspection.findings.map((finding) => (
              <li key={finding.id} className="flex gap-4 px-5 py-3">
                <span className={cn('w-16 shrink-0 text-[10px] font-semibold', SEVERITY_STYLE[finding.severity])}>
                  {finding.severity}
                </span>
                <span>
                  <span className="block text-xs font-medium text-ink">{finding.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{finding.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
