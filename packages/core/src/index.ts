/**
 * DevDNA SoftwareDNA core.
 *
 * The layering is deliberate and one-directional:
 *
 *   capture  ->  evidence  ->  inference  ->  modules  ->  trust
 *
 * Each layer may only read the one before it. In particular, no module reads a
 * raw snapshot, which is what makes a stored evidence ledger sufficient to
 * reproduce every conclusion.
 */

// Layer 1: capture. The wire format, and the only reader of it.
export * from './capture/snapshot.js';
export * from './capture/collectors.js';

// Layer 2: evidence. Observed facts with provenance.
export * from './evidence/types.js';
export * from './evidence/ledger.js';

// Layer 3: inference. Derived claims, and the engine that enforces support.
export * from './inference/types.js';
export * from './inference/provenance.js';

// Confidence propagation, shared by every module.
export * from './confidence/model.js';

// Layer 4: the assessment modules.
export * from './modules/identity.js';
export * from './modules/hardware.js';
export * from './modules/service.js';
export * from './modules/battery.js';
export * from './modules/security.js';
export * from './modules/trust.js';
export * from './modules/support.js';

// Extension seam for OEM, AASP, IRP and repair-network authorities.
export * from './adapters/types.js';

// Reference data.
export * from './catalog/index.js';

// Parsing utilities for the capture layer.
export * from './parsers/index.js';

// Orchestration.
export * from './inspection.js';

export * from './util/hash.js';
export * from './fixtures/index.js';
