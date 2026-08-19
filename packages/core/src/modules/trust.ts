import { EvidenceSubject } from '../evidence/types.js';
import type { EvidenceLedger } from '../evidence/ledger.js';
import {
  Determinacy,
  FindingBasis,
  ModuleId,
  Severity,
  type Finding,
  type ModuleResult,
} from '../inference/types.js';
import type { ProvenanceEngine } from '../inference/provenance.js';
import {
  clamp01,
  ConfidenceBand,
  confidenceBand,
  dampWeight,
  MINIMUM_REPORTABLE_CONFIDENCE,
  round,
} from '../confidence/model.js';
import { IdentityVerdict } from './identity.js';
import { HardwareVerdict, type HardwareDetail } from './hardware.js';
import { PartAuthenticity, ServiceVerdict, componentLabel, isCritical, COMPONENT_WEIGHTS, type ServiceDetail } from './service.js';
import { BatteryVerdict, type BatteryDetail } from './battery.js';
import { SecurityVerdict, type SecurityDetail } from './security.js';

/**
 * Module 7 - the Trust Engine.
 *
 * Aggregates every module into one score, one verdict, and an audit trail.
 *
 * Three principles decide its shape:
 *
 *   1. **Pillars a module could not assess are excluded, not zeroed.** A module
 *      that abstained contributes nothing to the score and reduces coverage
 *      instead. Scoring an abstention as zero would punish a device for
 *      DevDNA's blind spots.
 *   2. **Gates cap, they do not subtract.** A healthy battery must not be able
 *      to buy back an activation lock. Every gate that fires is recorded with
 *      its reason.
 *   3. **Low confidence outranks a high score.** An inspection below the
 *      reporting threshold is INSUFFICIENT_EVIDENCE whatever it scored.
 */

export const TRUST_ALGORITHM_VERSION = '2.0.0';

export enum TrustVerdict {
  TRUSTED = 'TRUSTED',
  TRUSTED_WITH_NOTES = 'TRUSTED_WITH_NOTES',
  CAUTION = 'CAUTION',
  UNTRUSTED = 'UNTRUSTED',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
}

/**
 * Base pillar weights. Service evidence leads because it is the question the
 * market cannot answer for itself; battery trails because condition is visible
 * in Settings and is a price adjustment rather than a trust question.
 */
export const PILLAR_WEIGHTS: Record<string, number> = {
  [ModuleId.SERVICE_EVIDENCE]: 0.3,
  [ModuleId.HARDWARE_CONSISTENCY]: 0.2,
  [ModuleId.IDENTITY]: 0.2,
  [ModuleId.SECURITY_DNA]: 0.2,
  [ModuleId.BATTERY_INTELLIGENCE]: 0.1,
};

export const TRUST_BANDS = { trusted: 85, withNotes: 70, caution: 50 } as const;

export interface TrustGate {
  code: string;
  cap: number;
  reason: string;
  module: ModuleId;
}

export interface PillarScore {
  module: ModuleId;
  /** Null when the module abstained; excluded from the weighted mean. */
  score: number | null;
  confidence: number;
  coverage: number;
  baseWeight: number;
  /** Confidence-damped and renormalised. Zero for an abstaining module. */
  effectiveWeight: number;
}

export interface TrustAssessment {
  score: number;
  /** Score before gates, so a technician can see what the caps cost. */
  rawScore: number;
  confidence: number;
  confidenceBand: ConfidenceBand;
  verdict: TrustVerdict;
  /** Share of pillar weight that produced a score at all. */
  coverage: number;
  pillars: PillarScore[];
  gatesApplied: TrustGate[];
  algorithmVersion: string;
}

export interface TrustInput {
  identity: ModuleResult;
  hardware: ModuleResult;
  service: ModuleResult;
  battery: ModuleResult;
  security: ModuleResult;
  details: {
    hardware: HardwareDetail;
    service: ServiceDetail;
    battery: BatteryDetail;
    security: SecurityDetail;
  };
}

export function runTrustEngine(
  ledger: EvidenceLedger,
  provenance: ProvenanceEngine,
  input: TrustInput,
  at: string,
): { assessment: TrustAssessment; findings: Finding[] } {
  const findings: Finding[] = [];

  const pillars: PillarScore[] = [
    pillar(input.identity, identityScore(input.identity)),
    pillar(input.hardware, hardwareScore(input.hardware, input.details.hardware)),
    pillar(input.service, serviceScore(input.details.service)),
    pillar(input.battery, batteryScore(input.battery, input.details.battery)),
    pillar(input.security, securityScore(input.security, input.details.security)),
  ];

  // --- Weighted score over pillars that actually produced one --------------
  const scoring = pillars.filter((p) => p.score !== null);
  const totalDamped = scoring.reduce((sum, p) => sum + dampWeight(p.baseWeight, p.confidence), 0);

  for (const entry of pillars) {
    entry.effectiveWeight =
      entry.score === null || totalDamped <= 0
        ? 0
        : round(dampWeight(entry.baseWeight, entry.confidence) / totalDamped);
  }

  const rawScore =
    scoring.length === 0
      ? 0
      : Math.round(
          clamp01(
            scoring.reduce((sum, p) => sum + (p.score as number) * p.effectiveWeight, 0) / 100,
          ) * 100,
        );

  const assessableWeight = Object.values(PILLAR_WEIGHTS).reduce((sum, w) => sum + w, 0);

  // Confidence is measured over the WHOLE intended picture, not just the part
  // we managed to see: a pillar that abstained contributes zero confidence at
  // its full base weight.
  //
  // Measuring it only across scoring pillars was the subtler and more dangerous
  // option, because a device where three of five modules abstained would still
  // report high confidence on the strength of the two that answered. Aggregate
  // confidence has to fall when the picture is incomplete, or the
  // INSUFFICIENT_EVIDENCE threshold never fires when it is most needed.
  const confidence = round(
    pillars.reduce(
      (sum, p) => sum + (p.score === null ? 0 : p.confidence) * p.baseWeight,
      0,
    ) / assessableWeight,
  );
  const coverage = round(
    scoring.reduce((sum, p) => sum + p.baseWeight * p.coverage, 0) / assessableWeight,
  );

  provenance.log({
    at,
    module: ModuleId.TRUST,
    action: 'SCORE_COMPUTED',
    summary: `Weighted pillar score ${rawScore} at confidence ${confidence} over ${scoring.length} of ${pillars.length} pillars`,
    refs: {},
  });

  // --- Gates ----------------------------------------------------------------
  const gates = evaluateGates(input, coverage);
  const cap = gates.reduce((min, gate) => Math.min(min, gate.cap), 100);
  const score = Math.min(rawScore, cap);

  for (const gate of gates) {
    const gateInferences = gateInferenceIds(input, gate.module);
    provenance.log({
      at,
      module: ModuleId.TRUST,
      action: 'GATE_APPLIED',
      summary: `${gate.code} capped the trust score at ${gate.cap}: ${gate.reason}`,
      refs: {},
    });
    findings.push({
      code: `TRUST_GATE_${gate.code}`,
      basis: gateInferences.length > 0 ? FindingBasis.EVIDENCE : FindingBasis.ABSENCE,
      severity: gate.cap <= 40 ? Severity.CRITICAL : gate.cap <= 70 ? Severity.HIGH : Severity.MEDIUM,
      module: ModuleId.TRUST,
      title: `Trust score capped at ${gate.cap}`,
      detail: gate.reason,
      evidenceIds: [],
      // A gate is a conclusion drawn from a module verdict, so it cites that
      // verdict's own supporting inferences rather than inventing new ones.
      // Coverage gates come from the pipeline itself and cite nothing.
      inferenceIds: gateInferences,
    });
  }

  // --- Verdict --------------------------------------------------------------
  const band = confidenceBand(confidence);
  const banded =
    confidence < MINIMUM_REPORTABLE_CONFIDENCE
      ? TrustVerdict.INSUFFICIENT_EVIDENCE
      : score >= TRUST_BANDS.trusted
        ? TrustVerdict.TRUSTED
        : score >= TRUST_BANDS.withNotes
          ? TrustVerdict.TRUSTED_WITH_NOTES
          : score >= TRUST_BANDS.caution
            ? TrustVerdict.CAUTION
            : TrustVerdict.UNTRUSTED;

  // Disclosure rule. A device serviced with genuine Apple parts is sound and
  // legitimately scores well, but "TRUSTED" with no qualifier would let a
  // reseller present a repaired handset as untouched. Any established
  // replacement forces the verdict to carry notes, without moving the score.
  const hasEstablishedReplacement = input.details.service.replacedCount > 0;
  const verdict =
    banded === TrustVerdict.TRUSTED && hasEstablishedReplacement
      ? TrustVerdict.TRUSTED_WITH_NOTES
      : banded;

  if (verdict !== banded) {
    provenance.log({
      at,
      module: ModuleId.TRUST,
      action: 'GATE_APPLIED',
      summary: `Verdict downgraded from TRUSTED to TRUSTED_WITH_NOTES: ${input.details.service.replacedCount} component(s) have established replacement evidence`,
      refs: {},
    });
  }

  if (verdict === TrustVerdict.INSUFFICIENT_EVIDENCE) {
    findings.push({
      code: 'TRUST_INSUFFICIENT_EVIDENCE',
      basis: FindingBasis.ABSENCE,
      severity: Severity.HIGH,
      module: ModuleId.TRUST,
      title: 'Inspection does not meet the evidence threshold',
      detail:
        `Aggregate confidence of ${Math.round(confidence * 100)}% is below the ` +
        `${Math.round(MINIMUM_REPORTABLE_CONFIDENCE * 100)}% reporting threshold, so no trust ` +
        'verdict is issued. Re-run with the device unlocked and a Parts and Service History ' +
        'attestation attached.',
      evidenceIds: [],
      inferenceIds: [],
    });
  }

  provenance.log({
    at,
    module: ModuleId.TRUST,
    action: 'MODULE_COMPLETED',
    summary: `Trust verdict ${verdict} at score ${score} (raw ${rawScore}, ${gates.length} gate(s))`,
    refs: {},
  });

  return {
    assessment: {
      score,
      rawScore,
      confidence,
      confidenceBand: band,
      verdict,
      coverage,
      pillars,
      gatesApplied: gates,
      algorithmVersion: TRUST_ALGORITHM_VERSION,
    },
    findings,
  };
}

function pillar(result: ModuleResult, score: number | null): PillarScore {
  return {
    module: result.module,
    score,
    confidence: result.confidence,
    coverage: result.coverage,
    baseWeight: PILLAR_WEIGHTS[result.module] ?? 0,
    effectiveWeight: 0,
  };
}

/** Identity is binary in effect: the identifiers either cohere or they do not. */
function identityScore(result: ModuleResult): number | null {
  const verdict = result.verdicts[0];
  if (!verdict || verdict.determinacy === Determinacy.INDETERMINATE) return null;
  return verdict.value === IdentityVerdict.IDENTITY_CONSISTENT ? 100 : 10;
}

/** Hardware degrades with the number and severity of anomalies found. */
function hardwareScore(result: ModuleResult, detail: HardwareDetail): number | null {
  const verdict = result.verdicts[0];
  if (!verdict || verdict.determinacy === Determinacy.INDETERMINATE) return null;
  if (verdict.value === HardwareVerdict.SPECIFICATION_MATCH) return 100;

  const penalty = detail.anomalies.reduce(
    (sum, anomaly) => sum + (anomaly.severity === Severity.HIGH ? 40 : 20),
    0,
  );
  return Math.max(10, 100 - penalty);
}

/**
 * Service score.
 *
 * Replacement alone is not a fault: a device serviced by Apple with a genuine
 * part is sound, it simply must be disclosed. What the score reflects is the
 * *authenticity* of what was fitted, which is why the authenticity annotation
 * earns its keep here without ever having been a verdict value.
 */
const AUTHENTICITY_SCORE: Record<PartAuthenticity, number> = {
  [PartAuthenticity.GENUINE_APPLE]: 82,
  [PartAuthenticity.GENUINE_TRANSPLANTED]: 68,
  [PartAuthenticity.NOT_VERIFIED]: 12,
  [PartAuthenticity.UNKNOWN]: 55,
};

function serviceScore(detail: ServiceDetail): number | null {
  const scored = detail.components.filter((c) => c.verdict !== ServiceVerdict.CANNOT_DETERMINE);
  if (scored.length === 0) return null;

  let numerator = 0;
  let denominator = 0;
  for (const component of scored) {
    const weight = COMPONENT_WEIGHTS[component.subject] ?? 0.02;
    const value =
      component.verdict === ServiceVerdict.ORIGINAL_LIKELY
        ? 100
        : AUTHENTICITY_SCORE[component.authenticity];
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? Math.round(numerator / denominator) : null;
}

/** Battery maps its health curve directly; condition, not authenticity. */
function batteryScore(result: ModuleResult, detail: BatteryDetail): number | null {
  const verdict = result.verdicts[0];
  if (!verdict || verdict.determinacy === Determinacy.INDETERMINATE) return null;
  const health = detail.maximumCapacityPercent;
  if (health === null) return null;

  // Piecewise, calibrated to how the trade prices a cell rather than as a
  // straight percentage. Steepens below 80% because that is where a shop must
  // price in a replacement.
  if (health >= 100) return 100;
  if (health >= 90) return Math.round(88 + (health - 90) * 1.2);
  if (health >= 80) return Math.round(60 + (health - 80) * 2.8);
  if (health >= 70) return Math.round(30 + (health - 70) * 3);
  if (health >= 50) return Math.round((health - 50) * 1.5);
  return 0;
}

function securityScore(result: ModuleResult, detail: SecurityDetail): number | null {
  const verdict = result.verdicts[0];
  if (!verdict || verdict.determinacy === Determinacy.INDETERMINATE) return null;
  return detail.postureScore;
}

export function evaluateGates(input: TrustInput, coverage: number): TrustGate[] {
  const gates: TrustGate[] = [];
  const { details } = input;

  const identityVerdict = input.identity.verdicts[0];
  if (identityVerdict?.value === IdentityVerdict.IDENTITY_MISMATCH) {
    gates.push({
      code: 'IDENTITY_MISMATCH',
      cap: 30,
      module: ModuleId.IDENTITY,
      reason:
        'Device identifiers contradict each other, so nothing else in this report can be tied to ' +
        'a known handset with confidence.',
    });
  }

  if (details.security.integrityCompromised) {
    gates.push({
      code: 'INTEGRITY_COMPROMISED',
      cap: 35,
      module: ModuleId.SECURITY_DNA,
      reason: 'A modified operating system can misreport every other value in this inspection.',
    });
  }

  if (details.security.activationLockEnabled === true) {
    gates.push({
      code: 'ACTIVATION_LOCK_ON',
      cap: 35,
      module: ModuleId.SECURITY_DNA,
      reason: 'Activation Lock is enabled; the device cannot be resold until it is removed.',
    });
  }

  if (details.security.supervised === true || details.security.mdmEnrolled === true) {
    gates.push({
      code: 'MDM_SUPERVISED',
      cap: 70,
      module: ModuleId.SECURITY_DNA,
      reason: 'Device is supervised or MDM-enrolled and may re-enrol after an erase.',
    });
  }

  const highAnomalies = details.hardware.anomalies.filter((a) => a.severity === Severity.HIGH);
  if (highAnomalies.length > 0) {
    gates.push({
      code: 'HARDWARE_ANOMALY',
      cap: 50,
      module: ModuleId.HARDWARE_CONSISTENCY,
      reason: `Reported hardware does not match the detected model: ${highAnomalies
        .map((a) => a.check)
        .join(', ')}.`,
    });
  }

  const unverified = details.service.components.filter(
    (c) =>
      c.verdict === ServiceVerdict.REPLACED_LIKELY &&
      c.authenticity === PartAuthenticity.NOT_VERIFIED,
  );
  const criticalUnverified = unverified.filter((c) => isCritical(c.subject));
  if (criticalUnverified.length > 0) {
    gates.push({
      code: 'CRITICAL_PART_UNVERIFIED',
      cap: 45,
      module: ModuleId.SERVICE_EVIDENCE,
      reason: `Apple could not verify the part fitted to: ${criticalUnverified
        .map((c) => componentLabel(c.subject))
        .join(', ')}.`,
    });
  } else if (unverified.length > 0) {
    gates.push({
      code: 'PART_UNVERIFIED',
      cap: 68,
      module: ModuleId.SERVICE_EVIDENCE,
      reason: `Apple could not verify the part fitted to: ${unverified
        .map((c) => componentLabel(c.subject))
        .join(', ')}.`,
    });
  }

  if (details.battery.maximumCapacityPercent !== null && details.battery.maximumCapacityPercent < 80) {
    gates.push({
      code: 'BATTERY_BELOW_THRESHOLD',
      cap: 82,
      module: ModuleId.BATTERY_INTELLIGENCE,
      reason: `Battery at ${details.battery.maximumCapacityPercent}% is below Apple's 80% service threshold.`,
    });
  }

  // Coverage gates are graduated. A report must not read as flawless when a
  // third of the device was never assessed.
  if (coverage < 0.35) {
    gates.push({
      code: 'COVERAGE_INSUFFICIENT',
      cap: 78,
      module: ModuleId.TRUST,
      reason: `Only ${Math.round(coverage * 100)}% of the assessable picture could be established.`,
    });
  } else if (coverage < 0.7) {
    gates.push({
      code: 'COVERAGE_PARTIAL',
      cap: 95,
      module: ModuleId.TRUST,
      reason: `${Math.round(coverage * 100)}% of the assessable picture was established; a perfect score requires broader coverage.`,
    });
  } else if (coverage < 0.9) {
    // A trust system printing a flat 100 is making an absolute claim. Reserve
    // it for inspections that actually saw almost everything.
    gates.push({
      code: 'COVERAGE_NOT_TOTAL',
      cap: 97,
      module: ModuleId.TRUST,
      reason: `${Math.round(coverage * 100)}% of the assessable picture was established; a flawless score requires near-total coverage.`,
    });
  }

  return gates;
}

/** The inferences behind whichever module a gate came from. */
function gateInferenceIds(input: TrustInput, module: ModuleId): string[] {
  const source =
    module === ModuleId.IDENTITY
      ? input.identity
      : module === ModuleId.HARDWARE_CONSISTENCY
        ? input.hardware
        : module === ModuleId.SERVICE_EVIDENCE
          ? input.service
          : module === ModuleId.BATTERY_INTELLIGENCE
            ? input.battery
            : module === ModuleId.SECURITY_DNA
              ? input.security
              : null;
  if (!source) return [];
  return source.verdicts.flatMap((v) => v.inferenceIds).slice(0, 6);
}

export const SUBJECT_FOR_TRUST = EvidenceSubject.DEVICE;
