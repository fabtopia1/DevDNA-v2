import type { EvidenceLedger } from '../evidence/ledger.js';
import type { Inference } from '../inference/types.js';

/**
 * The confidence model.
 *
 * Confidence propagates through four levels, and each level answers a different
 * question:
 *
 *   1. Channel reliability  - can this collection channel be believed?
 *   2. Inference confidence - is this specific reasoning step sound?
 *   3. Verdict confidence   - is this conclusion about one subject sound?
 *   4. Module / trust       - how much of the picture did we actually see?
 *
 * Two rules run through all of it:
 *
 *   - **Weakest link.** A conclusion is never more reliable than the shakiest
 *     observation it rests on. Confidence only ever decreases as it propagates
 *     upward through a single chain.
 *   - **Corroboration must be independent.** Two readings of the same analytics
 *     file are one observation, not two. Only genuinely separate channels raise
 *     confidence above the best single signal.
 */

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const round = (value: number, dp = 3): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

/** Level 2. A chain is as strong as its weakest cited channel. */
export const weakestLink = (reliabilities: readonly number[]): number =>
  reliabilities.length === 0 ? 0 : Math.min(...reliabilities);

/**
 * Level 3, part one: corroboration.
 *
 * Independent evidence compounds; repeated evidence does not. Inferences are
 * grouped by the set of evidence *sources* they rest on. Within a group only
 * the strongest counts. Across groups we apply noisy-OR:
 *
 *     combined = 1 - Π (1 - confidence_i)
 *
 * So two independent 0.6 signals give 0.84, while two 0.6 signals from the same
 * analytics file give 0.6. Without this grouping, a single chatty source could
 * manufacture near-certainty by repeating itself.
 */
export function corroborate(
  inferences: readonly Inference[],
  ledger: EvidenceLedger,
): { confidence: number; independentSources: number } {
  if (inferences.length === 0) return { confidence: 0, independentSources: 0 };

  const strongestPerSource = new Map<string, number>();
  for (const inference of inferences) {
    const sources = inference.evidenceIds
      .map((id) => ledger.get(id)?.provenance.source)
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    // Inferences resting on the same source-set are treated as one channel.
    const key = [...new Set(sources)].sort().join('+') || 'unknown';
    strongestPerSource.set(key, Math.max(strongestPerSource.get(key) ?? 0, inference.confidence));
  }

  let complement = 1;
  for (const confidence of strongestPerSource.values()) complement *= 1 - clamp01(confidence);

  return {
    confidence: clamp01(1 - complement),
    independentSources: strongestPerSource.size,
  };
}

/**
 * Level 3, part two: agreement.
 *
 * How one-sided the evidence is. Conflicting evidence must lower confidence
 * even when the winning side has more mass, because a contested conclusion is
 * genuinely less certain than an uncontested one.
 *
 * Returns 0 when there is no directional mass at all.
 */
export function agreement(winningMass: number, opposingMass: number): number {
  const total = winningMass + opposingMass;
  if (total <= 0) return 0;
  return clamp01(winningMass / total);
}

/**
 * Level 3, combined. Corroboration scaled by how uncontested the conclusion is.
 */
export function verdictConfidence(input: {
  supporting: readonly Inference[];
  opposingMass: number;
  ledger: EvidenceLedger;
}): { confidence: number; independentSources: number; agreement: number } {
  const { confidence: corroborated, independentSources } = corroborate(
    input.supporting,
    input.ledger,
  );
  const winningMass = input.supporting.reduce((sum, i) => sum + i.weight * i.confidence, 0);
  const agreementScore = agreement(winningMass, input.opposingMass);

  return {
    confidence: round(clamp01(corroborated * agreementScore)),
    independentSources,
    agreement: round(agreementScore),
  };
}

/**
 * Level 4: coverage damping.
 *
 * Confidence in a conclusion is not the same as confidence in a *picture*. A
 * module certain about one component out of ten has high verdict confidence and
 * low module confidence, and reporting only the former would be misleading.
 *
 * The floor keeps a well-evidenced but narrow assessment from collapsing to
 * zero, which would make it indistinguishable from having looked at nothing.
 */
export function dampByCoverage(confidence: number, coverage: number, floor = 0.35): number {
  return round(clamp01(confidence * (floor + (1 - floor) * clamp01(coverage))));
}

export interface WeightedEntry {
  value: number;
  weight: number;
}

export function weightedMean(entries: readonly WeightedEntry[]): number {
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) return 0;
  return entries.reduce((sum, e) => sum + e.value * e.weight, 0) / totalWeight;
}

/**
 * Confidence damping applied to trust weights.
 *
 * A pillar we are unsure about should influence the result less, but must never
 * drop out entirely, or a device whose parts we could barely assess would
 * quietly become a battery-and-software score wearing a trust badge.
 */
export const CONFIDENCE_WEIGHT_FLOOR = 0.4;

export const dampWeight = (baseWeight: number, confidence: number): number =>
  baseWeight * (CONFIDENCE_WEIGHT_FLOOR + (1 - CONFIDENCE_WEIGHT_FLOOR) * clamp01(confidence));

/** Below this, a trust verdict is reported as INSUFFICIENT_EVIDENCE. */
export const MINIMUM_REPORTABLE_CONFIDENCE = 0.45;

export enum ConfidenceBand {
  HIGH = 'HIGH',
  MODERATE = 'MODERATE',
  LOW = 'LOW',
  INSUFFICIENT = 'INSUFFICIENT',
}

/** Bands exist so reports never print a bare decimal at a non-technical reader. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return ConfidenceBand.HIGH;
  if (confidence >= 0.6) return ConfidenceBand.MODERATE;
  if (confidence >= MINIMUM_REPORTABLE_CONFIDENCE) return ConfidenceBand.LOW;
  return ConfidenceBand.INSUFFICIENT;
}
