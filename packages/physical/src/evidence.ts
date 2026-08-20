import {
  CollectionMethod,
  EvidenceKind,
  EvidenceLedger,
  EvidenceSource,
  FailureReason,
  type EvidenceRecord,
} from '@devdna/core';
import { SURFACE_SUBJECT, TAXONOMY_VERSION, defectClass, type Surface } from './taxonomy.js';
import { viewSpec, type CaptureView } from './capture/views.js';
import type { ValidationResult } from './validation/types.js';
import type { Detection, DetectorInfo } from './detection/types.js';
import { passesThreshold, reliabilityFor } from './detection/calibration.js';

/**
 * Detections and image quality become evidence.
 *
 * This is the seam where PhysicalDNA joins SoftwareDNA, and the notable thing
 * about it is how little it needed: a few vocabulary entries, and physical
 * observations flow into the same ledger, under the same provenance rules, read
 * by the same Provenance Engine. No new inference machinery, no second scoring
 * framework, no parallel audit trail.
 *
 * That was the test of the adapter seam documented in `docs/01-architecture.md`,
 * and it is worth saying plainly that it was a real test rather than a
 * rhetorical one: the seam was designed for OEM service records, and physical
 * inspection is a different kind of observation entirely.
 */

export const COLLECTOR_CAPTURE = 'physical.capture';
export const COLLECTOR_QUALITY = 'physical.image-quality';
export const COLLECTOR_DETECTOR = 'physical.detector';

export interface PhysicalCaptureSession {
  /** ISO-8601. When the session was captured. */
  capturedAt: string;
  validations: ValidationResult[];
  detector: DetectorInfo;
  detections: Detection[];
  /** Images the detector could not process at all. */
  detectorFailures: Array<{ imageId: string; reason: string }>;
}

export interface EvidenceCollectionOutcome {
  ledger: EvidenceLedger;
  /** Detections discarded before becoming evidence, with why. */
  discarded: Array<{ detection: Detection; reason: string }>;
}

/**
 * Translate a capture session into evidence.
 *
 * Nothing here interprets. A detection becomes "a region matching this class
 * was located here, by this model version, and this channel is believed this
 * far". Whether that makes the frame Fair or Good is decided later, by rules
 * that must cite these records.
 */
export function collectPhysicalEvidence(
  session: PhysicalCaptureSession,
  target?: EvidenceLedger,
): EvidenceCollectionOutcome {
  const ledger = target ?? new EvidenceLedger();
  const discarded: EvidenceCollectionOutcome['discarded'] = [];
  const instrument = `${session.detector.name}@${session.detector.version}`;

  const acceptedImages = new Set(
    session.validations.filter((v) => v.accepted).map((v) => v.imageId),
  );

  // --- Capture coverage, per (view, surface) --------------------------------
  //
  // Recorded per surface rather than per image because coverage is a question
  // about surfaces: "was the rear glass photographed usably?" is what decides
  // whether a rear-glass verdict is possible, and one image can answer it for
  // several surfaces at once.
  for (const validation of session.validations) {
    const spec = viewSpec(validation.view);
    for (const surface of spec.surfaces) {
      const subject = SURFACE_SUBJECT[surface];
      const key = `ViewCaptured:${validation.view}`;

      if (validation.accepted) {
        ledger.record({
          kind: EvidenceKind.DEVICE_PROPERTY,
          subject,
          key,
          value: validation.imageId,
          source: EvidenceSource.DEVDNA_CAPTURE_PIPELINE,
          method: CollectionMethod.GUIDED_PHOTO_CAPTURE,
          collector: COLLECTOR_CAPTURE,
          observedAt: session.capturedAt,
          note: `${spec.label} captured and passed image validation.`,
        });
      } else {
        ledger.recordFailure({
          subject,
          key,
          reason: FailureReason.PARSE_ERROR,
          source: EvidenceSource.DEVDNA_CAPTURE_PIPELINE,
          method: CollectionMethod.GUIDED_PHOTO_CAPTURE,
          collector: COLLECTOR_CAPTURE,
          observedAt: session.capturedAt,
          detail:
            `${spec.label} rejected: ` +
            validation.rejections.map((r) => r.reason).join(', ') +
            '. This surface was not assessed from this image.',
        });
      }
    }

    // --- The measurements behind the gate ----------------------------------
    //
    // Stored so a rejection is re-derivable rather than asserted. A shop
    // disputing "your system rejected my photograph" can be shown the number
    // and the threshold it failed.
    const primary = spec.surfaces[0];
    if (primary) {
      const subject = SURFACE_SUBJECT[primary];
      const metrics = validation.metrics;
      const quality: Array<[string, number]> = [
        [`ImageSharpness:${validation.imageId}`, Math.round(metrics.sharpness)],
        [`ImageIsotropy:${validation.imageId}`, Math.round(metrics.sharpnessIsotropy * 100) / 100],
        [`ImageBrightness:${validation.imageId}`, Math.round(metrics.brightness)],
        [`ImageContrast:${validation.imageId}`, Math.round(metrics.contrast)],
        [
          `ImageGlareRatio:${validation.imageId}`,
          Math.round(metrics.clippedHighlightRatio * 1000) / 1000,
        ],
        [
          `ImageSubjectFill:${validation.imageId}`,
          Math.round(metrics.subjectFillRatio * 100) / 100,
        ],
      ];
      for (const [key, value] of quality) {
        ledger.record({
          kind: EvidenceKind.IMAGE_QUALITY_METRIC,
          subject,
          key,
          value,
          source: EvidenceSource.DEVDNA_CAPTURE_PIPELINE,
          method: CollectionMethod.IMAGE_QUALITY_ANALYSIS,
          collector: COLLECTOR_QUALITY,
          observedAt: session.capturedAt,
        });
      }
    }
  }

  // --- Detector failures ----------------------------------------------------
  for (const failure of session.detectorFailures) {
    const validation = session.validations.find((v) => v.imageId === failure.imageId);
    const spec = validation ? viewSpec(validation.view) : undefined;
    for (const surface of spec?.surfaces ?? []) {
      ledger.recordFailure({
        subject: SURFACE_SUBJECT[surface],
        key: `DetectionRun:${failure.imageId}`,
        reason: FailureReason.UNKNOWN,
        source: EvidenceSource.DEVDNA_VISION_MODEL,
        method: CollectionMethod.VISION_MODEL_DETECTION,
        collector: COLLECTOR_DETECTOR,
        observedAt: session.capturedAt,
        detail: `The detector could not process this image: ${failure.reason}`,
      });
    }
  }

  // --- Detections -----------------------------------------------------------
  for (const detection of session.detections) {
    const rejection = rejectDetection(detection, acceptedImages);
    if (rejection) {
      discarded.push({ detection, reason: rejection });
      continue;
    }

    const definition = defectClass(detection.classId);
    // `rejectDetection` has already established the class exists; this narrows
    // the type without a non-null assertion.
    if (!definition) continue;

    const subject = SURFACE_SUBJECT[detection.surface];
    const location = formatBox(detection);

    ledger.record({
      kind: EvidenceKind.VISUAL_OBSERVATION,
      subject,
      key: `Defect:${detection.classId}`,
      // Value carries the localisation, so two distinct defects of the same
      // class on the same surface are two records rather than one deduplicated
      // into oblivion by content addressing.
      value: `${detection.imageId}#${location}`,
      source: EvidenceSource.DEVDNA_VISION_MODEL,
      method: CollectionMethod.VISION_MODEL_DETECTION,
      // Calibrated precision for the class — never the model's own score.
      reliability: reliabilityFor(detection),
      collector: COLLECTOR_DETECTOR,
      observedAt: session.capturedAt,
      instrument: `${instrument} taxonomy@${TAXONOMY_VERSION}`,
      raw: JSON.stringify({
        detectionId: detection.detectionId,
        classId: detection.classId,
        surface: detection.surface,
        view: detection.view,
        box: detection.box,
        modelScore: detection.modelScore,
        extent: detection.extent ?? null,
        calibration: session.detector.calibrationId,
      }),
      note: `${definition.label} located on ${humanSurface(detection.surface)} in the ${viewSpec(detection.view).label.toLowerCase()} image.`,
    });
  }

  return { ledger, discarded };
}

/**
 * Guards a detection must pass before it can become evidence.
 *
 * These are not conservatism for its own sake. Each one is a failure that would
 * otherwise show up as a confident finding about damage that was never
 * photographed.
 */
function rejectDetection(detection: Detection, acceptedImages: Set<string>): string | null {
  const definition = defectClass(detection.classId);
  if (!definition) return `unknown taxonomy class ${detection.classId}`;

  if (!acceptedImages.has(detection.imageId)) {
    return 'found in an image that failed validation';
  }
  if (!definition.surfaces.includes(detection.surface)) {
    return `class ${detection.classId} cannot occur on ${detection.surface}`;
  }
  // A rear-glass detection in the front view means the surface attribution is
  // wrong somewhere upstream. Scoring it would price a device on damage found
  // in a photograph that does not show the damaged part.
  if (!viewSpec(detection.view).surfaces.includes(detection.surface)) {
    return `the ${detection.view} view cannot show ${detection.surface}`;
  }
  if (!passesThreshold(detection)) {
    return `model score ${detection.modelScore.toFixed(2)} is below the operating threshold for ${detection.classId}`;
  }
  return null;
}

const formatBox = (detection: Detection): string =>
  [detection.box.x, detection.box.y, detection.box.width, detection.box.height]
    .map((n) => n.toFixed(4))
    .join(',');

export const humanSurface = (surface: Surface): string =>
  surface.toLowerCase().replace(/_/g, ' ');

/** Every detection record for one surface. */
export const defectRecordsFor = (
  ledger: EvidenceLedger,
  surface: Surface,
): EvidenceRecord[] =>
  ledger
    .forSubject(SURFACE_SUBJECT[surface])
    .filter(
      (record) =>
        record.kind === EvidenceKind.VISUAL_OBSERVATION && record.key.startsWith('Defect:'),
    );

export const captureRecordsFor = (
  ledger: EvidenceLedger,
  surface: Surface,
): { accepted: EvidenceRecord[]; failed: EvidenceRecord[] } => {
  const all = ledger
    .forSubject(SURFACE_SUBJECT[surface])
    .filter((record) => record.key.startsWith('ViewCaptured:'));
  return {
    accepted: all.filter((r) => r.kind !== EvidenceKind.COLLECTION_FAILURE),
    failed: all.filter((r) => r.kind === EvidenceKind.COLLECTION_FAILURE),
  };
};

/** The class id encoded in a `Defect:` evidence key. */
export const classIdOf = (record: EvidenceRecord): string => record.key.slice('Defect:'.length);
