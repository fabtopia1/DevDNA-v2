import { EvidenceKind, type EvidenceLedger, type EvidenceRecord } from '@devdna/core';
import { defectClass, Surface } from './taxonomy.js';
import { classIdOf } from './evidence.js';
import { extentFactor } from './scoring.js';

/**
 * Explainability.
 *
 * Every detected defect renders as a statement a technician can read to a
 * customer and a buyer can check: what was found, where, how far it is
 * believed, which evidence record says so, and what it means commercially.
 *
 * The `confidence` printed here is the record's **calibrated** reliability, not
 * the model's score. Those two numbers usually differ, and printing the wrong
 * one is how a system ends up telling a customer it is 97% sure of something it
 * has never been measured on.
 */

export interface DefectExplanation {
  /** e.g. "Deep scratch". */
  detectedDamage: string;
  classId: string;
  /** e.g. "Rear glass". */
  location: string;
  /** 0..1 calibrated reliability of the channel that reported it. */
  confidence: number;
  /** Which evidence record, and where in which image. */
  evidence: {
    evidenceId: string;
    imageId: string;
    box: { x: number; y: number; width: number; height: number } | null;
    /** Retained for the audit trail; never presented as confidence. */
    modelScore: number | null;
  };
  /** Plain-language commercial consequence. */
  impact: string;
  /** How much of this surface's score this defect cost. */
  scoreCost: number;
}

export function explainDefects(ledger: EvidenceLedger): DefectExplanation[] {
  return ledger
    .all()
    .filter(
      (record) =>
        record.kind === EvidenceKind.VISUAL_OBSERVATION && record.key.startsWith('Defect:'),
    )
    .map(explainRecord)
    .filter((entry): entry is DefectExplanation => entry !== null)
    .sort((a, b) => b.scoreCost - a.scoreCost);
}

function explainRecord(record: EvidenceRecord): DefectExplanation | null {
  const classId = classIdOf(record);
  const definition = defectClass(classId);
  if (!definition) return null;

  const raw = parseRaw(record);
  const area = raw.extent ?? (raw.box ? raw.box.width * raw.box.height : 0);
  const cost = definition.severityWeight * extentFactor(area);

  return {
    detectedDamage: definition.label,
    classId,
    location: humanLocation(raw.surface),
    confidence: record.provenance.reliability,
    evidence: {
      evidenceId: record.id,
      imageId: raw.imageId ?? String(record.value).split('#')[0] ?? '',
      box: raw.box ?? null,
      modelScore: raw.modelScore ?? null,
    },
    impact: definition.impact,
    scoreCost: Math.round(cost * 100),
  };
}

interface RawDetection {
  surface?: Surface;
  imageId?: string;
  box?: { x: number; y: number; width: number; height: number };
  modelScore?: number;
  extent?: number | null;
}

function parseRaw(record: EvidenceRecord): RawDetection {
  if (!record.raw) return {};
  try {
    return JSON.parse(record.raw) as RawDetection;
  } catch {
    return {};
  }
}

const humanLocation = (surface: Surface | undefined): string => {
  if (!surface) return 'Unknown';
  const words = surface.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The block that appears under each finding on a report. */
export const renderExplanation = (entry: DefectExplanation): string =>
  [
    `Detected Damage:  ${entry.detectedDamage}`,
    `Location:         ${entry.location}`,
    `Confidence:       ${Math.round(entry.confidence * 100)}%`,
    `Evidence:         ${entry.evidence.evidenceId} (${entry.evidence.imageId})`,
    `Impact:           ${entry.impact}`,
  ].join('\n');
