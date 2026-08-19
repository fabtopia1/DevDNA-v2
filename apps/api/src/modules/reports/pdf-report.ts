import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import {
  componentLabel,
  ConfidenceBand,
  Determinacy,
  PartAuthenticity,
  ServiceVerdict,
  Severity,
  TrustVerdict,
  type InspectionReport,
} from '@devdna/core';

export interface ReportContext {
  reportId: string;
  publicId: string;
  verifyUrl: string;
  organizationName: string;
  organizationLogo?: Buffer | null;
  technicianName?: string | null;
  workstation?: string | null;
  customerName?: string | null;
  generatedAt: Date;
}

const COLORS = {
  ink: '#0B1220',
  muted: '#5B6472',
  hairline: '#D7DCE3',
  panel: '#F5F7FA',
  trusted: '#12805C',
  notes: '#1F6FEB',
  caution: '#B26B00',
  untrusted: '#B3261E',
  insufficient: '#5B6472',
} as const;

const VERDICT_COLOR: Record<TrustVerdict, string> = {
  [TrustVerdict.TRUSTED]: COLORS.trusted,
  [TrustVerdict.TRUSTED_WITH_NOTES]: COLORS.notes,
  [TrustVerdict.CAUTION]: COLORS.caution,
  [TrustVerdict.UNTRUSTED]: COLORS.untrusted,
  [TrustVerdict.INSUFFICIENT_EVIDENCE]: COLORS.insufficient,
};

const VERDICT_LABEL: Record<TrustVerdict, string> = {
  [TrustVerdict.TRUSTED]: 'TRUSTED',
  [TrustVerdict.TRUSTED_WITH_NOTES]: 'TRUSTED WITH NOTES',
  [TrustVerdict.CAUTION]: 'CAUTION',
  [TrustVerdict.UNTRUSTED]: 'UNTRUSTED',
  [TrustVerdict.INSUFFICIENT_EVIDENCE]: 'INSUFFICIENT EVIDENCE',
};

const SERVICE_COLOR: Record<ServiceVerdict, string> = {
  [ServiceVerdict.ORIGINAL_LIKELY]: COLORS.trusted,
  [ServiceVerdict.REPLACED_LIKELY]: COLORS.caution,
  [ServiceVerdict.CANNOT_DETERMINE]: COLORS.muted,
};

const SERVICE_LABEL: Record<ServiceVerdict, string> = {
  [ServiceVerdict.ORIGINAL_LIKELY]: 'Original likely',
  [ServiceVerdict.REPLACED_LIKELY]: 'Replaced likely',
  [ServiceVerdict.CANNOT_DETERMINE]: 'Cannot determine',
};

const AUTHENTICITY_LABEL: Record<PartAuthenticity, string> = {
  [PartAuthenticity.GENUINE_APPLE]: 'genuine Apple part',
  [PartAuthenticity.GENUINE_TRANSPLANTED]: 'genuine part from another device',
  [PartAuthenticity.NOT_VERIFIED]: 'part not verified by Apple',
  [PartAuthenticity.UNKNOWN]: 'authenticity unknown',
};

const CONFIDENCE_LABEL: Record<ConfidenceBand, string> = {
  [ConfidenceBand.HIGH]: 'High confidence',
  [ConfidenceBand.MODERATE]: 'Moderate confidence',
  [ConfidenceBand.LOW]: 'Low confidence',
  [ConfidenceBand.INSUFFICIENT]: 'Insufficient evidence',
};

const PAGE = { margin: 46, width: 595.28, height: 841.89 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

/**
 * Device Verification Report.
 *
 * Structured to mirror the engine: what was concluded, on what evidence, and -
 * given equal weight - what could not be concluded at all. A report that
 * quietly omits its blind spots is worse than no report, because it converts
 * uncertainty into false confidence, and the sections below are ordered so a
 * reader cannot reach the verdict without passing the coverage.
 */
export async function renderReport(
  report: InspectionReport,
  context: ReportContext,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    info: {
      Title: `DevDNA Verification Report ${context.reportId}`,
      Author: context.organizationName,
      Subject: `${report.device.marketingName ?? 'iPhone'} verification`,
      Creator: 'DevDNA SoftwareDNA',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const qr = await QRCode.toBuffer(context.verifyUrl, {
    margin: 0,
    width: 220,
    color: { dark: COLORS.ink, light: '#FFFFFF' },
  });

  drawHeader(doc, context);
  drawVerdictBanner(doc, report);
  drawIdentity(doc, report);
  drawModuleVerdicts(doc, report);
  drawServiceEvidence(doc, report);
  drawFindings(doc, report);
  drawProvenanceFooter(doc, context, qr, report);

  doc.end();
  return done;
}

function drawHeader(doc: PDFKit.PDFDocument, context: ReportContext): void {
  const top = PAGE.margin;

  if (context.organizationLogo) {
    try {
      doc.image(context.organizationLogo, PAGE.margin, top, { fit: [120, 34] });
    } catch {
      // A corrupt tenant logo must never fail report generation.
    }
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(COLORS.ink)
      .text(context.organizationName, PAGE.margin, top, { width: 300 });
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.ink)
    .text('DevDNA SoftwareDNA', PAGE.margin, top, { width: CONTENT_WIDTH, align: 'right' })
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text('Device Verification Report', { width: CONTENT_WIDTH, align: 'right' })
    .text(`${context.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`, {
      width: CONTENT_WIDTH,
      align: 'right',
    })
    .text(`Report ${context.reportId}`, { width: CONTENT_WIDTH, align: 'right' });

  doc
    .moveTo(PAGE.margin, top + 52)
    .lineTo(PAGE.width - PAGE.margin, top + 52)
    .lineWidth(1)
    .strokeColor(COLORS.hairline)
    .stroke();

  doc.y = top + 68;
}

function drawVerdictBanner(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const { trust } = report;
  const color = VERDICT_COLOR[trust.verdict];
  const y = doc.y;
  const height = 100;

  doc.roundedRect(PAGE.margin, y, CONTENT_WIDTH, height, 6).fillColor(COLORS.panel).fill();
  doc.roundedRect(PAGE.margin, y, 6, height, 3).fillColor(color).fill();

  const insufficient = trust.verdict === TrustVerdict.INSUFFICIENT_EVIDENCE;

  if (insufficient) {
    // No score is shown at all. Printing a number beside "insufficient
    // evidence" invites a reader to use the number and ignore the words.
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(color)
      .text('NO VERDICT ISSUED', PAGE.margin + 26, y + 24, { width: 300 });
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(42)
      .fillColor(color)
      .text(`${trust.score}`, PAGE.margin + 26, y + 20, { width: 92 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text('/ 100  TRUST SCORE', PAGE.margin + 28, y + 66);
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(color)
      .text(VERDICT_LABEL[trust.verdict], PAGE.margin + 150, y + 22, { width: 280 });
  }

  const detailX = insufficient ? PAGE.margin + 26 : PAGE.margin + 150;
  const detailY = insufficient ? y + 48 : y + 46;

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(
      `${CONFIDENCE_LABEL[trust.confidenceBand]} (${Math.round(trust.confidence * 100)}%)  ·  ` +
        `${Math.round(trust.coverage * 100)}% of the assessable picture established`,
      detailX,
      detailY,
      { width: CONTENT_WIDTH - 180 },
    );

  doc.text(
    trust.gatesApplied.length > 0
      ? `Score capped at ${Math.min(...trust.gatesApplied.map((g) => g.cap))} — see Findings`
      : `Uncapped score ${trust.rawScore}`,
    detailX,
    detailY + 14,
    { width: CONTENT_WIDTH - 180 },
  );

  doc.text(
    `Engine ${report.engineVersion} · algorithm ${trust.algorithmVersion} · ` +
      `${report.evidence.length} evidence records`,
    detailX,
    detailY + 28,
    { width: CONTENT_WIDTH - 180 },
  );

  doc.y = y + height + 16;
}

function drawIdentity(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const { device } = report;
  sectionTitle(doc, 'Device');

  const rows: Array<[string, string]> = [
    ['Model', device.marketingName ?? device.productType ?? '—'],
    ['Product type', device.productType ?? '—'],
    ['Capacity', device.capacityGb ? `${device.capacityGb} GB` : '—'],
    ['iOS version', `${device.iosVersion ?? '—'}${device.buildVersion ? ` (${device.buildVersion})` : ''}`],
    ['Region', device.regionName ?? device.regionCode ?? '—'],
    ['Serial', device.serialNumber ?? '—'],
    ['IMEI', device.imei ?? '—'],
    ['Unit type', unitProvenanceLabel(device.unitProvenance)],
    ['Inspected', `${report.inspectedAt.replace('T', ' ').slice(0, 19)} UTC`],
    ['Battery', batterySummary(report)],
  ];

  twoColumnTable(doc, rows);
  doc.y += 10;
}

function batterySummary(report: InspectionReport): string {
  const battery = report.details.battery;
  if (battery.maximumCapacityPercent === null) return 'Not readable';
  const parts = [`${battery.maximumCapacityPercent}% · grade ${battery.wearGrade}`];
  if (battery.cycleCount !== null) parts.push(`${battery.cycleCount} cycles`);
  return parts.join(' · ');
}

function unitProvenanceLabel(provenance: string): string {
  const labels: Record<string, string> = {
    RETAIL: 'Retail unit',
    APPLE_REFURBISHED: 'Apple refurbished',
    SERVICE_REPLACEMENT: 'Service replacement',
    PERSONALISED: 'Retail (personalised)',
    DEMO: 'Demonstration unit',
    UNKNOWN: 'Not determinable',
  };
  return labels[provenance] ?? provenance;
}

/** Each module's verdict, with what it could and could not establish. */
function drawModuleVerdicts(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  sectionTitle(doc, 'Module verdicts');

  const entries: Array<{ label: string; verdict: string; confidence: number; note: string }> = [
    {
      label: 'Identity',
      verdict: verdictOf(report, 'identity'),
      confidence: report.modules.identity.confidence,
      note: `${report.details.identity.checksPerformed.length} of ${
        report.details.identity.checksPerformed.length + report.details.identity.checksUnavailable.length
      } identifier checks run`,
    },
    {
      label: 'Hardware consistency',
      verdict: verdictOf(report, 'hardware'),
      confidence: report.modules.hardware.confidence,
      note:
        report.details.hardware.anomalies.length > 0
          ? `${report.details.hardware.anomalies.length} anomaly: ${report.details.hardware.anomalies
              .map((a) => a.check)
              .join(', ')}`
          : report.details.hardware.modelCatalogued
            ? 'All comparable specifications match'
            : 'Model not in the hardware catalog',
    },
    {
      label: 'Security posture',
      verdict: verdictOf(report, 'security'),
      confidence: report.modules.security.confidence,
      note: `Posture ${report.details.security.postureScore}/100${
        report.details.security.integrityCompromised ? ' · integrity indicators present' : ''
      }`,
    },
    {
      label: 'Battery',
      verdict: verdictOf(report, 'battery'),
      confidence: report.modules.battery.confidence,
      note:
        report.details.battery.replacementLikelihood === null
          ? 'No replacement projection available'
          : `${Math.round(report.details.battery.replacementLikelihood * 100)}% likely to need ` +
            `replacement within ${report.details.battery.replacementWindowMonths} months`,
    },
  ];

  for (const entry of entries) {
    ensureSpace(doc, 30);
    const y = doc.y;
    const indeterminate = entry.verdict === 'CANNOT_DETERMINE';

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(entry.label, PAGE.margin, y, { width: 130 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(indeterminate ? COLORS.muted : COLORS.ink)
      .text(entry.verdict.replace(/_/g, ' ').toLowerCase(), PAGE.margin + 135, y, { width: 160 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        indeterminate ? 'not determinable' : `${Math.round(entry.confidence * 100)}% confidence`,
        PAGE.margin + 300,
        y + 0.5,
        { width: 80 },
      );
    doc
      .font('Helvetica')
      .fontSize(7.6)
      .fillColor(COLORS.muted)
      .text(entry.note, PAGE.margin + 135, y + 12, { width: CONTENT_WIDTH - 140 });
    doc.y = Math.max(doc.y, y + 12) + 8;
  }
  doc.y += 4;
}

const verdictOf = (report: InspectionReport, module: keyof InspectionReport['modules']): string =>
  report.modules[module].verdicts[0]?.value ?? 'CANNOT_DETERMINE';

/**
 * Service evidence.
 *
 * Note the wording throughout: "replaced likely", never "was repaired". The
 * engine reports what the evidence supports, and the report must not upgrade
 * that into a claim of fact on its way to a buyer.
 */
function drawServiceEvidence(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  ensureSpace(doc, 70);
  sectionTitle(doc, 'Service evidence');

  const { service } = report.details;
  const determined = service.components.filter((c) => c.verdict !== ServiceVerdict.CANNOT_DETERMINE);
  const undetermined = service.components.filter(
    (c) => c.verdict === ServiceVerdict.CANNOT_DETERMINE,
  );

  doc
    .font('Helvetica')
    .fontSize(7.8)
    .fillColor(COLORS.muted)
    .text(
      `${Math.round(report.modules.service.coverage * 100)}% of component weight determined · ` +
        `${service.attestationPresent ? "Apple's on-device service history was transcribed" : 'no service-history attestation captured'}`,
      PAGE.margin,
      doc.y,
      { width: CONTENT_WIDTH },
    );
  doc.y += 10;

  if (determined.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(
        'No component could be assessed on this device. This report makes no claim about whether ' +
          'any part is original.',
        PAGE.margin,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    doc.y += 18;
    return;
  }

  for (const component of determined) {
    ensureSpace(doc, 34);
    const y = doc.y;
    const color = SERVICE_COLOR[component.verdict];

    doc.circle(PAGE.margin + 4, y + 5, 3.2).fillColor(color).fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(COLORS.ink)
      .text(componentLabel(component.subject), PAGE.margin + 16, y, { width: 120 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(color)
      .text(SERVICE_LABEL[component.verdict], PAGE.margin + 140, y, { width: 110 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(AUTHENTICITY_LABEL[component.authenticity], PAGE.margin + 250, y + 1, { width: 160 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(`${Math.round(component.confidence * 100)}%`, PAGE.margin + 420, y + 1, { width: 60 });
    doc
      .font('Helvetica')
      .fontSize(7.6)
      .fillColor(COLORS.muted)
      .text(component.rationale, PAGE.margin + 16, y + 13, { width: CONTENT_WIDTH - 20 });
    doc.y = Math.max(doc.y, y + 13) + 8;
  }

  // Naming what was NOT assessed is load-bearing, not a disclaimer: silence
  // here would read as a clean bill of health.
  if (undetermined.length > 0) {
    ensureSpace(doc, 28);
    doc.y += 2;
    doc
      .font('Helvetica-Bold')
      .fontSize(7.8)
      .fillColor(COLORS.ink)
      .text('Not assessable on this device', PAGE.margin, doc.y, { width: CONTENT_WIDTH });
    doc
      .font('Helvetica')
      .fontSize(7.6)
      .fillColor(COLORS.muted)
      .text(
        `${undetermined.map((c) => componentLabel(c.subject)).join(', ')}. No claim is made about ` +
          'these components. Absence of evidence is not evidence that a part is original.',
        PAGE.margin,
        doc.y + 1,
        { width: CONTENT_WIDTH },
      );
    doc.y += 10;
  }
}

function drawFindings(doc: PDFKit.PDFDocument, report: InspectionReport): void {
  const findings = report.findings.filter((f) => f.severity !== Severity.INFO).slice(0, 14);
  if (findings.length === 0) return;

  ensureSpace(doc, 60);
  sectionTitle(doc, 'Findings');

  for (const finding of findings) {
    ensureSpace(doc, 30);
    const y = doc.y;
    const color =
      finding.severity === Severity.CRITICAL || finding.severity === Severity.HIGH
        ? COLORS.untrusted
        : finding.severity === Severity.MEDIUM
          ? COLORS.caution
          : COLORS.muted;

    doc
      .font('Helvetica-Bold')
      .fontSize(6.8)
      .fillColor(color)
      .text(finding.severity, PAGE.margin, y + 1.5, { width: 46 });
    doc
      .font('Helvetica-Bold')
      .fontSize(8.6)
      .fillColor(COLORS.ink)
      .text(finding.title, PAGE.margin + 50, y, { width: CONTENT_WIDTH - 50 });
    doc
      .font('Helvetica')
      .fontSize(7.8)
      .fillColor(COLORS.muted)
      .text(finding.detail, PAGE.margin + 50, doc.y + 1, { width: CONTENT_WIDTH - 50 });
    doc.y += 8;
  }
}

/**
 * Provenance footer.
 *
 * The ledger digest is what makes this document checkable: a recipient can ask
 * the issuer to reproduce the verdict from the same evidence, and any edit to
 * that evidence changes the digest.
 */
function drawProvenanceFooter(
  doc: PDFKit.PDFDocument,
  context: ReportContext,
  qr: Buffer,
  report: InspectionReport,
): void {
  ensureSpace(doc, 160);
  doc.y = Math.max(doc.y, PAGE.height - PAGE.margin - 160);
  const y = doc.y;

  doc
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.width - PAGE.margin, y)
    .lineWidth(1)
    .strokeColor(COLORS.hairline)
    .stroke();

  doc.image(qr, PAGE.margin, y + 14, { fit: [74, 74] });

  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(COLORS.ink)
    .text('Verify this report', PAGE.margin + 88, y + 16, { width: CONTENT_WIDTH - 88 });
  doc
    .font('Helvetica')
    .fontSize(7.6)
    .fillColor(COLORS.muted)
    .text(context.verifyUrl, PAGE.margin + 88, y + 28, { width: CONTENT_WIDTH - 88 })
    .text(
      `Inspected by ${context.technicianName ?? 'DevDNA Bridge'}` +
        `${context.workstation ? ` on ${context.workstation}` : ''}` +
        `${context.customerName ? ` for ${context.customerName}` : ''}`,
      PAGE.margin + 88,
      y + 40,
      { width: CONTENT_WIDTH - 88 },
    )
    .font('Courier')
    .fontSize(6.6)
    .text(`Evidence ledger ${report.ledgerDigest}`, PAGE.margin + 88, y + 52, {
      width: CONTENT_WIDTH - 88,
    });

  doc
    .font('Helvetica')
    .fontSize(6.6)
    .fillColor(COLORS.muted)
    .text(
      'Every conclusion in this report cites the evidence behind it, and that evidence is retained. ' +
        'DevDNA reads only information the device makes available over a standard, user-authorised ' +
        'USB pairing; it is not an Apple product and is not endorsed by or affiliated with Apple Inc. ' +
        'Service verdicts state what the evidence supports, not that a repair is known to have ' +
        'occurred. Where Apple does not expose a component’s state, this report says so rather than ' +
        'inferring one.',
      PAGE.margin + 88,
      y + 66,
      { width: CONTENT_WIDTH - 88, lineGap: 0.5 },
    );
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 40);
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(title.toUpperCase(), PAGE.margin, doc.y, { width: CONTENT_WIDTH, characterSpacing: 0.6 });
  doc.y += 10;
}

function twoColumnTable(doc: PDFKit.PDFDocument, rows: Array<[string, string]>): void {
  const columnWidth = CONTENT_WIDTH / 2;
  const startY = doc.y;
  const half = Math.ceil(rows.length / 2);

  rows.forEach((row, index) => {
    const column = index < half ? 0 : 1;
    const rowIndex = index < half ? index : index - half;
    const x = PAGE.margin + column * columnWidth;
    const y = startY + rowIndex * 15;

    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(row[0], x, y, { width: 82 });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLORS.ink)
      .text(row[1], x + 86, y, { width: columnWidth - 96, ellipsis: true, height: 12 });
  });

  doc.y = startY + half * 15;
}

/** Break to a new page when the next block would not fit. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE.height - PAGE.margin) {
    doc.addPage();
    doc.y = PAGE.margin;
  }
}

export { Determinacy };
