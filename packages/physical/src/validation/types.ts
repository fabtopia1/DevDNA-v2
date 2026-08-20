import type { CaptureView } from '../capture/views.js';

/**
 * A decoded image, as this package sees it.
 *
 * Deliberately not a file, a Buffer of JPEG bytes, or a sharp instance. The
 * validation maths is pure arithmetic over a luminance plane, and keeping it
 * that way means the identical code runs in three places that could otherwise
 * drift: the browser at capture time (canvas), the bridge, and the API
 * (sharp). Decoding is an adapter's job; judging is this package's.
 */
export interface LumaImage {
  width: number;
  height: number;
  /** Row-major 8-bit luminance, length === width * height. */
  luma: Uint8Array;
}

export interface CaptureInput {
  /** Stable id for this image; used in evidence and to locate the file. */
  imageId: string;
  view: CaptureView;
  image: LumaImage;
  /** ISO-8601 capture time from the device that took the photograph. */
  capturedAt: string;
  /** Content hash of the original encoded file. Pins the exact bytes judged. */
  sha256: string;
  /** Optional capture-device context, recorded but never trusted for geometry. */
  deviceModel?: string;
}

/** Why an image was rejected. Each maps to one retake instruction. */
export enum RejectionReason {
  TOO_SMALL = 'TOO_SMALL',
  OUT_OF_FOCUS = 'OUT_OF_FOCUS',
  MOTION_BLUR = 'MOTION_BLUR',
  UNDEREXPOSED = 'UNDEREXPOSED',
  OVEREXPOSED = 'OVEREXPOSED',
  LOW_CONTRAST = 'LOW_CONTRAST',
  EXCESSIVE_GLARE = 'EXCESSIVE_GLARE',
  SUBJECT_TOO_SMALL = 'SUBJECT_TOO_SMALL',
  SUBJECT_CLIPPED = 'SUBJECT_CLIPPED',
}

export interface ImageMetrics {
  width: number;
  height: number;
  longEdgePx: number;
  /**
   * Variance of the Laplacian. The standard focus proxy: a sharp image has
   * strong second derivatives, a blurred one does not.
   */
  sharpness: number;
  /**
   * Directional sharpness ratio, 0..1, where 1 is isotropic.
   *
   * Motion blur destroys detail along one axis and leaves the perpendicular
   * axis intact, so a low ratio separates "camera moved" from "focus missed" —
   * two failures with completely different retake instructions.
   */
  sharpnessIsotropy: number;
  /** Mean luminance, 0..255. */
  brightness: number;
  /** Standard deviation of luminance. Global contrast. */
  contrast: number;
  /** Share of pixels at or near 255. Specular reflection hides surface damage. */
  clippedHighlightRatio: number;
  /** Share of pixels at or near 0. */
  clippedShadowRatio: number;
  /**
   * Share of the frame occupied by the largest coherent bright/edge-dense
   * region — a crude subject-fill estimate. A device photographed from too far
   * away is not usable evidence about a hairline crack.
   */
  subjectFillRatio: number;
  /** True when subject edge density touches the frame border. */
  subjectTouchesBorder: boolean;
}

export interface ValidationResult {
  imageId: string;
  view: CaptureView;
  accepted: boolean;
  metrics: ImageMetrics;
  rejections: Array<{ reason: RejectionReason; detail: string }>;
  /** Retake instruction, when rejected. Written for a technician, not a developer. */
  retakeInstruction?: string;
}
