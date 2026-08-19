import { InferenceDirection, type Inference } from '../inference/types.js';

/**
 * Shared helpers for the assessment modules.
 *
 * Note what is deliberately absent: there is no helper for *writing* evidence.
 * Modules are pure readers of the ledger, which is what makes `evaluate` a
 * function of the evidence alone and therefore reproducible. Catalog
 * expectations are seeded during collection instead - see
 * `capture/collectors.ts`.
 */

export interface DirectionalMass {
  positive: number;
  negative: number;
  total: number;
  supporting: Inference[];
  opposing: Inference[];
}

/**
 * Split inferences by direction and total their mass.
 *
 * Mass is `weight * confidence`: how much a rule moves a verdict, scaled by how
 * much the rule's own reasoning can be believed. Inferences that reduce
 * determinacy carry no directional mass by design.
 */
export function massFor(
  inferences: readonly Inference[],
  winner: InferenceDirection,
): DirectionalMass {
  const loser =
    winner === InferenceDirection.SUPPORTS_POSITIVE
      ? InferenceDirection.SUPPORTS_NEGATIVE
      : InferenceDirection.SUPPORTS_POSITIVE;

  const supporting = inferences.filter((i) => i.direction === winner);
  const opposing = inferences.filter((i) => i.direction === loser);
  const mass = (list: readonly Inference[]): number =>
    list.reduce((sum, i) => sum + i.weight * i.confidence, 0);

  const positive = mass(supporting);
  const negative = mass(opposing);
  return { positive, negative, total: positive + negative, supporting, opposing };
}

/** Coverage: the share of what a module set out to assess that it could. */
export function coverageOf(determined: number, applicable: number): number {
  if (applicable <= 0) return 0;
  return Math.min(1, Math.max(0, determined / applicable));
}
