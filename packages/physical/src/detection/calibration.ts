import { DEFECT_CLASS_IDS } from '../taxonomy.js';
import type { Detection } from './types.js';

/**
 * Calibration: turning a model score into a reliability.
 *
 * A detector that says 0.94 is not making a 94% claim about the world. It is
 * reporting an activation, and the relationship between that activation and
 * being right has to be *measured*, per class, on data the model never saw.
 *
 * So each class carries a calibration entry derived from the held-out benchmark
 * set: the precision actually observed at the operating threshold. That number
 * — not the softmax — becomes the evidence record's channel reliability, and
 * therefore bounds every inference drawn from the detection.
 *
 * The consequences are deliberate and uncomfortable, which is how you can tell
 * they are honest:
 *
 *   - a class DevDNA cannot yet detect reliably contributes little confidence,
 *     no matter how certain the network sounds;
 *   - a class with no calibration entry falls back to a low default, so
 *     shipping an uncalibrated class visibly costs confidence rather than
 *     silently borrowing it;
 *   - improving the score means improving measured precision, which cannot be
 *     done by tuning a threshold upward.
 */

export interface ClassCalibration {
  classId: string;
  /**
   * Model score below which a detection is discarded entirely. Chosen per class
   * on the validation set, not globally: hairline cracks and shattered glass do
   * not share an operating point.
   */
  operatingThreshold: number;
  /** Measured precision at that threshold on the held-out benchmark set. */
  precision: number;
  /** Measured recall. Not used for reliability; drives coverage honesty. */
  recall: number;
  /** How many held-out instances the numbers rest on. */
  sampleSize: number;
  /** Benchmark set version the numbers were measured against. */
  benchmarkVersion: string;
}

/**
 * Reliability for a class with no calibration entry.
 *
 * Set low on purpose. An uncalibrated class is one whose error rate nobody has
 * measured, and the correct treatment of an unmeasured instrument is suspicion.
 */
export const UNCALIBRATED_RELIABILITY = 0.5;
export const UNCALIBRATED_THRESHOLD = 0.85;

/**
 * The shipped calibration table.
 *
 * Every entry here is a placeholder carrying `sampleSize: 0` and the
 * `unmeasured` benchmark version, because no model has been trained yet. They
 * are present so the pipeline is complete and typed, and they are marked so
 * that no reader — and no report — can mistake them for measurements.
 *
 * `isMeasured` is what the engine checks. Until a benchmark run replaces these,
 * every class behaves as uncalibrated, and the engine says so in the report
 * rather than producing a confident number from an unvalidated model.
 */
export const CALIBRATION_VERSION = 'unmeasured-0';

const PLACEHOLDER_TABLE: Record<string, ClassCalibration> = Object.fromEntries(
  DEFECT_CLASS_IDS.map((classId) => [
    classId,
    {
      classId,
      operatingThreshold: UNCALIBRATED_THRESHOLD,
      precision: UNCALIBRATED_RELIABILITY,
      recall: 0,
      sampleSize: 0,
      benchmarkVersion: CALIBRATION_VERSION,
    } satisfies ClassCalibration,
  ]),
);

export const CALIBRATION_TABLE: Record<string, ClassCalibration> = { ...PLACEHOLDER_TABLE };

/**
 * Install a measured calibration table, as produced by a benchmark run.
 *
 * This is how the engine goes from "declines to grade" to "grades": the
 * benchmark job publishes precision and recall per class, and loading them here
 * raises every downstream confidence to the level the measurements support —
 * and no higher. It is a data change, not a code change, which is the property
 * that lets the model improve on its own release cycle.
 *
 * Entries are merged, so a partial benchmark leaves the unmeasured classes
 * behaving as unmeasured rather than silently inheriting a neighbour's numbers.
 */
export function loadCalibration(entries: readonly ClassCalibration[]): void {
  for (const entry of entries) CALIBRATION_TABLE[entry.classId] = entry;
}

/** Restore the shipped placeholders. Used by tests and by a rollback. */
export function resetCalibration(): void {
  for (const key of Object.keys(CALIBRATION_TABLE)) delete CALIBRATION_TABLE[key];
  Object.assign(CALIBRATION_TABLE, PLACEHOLDER_TABLE);
}

export const isMeasured = (calibration: ClassCalibration | undefined): boolean =>
  Boolean(calibration && calibration.sampleSize >= 50 && calibration.benchmarkVersion !== CALIBRATION_VERSION);

export const calibrationFor = (classId: string): ClassCalibration | undefined =>
  CALIBRATION_TABLE[classId];

/**
 * The reliability that goes onto the evidence record.
 *
 * Note what is absent: `detection.modelScore` does not appear. The score decides
 * whether the detection survives thresholding; it does not decide how far the
 * detection is believed.
 */
export function reliabilityFor(detection: Detection): number {
  const calibration = calibrationFor(detection.classId);
  if (!isMeasured(calibration)) return UNCALIBRATED_RELIABILITY;
  return Math.min(0.99, Math.max(0.05, calibration!.precision));
}

/** Detections below their class operating threshold never become evidence. */
export function passesThreshold(detection: Detection): boolean {
  const calibration = calibrationFor(detection.classId);
  const threshold = calibration?.operatingThreshold ?? UNCALIBRATED_THRESHOLD;
  return detection.modelScore >= threshold;
}

/** True when every class in the taxonomy has real measured calibration. */
export const calibrationIsMeasured = (): boolean =>
  DEFECT_CLASS_IDS.every((id) => isMeasured(calibrationFor(id)));
