import { ConditionGrade } from './scoring.js';
import { renderExplanation, type DefectExplanation } from './explain.js';
import type { PhysicalReport } from './inspection.js';
import { defectClass } from './taxonomy.js';

/**
 * The PhysicalDNA section of a DevDNA verification report.
 *
 * Written to sit directly beneath the SoftwareDNA section, sharing its
 * conventions: a headline verdict, the number behind it, what was found, and —
 * given equal prominence — what could not be assessed.
 *
 * That last part is the one that gets cut in every product review and must not
 * be. A shorter findings list must never read as a cleaner device.
 */

export const GRADE_LABEL: Record<ConditionGrade, string> = {
  [ConditionGrade.PRISTINE]: 'Pristine',
  [ConditionGrade.EXCELLENT]: 'Excellent',
  [ConditionGrade.GOOD]: 'Good',
  [ConditionGrade.FAIR]: 'Fair',
  [ConditionGrade.POOR]: 'Poor',
  [ConditionGrade.HEAVILY_DAMAGED]: 'Heavily damaged',
  [ConditionGrade.INSUFFICIENT_EVIDENCE]: 'No grade issued',
};

export interface PhysicalReportSection {
  overallCondition: string;
  /** Null when the evidence did not meet the reporting threshold. */
  physicalDnaScore: number | null;
  findings: string[];
  inspectionConfidence: number;
  coverage: number;
  /** Surfaces with no usable photograph. Always rendered, never omitted. */
  notAssessed: string[];
  explanations: DefectExplanation[];
  caveats: string[];
}

export function buildReportSection(report: PhysicalReport): PhysicalReportSection {
  const insufficient = report.score.grade === ConditionGrade.INSUFFICIENT_EVIDENCE;

  const findings = report.detail.surfaces
    .filter((surface) => surface.assessable)
    .flatMap((surface) => {
      const defects = [...surface.defects, ...surface.wear];
      if (defects.length === 0) {
        return [`No damage detected on ${humanise(surface.surface)}`];
      }
      return defects.map(
        (defect) =>
          `${defectClass(defect.classId)?.label ?? defect.classId} on ${humanise(surface.surface)}`,
      );
    });

  const caveats = report.score.gatesApplied.map((gate) => gate.reason);
  if (report.detail.notAssessed.length > 0) {
    caveats.push(
      `${report.detail.notAssessed.length} surface(s) could not be photographed usably and are ` +
        'excluded from this assessment. No claim is made about their condition.',
    );
  }

  return {
    overallCondition: GRADE_LABEL[report.score.grade],
    physicalDnaScore: insufficient ? null : report.score.score,
    findings,
    inspectionConfidence: report.score.confidence,
    coverage: report.score.coverage,
    notAssessed: report.detail.notAssessed.map(humanise),
    explanations: report.explanations,
    caveats,
  };
}

/** Plain-text rendering, as it appears on the PDF and in the CLI. */
export function renderReportSection(report: PhysicalReport): string {
  const section = buildReportSection(report);
  const lines: string[] = ['PhysicalDNA', ''];

  lines.push(`Overall Condition:      ${section.overallCondition}`);
  lines.push(
    `PhysicalDNA Score:      ${section.physicalDnaScore === null ? '— (insufficient evidence)' : `${section.physicalDnaScore}/100`}`,
  );
  lines.push('');

  lines.push('Findings:');
  for (const finding of section.findings) lines.push(`  - ${finding}`);
  lines.push('');

  lines.push(`Inspection Confidence:  ${Math.round(section.inspectionConfidence * 100)}%`);
  lines.push(`Device Coverage:        ${Math.round(section.coverage * 100)}%`);

  if (section.notAssessed.length > 0) {
    lines.push('');
    lines.push('Not assessed:');
    for (const surface of section.notAssessed) lines.push(`  - ${surface}`);
    lines.push('  No claim is made about these surfaces.');
  }

  if (section.explanations.length > 0) {
    lines.push('', 'Evidence for each finding:', '');
    for (const explanation of section.explanations) {
      lines.push(...renderExplanation(explanation).split('\n').map((line) => `  ${line}`));
      lines.push('');
    }
  }

  if (section.caveats.length > 0) {
    lines.push('Limits on this assessment:');
    for (const caveat of section.caveats) lines.push(`  - ${caveat}`);
  }

  return lines.join('\n');
}

const humanise = (value: string): string => value.toLowerCase().replace(/_/g, ' ');
