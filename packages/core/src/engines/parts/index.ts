import {
  clamp,
  DataSource,
  round,
  Severity,
  type Finding,
} from '../../types/common.js';
import type { RawDeviceSnapshot } from '../../types/device.js';
import {
  PartComponent,
  PartVerdict,
  SignalPolarity,
  VERDICT_SCORE,
  type PartResult,
  type PartSignal,
  type PartsAssessment,
} from '../../types/parts.js';
import { applicableComponents, resolveDevice } from '../../catalog/devices.js';
import { asString, pick } from '../../parsers/ideviceinfo.js';
import { collectPartSignals, type PartDetector } from './signals.js';

export * from './signals.js';

/**
 * How much each component contributes to the parts score. Weighted by what the
 * resale market actually cares about: a non-genuine display or Face ID module
 * destroys value, a third-party speaker barely moves the price.
 */
export const COMPONENT_WEIGHTS: Record<PartComponent, number> = {
  [PartComponent.DISPLAY]: 0.24,
  [PartComponent.BATTERY]: 0.18,
  [PartComponent.FACE_ID]: 0.14,
  [PartComponent.REAR_CAMERA]: 0.13,
  [PartComponent.LOGIC_BOARD]: 0.1,
  [PartComponent.FRONT_CAMERA]: 0.09,
  [PartComponent.TOUCH_ID]: 0.06,
  [PartComponent.REAR_HOUSING]: 0.05,
  [PartComponent.LIDAR]: 0.03,
  [PartComponent.SPEAKER]: 0.03,
  [PartComponent.MICROPHONE]: 0.03,
  [PartComponent.TAPTIC_ENGINE]: 0.02,
};

/**
 * Decision thresholds for the rule engine, expressed as a share of total
 * signal mass. `UNKNOWN` is deliberately the easiest verdict to reach: for a
 * trade buyer, a missed non-genuine part is far more expensive than an
 * over-cautious flag.
 */
export const VERDICT_THRESHOLDS = {
  unknown: 0.42,
  used: 0.45,
  genuine: 0.55,
  /** Below this total signal mass we refuse to conclude anything. */
  minimumMass: 0.25,
} as const;

interface PolarityMass {
  genuine: number;
  used: number;
  unknown: number;
  serviced: number;
  total: number;
}

function accumulate(signals: PartSignal[]): PolarityMass {
  const mass: PolarityMass = { genuine: 0, used: 0, unknown: 0, serviced: 0, total: 0 };
  for (const signal of signals) {
    const weight = clamp(signal.strength, 0, 1) * clamp(signal.confidence, 0, 1);
    switch (signal.polarity) {
      case SignalPolarity.SUPPORTS_GENUINE:
        mass.genuine += weight;
        break;
      case SignalPolarity.SUPPORTS_USED:
        mass.used += weight;
        break;
      case SignalPolarity.SUPPORTS_UNKNOWN:
        mass.unknown += weight;
        break;
      case SignalPolarity.SUPPORTS_SERVICED:
        mass.serviced += weight;
        break;
    }
    mass.total += weight;
  }
  return mass;
}

/**
 * Resolve one component's verdict from its signals.
 *
 * Rules, in order:
 *  1. No signals at all -> CANNOT_DETERMINE. We never guess "genuine" from
 *     silence; absence of evidence is not evidence of authenticity.
 *  2. Signal mass below the floor -> UNVERIFIED_PART.
 *  3. Non-genuine evidence clears its threshold -> UNKNOWN_PART.
 *  4. Transplant evidence clears its threshold -> USED_APPLE_PART.
 *  5. Genuine evidence clears its (higher) threshold -> GENUINE_APPLE_PART.
 *  6. Otherwise the evidence conflicts -> UNVERIFIED_PART.
 */
export function resolveVerdict(signals: PartSignal[]): {
  verdict: PartVerdict;
  confidence: number;
  rationale: string;
} {
  if (signals.length === 0) {
    return {
      verdict: PartVerdict.CANNOT_DETERMINE,
      confidence: 0,
      rationale: 'No usable signal was obtainable for this component on this device and iOS build.',
    };
  }

  const mass = accumulate(signals);
  if (mass.total < VERDICT_THRESHOLDS.minimumMass) {
    return {
      verdict: PartVerdict.UNVERIFIED_PART,
      confidence: round(clamp(mass.total, 0, 1), 3),
      rationale: 'Signals were found but are too weak to support a verdict.',
    };
  }

  const share = (value: number): number => value / mass.total;
  const unknownShare = share(mass.unknown);
  const usedShare = share(mass.used);
  const genuineShare = share(mass.genuine);

  // Certainty scales with both how one-sided the evidence is and how much of
  // it there is; a single weak signal never yields high confidence.
  const massFactor = clamp(mass.total / 1.2, 0, 1);

  if (unknownShare >= VERDICT_THRESHOLDS.unknown) {
    return {
      verdict: PartVerdict.UNKNOWN_PART,
      confidence: round(clamp(unknownShare * massFactor, 0, 1), 3),
      rationale: describe(signals, SignalPolarity.SUPPORTS_UNKNOWN),
    };
  }
  if (usedShare >= VERDICT_THRESHOLDS.used) {
    return {
      verdict: PartVerdict.USED_APPLE_PART,
      confidence: round(clamp(usedShare * massFactor, 0, 1), 3),
      rationale: describe(signals, SignalPolarity.SUPPORTS_USED),
    };
  }
  if (genuineShare >= VERDICT_THRESHOLDS.genuine) {
    return {
      verdict: PartVerdict.GENUINE_APPLE_PART,
      confidence: round(clamp(genuineShare * massFactor, 0, 1), 3),
      rationale: describe(signals, SignalPolarity.SUPPORTS_GENUINE),
    };
  }

  return {
    verdict: PartVerdict.UNVERIFIED_PART,
    confidence: round(clamp(Math.max(unknownShare, usedShare, genuineShare) * massFactor * 0.6, 0, 1), 3),
    rationale: 'Evidence points in conflicting directions; no verdict is defensible.',
  };
}

function describe(signals: PartSignal[], polarity: SignalPolarity): string {
  const relevant = signals
    .filter((s) => s.polarity === polarity)
    .sort((a, b) => b.strength * b.confidence - a.strength * a.confidence);
  const top = relevant[0];
  if (!top) return 'Verdict derived from the combined signal set.';
  const extra = relevant.length > 1 ? ` (+${relevant.length - 1} corroborating signal${relevant.length > 2 ? 's' : ''})` : '';
  return `${top.summary}${extra}.`;
}

export interface PartsEngineOptions {
  detectors?: PartDetector[];
  componentWeights?: Partial<Record<PartComponent, number>>;
}

export function assessParts(
  snapshot: RawDeviceSnapshot,
  options: PartsEngineOptions = {},
): PartsAssessment {
  const device = resolveDevice(asString(pick(snapshot.lockdown, 'ProductType')));
  const components = applicableComponents(device);
  const weights = { ...COMPONENT_WEIGHTS, ...(options.componentWeights ?? {}) };
  const signals = collectPartSignals(snapshot, options.detectors);
  const findings: Finding[] = [];

  const byComponent = new Map<PartComponent, PartSignal[]>();
  for (const signal of signals) {
    const list = byComponent.get(signal.component) ?? [];
    list.push(signal);
    byComponent.set(signal.component, list);
  }

  const results: PartResult[] = components.map((component) => {
    const componentSignals = byComponent.get(component) ?? [];
    const { verdict, confidence, rationale } = resolveVerdict(componentSignals);
    return {
      component,
      verdict,
      confidence,
      weight: weights[component] ?? 0.02,
      signals: componentSignals,
      rationale,
    };
  });

  // Weighted mean over components that produced a scoreable verdict.
  let scoreNumerator = 0;
  let scoreDenominator = 0;
  let applicableWeight = 0;
  let confidenceNumerator = 0;

  for (const result of results) {
    applicableWeight += result.weight;
    const value = VERDICT_SCORE[result.verdict];
    if (value === null) continue;
    scoreNumerator += value * result.weight;
    scoreDenominator += result.weight;
    confidenceNumerator += result.confidence * result.weight;
  }

  const coverage = applicableWeight > 0 ? round(scoreDenominator / applicableWeight, 3) : 0;
  const score = scoreDenominator > 0 ? round(clamp(scoreNumerator / scoreDenominator)) : 0;
  const meanSignalConfidence = scoreDenominator > 0 ? confidenceNumerator / scoreDenominator : 0;

  // A perfect score over 10% of the device tells a buyer nothing, so coverage
  // is a first-class multiplier on confidence rather than a footnote.
  const confidence = round(clamp(meanSignalConfidence * (0.35 + 0.65 * coverage), 0, 1), 3);

  for (const result of results) {
    if (result.verdict === PartVerdict.UNKNOWN_PART) {
      findings.push({
        code: `PART_UNKNOWN_${result.component}`,
        severity: isCritical(result.component) ? Severity.CRITICAL : Severity.HIGH,
        title: `${labelFor(result.component)}: non-genuine part detected`,
        detail: result.rationale,
        source: result.signals[0]?.source ?? DataSource.DERIVED,
      });
    } else if (result.verdict === PartVerdict.USED_APPLE_PART) {
      findings.push({
        code: `PART_USED_${result.component}`,
        severity: Severity.MEDIUM,
        title: `${labelFor(result.component)}: genuine Apple part from another device`,
        detail: result.rationale,
        source: result.signals[0]?.source ?? DataSource.DERIVED,
      });
    }
  }

  if (coverage < 0.5) {
    findings.push({
      code: 'PARTS_COVERAGE_LOW',
      severity: Severity.MEDIUM,
      title: `Only ${Math.round(coverage * 100)}% of components could be assessed`,
      detail:
        'Capture a Parts & Service History attestation from Settings > General > About to raise ' +
        'coverage. Without it, this report makes no claim about the unassessed components.',
      source: DataSource.DERIVED,
    });
  }

  if (!snapshot.attestation) {
    findings.push({
      code: 'PARTS_NO_ATTESTATION',
      severity: Severity.LOW,
      title: 'No Parts & Service History attestation captured',
      detail:
        'Apple exposes its own component verdicts only on-device. Attaching the technician ' +
        'attestation is the single largest available increase in parts confidence.',
      source: DataSource.DERIVED,
    });
  }

  return {
    results,
    score,
    confidence,
    coverage,
    attestationPresent: snapshot.attestation !== null,
    findings,
  };
}

const CRITICAL_COMPONENTS = new Set<PartComponent>([
  PartComponent.DISPLAY,
  PartComponent.LOGIC_BOARD,
  PartComponent.FACE_ID,
]);

export const isCritical = (component: PartComponent): boolean => CRITICAL_COMPONENTS.has(component);

const COMPONENT_LABELS: Record<PartComponent, string> = {
  [PartComponent.DISPLAY]: 'Display',
  [PartComponent.BATTERY]: 'Battery',
  [PartComponent.REAR_CAMERA]: 'Rear Camera',
  [PartComponent.FRONT_CAMERA]: 'Front Camera',
  [PartComponent.FACE_ID]: 'Face ID',
  [PartComponent.TOUCH_ID]: 'Touch ID',
  [PartComponent.REAR_HOUSING]: 'Rear Housing',
  [PartComponent.LOGIC_BOARD]: 'Logic Board',
  [PartComponent.LIDAR]: 'LiDAR Scanner',
  [PartComponent.SPEAKER]: 'Speaker',
  [PartComponent.MICROPHONE]: 'Microphone',
  [PartComponent.TAPTIC_ENGINE]: 'Taptic Engine',
};

export const labelFor = (component: PartComponent): string => COMPONENT_LABELS[component];

const VERDICT_LABELS: Record<PartVerdict, string> = {
  [PartVerdict.GENUINE_APPLE_PART]: 'Genuine Apple Part',
  [PartVerdict.USED_APPLE_PART]: 'Used Apple Part',
  [PartVerdict.UNKNOWN_PART]: 'Unknown Part',
  [PartVerdict.UNVERIFIED_PART]: 'Unverified Part',
  [PartVerdict.CANNOT_DETERMINE]: 'Cannot Determine',
  [PartVerdict.NOT_APPLICABLE]: 'Not Applicable',
};

export const verdictLabel = (verdict: PartVerdict): string => VERDICT_LABELS[verdict];
