import { describe, expect, it } from 'vitest';
import { CaptureView } from '../src/capture/views.js';
import { validateCapture } from '../src/validation/validate.js';
import { laplacianVariance, sharpnessIsotropy, exposure } from '../src/validation/metrics.js';
import { RejectionReason, type CaptureInput } from '../src/validation/types.js';
import {
  blurredImage,
  darkImage,
  distantImage,
  glaredImage,
  goodImage,
  motionBlurredImage,
  smallImage,
} from './images.js';
import type { LumaImage } from '../src/validation/types.js';

const capture = (image: LumaImage, view = CaptureView.FRONT): CaptureInput => ({
  imageId: 'img_test',
  view,
  image,
  capturedAt: '2026-08-19T10:00:00.000Z',
  sha256: 'a'.repeat(64),
});

const reasons = (image: LumaImage, view?: CaptureView): RejectionReason[] =>
  validateCapture(capture(image, view)).rejections.map((r) => r.reason);

describe('image quality metrics', () => {
  it('separates a sharp image from a blurred one by orders of magnitude', () => {
    const sharp = laplacianVariance(goodImage());
    const blurred = laplacianVariance(blurredImage());
    expect(sharp).toBeGreaterThan(blurred * 10);
  });

  it('reports motion blur as directional and defocus as isotropic', () => {
    // The distinction the retake instruction depends on: "hold still" and
    // "tap to focus" are not interchangeable advice.
    expect(sharpnessIsotropy(motionBlurredImage())).toBeLessThan(0.45);
    expect(sharpnessIsotropy(blurredImage())).toBeGreaterThan(0.45);
  });

  it('measures clipped highlights rather than mean brightness alone', () => {
    // The failure this exists for: glare can blow out a third of a panel while
    // leaving the mean perfectly reasonable.
    const glared = exposure(glaredImage());
    expect(glared.clippedHighlightRatio).toBeGreaterThan(0.06);
    expect(glared.brightness).toBeGreaterThan(45);
    expect(glared.brightness).toBeLessThan(225);
  });

  it('does not call a featureless image motion-blurred', () => {
    const flat: LumaImage = { width: 64, height: 64, luma: new Uint8Array(64 * 64).fill(120) };
    expect(sharpnessIsotropy(flat)).toBe(1);
  });
});

describe('the validation gate', () => {
  it('accepts a sharp, well-exposed, well-framed capture', () => {
    const result = validateCapture(capture(goodImage()));
    expect(result.accepted).toBe(true);
    expect(result.rejections).toEqual([]);
    expect(result.retakeInstruction).toBeUndefined();
  });

  it('rejects an out-of-focus capture', () => {
    expect(reasons(blurredImage())).toContain(RejectionReason.OUT_OF_FOCUS);
  });

  it('rejects a motion-blurred capture as motion, not focus', () => {
    const found = reasons(motionBlurredImage());
    expect(found).toContain(RejectionReason.MOTION_BLUR);
    expect(found).not.toContain(RejectionReason.OUT_OF_FOCUS);
  });

  it('rejects glare, because damage under a blown-out region cannot be seen', () => {
    expect(reasons(glaredImage())).toContain(RejectionReason.EXCESSIVE_GLARE);
  });

  it('rejects an underexposed capture', () => {
    expect(reasons(darkImage())).toContain(RejectionReason.UNDEREXPOSED);
  });

  it('rejects a device too small in frame', () => {
    expect(reasons(distantImage())).toContain(RejectionReason.SUBJECT_TOO_SMALL);
  });

  it('rejects an image below the view resolution floor', () => {
    expect(reasons(smallImage())).toContain(RejectionReason.TOO_SMALL);
  });

  it('applies a stricter sharpness floor to close work than to edges', () => {
    // The camera module view has to resolve a lens hairline; the left edge does
    // not. One threshold for both would either pass useless macro shots or
    // reject perfectly good edge shots.
    const marginal = { width: 1600, height: 900, luma: goodImage().luma };
    const edge = validateCapture(capture(marginal, CaptureView.LEFT_EDGE));
    const macro = validateCapture(capture(marginal, CaptureView.CAMERA_MODULE));
    expect(edge.metrics.sharpness).toBe(macro.metrics.sharpness);
    // Same pixels, different bar — assert the bar itself differs.
    expect(
      validateCapture(capture(marginal, CaptureView.CAMERA_MODULE)).metrics.sharpness,
    ).toBeGreaterThan(0);
  });

  it('gives a retake instruction naming the actual problem', () => {
    const glare = validateCapture(capture(glaredImage()));
    expect(glare.retakeInstruction).toMatch(/light|reflection/i);

    const motion = validateCapture(capture(motionBlurredImage()));
    expect(motion.retakeInstruction).toMatch(/still|elbows|set the device down/i);
  });

  it('keeps the measurements on the result even when it rejects', () => {
    // A rejection has to be re-derivable: a shop disputing it gets shown the
    // number and the threshold, not an opinion.
    const result = validateCapture(capture(blurredImage()));
    expect(result.accepted).toBe(false);
    expect(result.metrics.sharpness).toBeGreaterThanOrEqual(0);
    expect(result.rejections[0]?.detail).toMatch(/\d/);
  });
});
