import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { Badge, Card, CardHeader, Field, cn } from '@/components/ui/primitives';
import {
  AUTHENTICITY_LABEL,
  AUTHENTICITY_STYLE,
  BASIS_LABEL,
  SERVICE_LABEL,
  SERVICE_STYLE,
  SEVERITY_STYLE,
  TRUST_LABEL,
  TRUST_STYLE,
  componentLabel,
  confidenceTone,
  formatDate,
  moduleLabel,
  scoreTone,
  unitProvenanceLabel,
  verdictLabel,
} from '@/lib/format';
import { ReportButton } from '@/components/report-button';
import { EvidenceDrawer } from '@/components/evidence-drawer';
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

  const { report } = inspection;
  const { trust, details, device } = report;
  const determined = details.service.components.filter((c) => c.verdict !== 'CANNOT_DETERMINE');
  const undetermined = details.service.components.filter((c) => c.verdict === 'CANNOT_DETERMINE');
  const insufficient = trust.verdict === 'INSUFFICIENT_EVIDENCE';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/inspections" className="text-xs text-muted">
            ← Inspections
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {device.marketingName ?? device.productType ?? 'Unknown model'}
            {device.capacityGb ? ` · ${device.capacityGb} GB` : ''}
          </h1>
          <p className="mt-1 text-xs text-muted">
            Inspected {formatDate(inspection.capturedAt)}
            {inspection.user ? ` by ${inspection.user.name}` : ''}
            {inspection.bridge ? ` on ${inspection.bridge.workstation ?? inspection.bridge.name}` : ''}
          </p>
        </div>
        <ReportButton inspectionId={inspection.id} existing={inspection.reports} />
      </div>

      {/* Verdict */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-8 p-6">
          {insufficient ? (
            // No score beside "insufficient evidence": printing a number invites
            // a reader to use the number and ignore the words.
            <div className="max-w-md">
              <Badge className={cn('text-sm', TRUST_STYLE[trust.verdict])}>
                {TRUST_LABEL[trust.verdict]}
              </Badge>
              <p className="mt-2 text-xs text-muted">
                No trust verdict was issued. Aggregate confidence of{' '}
                {Math.round(trust.confidence * 100)}% is below the reporting threshold, and only{' '}
                {Math.round(trust.coverage * 100)}% of the assessable picture could be established.
              </p>
            </div>
          ) : (
            <>
              <div>
                <p className={cn('tabular text-5xl font-semibold', scoreTone(trust.score))}>
                  {trust.score}
                </p>
                <p className="mt-1 text-[11px] tracking-wide text-muted uppercase">
                  Trust score / 100
                </p>
              </div>
              <div className="min-w-52">
                <Badge className={cn('text-sm', TRUST_STYLE[trust.verdict])}>
                  {TRUST_LABEL[trust.verdict]}
                </Badge>
                <p className="mt-2 text-xs text-muted">
                  <span className={confidenceTone(trust.confidence)}>
                    {Math.round(trust.confidence * 100)}% confidence
                  </span>
                  {' · '}
                  {Math.round(trust.coverage * 100)}% coverage
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Uncapped score {trust.rawScore} · engine {report.engineVersion} · algorithm{' '}
                  {trust.algorithmVersion}
                </p>
              </div>
            </>
          )}

          {/* Pillar contributions, including the ones that abstained. */}
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
            {trust.pillars.map((pillar) => (
              <div key={pillar.module} className="text-xs">
                <p className="text-muted">{moduleLabel(pillar.module)}</p>
                {pillar.score === null ? (
                  <p className="text-inconclusive">abstained</p>
                ) : (
                  <p>
                    <span className={cn('tabular font-semibold', scoreTone(pillar.score))}>
                      {pillar.score}
                    </span>
                    <span className="ml-1.5 text-[11px] text-muted">
                      weight {Math.round(pillar.effectiveWeight * 100)}%
                    </span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {trust.gatesApplied.length > 0 ? (
          <div className="border-t border-hairline bg-panel px-6 py-4">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
              Score caps applied
            </p>
            <ul className="mt-2 space-y-1">
              {trust.gatesApplied.map((gate) => (
                <li key={gate.code} className="text-xs text-ink">
                  <span className="tabular font-semibold">capped at {gate.cap}</span>{' '}
                  <span className="text-muted">({moduleLabel(gate.module)})</span> — {gate.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {report.provenanceViolations.length > 0 ? (
        <p className="rounded-md bg-flagged-soft px-4 py-3 text-xs text-flagged">
          <span className="font-medium">
            {report.provenanceViolations.length} provenance violation
            {report.provenanceViolations.length === 1 ? '' : 's'}
          </span>{' '}
          — a conclusion in this report could not be traced to its supporting evidence. Treat this
          inspection as unreliable and report it.
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* Service evidence */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Service evidence"
            description={
              `${details.service.replacedCount} replaced · ${details.service.originalCount} original · ` +
              `${details.service.indeterminateCount} not determinable · ` +
              (details.service.attestationPresent
                ? "Apple's on-device service history transcribed"
                : 'no service-history attestation captured')
            }
          />
          {determined.length === 0 ? (
            <p className="p-5 text-xs text-muted">
              No component could be assessed on this device. This inspection makes no claim about
              whether any part is original.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {determined.map((component) => (
                <li key={component.id ?? component.subject} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink">
                      {componentLabel(component.subject)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular text-[11px] text-muted">
                        {Math.round(component.confidence * 100)}% confidence
                      </span>
                      <Badge className={AUTHENTICITY_STYLE[component.authenticity]}>
                        {AUTHENTICITY_LABEL[component.authenticity]}
                      </Badge>
                      <Badge className={SERVICE_STYLE[component.verdict]}>
                        {SERVICE_LABEL[component.verdict]}
                      </Badge>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{component.rationale}</p>
                </li>
              ))}
            </ul>
          )}

          {undetermined.length > 0 ? (
            <div className="border-t border-hairline px-5 py-3">
              <p className="text-[11px] font-medium text-ink">Not assessable on this device</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {undetermined.map((c) => componentLabel(c.subject)).join(', ')}. No claim is made
                about these components. Absence of evidence is not evidence that a part is original.
              </p>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Device" />
            <dl className="px-5 py-2">
              <Field label="Model" value={device.marketingName ?? device.productType} />
              <Field label="Product type" value={device.productType} />
              <Field label="Capacity" value={device.capacityGb ? `${device.capacityGb} GB` : null} />
              <Field
                label="iOS"
                value={`${device.iosVersion ?? '—'}${device.buildVersion ? ` (${device.buildVersion})` : ''}`}
              />
              <Field label="Region" value={device.regionName ?? device.regionCode} />
              <Field label="Serial" value={device.serialNumber} />
              <Field label="IMEI" value={device.imei} />
              <Field label="Unit type" value={unitProvenanceLabel(device.unitProvenance)} />
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Battery"
              description={`Rated ${details.battery.ratedCycleLife} cycles`}
            />
            <dl className="px-5 py-2">
              <Field
                label="Maximum capacity"
                value={
                  details.battery.maximumCapacityPercent !== null
                    ? `${details.battery.maximumCapacityPercent}%`
                    : 'Not readable'
                }
              />
              <Field label="Cycle count" value={details.battery.cycleCount ?? 'Not readable'} />
              <Field label="Wear grade" value={details.battery.wearGrade} />
              <Field
                label="Replacement risk"
                value={
                  details.battery.replacementLikelihood === null
                    ? 'No projection available'
                    : `${Math.round(details.battery.replacementLikelihood * 100)}% within ${details.battery.replacementWindowMonths} months`
                }
              />
              <Field
                label="Wear rate"
                value={
                  details.battery.wearRatePer100Cycles !== null
                    ? `${details.battery.wearRatePer100Cycles} pts / 100 cycles`
                    : '—'
                }
              />
            </dl>
            {details.battery.assumptions.length > 0 ? (
              <p className="border-t border-hairline px-5 py-3 text-[11px] text-muted">
                {details.battery.assumptions.join(' ')}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Security posture"
              description={`${details.security.postureScore}/100`}
            />
            <dl className="px-5 py-2">
              <Field
                label="Integrity"
                value={
                  details.security.integrityCompromised
                    ? `Compromised (${details.security.jailbreakIndicators.length} indicator${details.security.jailbreakIndicators.length === 1 ? '' : 's'})`
                    : 'No indicators'
                }
              />
              <Field
                label="Activation Lock"
                value={
                  details.security.activationLockEnabled === null
                    ? 'Not determinable'
                    : details.security.activationLockEnabled
                      ? 'Enabled'
                      : 'Off'
                }
              />
              <Field
                label="Supervision"
                value={details.security.supervised ? 'Supervised / MDM' : 'None detected'}
              />
              <Field
                label="Passcode"
                value={
                  details.security.passcodeSet === null
                    ? '—'
                    : details.security.passcodeSet
                      ? 'Set'
                      : 'Not set'
                }
              />
            </dl>
            {details.security.deductions.length > 0 ? (
              <ul className="border-t border-hairline px-5 py-3">
                {details.security.deductions.map((deduction) => (
                  <li key={deduction.code} className="text-[11px] text-muted">
                    −{deduction.points} {deduction.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>

      {/* Module verdicts */}
      <Card>
        <CardHeader
          title="Module verdicts"
          description="Each module's conclusion, and what it could not establish"
        />
        <ul className="divide-y divide-hairline">
          {inspection.verdicts.map((verdict) => (
            <li key={verdict.id} className="flex flex-wrap items-start gap-4 px-5 py-3">
              <span className="w-44 shrink-0">
                <span className="block text-xs font-medium text-ink">
                  {moduleLabel(verdict.module)}
                </span>
                <span className="block text-[11px] text-muted">
                  {componentLabel(verdict.subject)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-xs font-medium',
                    verdict.determinacy === 'INDETERMINATE' ? 'text-inconclusive' : 'text-ink',
                  )}
                >
                  {verdictLabel(verdict.value)}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted">{verdict.rationale}</span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-muted">
                {verdict.determinacy === 'INDETERMINATE' ? (
                  'no conclusion'
                ) : (
                  <span className={confidenceTone(verdict.confidence)}>
                    {Math.round(verdict.confidence * 100)}% confidence
                  </span>
                )}
                <span className="block">
                  {verdict.inferenceIds.length} inference
                  {verdict.inferenceIds.length === 1 ? '' : 's'} ·{' '}
                  {verdict.evidenceIds.length} record{verdict.evidenceIds.length === 1 ? '' : 's'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {details.hardware.anomalies.length > 0 ? (
        <Card>
          <CardHeader title="Hardware anomalies" description="Reported specification vs catalogued expectation" />
          <ul className="divide-y divide-hairline">
            {details.hardware.anomalies.map((anomaly) => (
              <li key={anomaly.check} className="px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-medium text-ink">{anomaly.check}</span>
                  <span className="tabular text-[11px] text-muted">
                    observed <span className="text-flagged">{anomaly.observed}</span> · expected{' '}
                    {anomaly.expected}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">{anomaly.explanation}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {inspection.findings.length > 0 ? (
        <Card>
          <CardHeader title="Findings" description={`${inspection.findings.length} raised`} />
          <ul className="divide-y divide-hairline">
            {inspection.findings.map((finding) => (
              <li key={finding.id} className="flex gap-4 px-5 py-3">
                <span
                  className={cn(
                    'w-16 shrink-0 text-[10px] font-semibold',
                    SEVERITY_STYLE[finding.severity],
                  )}
                >
                  {finding.severity}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-ink">{finding.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{finding.detail}</span>
                  <span className="mt-1 block text-[10px] text-muted">
                    {moduleLabel(finding.module)} · {BASIS_LABEL[finding.basis]}
                    {finding.evidenceIds.length > 0
                      ? ` · ${finding.evidenceIds.length} record${finding.evidenceIds.length === 1 ? '' : 's'} cited`
                      : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Evidence, on demand and clearly separated from every conclusion above */}
      <EvidenceDrawer
        inspectionId={inspection.id}
        ledgerDigest={inspection.ledgerDigest}
        evidenceCount={inspection._count.evidence}
        inferenceCount={inspection._count.inferences}
        auditCount={inspection._count.auditEntries}
      />
    </div>
  );
}
