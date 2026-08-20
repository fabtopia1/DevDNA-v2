import { createHash } from 'node:crypto';
import { Surface } from '../taxonomy.js';
import { viewSpec } from '../capture/views.js';
import type { CaptureInput } from '../validation/types.js';
import type { DefectDetector, Detection, DetectionResult, DetectorInfo } from './types.js';

/**
 * A deterministic stand-in for the trained detector.
 *
 * It exists so the entire pipeline downstream of the model — evidence,
 * inference, verdicts, scoring, explainability, reporting — can be built,
 * tested and reviewed before a single weight has been trained. When the real
 * detector arrives it implements the same interface and nothing else changes.
 *
 * It is NOT a simulator of defect detection, and must never be presented as
 * one. It emits whatever the caller scripts it to emit, derived from the image
 * id so that runs are reproducible. Its purpose is to exercise plumbing.
 */

export interface ScriptedDefect {
  /** Which image to attach the detection to. */
  imageId: string;
  classId: string;
  surface: Surface;
  box: { x: number; y: number; width: number; height: number };
  modelScore: number;
  extent?: number;
}

export class MockDetector implements DefectDetector {
  constructor(
    private readonly script: ScriptedDefect[] = [],
    private readonly failures: Array<{ imageId: string; reason: string }> = [],
  ) {}

  info(): DetectorInfo {
    return {
      name: 'mock-detector',
      version: '0.0.0',
      taxonomyVersion: '1.0.0',
      calibrationId: 'unmeasured-0',
    };
  }

  async detect(captures: readonly CaptureInput[]): Promise<DetectionResult> {
    const byId = new Map(captures.map((capture) => [capture.imageId, capture]));
    const detections: Detection[] = [];

    for (const entry of this.script) {
      const capture = byId.get(entry.imageId);
      if (!capture) continue;
      const spec = viewSpec(capture.view);
      detections.push({
        detectionId: `det_${createHash('sha256')
          .update([entry.imageId, entry.classId, JSON.stringify(entry.box)].join('|'))
          .digest('hex')
          .slice(0, 16)}`,
        imageId: entry.imageId,
        view: capture.view,
        classId: entry.classId,
        surface: entry.surface,
        box: entry.box,
        modelScore: entry.modelScore,
        ...(entry.extent !== undefined ? { extent: entry.extent } : {}),
      });
      void spec;
    }

    return { detector: this.info(), detections, failures: [...this.failures] };
  }
}
