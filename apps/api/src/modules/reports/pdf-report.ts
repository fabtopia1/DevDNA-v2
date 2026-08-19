import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import {
  labelFor,
  PartVerdict,
  Severity,
  verdictLabel,
  VerificationStatus,
  type InspectionResult,
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
  verified: '#12805C',
  notes: '#1F6FEB',
  caution: '#B26B00',
  flagged: '#B3261E',
  inconclusive: '#5B6472',
} as const;

const STATUS_COLOR: Record<VerificationStatus, string> = {
  [VerificationStatus.VERIFIED]: COLORS.verified,
  [VerificationStatus.VERIFIED_WITH_NOTES]: COLORS.notes,
  [VerificationStatus.CAUTION]: COLORS.caution,
  [VerificationStatus.FLAGGED]: COLORS.flagged,
  [VerificationStatus.INCONCLUSIVE]: COLORS.inconclusive,
};

const STATUS_LABEL: Record<VerificationStatus, string> = {
  [VerificationStatus.VERIFIED]: 'VERIFIED',
  [VerificationStatus.VERIFIED_WITH_NOTES]: 'VERIFIED WITH NOTES',
  [VerificationStatus.CAUTION]: 'CAUTION',
  [VerificationStatus.FLAGGED]: 'FLAGGED',
  [VerificationStatus.INCONCLUSIVE]: 'INCONCLUSIVE',
};

const VERDICT_COLOR: Record<PartVerdict, string> = {
  [PartVerdict.GENUINE_APPLE_PART]: COLORS.verified,
  [PartVerdict.USED_APPLE_PART]: COLORS.caution,
  [PartVerdict.UNKNOWN_PART]: COLORS.flagged,
  [PartVerdict.UNVERIFIED_PART]: COLORS.muted,
  [PartVerdict.CANNOT_DETERMINE]: COLORS.muted,
  [PartVerdict.NOT_APPLICABLE]: COLORS.muted,
};

const PAGE = { margin: 46, width: 595.28, height: 841.89 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

/**
 * Device Verification Report.
 *
 * Written for a trade audience: the buyer of a used handset needs the verdict,
 * the evidence behind it, and — critically — what the inspection could *not*
 * determine. A report that quietly omits its blind spots is worse than no
 * report, because it converts uncertainty into false confidence.
 */
export async function renderReport(
  result: InspectionResult,
  context: ReportContext,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    info: {
      Title: `DevDNA Verification Report ${context.reportId}`,
      Author: context.organizationName,
      Subject: `${result.identity.marketingName} device verification`,
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
  drawVerdictBanner(doc, result);
  drawIdentity(doc, result);
  drawScores(doc, result);
  drawParts(doc, result);
  drawFindings(doc, result);
  drawFooter(doc, context, qr, result);

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
    .text(context.generatedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC', {
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

function drawVerdictBanner(doc: PDFKit.PDFDocument, result: InspectionResult): void {
  const { trust } = result;
  const color = STATUS_COLOR[trust.status];
  const y = doc.y;
  const height = 92;

  doc.roundedRect(PAGE.margin, y, CONTENT_WIDTH, height, 6).fillColor(COLORS.panel).fill();
  doc.roundedRect(PAGE.margin, y, 6, height, 3).fillColor(color).fill();

  doc
    .font('Helvetica-Bold')
    .fontSize(42)
    .fillColor(color)
    .text(`${trust.score}`, PAGE.margin + 26, y + 20, { width: 92, align: 'left' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text('/ 100  TRUST SCORE', PAGE.margin + 28, y + 66);

  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(color)
    .text(STATUS_LABEL[trust.status], PAGE.margin + 150, y + 22, { width: 260 });

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(
      `Confidence ${Math.round(trust.confidence * 100)}%  ·  engine ${result.engineVersion}  ·  ` +
        `algorithm ${trust.algorithmVersion}`,
      PAGE.margin + 150,
      y + 46,
      { width: 300 },
    );

  if (trust.gatesApplied.length > 0) {
    doc.text(
      `Score capped at ${Math.min(...trust.gatesApplied.map((g) => g.cap))} — see Findings`,
      PAGE.margin + 150,
      y + 62,
      { width: 300 },
    );
  } else {
    doc.text(`Uncapped score ${trust.rawScore}`, PAGE.margin + 150, y + 62, { width: 300 });
  }

  doc.y = y + height + 18;
}

function drawIdentity(doc: PDFKit.PDFDocument, result: InspectionResult): void {
  const { identity } = result;
  sectionTitle(doc, 'Device identity');

  const rows: Array<[string, string]> = [
    ['Model', identity.marketingName],
    ['Product type', identity.productType || '—'],
    ['Capacity', identity.marketingCapacityGb ? `${identity.marketingCapacityGb} GB` : '—'],
    ['iOS version', `${identity.iosVersion ?? '—'}${identity.buildVersion ? ` (${identity.buildVersion})` : ''}`],
    ['Region', identity.regionName ?? identity.regionCode ?? '—'],
    ['Model number', identity.modelNumber ?? '—'],
    ['Serial', identity.serialNumber ?? '—'],
    ['IMEI', identity.imei ?? '—'],
    ['Activation', activationSummary(result)],
    ['Inspected', result.inspectedAt.replace('T', ' ').slice(0, 19) + ' UTC'],
  ];

  twoColumnTable(doc, rows);
  doc.y += 10;
}

function activationSummary(result: InspectionResult): string {
  const a = result.identity.activation;
  const parts = [a.activated ? 'Activated' : a.state ?? 'Unknown'];
  if (a.activationLockEnabled === true) parts.push('Activation Lock ON');
  else if (a.activationLockEnabled === false) parts.push('Activation Lock off');
  else parts.push('Activation Lock not determinable');
  if (a.supervised) parts.push('Supervised/MDM');
  return parts.join(' · ');
}

function drawScores(doc: PDFKit.PDFDocument, result: InspectionResult): void {
  sectionTitle(doc, 'Component scores');
  const y = doc.y;
  const columnWidth = (CONTENT_WIDTH - 20) / 3;

  const battery = result.battery;
  const cards: Array<{ title: string; score: number; lines: string[] }> = [
    {
      title: 'Battery',
      score: battery.score,
      lines: [
        `Maximum capacity  ${battery.maximumCapacityPercent?.value ?? '—'}%`,
        `Cycle count  ${battery.cycleCount?.value ?? '—'} / ${battery.ratedCycleLife} rated`,
        `Condition  ${battery.condition.replace(/_/g, ' ').toLowerCase()}`,
        `Source  ${sourceLabel(battery.maximumCapacityPercent?.source)}`,
      ],
    },
    {
      title: 'Software',
      score: result.software.score,
      lines: [
        `iOS  ${result.software.iosVersion ?? '—'}`,
        `Storage used  ${result.software.storage.usedPercent ?? '—'}%`,
        `Integrity  ${result.software.jailbreakSuspected ? 'jailbreak indicators' : 'no indicators'}`,
        `Diagnostics  ${result.software.diagnosticsAvailable ? 'available' : 'unavailable'}`,
      ],
    },
    {
      title: 'Parts authenticity',
      score: result.parts.score,
      lines: [
        `Coverage  ${Math.round(result.parts.coverage * 100)}% of component weight`,
        `Confidence  ${Math.round(result.parts.confidence * 100)}%`,
        `Apple service history  ${result.parts.attestationPresent ? 'attested' : 'not captured'}`,
      ],
    },
  ];

  cards.forEach((card, index) => {
    const x = PAGE.margin + index * (columnWidth + 10);
    doc.roundedRect(x, y, columnWidth, 96, 5).lineWidth(1).strokeColor(COLORS.hairline).stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(card.title.toUpperCase(), x + 12, y + 11, { width: columnWidth - 24 });
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor(COLORS.ink)
      .text(`${card.score}`, x + 12, y + 23, { width: columnWidth - 24 });

    let lineY = y + 54;
    for (const line of card.lines) {
      doc
        .font('Helvetica')
        .fontSize(7.6)
        .fillColor(COLORS.muted)
        .text(line, x + 12, lineY, { width: columnWidth - 20 });
      lineY += 11;
    }
  });

  doc.y = y + 110;
}

function drawParts(doc: PDFKit.PDFDocument, result: InspectionResult): void {
  sectionTitle(doc, 'Parts & service verification');

  const assessed = result.parts.results.filter(
    (part) => part.verdict !== PartVerdict.CANNOT_DETERMINE,
  );
  const undetermined = result.parts.results.filter(
    (part) => part.verdict === PartVerdict.CANNOT_DETERMINE,
  );

  if (assessed.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(
        'No component could be assessed on this device. This report makes no claim about ' +
          'the authenticity of any part.',
        PAGE.margin,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    doc.y += 20;
    return;
  }

  for (const part of assessed) {
    ensureSpace(doc, 34);
    const y = doc.y;
    doc.circle(PAGE.margin + 4, y + 6, 3.2).fillColor(VERDICT_COLOR[part.verdict]).fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(COLORS.ink)
      .text(labelFor(part.component), PAGE.margin + 16, y, { width: 130 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(VERDICT_COLOR[part.verdict])
      .text(verdictLabel(part.verdict), PAGE.margin + 150, y, { width: 150 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(`${Math.round(part.confidence * 100)}% confidence`, PAGE.margin + 310, y + 1, {
        width: 80,
      });
    doc
      .font('Helvetica')
      .fontSize(7.8)
      .fillColor(COLORS.muted)
      .text(part.rationale, PAGE.margin + 16, y + 13, { width: CONTENT_WIDTH - 20 });
    doc.y = Math.max(doc.y, y + 13) + 8;
  }

  // Naming what was NOT assessed is a load-bearing part of the report, not a
  // disclaimer: silence here would read as a clean bill of health.
  if (undetermined.length > 0) {
    doc.y += 4;
    doc
      .font('Helvetica')
      .fontSize(7.8)
      .fillColor(COLORS.muted)
      .text(
        `Not assessable on this device: ${undetermined.map((p) => labelFor(p.component)).join(', ')}. ` +
          'No claim is made about these components.',
        PAGE.margin,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    doc.y += 12;
  }
}

function drawFindings(doc: PDFKit.PDFDocument, result: InspectionResult): void {
  const findings = result.findings.filter((f) => f.severity !== Severity.INFO).slice(0, 12);
  if (findings.length === 0) return;

  ensureSpace(doc, 60);
  sectionTitle(doc, 'Findings');

  for (const finding of findings) {
    ensureSpace(doc, 32);
    const y = doc.y;
    const color =
      finding.severity === Severity.CRITICAL || finding.severity === Severity.HIGH
        ? COLORS.flagged
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

function drawFooter(
  doc: PDFKit.PDFDocument,
  context: ReportContext,
  qr: Buffer,
  result: InspectionResult,
): void {
  ensureSpace(doc, 150);
  doc.y = Math.max(doc.y, PAGE.height - PAGE.margin - 150);
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
    );

  doc
    .font('Helvetica')
    .fontSize(6.6)
    .fillColor(COLORS.muted)
    .text(
      'DevDNA reads only information the device makes available over a standard, user-authorised USB ' +
        'pairing. It is not an Apple product and is not endorsed by or affiliated with Apple Inc. ' +
        'Component verdicts are derived from the evidence listed above; where Apple does not expose a ' +
        'component’s service state, this report says so rather than inferring one. ' +
        `Confidence for this inspection is ${Math.round(result.trust.confidence * 100)}%.`,
      PAGE.margin + 88,
      y + 58,
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

    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(row[0], x, y, { width: 86 });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLORS.ink)
      .text(row[1], x + 90, y, { width: columnWidth - 100, ellipsis: true, height: 12 });
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

const SOURCE_LABELS: Record<string, string> = {
  DIAGNOSTICS_RELAY: 'device diagnostics registry',
  ANALYTICS_LOG: 'device analytics files',
  LOCKDOWN: 'device properties',
  LOCKDOWN_DOMAIN: 'device properties',
  DERIVED: 'derived from registry values',
  TECHNICIAN_ATTESTATION: 'technician attestation',
  ATTESTATION_OCR: 'screenshot OCR',
  MOBILEGESTALT: 'capability probe',
  SIMULATOR: 'simulated capture',
};

const sourceLabel = (source: string | undefined): string =>
  source ? (SOURCE_LABELS[source] ?? source.toLowerCase()) : 'not available';
