import { notFound } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api';
import { Badge, Card, CardHeader, Field, cn } from '@/components/ui/primitives';
import {
  AUTHENTICITY_LABEL,
  AUTHENTICITY_STYLE,
  SERVICE_LABEL,
  SERVICE_STYLE,
  TRUST_LABEL,
  TRUST_STYLE,
  componentLabel,
  formatDate,
  scoreTone,
  unitProvenanceLabel,
  verdictLabel,
} from '@/lib/format';
import type { PublicVerification } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Public verification, reached by scanning the QR code on a report.
 *
 * The audience is a stranger holding a PDF: a wholesale buyer, an insurer, a
 * customer. It confirms the report is genuine, restates the verdict, and shows
 * nothing that identifies the handset or the technician.
 *
 * It also states what was *not* assessed. A shorter component list must never
 * read as a cleaner device.
 */
export default async function VerifyPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;

  const response = await fetch(
    `${API_BASE_URL}/v1/verify/${encodeURIComponent(publicId.toUpperCase())}`,
    { cache: 'no-store' },
  );
  if (!response.ok) notFound();
  const verification = (await response.json()) as PublicVerification;
  const { verdict, device, battery, modules } = verification;
  const insufficient = verdict.trustVerdict === 'INSUFFICIENT_EVIDENCE';

  return (
    <main className="min-h-screen bg-panel px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-ink">DevDNA</p>
          <p className="mt-0.5 text-[10px] tracking-widest text-muted uppercase">
            Report verification
          </p>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-6 p-6">
            {insufficient ? (
              <div>
                <Badge className={cn('text-sm', TRUST_STYLE[verdict.trustVerdict])}>
                  {TRUST_LABEL[verdict.trustVerdict]}
                </Badge>
                <p className="mt-2 max-w-sm text-xs text-muted">
                  This inspection did not gather enough evidence to issue a trust verdict. No score
                  is shown, because there is nothing a score could honestly summarise.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <p className={`tabular text-5xl font-semibold ${scoreTone(verdict.trustScore)}`}>
                    {verdict.trustScore}
                  </p>
                  <p className="mt-1 text-[11px] tracking-wide text-muted uppercase">
                    Trust score / 100
                  </p>
                </div>
                <div className="text-right">
                  <Badge className={cn('text-sm', TRUST_STYLE[verdict.trustVerdict])}>
                    {TRUST_LABEL[verdict.trustVerdict]}
                  </Badge>
                  <p className="mt-2 text-xs text-muted">
                    {Math.round(verdict.confidence * 100)}% confidence
                  </p>
                  <p className="text-[11px] text-muted">
                    {Math.round(verdict.coverage * 100)}% of the device assessed
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="border-t border-hairline px-6 py-2">
            <Field label="Model" value={device.model} />
            <Field label="Capacity" value={device.capacityGb ? `${device.capacityGb} GB` : '—'} />
            <Field label="Region" value={device.region} />
            <Field label="iOS at inspection" value={device.iosVersion} />
            <Field label="Unit type" value={unitProvenanceLabel(device.unitProvenance)} />
            <Field
              label="Battery health"
              value={battery.healthPercent !== null ? `${battery.healthPercent}%` : 'Not readable'}
            />
            <Field label="Battery cycles" value={battery.cycleCount ?? 'Not readable'} />
            <Field label="Battery wear grade" value={battery.wearGrade ?? '—'} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Module verdicts" />
          <div className="px-5 py-2">
            <Field label="Identity" value={verdictLabel(modules.identity)} />
            <Field label="Hardware consistency" value={verdictLabel(modules.hardware)} />
            <Field label="Security posture" value={verdictLabel(modules.security)} />
            <Field label="Battery" value={verdictLabel(modules.battery)} />
            <Field
              label="Hardware anomalies"
              value={verification.hardwareAnomalies > 0 ? verification.hardwareAnomalies : 'None'}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Service evidence"
            description={`${verification.components.length} component${verification.components.length === 1 ? '' : 's'} assessed`}
          />
          {verification.components.length === 0 ? (
            <p className="px-5 py-4 text-xs text-muted">
              No component could be assessed. This report makes no claim about whether any part is
              original.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {verification.components.map((component) => (
                <li
                  key={component.subject}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"
                >
                  <span className="text-xs text-ink">{componentLabel(component.subject)}</span>
                  <span className="flex items-center gap-2">
                    <Badge className={AUTHENTICITY_STYLE[component.authenticity]}>
                      {AUTHENTICITY_LABEL[component.authenticity]}
                    </Badge>
                    <Badge className={SERVICE_STYLE[component.verdict]}>
                      {SERVICE_LABEL[component.verdict]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {verification.notAssessed > 0 ? (
            <p className="border-t border-hairline px-5 py-3 text-[11px] text-muted">
              <span className="font-medium text-ink">
                {verification.notAssessed} further component
                {verification.notAssessed === 1 ? '' : 's'} could not be assessed.
              </span>{' '}
              No claim is made about them. Absence of evidence is not evidence that a part is
              original.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Provenance" />
          <div className="px-5 py-2">
            <Field
              label="Report ID"
              value={<span className="font-mono">{verification.reportId}</span>}
            />
            <Field label="Issued by" value={verification.issuedBy} />
            <Field label="Issued" value={formatDate(verification.issuedAt)} />
            <Field label="Inspected" value={formatDate(verification.inspectedAt)} />
            <Field
              label="Evidence"
              value={`${verification.evidenceCount} records · ${verification.inferenceCount} inferences`}
            />
            <Field
              label="Engine"
              value={`${verification.engineVersion} · algorithm ${verification.algorithmVersion}`}
            />
            <Field
              label="Document checksum"
              value={
                <span className="font-mono text-[10px]">
                  {verification.checksum.slice(0, 32)}…
                </span>
              }
            />
            <Field
              label="Evidence ledger"
              value={
                <span className="font-mono text-[10px]">
                  {verification.evidenceLedgerDigest.slice(0, 32)}…
                </span>
              }
            />
          </div>
        </Card>

        <p className="text-center text-[11px] text-muted">
          Compare the document checksum with the PDF you were given to confirm it has not been
          altered. The evidence ledger digest identifies the exact evidence this verdict was
          computed from; the issuer can reproduce the verdict from it, and any change to that
          evidence changes the digest. DevDNA is not affiliated with Apple Inc.
        </p>
      </div>
    </main>
  );
}
