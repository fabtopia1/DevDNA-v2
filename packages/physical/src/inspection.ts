import { EvidenceKind, EvidenceLedger, ProvenanceEngine, type Finding } from '@devdna/core';
import { collectPhysicalEvidence, type PhysicalCaptureSession } from './evidence.js';
import { runPhysicalModule, type ConditionVerdict, type PhysicalDetail } from './module.js';
import { computePhysicalScore, type PhysicalScore } from './scoring.js';
import { explainDefects, type DefectExplanation } from './explain.js';
import { REQUIRED_VIEWS, type CaptureView } from './capture/views.js';
import { validateCapture } from './validation/validate.js';
import type { CaptureInput, ValidationResult } from './validation/types.js';
import type { DefectDetector } from './detection/types.js';
import type { ModuleResult } from '@devdna/core';

/**
 * PhysicalDNA orchestration.
 *
 * Same two-phase shape as SoftwareDNA: turn observations into evidence, then
 * reason over the evidence. `evaluatePhysical` takes a ledger and nothing else,
 * which is what makes a stored assessment reproducible without the photographs.
 */

export const PHYSICAL_ENGINE_VERSION = '1.0.0';

export interface PhysicalReport {
  engineVersion: string;
  assessedAt: string;
  ledgerDigest: string;
  module: ModuleResult<ConditionVerdict>;
  detail: PhysicalDetail;
  score: PhysicalScore;
  findings: Finding[];
  explanations: DefectExplanation[];
  /** Required views with no accepted image. Drives the retake prompt. */
  missingRequiredViews: CaptureView[];
  provenanceViolations: ReturnType<typeof ProvenanceEngine.audit>;
}

export interface InspectPhysicalInput {
  captures: readonly CaptureInput[];
  detector: DefectDetector;
  capturedAt?: string;
}

/** Validate, detect, record evidence, then reason over it. */
export async function inspectPhysical(input: InspectPhysicalInput): Promise<PhysicalReport> {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const validations: ValidationResult[] = input.captures.map(validateCapture);

  // Only images that passed validation are shown to the detector. Running it on
  // rejected images would produce detections that the evidence adapter must
  // then discard, and every one of those is a chance for a misattributed defect
  // to reach a score.
  const usable = input.captures.filter((capture) =>
    validations.some((v) => v.imageId === capture.imageId && v.accepted),
  );

  const detection = await input.detector.detect(usable);

  const { ledger } = collectPhysicalEvidence({
    capturedAt,
    validations,
    detector: detection.detector,
    detections: detection.detections,
    detectorFailures: detection.failures,
  } satisfies PhysicalCaptureSession);

  return evaluatePhysical(ledger, { at: capturedAt, validations });
}

export interface EvaluateOptions {
  at?: string;
  /** Only used to report which views still need retaking; never scored from. */
  validations?: readonly ValidationResult[];
}

/**
 * Reason over a physical evidence ledger.
 *
 * The reproducibility seam. Everything below is a pure function of the stored
 * evidence, so a physical assessment can be re-derived, re-scored under an
 * improved engine, or defended in a dispute, with no access to the images.
 */
export function evaluatePhysical(
  source: EvidenceLedger,
  options: EvaluateOptions = {},
): PhysicalReport {
  const at = options.at ?? new Date().toISOString();
  const ledger = source.clone();
  const provenance = new ProvenanceEngine(ledger);

  const { result, findings, detail } = runPhysicalModule(ledger, provenance, at);

  const score = computePhysicalScore({
    surfaces: detail.surfaces,
    detectorCalibrated: detail.detectorCalibrated,
  });

  return {
    engineVersion: PHYSICAL_ENGINE_VERSION,
    assessedAt: at,
    ledgerDigest: ledger.digest(),
    module: result,
    detail,
    score,
    findings,
    explanations: explainDefects(ledger),
    missingRequiredViews: missingRequired(ledger, options.validations),
    provenanceViolations: ProvenanceEngine.audit(ledger, [result], findings),
  };
}

function missingRequired(
  ledger: EvidenceLedger,
  validations: readonly ValidationResult[] | undefined,
): CaptureView[] {
  const accepted = new Set<string>();
  if (validations) {
    for (const validation of validations) if (validation.accepted) accepted.add(validation.view);
  } else {
    for (const record of ledger.all()) {
      if (record.key.startsWith('ViewCaptured:') && record.kind !== EvidenceKind.COLLECTION_FAILURE) {
        const view = record.key.split(':')[1];
        if (view) accepted.add(view);
      }
    }
  }
  return REQUIRED_VIEWS.filter((view) => !accepted.has(view));
}
