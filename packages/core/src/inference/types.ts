import type { EvidenceSubject } from '../evidence/types.js';

/**
 * The inference layer.
 *
 * An `Inference` is a derived claim. It is not an observation, and it is not a
 * verdict. It says: "given these specific evidence records, this rule fired,
 * and it pushes the conclusion this far in this direction."
 *
 * Every inference must cite at least one evidence record. That is enforced at
 * construction time by the Provenance Engine, not left to discipline.
 */

export enum ModuleId {
  IDENTITY = 'IDENTITY',
  HARDWARE_CONSISTENCY = 'HARDWARE_CONSISTENCY',
  SERVICE_EVIDENCE = 'SERVICE_EVIDENCE',
  BATTERY_INTELLIGENCE = 'BATTERY_INTELLIGENCE',
  SECURITY_DNA = 'SECURITY_DNA',
  PHYSICAL_CONDITION = 'PHYSICAL_CONDITION',
  TRUST = 'TRUST',
}

/**
 * Which way an inference pushes. Deliberately generic: each module maps these
 * onto its own verdict vocabulary, so the rule engine stays shared.
 */
export enum InferenceDirection {
  /** Supports the benign / expected / original conclusion. */
  SUPPORTS_POSITIVE = 'SUPPORTS_POSITIVE',
  /** Supports the adverse / anomalous / replaced conclusion. */
  SUPPORTS_NEGATIVE = 'SUPPORTS_NEGATIVE',
  /**
   * Reduces what can be concluded without favouring either side. Used for
   * collection failures and coverage gaps.
   */
  REDUCES_DETERMINACY = 'REDUCES_DETERMINACY',
}

export interface Inference {
  id: string;
  module: ModuleId;
  /** Stable rule identifier, e.g. `identity.imei-checksum-invalid`. */
  rule: string;
  subject: EvidenceSubject;
  direction: InferenceDirection;
  /** Plain-language claim, shown to technicians and printed on reports. */
  statement: string;
  /** 0..1 how strongly this rule moves a verdict when it fires. */
  weight: number;
  /** 0..1 belief in this inference, after evidence reliability is applied. */
  confidence: number;
  /** Non-empty. Enforced by the Provenance Engine. */
  evidenceIds: string[];
  derivedAt: string;
}

/** Whether a conclusion could be reached at all. */
export enum Determinacy {
  DETERMINED = 'DETERMINED',
  INDETERMINATE = 'INDETERMINATE',
}

/**
 * A conclusion about one subject.
 *
 * `value` is drawn from the owning module's vocabulary. An INDETERMINATE
 * verdict is a real, reportable outcome, never a fallback that gets rounded
 * into a pass.
 */
export interface Verdict<V extends string = string> {
  id: string;
  module: ModuleId;
  subject: EvidenceSubject;
  value: V;
  determinacy: Determinacy;
  /** 0..1. Meaningless for INDETERMINATE verdicts, which report 0. */
  confidence: number;
  /** Why this verdict, in one sentence a technician can repeat to a customer. */
  rationale: string;
  inferenceIds: string[];
  /** Union of evidence cited by the supporting inferences. */
  evidenceIds: string[];
}

/** A module's complete output: its verdicts plus the inferences behind them. */
export interface ModuleResult<V extends string = string> {
  module: ModuleId;
  verdicts: Verdict<V>[];
  inferences: Inference[];
  /**
   * 0..1 share of what this module set out to assess that it actually could.
   * Coverage is reported separately from confidence: a confident verdict about
   * 10% of a device is not the same as a confident verdict about all of it.
   */
  coverage: number;
  /** 0..1 aggregate confidence across this module's determined verdicts. */
  confidence: number;
  /** Module-specific structured output, e.g. battery wear grade. */
  detail?: Record<string, unknown>;
}

/** Severity for surfaced findings. Independent of verdict vocabulary. */
export enum Severity {
  INFO = 'INFO',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * What a finding rests on.
 *
 * Most findings are grounded in specific records. But some of the most
 * important ones - "no attestation was captured", "coverage is too low",
 * "Activation Lock could not be determined" - are assertions about what the
 * evidence set does *not* contain, and by construction can cite nothing.
 *
 * Rather than let those slip through as unsupported conclusions, absence is
 * modelled explicitly. The claim stays verifiable: re-examining the ledger
 * either finds the missing records or does not, and the ledger digest pins
 * exactly which ledger the claim was made about.
 */
export enum FindingBasis {
  /** Grounded in named evidence records or inferences. */
  EVIDENCE = 'EVIDENCE',
  /** Grounded in the verifiable absence of evidence from the ledger. */
  ABSENCE = 'ABSENCE',
}

export interface Finding {
  code: string;
  severity: Severity;
  module: ModuleId;
  title: string;
  detail: string;
  basis: FindingBasis;
  /** Findings are conclusions too, so they cite their support. */
  evidenceIds: string[];
  inferenceIds: string[];
}
