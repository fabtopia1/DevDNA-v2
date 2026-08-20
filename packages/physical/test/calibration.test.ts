import { afterEach, describe, expect, it } from 'vitest';
import {
  CALIBRATION_TABLE,
  calibrationIsMeasured,
  loadCalibration,
  reliabilityFor,
  resetCalibration,
  UNCALIBRATED_RELIABILITY,
  type ClassCalibration,
} from '../src/detection/calibration.js';
import { DEFECT_CLASS_IDS, Surface } from '../src/taxonomy.js';
import { REQUIRED_VIEWS } from '../src/capture/views.js';
import { MockDetector, type ScriptedDefect } from '../src/detection/mock.js';
import { inspectPhysical } from '../src/inspection.js';
import { ConditionGrade } from '../src/scoring.js';
import { goodImage } from './images.js';
import type { CaptureInput } from '../src/validation/types.js';

const AT = '2026-08-19T10:00:00.000Z';

const captures = (): CaptureInput[] =>
  REQUIRED_VIEWS.map((view, i) => ({
    imageId: `img_${view.toLowerCase()}`,
    view,
    image: goodImage(i),
    capturedAt: AT,
    sha256: 'a'.repeat(64),
  }));

/** A plausible post-benchmark calibration table. */
const measured = (precision = 0.93, recall = 0.88): ClassCalibration[] =>
  DEFECT_CLASS_IDS.map((classId) => ({
    classId,
    operatingThreshold: 0.6,
    precision,
    recall,
    sampleSize: 400,
    benchmarkVersion: 'benchmark-2026.1',
  }));

afterEach(() => resetCalibration());

describe('calibration', () => {
  it('ships uncalibrated, and says so', () => {
    expect(calibrationIsMeasured()).toBe(false);
    expect(CALIBRATION_TABLE['CRACK_STRUCTURAL']?.sampleSize).toBe(0);
  });

  it('uses measured precision as reliability once a benchmark lands', () => {
    const detection = {
      detectionId: 'd', imageId: 'i', view: 'BACK', classId: 'CHIP',
      surface: Surface.REAR_GLASS, box: { x: 0, y: 0, width: 0.1, height: 0.1 },
      modelScore: 0.99,
    } as never;

    expect(reliabilityFor(detection)).toBe(UNCALIBRATED_RELIABILITY);
    loadCalibration(measured(0.91));
    // Still not the model's 0.99 — the measured 0.91.
    expect(reliabilityFor(detection)).toBeCloseTo(0.91);
  });

  it('merges partial benchmarks rather than vouching for unmeasured classes', () => {
    loadCalibration([
      {
        classId: 'CHIP', operatingThreshold: 0.6, precision: 0.95, recall: 0.9,
        sampleSize: 300, benchmarkVersion: 'benchmark-2026.1',
      },
    ]);
    expect(calibrationIsMeasured()).toBe(false);
    expect(CALIBRATION_TABLE['CRACK_STRUCTURAL']?.sampleSize).toBe(0);
  });

  it('will not treat a thin benchmark as a measurement', () => {
    loadCalibration(
      DEFECT_CLASS_IDS.map((classId) => ({
        classId, operatingThreshold: 0.6, precision: 0.99, recall: 0.99,
        sampleSize: 5, benchmarkVersion: 'benchmark-2026.1',
      })),
    );
    // Five examples is not evidence of 99% precision, however good it looks.
    expect(calibrationIsMeasured()).toBe(false);
  });

  it('issues a real grade once the detector is benchmarked', async () => {
    const before = await inspectPhysical({
      captures: captures(), detector: new MockDetector(), capturedAt: AT,
    });
    // Unbenchmarked: the engine refuses to grade at all.
    expect(before.score.grade).toBe(ConditionGrade.INSUFFICIENT_EVIDENCE);

    loadCalibration(measured());
    const after = await inspectPhysical({
      captures: captures(), detector: new MockDetector(), capturedAt: AT,
    });

    expect(after.score.grade).not.toBe(ConditionGrade.INSUFFICIENT_EVIDENCE);
    expect(after.score.confidence).toBeGreaterThan(0.45);
    expect(after.score.gatesApplied.map((g) => g.code)).not.toContain('DETECTOR_UNCALIBRATED');
    expect(after.score.score).toBeGreaterThan(90);
    expect(after.provenanceViolations).toEqual([]);
  });

  it('still prices damage correctly under a measured detector', async () => {
    loadCalibration(measured());
    const cracked: ScriptedDefect = {
      imageId: 'img_display_off', classId: 'CRACK_STRUCTURAL', surface: Surface.FRONT_GLASS,
      box: { x: 0.2, y: 0.1, width: 0.5, height: 0.4 }, modelScore: 0.96, extent: 0.2,
    };
    const report = await inspectPhysical({
      captures: captures(), detector: new MockDetector([cracked]), capturedAt: AT,
    });

    expect(report.score.grade).toBe(ConditionGrade.FAIR);
    expect(report.score.gatesApplied.map((g) => g.code)).toContain('FRONT_GLASS_SEVERE_DAMAGE');
    expect(report.explanations[0]?.confidence).toBeCloseTo(0.93);
  });

  it('lets a low-recall detector score damage but not vouch for cleanliness', async () => {
    // The asymmetry that makes recall commercially load-bearing: precision
    // bounds what a detection means, recall bounds what an *absence* means.
    loadCalibration(measured(0.95, 0.4));
    const report = await inspectPhysical({
      captures: captures(), detector: new MockDetector(), capturedAt: AT,
    });
    expect(report.score.confidence).toBeLessThan(0.6);
  });
});
