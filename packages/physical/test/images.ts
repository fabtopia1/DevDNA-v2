import type { LumaImage } from '../src/validation/types.js';

/**
 * Synthetic test images.
 *
 * Constructed rather than fixtured because the validator's job is to respond to
 * measurable properties — sharpness, exposure, clipping, framing — and a
 * generator lets each test isolate exactly one of them. A folder of real
 * photographs would test all of them at once and pin none.
 */

/** Deterministic PRNG, so a failing test fails identically on every machine. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export interface SceneOptions {
  width?: number;
  height?: number;
  /** Share of the frame the "device" occupies, centred. */
  fill?: number;
  /** Background luminance. */
  background?: number;
  /** Texture amplitude inside the subject. Low amplitude reads as blur. */
  texture?: number;
  /** Subject mean luminance. */
  subjectLevel?: number;
  /** Blow out this share of the subject to 255, simulating specular glare. */
  glare?: number;
  /** Smear texture horizontally, simulating motion blur. */
  motion?: boolean;
  seed?: number;
}

/**
 * A textured rectangle on a flat background — the coarse shape of a phone
 * photographed on a bench.
 */
export function scene(options: SceneOptions = {}): LumaImage {
  const width = options.width ?? 1600;
  const height = options.height ?? 900;
  const fill = options.fill ?? 0.45;
  const background = options.background ?? 70;
  const texture = options.texture ?? 60;
  const subjectLevel = options.subjectLevel ?? 130;
  const glare = options.glare ?? 0;
  const random = rng(options.seed ?? 42);

  const luma = new Uint8Array(width * height);
  luma.fill(background);

  // Centred subject rectangle sized to hit the requested fill fraction.
  const side = Math.sqrt(fill);
  const sw = Math.floor(width * side);
  const sh = Math.floor(height * side);
  const x0 = Math.floor((width - sw) / 2);
  const y0 = Math.floor((height - sh) / 2);

  const glareRows = Math.floor(sh * glare);

  for (let y = y0; y < y0 + sh; y += 1) {
    const inGlare = y - y0 < glareRows;
    for (let x = x0; x < x0 + sw; x += 1) {
      if (inGlare) {
        luma[y * width + x] = 255;
        continue;
      }
      luma[y * width + x] = clampByte(subjectLevel + (random() - 0.5) * 2 * texture);
    }
  }

  // Motion blur: a horizontal box average over the subject. Detail along the
  // direction of travel is destroyed; the perpendicular axis survives, which is
  // exactly the asymmetry the isotropy metric exists to catch.
  if (options.motion) {
    const span = 9;
    for (let y = y0; y < y0 + sh; y += 1) {
      const row = new Uint8Array(sw);
      for (let x = 0; x < sw; x += 1) {
        let sum = 0;
        let count = 0;
        for (let k = -span; k <= span; k += 1) {
          const sx = x + k;
          if (sx < 0 || sx >= sw) continue;
          sum += luma[y * width + x0 + sx] ?? 0;
          count += 1;
        }
        row[x] = clampByte(sum / Math.max(1, count));
      }
      for (let x = 0; x < sw; x += 1) luma[y * width + x0 + x] = row[x] ?? 0;
    }
  }

  // A little background noise so the flat area is not perfectly zero-gradient.
  for (let i = 0; i < luma.length; i += 97) {
    luma[i] = clampByte((luma[i] ?? background) + (random() - 0.5) * 4);
  }

  return { width, height, luma };
}

/** A sharp, well-exposed, well-framed capture. The baseline "good" image. */
export const goodImage = (seed = 1): LumaImage => scene({ seed });

/** Focus failure: texture amplitude collapses isotropically. */
export const blurredImage = (seed = 2): LumaImage => scene({ seed, texture: 1.2 });

/** Camera movement: detail survives vertically, collapses horizontally. */
export const motionBlurredImage = (seed = 3): LumaImage => scene({ seed, motion: true });

/** Specular reflection across the top third of the device. */
export const glaredImage = (seed = 4): LumaImage => scene({ seed, glare: 0.5 });

export const darkImage = (seed = 5): LumaImage =>
  scene({ seed, background: 6, subjectLevel: 14, texture: 6 });

export const distantImage = (seed = 6): LumaImage => scene({ seed, fill: 0.02 });

export const smallImage = (seed = 7): LumaImage => scene({ seed, width: 640, height: 360 });

const clampByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
