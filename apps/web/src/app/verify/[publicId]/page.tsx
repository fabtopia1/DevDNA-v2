import { notFound } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api';
import { Badge, Card, CardHeader, Field } from '@/components/ui/primitives';
import {
  STATUS_LABEL,
  STATUS_STYLE,
  VERDICT_LABEL,
  VERDICT_STYLE,
  componentLabel,
  formatDate,
  scoreTone,
} from '@/lib/format';
import type { PublicVerification } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Public verification page, reached by scanning the QR code on a report.
 *
 * The audience is a stranger holding a PDF — a wholesale buyer, an insurer, a
 * customer. It confirms the report is genuine and restates the verdict, and
 * deliberately shows nothing that identifies the handset or the technician.
 */
export default async function VerifyPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;

  const response = await fetch(`${API_BASE_URL}/v1/verify/${encodeURIComponent(publicId.toUpperCase())}`, {
    cache: 'no-store',
  });
  if (!response.ok) notFound();
  const verification = (await response.json()) as PublicVerification;
  const { verdict, device } = verification;

  return (
    <main className="min-h-screen bg-panel px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-ink">DevDNA</p>
          <p className="mt-0.5 text-[10px] tracking-widest text-muted uppercase">Report verification</p>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-6 p-6">
            <div>
              <p className={`tabular text-5xl font-semibold ${scoreTone(verdict.trustScore)}`}>
                {verdict.trustScore}
              </p>
              <p className="mt-1 text-[11px] tracking-wide text-muted uppercase">Trust score / 100</p>
            </div>
            <div className="text-right">
              <Badge className={`text-sm ${STATUS_STYLE[verdict.status]}`}>
                {STATUS_LABEL[verdict.status]}
              </Badge>
              <p className="mt-2 text-xs text-muted">
                {Math.round(verdict.confidence * 100)}% confidence
              </p>
            </div>
          </div>

          <div className="border-t border-hairline px-6 py-2">
            <Field label="Model" value={device.model} />
            <Field label="Capacity" value={device.capacityGb ? `${device.capacityGb} GB` : '—'} />
            <Field label="Region" value={device.region} />
            <Field label="iOS at inspection" value={device.iosVersion} />
            <Field label="Battery health" value={verdict.batteryHealthPercent ? `${verdict.batteryHealthPercent}%` : 'Not readable'} />
            <Field label="Battery cycles" value={verdict.batteryCycleCount ?? 'Not readable'} />
            <Field label="Battery score" value={verdict.batteryScore} />
            <Field label="Software score" value={verdict.softwareScore} />
            <Field label="Parts score" value={verdict.partsScore} />
          </div>
        </Card>

        {verification.parts.length > 0 ? (
          <Card>
            <CardHeader title="Component verdicts" />
            <ul className="divide-y divide-hairline">
              {verification.parts.map((part) => (
                <li key={part.component} className="flex items-center justify-between px-5 py-2.5">
                  <span className="text-xs text-ink">{componentLabel(part.component)}</span>
                  <Badge className={VERDICT_STYLE[part.verdict]}>{VERDICT_LABEL[part.verdict]}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Provenance" />
          <div className="px-5 py-2">
            <Field label="Report ID" value={<span className="font-mono">{verification.reportId}</span>} />
            <Field label="Issued by" value={verification.issuedBy} />
            <Field label="Issued" value={formatDate(verification.issuedAt)} />
            <Field label="Inspected" value={formatDate(verification.inspectedAt)} />
            <Field label="Engine" value={verification.engineVersion} />
            <Field
              label="Document checksum"
              value={<span className="font-mono text-[10px]">{verification.checksum.slice(0, 32)}…</span>}
            />
          </div>
        </Card>

        <p className="text-center text-[11px] text-muted">
          This page confirms a report issued through DevDNA. Compare the checksum above with the PDF you were
          given to confirm the document has not been altered. DevDNA is not affiliated with Apple Inc.
        </p>
      </div>
    </main>
  );
}
