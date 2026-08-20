import type { ImageMetrics, LumaImage } from './types.js';

/**
 * Image quality measurement.
 *
 * Every function here is deterministic arithmetic over a luminance plane: the
 * same pixels always produce the same numbers, which is what allows the metrics
 * to be stored as evidence and a rejection to be re-derived months later.
 *
 * None of it is machine learning, and that is deliberate. Whether an image is
 * in focus is a measurable property, not a judgement, and answering it with a
 * model would make the *gate* on the evidence pipeline itself unexplainable.
 */

const at = (image: LumaImage, x: number, y: number): number =>
  image.luma[y * image.width + x] ?? 0;

/**
 * Variance of the Laplacian.
 *
 * The 4-neighbour discrete Laplacian responds to second-order intensity change.
 * A focused image has abundant fine structure and therefore high variance; blur
 * is a low-pass filter, and low-pass filtering collapses it.
 *
 * Absolute values are resolution- and content-dependent, which is why the
 * thresholds live per view in `views.ts` rather than as one global constant:
 * an edge shot of a plain aluminium band legitimately carries less structure
 * than a shot of a cracked screen.
 */
export function laplacianVariance(image: LumaImage): number {
  const { width, height } = image;
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const value =
        4 * at(image, x, y) -
        at(image, x - 1, y) -
        at(image, x + 1, y) -
        at(image, x, y - 1) -
        at(image, x, y + 1);
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/**
 * How evenly sharpness is distributed between axes, 0..1.
 *
 * Computed as min(h, v) / max(h, v) over mean absolute first differences.
 * Motion blur is directional: a hand moving during exposure smears detail along
 * the direction of travel and leaves the perpendicular direction largely
 * intact. Focus error is isotropic — it loses both equally.
 *
 * Separating them matters because the retake instruction differs. "Hold the
 * camera still" and "move back and tap to focus" are not interchangeable, and a
 * technician given the wrong one will retake the same bad photograph.
 */
export function sharpnessIsotropy(image: LumaImage): number {
  const { width, height } = image;
  if (width < 2 || height < 2) return 1;

  let horizontal = 0;
  let vertical = 0;
  let count = 0;

  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      horizontal += Math.abs(at(image, x, y) - at(image, x - 1, y));
      vertical += Math.abs(at(image, x, y) - at(image, x, y - 1));
      count += 1;
    }
  }

  if (count === 0) return 1;
  const h = horizontal / count;
  const v = vertical / count;
  const max = Math.max(h, v);
  // A uniform field has no directionality to measure; report isotropic rather
  // than dividing by zero and calling a blank wall "motion blurred".
  if (max < 1e-6) return 1;
  return Math.min(h, v) / max;
}

export interface Exposure {
  brightness: number;
  contrast: number;
  clippedHighlightRatio: number;
  clippedShadowRatio: number;
}

/**
 * Exposure and clipping.
 *
 * Clipped highlights are the metric that earns its place on a phone: glass is
 * specular, and a technician working under a shop's ceiling LED will reliably
 * produce a photograph with a blown-out band across the middle of the panel.
 * Every defect under that band is invisible, and a detector that sees nothing
 * there will report nothing there — silently converting a lighting failure into
 * a clean bill of health.
 */
export function exposure(image: LumaImage): Exposure {
  const total = image.luma.length;
  if (total === 0) {
    return { brightness: 0, contrast: 0, clippedHighlightRatio: 0, clippedShadowRatio: 0 };
  }

  let sum = 0;
  let sumSquares = 0;
  let high = 0;
  let low = 0;

  for (let i = 0; i < total; i += 1) {
    const value = image.luma[i] ?? 0;
    sum += value;
    sumSquares += value * value;
    if (value >= 250) high += 1;
    if (value <= 5) low += 1;
  }

  const mean = sum / total;
  const variance = Math.max(0, sumSquares / total - mean * mean);
  return {
    brightness: mean,
    contrast: Math.sqrt(variance),
    clippedHighlightRatio: high / total,
    clippedShadowRatio: low / total,
  };
}

/**
 * Subject framing, estimated from edge density.
 *
 * A phone against a bench is a rectangle of structure surrounded by relatively
 * flat background. Rather than run a detector, the frame is divided into a
 * coarse grid, each cell scored by mean gradient magnitude, and cells above a
 * fraction of the peak are treated as subject.
 *
 * This is a heuristic and is treated as one: it gates only the two failures it
 * can actually establish — the device is far too small in frame, or it runs off
 * the edge — and never claims the framing is *correct*.
 */
export function framing(
  image: LumaImage,
  grid = 12,
): { subjectFillRatio: number; subjectTouchesBorder: boolean } {
  const { width, height } = image;
  if (width < grid * 2 || height < grid * 2) {
    return { subjectFillRatio: 1, subjectTouchesBorder: true };
  }

  const cellW = Math.floor(width / grid);
  const cellH = Math.floor(height / grid);
  const density: number[] = new Array(grid * grid).fill(0);

  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      let sum = 0;
      let count = 0;
      const x0 = gx * cellW;
      const y0 = gy * cellH;
      for (let y = y0 + 1; y < y0 + cellH; y += 2) {
        for (let x = x0 + 1; x < x0 + cellW; x += 2) {
          sum +=
            Math.abs(at(image, x, y) - at(image, x - 1, y)) +
            Math.abs(at(image, x, y) - at(image, x, y - 1));
          count += 1;
        }
      }
      density[gy * grid + gx] = count > 0 ? sum / count : 0;
    }
  }

  const peak = Math.max(...density);
  if (peak <= 0) return { subjectFillRatio: 0, subjectTouchesBorder: false };

  const threshold = peak * 0.25;
  let occupied = 0;
  let touchesBorder = false;

  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      if ((density[gy * grid + gx] ?? 0) < threshold) continue;
      occupied += 1;
      if (gx === 0 || gy === 0 || gx === grid - 1 || gy === grid - 1) touchesBorder = true;
    }
  }

  return { subjectFillRatio: occupied / (grid * grid), subjectTouchesBorder: touchesBorder };
}

/** Every metric for one image, in one pass-set. */
export function measure(image: LumaImage): ImageMetrics {
  const exp = exposure(image);
  const frame = framing(image);
  return {
    width: image.width,
    height: image.height,
    longEdgePx: Math.max(image.width, image.height),
    sharpness: laplacianVariance(image),
    sharpnessIsotropy: sharpnessIsotropy(image),
    brightness: exp.brightness,
    contrast: exp.contrast,
    clippedHighlightRatio: exp.clippedHighlightRatio,
    clippedShadowRatio: exp.clippedShadowRatio,
    subjectFillRatio: frame.subjectFillRatio,
    subjectTouchesBorder: frame.subjectTouchesBorder,
  };
}
