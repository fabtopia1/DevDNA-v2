import { clamp, DataSource, round, Severity, type Finding } from '../types/common.js';
import type { BatteryAssessment } from '../types/battery.js';
import type { DeviceIdentity } from '../types/device.js';
import { PartVerdict, type PartsAssessment } from '../types/parts.js';
import type { SoftwareAssessment } from '../types/software.js';
import {
  VerificationStatus,
  type TrustAssessment,
  type TrustGate,
} from '../types/inspection.js';
import { isCritical, labelFor } from './parts/index.js';

export const TRUST_ALGORITHM_VERSION = '1.0.0';

/**
 * Base weights. Parts carry the most weight because component authenticity is
 * the question the resale market cannot answer for itself — battery health and
 * iOS version are already visible in Settings, a swapped display is not.
 */
export const TRUST_WEIGHTS = { parts: 0.45, battery: 0.3, software: 0.25 } as const;

/**
 * Confidence damping. A pillar we are unsure about should influence the final
 * score less, but never fall out of it entirely — hence the 0.4 floor.
 *
 *   effectiveWeight = baseWeight * (0.4 + 0.6 * confidence)
 *
 * Weights are then renormalised so the result stays on a 0-100 scale.
 */
export const CONFIDENCE_FLOOR = 0.4;

/** Score bands. */
export const TRUST_BANDS = { verified: 85, verifiedWithNotes: 70, caution: 50 } as const;

/** Below this aggregate confidence we report INCONCLUSIVE rather than a score. */
export const MINIMUM_REPORTABLE_CONFIDENCE = 0.45;

export interface TrustInput {
  identity: DeviceIdentity;
  battery: BatteryAssessment;
  software: SoftwareAssessment;
  parts: PartsAssessment;
}

/**
 * Hard gates. These are caps, not subtractions: a device with an activation
 * lock cannot be "mostly fine" because its battery is healthy. Each gate that
 * fires is reported with its reason so a technician can see exactly why a
 * score was held down.
 */
export function evaluateGates(input: TrustInput): TrustGate[] {
  const gates: TrustGate[] = [];
  const { identity, battery, software, parts } = input;

  if (identity.activation.activationLockEnabled === true) {
    gates.push({
      code: 'ACTIVATION_LOCK_ON',
      cap: 35,
      reason: 'Activation Lock is enabled — the device cannot be resold until it is removed.',
    });
  }
  if (identity.activation.activated === false) {
    gates.push({
      code: 'NOT_ACTIVATED',
      cap: 60,
      reason: 'Device is not activated, so parts of the inspection could not be completed.',
    });
  }
  if (software.jailbreakSuspected) {
    gates.push({
      code: 'JAILBREAK_SUSPECTED',
      cap: 40,
      reason: 'A modified operating system can falsify every value in this report.',
    });
  }
  if (identity.activation.supervised === true || identity.activation.mdmEnrolled === true) {
    gates.push({
      code: 'MDM_SUPERVISED',
      cap: 70,
      reason: 'Device is supervised or MDM-enrolled and may re-enrol after an erase.',
    });
  }

  const unknownParts = parts.results.filter((r) => r.verdict === PartVerdict.UNKNOWN_PART);
  const criticalUnknown = unknownParts.filter((r) => isCritical(r.component));
  if (criticalUnknown.length > 0) {
    gates.push({
      code: 'CRITICAL_PART_UNKNOWN',
      cap: 45,
      reason: `Non-genuine ${criticalUnknown.map((r) => labelFor(r.component)).join(', ')} detected.`,
    });
  } else if (unknownParts.length > 0) {
    gates.push({
      code: 'PART_UNKNOWN',
      cap: 68,
      reason: `Non-genuine ${unknownParts.map((r) => labelFor(r.component)).join(', ')} detected.`,
    });
  }

  const maxCapacity = battery.maximumCapacityPercent?.value ?? null;
  if (maxCapacity !== null && maxCapacity < 80) {
    gates.push({
      code: 'BATTERY_BELOW_SERVICE_THRESHOLD',
      cap: 82,
      reason: `Battery at ${maxCapacity}% is below Apple's 80% service threshold.`,
    });
  }

  // Coverage gates are graduated: a report must not read as a flawless 100
  // when a third of the device was never assessed. The score a shop sees is
  // capped by how much of the handset the inspection actually reached.
  if (parts.coverage < 0.35) {
    gates.push({
      code: 'PARTS_COVERAGE_INSUFFICIENT',
      cap: 78,
      reason:
        `Only ${Math.round(parts.coverage * 100)}% of component weight could be assessed; the ` +
        'report cannot certify what it did not see.',
    });
  } else if (parts.coverage < 0.7) {
    gates.push({
      code: 'PARTS_COVERAGE_PARTIAL',
      cap: 95,
      reason:
        `${Math.round(parts.coverage * 100)}% of component weight was assessed. A perfect score ` +
        'requires broader component coverage.',
    });
  }

  return gates;
}

export function assessTrust(input: TrustInput): TrustAssessment {
  const { battery, software, parts } = input;

  const pillars = [
    { key: 'parts' as const, score: parts.score, confidence: parts.confidence, base: TRUST_WEIGHTS.parts },
    { key: 'battery' as const, score: battery.score, confidence: battery.confidence, base: TRUST_WEIGHTS.battery },
    { key: 'software' as const, score: software.score, confidence: software.confidence, base: TRUST_WEIGHTS.software },
  ];

  const effective = pillars.map((p) => ({
    ...p,
    weight: p.base * (CONFIDENCE_FLOOR + (1 - CONFIDENCE_FLOOR) * clamp(p.confidence, 0, 1)),
  }));
  const totalWeight = effective.reduce((sum, p) => sum + p.weight, 0);
  const normalised = effective.map((p) => ({ ...p, weight: totalWeight > 0 ? p.weight / totalWeight : 0 }));

  const rawScore = round(clamp(normalised.reduce((sum, p) => sum + p.score * p.weight, 0)));
  const confidence = round(
    clamp(normalised.reduce((sum, p) => sum + clamp(p.confidence, 0, 1) * p.weight, 0), 0, 1),
    3,
  );

  const gatesApplied = evaluateGates(input);
  const cap = gatesApplied.reduce((min, gate) => Math.min(min, gate.cap), 100);
  const score = round(clamp(Math.min(rawScore, cap)));

  const status = deriveStatus(score, confidence);

  const byKey = Object.fromEntries(
    normalised.map((p) => [p.key, { score: p.score, confidence: round(p.confidence, 3), weight: round(p.weight, 3) }]),
  ) as TrustAssessment['inputs'];

  return {
    score,
    rawScore,
    confidence,
    status,
    inputs: byKey,
    gatesApplied,
    algorithmVersion: TRUST_ALGORITHM_VERSION,
  };
}

/**
 * A low-confidence inspection is never presented as a pass. Reporting
 * "Verified" off thin evidence is the one failure mode that would destroy the
 * product's reason to exist.
 */
export function deriveStatus(score: number, confidence: number): VerificationStatus {
  if (confidence < MINIMUM_REPORTABLE_CONFIDENCE) return VerificationStatus.INCONCLUSIVE;
  if (score >= TRUST_BANDS.verified) return VerificationStatus.VERIFIED;
  if (score >= TRUST_BANDS.verifiedWithNotes) return VerificationStatus.VERIFIED_WITH_NOTES;
  if (score >= TRUST_BANDS.caution) return VerificationStatus.CAUTION;
  return VerificationStatus.FLAGGED;
}

/** Findings raised by the trust layer itself, on top of per-engine findings. */
export function trustFindings(trust: TrustAssessment, input: TrustInput): Finding[] {
  const findings: Finding[] = [];

  for (const gate of trust.gatesApplied) {
    findings.push({
      code: `GATE_${gate.code}`,
      severity: gate.cap <= 40 ? Severity.CRITICAL : gate.cap <= 70 ? Severity.HIGH : Severity.MEDIUM,
      title: `Trust score capped at ${gate.cap}`,
      detail: gate.reason,
      source: DataSource.DERIVED,
    });
  }

  if (input.identity.activation.activationLockEnabled === null) {
    findings.push({
      code: 'ACTIVATION_LOCK_UNKNOWN',
      severity: Severity.MEDIUM,
      title: 'Activation Lock state could not be determined over USB',
      detail:
        'No lockdown domain returned Find My state. Confirm manually in Settings > [name] > ' +
        'Find My before purchase — this is the single most common post-sale dispute.',
      source: DataSource.DERIVED,
    });
  }

  if (trust.status === VerificationStatus.INCONCLUSIVE) {
    findings.push({
      code: 'INSPECTION_INCONCLUSIVE',
      severity: Severity.HIGH,
      title: 'Inspection is inconclusive',
      detail:
        `Aggregate confidence of ${Math.round(trust.confidence * 100)}% is below the ` +
        `${Math.round(MINIMUM_REPORTABLE_CONFIDENCE * 100)}% reporting threshold. ` +
        'Re-run with the device unlocked and a Parts & Service History attestation attached.',
      source: DataSource.DERIVED,
    });
  }

  return findings;
}
