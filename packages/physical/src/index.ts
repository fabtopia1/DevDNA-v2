/**
 * DevDNA PhysicalDNA.
 *
 * The layering mirrors SoftwareDNA exactly, and for the same reason:
 *
 *   capture -> validation -> detection -> evidence -> inference -> score
 *
 * The detector sits behind an interface at the third step and produces nothing
 * but evidence. Everything after it is deterministic, auditable, and a pure
 * function of the ledger — which is how a score computed from a neural network
 * stays explainable and reproducible.
 */

export * from './taxonomy.js';
export * from './capture/views.js';
export * from './validation/types.js';
export * from './validation/metrics.js';
export * from './validation/validate.js';
export * from './detection/types.js';
export * from './detection/calibration.js';
export * from './detection/mock.js';
export * from './evidence.js';
export * from './scoring.js';
export * from './module.js';
export * from './explain.js';
export * from './inspection.js';
export * from './report.js';
