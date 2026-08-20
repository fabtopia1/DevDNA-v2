import { viewSpec, type CaptureView } from '../capture/views.js';
import { measure } from './metrics.js';
import { RejectionReason, type CaptureInput, type ValidationResult } from './types.js';

/**
 * The image quality gate.
 *
 * Its purpose is not to be strict for its own sake. It is to make sure that
 * when the detector reports nothing, "nothing" means "no damage" and not "no
 * usable pixels". Everything downstream — coverage, confidence, the score —
 * rests on that distinction, and there is no way to recover it later: an
 * unusable image and a clean surface look identical in a list of zero
 * detections.
 *
 * A rejected image is still recorded. The evidence that a technician tried to
 * photograph the rear glass three times and the glare defeated every attempt is
 * exactly what justifies abstaining on that surface.
 */

export const THRESHOLDS = {
  /** Below this, focus has failed regardless of view. */
  absoluteMinSharpness: 40,
  /** Directional sharpness below this reads as motion rather than defocus. */
  motionIsotropy: 0.45,
  minBrightness: 45,
  maxBrightness: 225,
  minContrast: 18,
  /** Specular clipping above this hides an unknown share of the surface. */
  maxClippedHighlights: 0.06,
  maxClippedShadows: 0.2,
  /** The device must fill at least this share of the frame. */
  minSubjectFill: 0.12,
} as const;

export function validateCapture(input: CaptureInput): ValidationResult {
  const spec = viewSpec(input.view);
  const metrics = measure(input.image);
  const rejections: ValidationResult['rejections'] = [];

  const reject = (reason: RejectionReason, detail: string): void => {
    rejections.push({ reason, detail });
  };

  if (metrics.longEdgePx < spec.minLongEdgePx) {
    reject(
      RejectionReason.TOO_SMALL,
      `Long edge is ${metrics.longEdgePx}px; ${spec.label} requires at least ${spec.minLongEdgePx}px.`,
    );
  }

  // Motion is tested before focus, and independently of the sharpness floor.
  //
  // Both failures present as lost detail, but they lose it differently and need
  // different retake instructions. The independence matters: a strongly smeared
  // image can still carry high *total* Laplacian variance from the axis the
  // movement left intact, sailing past a sharpness threshold while every defect
  // running along the direction of travel has been erased. Only the isotropy
  // ratio catches that, so it gets its own gate rather than being a tie-breaker
  // on a soft image.
  const soft = metrics.sharpness < spec.minSharpness;
  if (metrics.sharpnessIsotropy < THRESHOLDS.motionIsotropy) {
    reject(
      RejectionReason.MOTION_BLUR,
      `Detail is directional (isotropy ${metrics.sharpnessIsotropy.toFixed(2)}, floor ${THRESHOLDS.motionIsotropy}), consistent with camera movement during exposure.`,
    );
  } else if (soft || metrics.sharpness < THRESHOLDS.absoluteMinSharpness) {
    reject(
      RejectionReason.OUT_OF_FOCUS,
      `Sharpness ${metrics.sharpness.toFixed(0)} is below the ${spec.minSharpness} required for ${spec.label}.`,
    );
  }

  if (metrics.brightness < THRESHOLDS.minBrightness) {
    reject(
      RejectionReason.UNDEREXPOSED,
      `Mean luminance ${metrics.brightness.toFixed(0)} is too dark to resolve surface detail.`,
    );
  } else if (metrics.brightness > THRESHOLDS.maxBrightness) {
    reject(
      RejectionReason.OVEREXPOSED,
      `Mean luminance ${metrics.brightness.toFixed(0)} is washing out surface detail.`,
    );
  }

  if (metrics.contrast < THRESHOLDS.minContrast) {
    reject(
      RejectionReason.LOW_CONTRAST,
      `Contrast ${metrics.contrast.toFixed(0)} is too flat to separate a defect from the surface.`,
    );
  }

  if (metrics.clippedHighlightRatio > THRESHOLDS.maxClippedHighlights) {
    reject(
      RejectionReason.EXCESSIVE_GLARE,
      `${(metrics.clippedHighlightRatio * 100).toFixed(1)}% of the frame is blown out; anything beneath it cannot be assessed.`,
    );
  }

  if (metrics.clippedShadowRatio > THRESHOLDS.maxClippedShadows) {
    reject(
      RejectionReason.UNDEREXPOSED,
      `${(metrics.clippedShadowRatio * 100).toFixed(1)}% of the frame is crushed to black.`,
    );
  }

  if (metrics.subjectFillRatio < THRESHOLDS.minSubjectFill) {
    reject(
      RejectionReason.SUBJECT_TOO_SMALL,
      `The device fills roughly ${(metrics.subjectFillRatio * 100).toFixed(0)}% of the frame; move closer.`,
    );
  }

  // Clipping at the border is only a fault where the view is meant to contain
  // the whole device. A close-up is *supposed* to run off the edge.
  if (metrics.subjectTouchesBorder && input.view !== 'CLOSE_UP' && metrics.subjectFillRatio > 0.8) {
    reject(
      RejectionReason.SUBJECT_CLIPPED,
      'The device runs past the frame edge; part of the surface is outside the photograph.',
    );
  }

  const accepted = rejections.length === 0;
  return {
    imageId: input.imageId,
    view: input.view,
    accepted,
    metrics,
    rejections,
    ...(accepted ? {} : { retakeInstruction: retakeInstruction(rejections, input.view) }),
  };
}

/** One instruction, addressing the most actionable failure first. */
function retakeInstruction(
  rejections: ValidationResult['rejections'],
  view: CaptureView,
): string {
  const spec = viewSpec(view);
  const reasons = new Set(rejections.map((r) => r.reason));

  if (reasons.has(RejectionReason.EXCESSIVE_GLARE)) {
    return 'Move the device out of direct light, or tilt it so the reflection falls outside the frame, and retake.';
  }
  if (reasons.has(RejectionReason.MOTION_BLUR)) {
    return 'Rest your elbows on the bench or set the device down, then retake.';
  }
  if (reasons.has(RejectionReason.OUT_OF_FOCUS)) {
    return 'Tap the device on screen to focus, hold about 20cm away, and retake.';
  }
  if (reasons.has(RejectionReason.SUBJECT_TOO_SMALL)) {
    return `Move closer so the device fills the frame. ${spec.instruction}`;
  }
  if (reasons.has(RejectionReason.SUBJECT_CLIPPED)) {
    return `Move back slightly so the whole device is inside the frame. ${spec.instruction}`;
  }
  if (reasons.has(RejectionReason.UNDEREXPOSED)) {
    return 'Add light, or move to a brighter part of the bench, and retake.';
  }
  if (reasons.has(RejectionReason.OVEREXPOSED)) {
    return 'Reduce the light or move out of direct sun, and retake.';
  }
  if (reasons.has(RejectionReason.LOW_CONTRAST)) {
    return 'Use a plain, contrasting background and diffuse light, then retake.';
  }
  if (reasons.has(RejectionReason.TOO_SMALL)) {
    return 'Capture at full camera resolution rather than a cropped or downscaled image.';
  }
  return `Retake this view. ${spec.instruction}`;
}
