import { describe, expect, it } from 'vitest';
import { EvidenceKind, EvidenceSubject, EvidenceLedger } from '@devdna/core';
import { CaptureView, REQUIRED_VIEWS, viewSpec } from '../src/capture/views.js';
import { Surface, DEFECT_CLASSES, defectClass, TRUST_RELEVANT_CLASSES } from '../src/taxonomy.js';
import { MockDetector, type ScriptedDefect } from '../src/detection/mock.js';
import { UNCALIBRATED_RELIABILITY, calibrationIsMeasured } from '../src/detection/calibration.js';
import { collectPhysicalEvidence } from '../src/evidence.js';
import { evaluatePhysical, inspectPhysical } from '../src/inspection.js';
import { ConditionVerdict } from '../src/module.js';
import { ConditionGrade, PhysicalPillar } from '../src/scoring.js';
import type { CaptureInput } from '../src/validation/types.js';
import { blurredImage, glaredImage, goodImage } from './images.js';

const AT = '2026-08-19T10:00:00.000Z';

/** One capture per view, all of them usable unless overridden. */
function captures(overrides: Partial<Record<CaptureView, 'blurred' | 'glared'>> = {}): CaptureInput[] {
  return REQUIRED_VIEWS.map((view, index) => {
    const broken = overrides[view];
    const image =
      broken === 'blurred' ? blurredImage(index) : broken === 'glared' ? glaredImage(index) : goodImage(index);
    return {
      imageId: `img_${view.toLowerCase()}`,
      view,
      image,
      capturedAt: AT,
      sha256: `${index}`.repeat(64).slice(0, 64),
    };
  });
}

const run = (script: ScriptedDefect[] = [], overrides = {}) =>
  inspectPhysical({
    captures: captures(overrides),
    detector: new MockDetector(script),
    capturedAt: AT,
  });

const CRACKED_SCREEN: ScriptedDefect = {
  imageId: 'img_display_off',
  classId: 'CRACK_STRUCTURAL',
  surface: Surface.FRONT_GLASS,
  box: { x: 0.2, y: 0.1, width: 0.5, height: 0.4 },
  modelScore: 0.96,
  extent: 0.2,
};

const LOWER_FRAME_SCRATCH: ScriptedDefect = {
  imageId: 'img_bottom_edge',
  classId: 'SCRATCH_LIGHT',
  surface: Surface.FRAME,
  box: { x: 0.3, y: 0.4, width: 0.04, height: 0.01 },
  modelScore: 0.91,
};

describe('taxonomy', () => {
  it('has unique ids and a usable definition for every class', () => {
    const ids = DEFECT_CLASSES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of DEFECT_CLASSES) {
      expect(entry.surfaces.length).toBeGreaterThan(0);
      expect(entry.severityWeight).toBeGreaterThan(0);
      expect(entry.severityWeight).toBeLessThanOrEqual(1);
      expect(entry.annotationRule.length).toBeGreaterThan(20);
      expect(entry.impact.length).toBeGreaterThan(10);
    }
  });

  it('covers every surface', () => {
    for (const surface of Object.values(Surface)) {
      expect(DEFECT_CLASSES.some((entry) => entry.surfaces.includes(surface))).toBe(true);
    }
  });

  it('marks repair indicators as trust-relevant and cosmetic wear as not', () => {
    const ids = TRUST_RELEVANT_CLASSES.map((entry) => entry.id);
    expect(ids).toContain('NON_OEM_SCREW');
    expect(ids).toContain('ADHESIVE_RESIDUE');
    // The distinction the whole integration rests on: a scratched phone is not
    // a less trustworthy phone.
    expect(ids).not.toContain('SCRATCH_LIGHT');
    expect(ids).not.toContain('HEAVY_WEAR_FIELD');
  });
});

describe('evidence adapter', () => {
  it('records the calibrated reliability, never the model score', async () => {
    const report = await run([CRACKED_SCREEN]);
    const ledger = EvidenceLedger.from(
      // Re-read from the report's own explanations to prove the value shipped.
      [],
    );
    void ledger;
    const explanation = report.explanations.find((e) => e.classId === 'CRACK_STRUCTURAL');
    expect(explanation).toBeDefined();
    expect(explanation!.evidence.modelScore).toBeCloseTo(0.96);
    // 0.96 is the network's activation. 0.5 is what DevDNA has actually
    // measured about it, which is nothing.
    expect(explanation!.confidence).toBe(UNCALIBRATED_RELIABILITY);
  });

  it('discards a detection found in an image that failed validation', () => {
    const { discarded, ledger } = collectPhysicalEvidence({
      capturedAt: AT,
      validations: [
        {
          imageId: 'img_bad',
          view: CaptureView.BACK,
          accepted: false,
          metrics: {} as never,
          rejections: [{ reason: 'OUT_OF_FOCUS' as never, detail: 'test' }],
        },
      ],
      detector: new MockDetector().info(),
      detections: [
        {
          detectionId: 'det_1',
          imageId: 'img_bad',
          view: CaptureView.BACK,
          classId: 'CHIP',
          surface: Surface.REAR_GLASS,
          box: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
          modelScore: 0.99,
        },
      ],
      detectorFailures: [],
    });

    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.reason).toMatch(/failed validation/);
    expect(ledger.all().some((r) => r.key.startsWith('Defect:'))).toBe(false);
  });

  it('discards a detection attributed to a surface its view cannot show', () => {
    const { discarded } = collectPhysicalEvidence({
      capturedAt: AT,
      validations: [
        {
          imageId: 'img_front',
          view: CaptureView.FRONT,
          accepted: true,
          metrics: {} as never,
          rejections: [],
        },
      ],
      detector: new MockDetector().info(),
      detections: [
        {
          detectionId: 'det_2',
          imageId: 'img_front',
          view: CaptureView.FRONT,
          // The front view cannot see the rear glass. Scoring this would price
          // a device on damage that was never photographed.
          classId: 'CHIP',
          surface: Surface.REAR_GLASS,
          box: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
          modelScore: 0.99,
        },
      ],
      detectorFailures: [],
    });

    expect(discarded[0]?.reason).toMatch(/cannot show/);
  });

  it('records a rejected capture as a failure rather than dropping it', async () => {
    const report = await run([], { [CaptureView.BACK]: 'glared' });
    expect(report.detail.notAssessed).toContain(Surface.REAR_GLASS);
    // The abstention is supported: there is a record saying we tried.
    const abstained = report.module.verdicts.find(
      (v) => v.subject === EvidenceSubject.REAR_HOUSING,
    );
    expect(abstained?.value).toBe(ConditionVerdict.CANNOT_DETERMINE);
    expect(abstained?.inferenceIds.length).toBeGreaterThan(0);
  });
});

describe('condition module and score', () => {
  it('produces no provenance violations on any path', async () => {
    for (const report of [
      await run(),
      await run([CRACKED_SCREEN, LOWER_FRAME_SCRATCH]),
      await run([], { [CaptureView.BACK]: 'glared', [CaptureView.CAMERA_MODULE]: 'blurred' }),
    ]) {
      expect(report.provenanceViolations).toEqual([]);
    }
  });

  it('caps an undamaged device because the detector is uncalibrated', async () => {
    const report = await run();
    expect(calibrationIsMeasured()).toBe(false);
    expect(report.score.gatesApplied.map((g) => g.code)).toContain('DETECTOR_UNCALIBRATED');
    // The cap is the point: "we found nothing" is worth nothing until the miss
    // rate has been measured.
    expect(report.score.score).toBeLessThanOrEqual(84);
    expect(report.score.rawScore).toBeGreaterThan(report.score.score);
    expect(report.score.grade).not.toBe(ConditionGrade.PRISTINE);
  });

  it('drops the display pillar when the screen is cracked', async () => {
    const clean = await run();
    const cracked = await run([CRACKED_SCREEN]);

    const pillar = (r: typeof cracked, p: PhysicalPillar) =>
      r.score.pillars.find((entry) => entry.pillar === p);

    expect(pillar(cracked, PhysicalPillar.DISPLAY)!.score).toBeLessThan(
      pillar(clean, PhysicalPillar.DISPLAY)!.score!,
    );
    // Both the underlying score and the capped, reported score must move. The
    // second is the one that matters commercially: while the detector is
    // uncalibrated the cap flattens the top of the range, and a cracked screen
    // that still reported the same grade as a clean one would be indefensible.
    expect(cracked.score.rawScore).toBeLessThan(clean.score.rawScore);
    expect(cracked.score.score).toBeLessThan(clean.score.score);
    expect(cracked.score.gatesApplied.map((g) => g.code)).toContain('FRONT_GLASS_SEVERE_DAMAGE');
    expect(
      cracked.module.verdicts.find((v) => v.subject === EvidenceSubject.DISPLAY)?.value,
    ).not.toBe(ConditionVerdict.SURFACE_UNDAMAGED);
  });

  it('saturates rather than accumulating linearly across many light defects', async () => {
    const many: ScriptedDefect[] = Array.from({ length: 10 }, (_, i) => ({
      ...LOWER_FRAME_SCRATCH,
      box: { x: 0.05 * i, y: 0.4, width: 0.04, height: 0.01 },
      modelScore: 0.9,
    }));
    const one = await run([LOWER_FRAME_SCRATCH]);
    const ten = await run(many);

    const frame = (r: typeof one) =>
      r.score.pillars.find((p) => p.pillar === PhysicalPillar.FRAME)!.score!;

    // Ten scratches are worse than one...
    expect(frame(ten)).toBeLessThan(frame(one));
    // ...and nowhere near ten times worse. A linear model would drive a
    // well-used but sound handset to zero.
    expect(frame(ten)).toBeGreaterThan(30);
  });

  it('excludes an unassessable surface instead of scoring it as damaged', async () => {
    const full = await run();
    // Both views that can show the rear camera have to fail: the back view sees
    // the module too, and a system that treated one failed close-up as "camera
    // not assessed" would understate its own coverage.
    const partial = await run([], {
      [CaptureView.CAMERA_MODULE]: 'glared',
      [CaptureView.BACK]: 'glared',
    });

    expect(partial.score.coverage).toBeLessThan(full.score.coverage);

    // The camera pillar still scores, from the front camera — but it must not
    // claim full coverage, because the rear camera is 85% of what the pillar is
    // about and was never usably photographed.
    const camera = partial.score.pillars.find((p) => p.pillar === PhysicalPillar.CAMERA);
    expect(camera?.coverage).toBeLessThan(1);
    expect(partial.detail.notAssessed).toContain(Surface.REAR_CAMERA);

    // A surface with no usable view abstains outright rather than scoring zero
    // and dragging the device down.
    const rearGlass = partial.score.pillars.find((p) => p.pillar === PhysicalPillar.REAR_GLASS);
    expect(rearGlass?.score).toBeNull();
    expect(rearGlass?.effectiveWeight).toBe(0);
  });

  it('reports insufficient evidence rather than a grade when nothing is usable', async () => {
    const report = await inspectPhysical({
      captures: captures().map((capture) => ({ ...capture, image: blurredImage(9) })),
      detector: new MockDetector(),
      capturedAt: AT,
    });
    expect(report.score.coverage).toBe(0);
    expect(report.score.grade).toBe(ConditionGrade.INSUFFICIENT_EVIDENCE);
    expect(report.missingRequiredViews.length).toBe(REQUIRED_VIEWS.length);
  });

  it('names the surfaces it did not assess', async () => {
    const report = await run([], { [CaptureView.BACK]: 'glared' });
    const finding = report.findings.find((f) => f.code === 'PHYSICAL_SURFACES_NOT_ASSESSED');
    expect(finding).toBeDefined();
    expect(finding!.basis).toBe('ABSENCE');
    expect(finding!.detail).toMatch(/cleaner device/);
  });

  it('separates wear from damage so they cannot be double counted', async () => {
    const worn = await run([
      {
        imageId: 'img_back',
        classId: 'HEAVY_WEAR_FIELD',
        surface: Surface.REAR_GLASS,
        box: { x: 0.1, y: 0.1, width: 0.6, height: 0.6 },
        modelScore: 0.95,
        extent: 0.36,
      },
    ]);

    const rearGlass = worn.score.pillars.find((p) => p.pillar === PhysicalPillar.REAR_GLASS);
    const bodyWear = worn.score.pillars.find((p) => p.pillar === PhysicalPillar.BODY_WEAR);

    // Heavy wear is charged to body wear only. The rear-glass *damage* pillar
    // is untouched, because nothing is broken.
    expect(rearGlass?.score).toBe(100);
    expect(bodyWear!.score!).toBeLessThan(100);
  });
});

describe('explainability', () => {
  it('gives every detection the mandated explanation fields', async () => {
    const report = await run([CRACKED_SCREEN, LOWER_FRAME_SCRATCH]);
    expect(report.explanations).toHaveLength(2);

    for (const entry of report.explanations) {
      expect(entry.detectedDamage).toBe(defectClass(entry.classId)!.label);
      expect(entry.location).toMatch(/^[A-Z]/);
      expect(entry.confidence).toBeGreaterThan(0);
      expect(entry.evidence.evidenceId).toMatch(/^ev_/);
      expect(entry.evidence.imageId).toMatch(/^img_/);
      expect(entry.evidence.box).not.toBeNull();
      expect(entry.impact.length).toBeGreaterThan(10);
    }
  });

  it('orders explanations by what they actually cost the score', async () => {
    const report = await run([LOWER_FRAME_SCRATCH, CRACKED_SCREEN]);
    expect(report.explanations[0]?.classId).toBe('CRACK_STRUCTURAL');
  });
});

describe('reproducibility', () => {
  it('recomputes an identical assessment from the stored evidence alone', async () => {
    const original = await run([CRACKED_SCREEN, LOWER_FRAME_SCRATCH]);

    // Rebuild the ledger the way the database would return it, with no images,
    // no detector and no capture session — then score it again.
    const { ledger } = collectPhysicalEvidence({
      capturedAt: AT,
      validations: captures().map((capture) => ({
        imageId: capture.imageId,
        view: capture.view,
        accepted: true,
        metrics: {} as never,
        rejections: [],
      })),
      detector: new MockDetector().info(),
      detections: (await new MockDetector([CRACKED_SCREEN, LOWER_FRAME_SCRATCH]).detect(
        captures(),
      )).detections,
      detectorFailures: [],
    });

    const replayed = evaluatePhysical(ledger, { at: AT });
    expect(replayed.score.score).toBe(original.score.score);
    expect(replayed.score.grade).toBe(original.score.grade);
    expect(replayed.module.verdicts.map((v) => v.value).sort()).toEqual(
      original.module.verdicts.map((v) => v.value).sort(),
    );
  });

  it('is idempotent: evaluating the same ledger twice gives the same answer', async () => {
    const report = await run([CRACKED_SCREEN]);
    const { ledger } = collectPhysicalEvidence({
      capturedAt: AT,
      validations: captures().map((capture) => ({
        imageId: capture.imageId,
        view: capture.view,
        accepted: true,
        metrics: {} as never,
        rejections: [],
      })),
      detector: new MockDetector().info(),
      detections: (await new MockDetector([CRACKED_SCREEN]).detect(captures())).detections,
      detectorFailures: [],
    });

    const first = evaluatePhysical(ledger, { at: AT });
    const second = evaluatePhysical(ledger, { at: AT });
    expect(second.ledgerDigest).toBe(first.ledgerDigest);
    expect(JSON.stringify(second.score)).toBe(JSON.stringify(first.score));
    void report;
  });

  it('keeps evidence and conclusions in separate layers', async () => {
    const report = await run([CRACKED_SCREEN]);
    // Every inference cites evidence; every verdict cites inferences or abstains.
    for (const inference of report.module.inferences) {
      expect(inference.evidenceIds.length).toBeGreaterThan(0);
    }
    for (const verdict of report.module.verdicts) {
      if (verdict.determinacy === 'DETERMINED') {
        expect(verdict.inferenceIds.length).toBeGreaterThan(0);
        expect(verdict.confidence).toBeGreaterThan(0);
      } else {
        expect(verdict.confidence).toBe(0);
      }
    }
  });
});

describe('capture plan', () => {
  it('constrains every view to surfaces it can physically show', () => {
    expect(viewSpec(CaptureView.FRONT).surfaces).not.toContain(Surface.REAR_GLASS);
    expect(viewSpec(CaptureView.BACK).surfaces).not.toContain(Surface.DISPLAY_ACTIVE_AREA);
    expect(viewSpec(CaptureView.CAMERA_MODULE).surfaces).toEqual([Surface.REAR_CAMERA]);
  });

  it('requires a display-on capture, without which panel defects are invisible', () => {
    expect(REQUIRED_VIEWS).toContain(CaptureView.DISPLAY_ON);
    expect(viewSpec(CaptureView.DISPLAY_ON).displayState).not.toBe('OFF');
  });
});
