import { EvidenceKind, EvidenceSubject, type EvidenceRecord } from '../evidence/types.js';
import type { EvidenceLedger } from '../evidence/ledger.js';
import {
  Determinacy,
  InferenceDirection,
  ModuleId,
  FindingBasis,
  Severity,
  type Finding,
  type Inference,
  type ModuleResult,
  type Verdict,
} from '../inference/types.js';
import type { ProvenanceEngine } from '../inference/provenance.js';
import { dampByCoverage, round, verdictConfidence } from '../confidence/model.js';
import { AppleServiceHistoryLabel } from '../capture/snapshot.js';
import { applicableComponents, resolveDevice, SERVICE_HISTORY_TRACKED } from '../catalog/devices.js';
import { massFor } from './support.js';

/**
 * Module 3 - the Service Evidence Engine.
 *
 * Answers one question per component: **is there evidence this part was
 * replaced?** It never claims a repair occurred unless something directly
 * supports it, and its entire vocabulary is three values.
 *
 * The most important correction this module encodes: iOS renders the Parts and
 * Service History screen **only when a service record exists**. A component
 * appearing there is therefore evidence that it *was serviced* - including when
 * it is labelled "Genuine Apple Part". That label describes the authenticity of
 * the part fitted, not whether the component is original to the device.
 *
 * Authenticity is reported separately, as an annotation and a finding, because
 * the verdict vocabulary is deliberately about replacement alone. Conflating
 * "genuine" with "original" is the single most common error in this market, and
 * it systematically overvalues serviced handsets.
 */

export enum ServiceVerdict {
  ORIGINAL_LIKELY = 'ORIGINAL_LIKELY',
  REPLACED_LIKELY = 'REPLACED_LIKELY',
  CANNOT_DETERMINE = 'CANNOT_DETERMINE',
}

/** Authenticity of a fitted part. Orthogonal to whether it was replaced. */
export enum PartAuthenticity {
  GENUINE_APPLE = 'GENUINE_APPLE',
  /** Authentic Apple part previously fitted to a different device. */
  GENUINE_TRANSPLANTED = 'GENUINE_TRANSPLANTED',
  NOT_VERIFIED = 'NOT_VERIFIED',
  UNKNOWN = 'UNKNOWN',
}

export interface ComponentServiceRecord {
  subject: EvidenceSubject;
  verdict: ServiceVerdict;
  confidence: number;
  authenticity: PartAuthenticity;
  rationale: string;
  evidenceIds: string[];
  inferenceIds: string[];
}

export interface ServiceDetail extends Record<string, unknown> {
  components: ComponentServiceRecord[];
  /** True when a technician transcribed Apple's own service history screen. */
  attestationPresent: boolean;
  serviceHistorySectionAbsent: boolean;
  replacedCount: number;
  originalCount: number;
  indeterminateCount: number;
}

/**
 * Decision thresholds, as a share of directional mass.
 *
 * REPLACED is easier to reach than ORIGINAL, deliberately. For a trade buyer a
 * missed replacement is expensive and an over-cautious flag is cheap, and
 * "original" is the claim that carries commercial weight, so it should be the
 * harder one to earn.
 */
export const SERVICE_THRESHOLDS = {
  replaced: 0.45,
  original: 0.6,
  /** Below this total mass nothing is concluded at all. */
  minimumMass: 0.25,
} as const;

/**
 * How much each component matters to the overall service picture. Weighted by
 * what the resale market actually prices, not by part cost.
 */
export const COMPONENT_WEIGHTS: Record<string, number> = {
  [EvidenceSubject.DISPLAY]: 0.24,
  [EvidenceSubject.BATTERY]: 0.18,
  [EvidenceSubject.FACE_ID]: 0.14,
  [EvidenceSubject.REAR_CAMERA]: 0.13,
  [EvidenceSubject.LOGIC_BOARD]: 0.1,
  [EvidenceSubject.FRONT_CAMERA]: 0.09,
  [EvidenceSubject.TOUCH_ID]: 0.06,
  [EvidenceSubject.REAR_HOUSING]: 0.05,
  [EvidenceSubject.LIDAR]: 0.03,
  [EvidenceSubject.SPEAKER]: 0.03,
  [EvidenceSubject.MICROPHONE]: 0.03,
  [EvidenceSubject.TAPTIC_ENGINE]: 0.02,
};

/** Diagnostic events that evidence a component having been worked on. */
const DIAGNOSTIC_RULES: Record<
  string,
  { weight: number; ruleConfidence: number; statement: string; authenticity?: PartAuthenticity }
> = {
  AppleSmartBatteryUnknownPart: {
    weight: 0.8,
    ruleConfidence: 0.85,
    statement: 'Device analytics record the battery as an unknown part',
    authenticity: PartAuthenticity.NOT_VERIFIED,
  },
  BatteryUnknownPart: {
    weight: 0.75,
    ruleConfidence: 0.8,
    statement: 'Device analytics record a battery pairing failure',
    authenticity: PartAuthenticity.NOT_VERIFIED,
  },
  NonGenuineBattery: {
    weight: 0.8,
    ruleConfidence: 0.85,
    statement: 'Device analytics record a non-genuine battery flag',
    authenticity: PartAuthenticity.NOT_VERIFIED,
  },
  DisplaySerialMismatch: {
    weight: 0.75,
    ruleConfidence: 0.85,
    statement: 'The installed display carries a serial the device was not assembled with',
  },
  AppleDisplayPipeAuthFailure: {
    weight: 0.7,
    ruleConfidence: 0.8,
    statement: 'Device analytics record a display authentication failure',
    authenticity: PartAuthenticity.NOT_VERIFIED,
  },
  MultitouchCalibrationFailure: {
    weight: 0.5,
    ruleConfidence: 0.7,
    statement: 'Touch calibration data is missing or invalid, typical of a replaced panel',
  },
  TrueToneDisabled: {
    weight: 0.45,
    ruleConfidence: 0.7,
    statement: 'True Tone is unavailable, typical of a panel that was swapped',
  },
  FaceIDPairingFailure: {
    weight: 0.8,
    ruleConfidence: 0.85,
    statement: 'Device analytics record a Face ID module pairing failure',
    authenticity: PartAuthenticity.NOT_VERIFIED,
  },
  PearlNotPaired: {
    weight: 0.8,
    ruleConfidence: 0.85,
    statement: 'The TrueDepth module is not paired to this logic board',
    authenticity: PartAuthenticity.NOT_VERIFIED,
  },
  CameraPairingFailure: {
    weight: 0.7,
    ruleConfidence: 0.8,
    statement: 'Device analytics record a rear camera pairing failure',
    authenticity: PartAuthenticity.NOT_VERIFIED,
  },
  ServiceHistoryRecord: {
    weight: 0.4,
    ruleConfidence: 0.7,
    statement: 'Device analytics contain a service history record',
  },
};

const LABEL_AUTHENTICITY: Record<AppleServiceHistoryLabel, PartAuthenticity> = {
  [AppleServiceHistoryLabel.GENUINE_APPLE_PART]: PartAuthenticity.GENUINE_APPLE,
  [AppleServiceHistoryLabel.USED_APPLE_PART]: PartAuthenticity.GENUINE_TRANSPLANTED,
  [AppleServiceHistoryLabel.UNKNOWN_PART]: PartAuthenticity.NOT_VERIFIED,
  [AppleServiceHistoryLabel.UNABLE_TO_VERIFY]: PartAuthenticity.NOT_VERIFIED,
};

export function runServiceEngine(
  ledger: EvidenceLedger,
  provenance: ProvenanceEngine,
  at: string,
): { result: ModuleResult<ServiceVerdict>; findings: Finding[]; detail: ServiceDetail } {
  const allInferences: Inference[] = [];
  const findings: Finding[] = [];
  const verdicts: Verdict<ServiceVerdict>[] = [];
  const components: ComponentServiceRecord[] = [];

  const productType = ledger.string(EvidenceSubject.DEVICE, 'ProductType') ?? null;
  const device = resolveDevice(productType);
  const applicable = applicableComponents(device);

  const sectionAbsentRecord = ledger.best(EvidenceSubject.DEVICE, 'ServiceHistorySectionAbsent');
  const sectionAbsent = sectionAbsentRecord?.value === true;
  const attestationPresent =
    sectionAbsent ||
    ledger.find(
      (r) => r.kind === EvidenceKind.SERVICE_RECORD_STATEMENT && r.key === 'ServiceHistoryLabel',
    ).length > 0;

  // Which components iOS actually listed. Needed for the absence argument.
  const listedSubjects = new Set(
    ledger
      .find((r) => r.kind === EvidenceKind.SERVICE_RECORD_STATEMENT && r.key === 'ServiceHistoryLabel')
      .map((r) => r.subject),
  );

  for (const subject of applicable) {
    const inferences: Inference[] = [];
    let authenticity = PartAuthenticity.UNKNOWN;

    const derive = (input: {
      rule: string;
      direction: InferenceDirection;
      statement: string;
      weight: number;
      ruleConfidence: number;
      evidenceIds: string[];
    }): void => {
      const inference = provenance.derive({ module: ModuleId.SERVICE_EVIDENCE, subject, at, ...input });
      inferences.push(inference);
      allInferences.push(inference);
    };

    // --- Apple's own service record ---------------------------------------
    const labelRecord = ledger.best(subject, 'ServiceHistoryLabel');
    if (labelRecord) {
      const label = String(labelRecord.value) as AppleServiceHistoryLabel;
      authenticity = LABEL_AUTHENTICITY[label] ?? PartAuthenticity.UNKNOWN;

      // Presence on the screen is the replacement evidence. The label refines
      // authenticity, not the replacement question.
      derive({
        rule: 'service.listed-in-service-history',
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement:
          `iOS lists this component in Parts and Service History as "${label}", and iOS only ` +
          'populates that screen when a service record exists',
        weight: 0.9,
        ruleConfidence: 0.9,
        evidenceIds: [labelRecord.id],
      });

      if (authenticity === PartAuthenticity.NOT_VERIFIED) {
        findings.push({
          code: `SERVICE_PART_NOT_VERIFIED_${subject}`,
          basis: FindingBasis.EVIDENCE,
          severity: isCritical(subject) ? Severity.CRITICAL : Severity.HIGH,
          module: ModuleId.SERVICE_EVIDENCE,
          title: `${componentLabel(subject)}: Apple could not verify the fitted part`,
          detail: `iOS reports "${label}" for this component.`,
          evidenceIds: [labelRecord.id],
          inferenceIds: [],
        });
      } else if (authenticity === PartAuthenticity.GENUINE_TRANSPLANTED) {
        findings.push({
          code: `SERVICE_PART_TRANSPLANTED_${subject}`,
          basis: FindingBasis.EVIDENCE,
          severity: Severity.MEDIUM,
          module: ModuleId.SERVICE_EVIDENCE,
          title: `${componentLabel(subject)}: genuine Apple part from another device`,
          detail: `iOS reports "${label}" for this component.`,
          evidenceIds: [labelRecord.id],
          inferenceIds: [],
        });
      }
    } else if (sectionAbsent && sectionAbsentRecord && SERVICE_HISTORY_TRACKED.includes(subject)) {
      // iOS showed no section at all, so it holds no service record for any
      // component it tracks. Genuine originality evidence, but second-hand:
      // Apple's records are not exhaustive for out-of-network repairs.
      derive({
        rule: 'service.no-service-history-section',
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement:
          'iOS displayed no Parts and Service History section, so Apple holds no service record ' +
          'for the components it tracks',
        weight: 0.6,
        ruleConfidence: 0.75,
        evidenceIds: [sectionAbsentRecord.id],
      });
    } else if (
      listedSubjects.size > 0 &&
      SERVICE_HISTORY_TRACKED.includes(subject) &&
      !listedSubjects.has(subject)
    ) {
      // The section exists and lists other components but not this one, so iOS
      // is tracking and has no record for it. Stronger than a blank screen.
      const anyListed = ledger.find(
        (r) => r.kind === EvidenceKind.SERVICE_RECORD_STATEMENT && r.key === 'ServiceHistoryLabel',
      )[0];
      if (anyListed) {
        derive({
          rule: 'service.absent-from-populated-history',
          direction: InferenceDirection.SUPPORTS_POSITIVE,
          statement:
            'iOS lists other components in Parts and Service History but not this one, so it ' +
            'holds no service record for it',
          weight: 0.65,
          ruleConfidence: 0.8,
          evidenceIds: [anyListed.id],
        });
      }
    }

    // --- Diagnostic events -------------------------------------------------
    for (const record of ledger.forSubject(subject)) {
      if (record.kind !== EvidenceKind.DIAGNOSTIC_EVENT) continue;
      const rule = DIAGNOSTIC_RULES[record.key];
      if (!rule) continue;

      derive({
        rule: `service.diagnostic.${record.key}`,
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: rule.statement,
        weight: rule.weight,
        ruleConfidence: rule.ruleConfidence,
        evidenceIds: [record.id],
      });
      if (rule.authenticity && authenticity === PartAuthenticity.UNKNOWN) {
        authenticity = rule.authenticity;
      }
    }

    // --- Capability loss ---------------------------------------------------
    // True Tone needs the panel's factory calibration, which does not travel
    // with a third-party or transplanted display. Note the asymmetry: True Tone
    // *present* is only weak originality evidence, because a genuine Apple
    // display service restores it.
    if (subject === EvidenceSubject.DISPLAY && device.recognised && device.generation >= 8) {
      const trueTone = firstDefined(
        ledger.best(EvidenceSubject.DISPLAY, 'DisplaySupportsTrueTone'),
        ledger.best(EvidenceSubject.DISPLAY, 'TrueToneSupported'),
      );
      if (trueTone && trueTone.value === false) {
        derive({
          rule: 'service.true-tone-absent',
          direction: InferenceDirection.SUPPORTS_NEGATIVE,
          statement: `${device.marketingName} shipped with True Tone but reports it unsupported`,
          weight: 0.6,
          ruleConfidence: 0.8,
          evidenceIds: [trueTone.id],
        });
      } else if (trueTone && trueTone.value === true) {
        derive({
          rule: 'service.true-tone-present',
          direction: InferenceDirection.SUPPORTS_POSITIVE,
          statement: 'Display reports True Tone calibration data present',
          weight: 0.25,
          ruleConfidence: 0.6,
          evidenceIds: [trueTone.id],
        });
      }
    }

    if (subject === EvidenceSubject.FACE_ID && device.biometrics === 'FACE_ID') {
      const faceId = firstDefined(
        ledger.best(EvidenceSubject.FACE_ID, 'SupportsFaceID'),
        ledger.best(EvidenceSubject.FACE_ID, 'FaceIDCapability'),
      );
      if (faceId && faceId.value === false) {
        derive({
          rule: 'service.face-id-capability-absent',
          direction: InferenceDirection.SUPPORTS_NEGATIVE,
          statement: `${device.marketingName} shipped with Face ID but reports no Face ID capability`,
          weight: 0.7,
          ruleConfidence: 0.8,
          evidenceIds: [faceId.id],
        });
        authenticity =
          authenticity === PartAuthenticity.UNKNOWN ? PartAuthenticity.NOT_VERIFIED : authenticity;
      }
    }

    // --- Conclude for this component ---------------------------------------
    const replaced = massFor(inferences, InferenceDirection.SUPPORTS_NEGATIVE);
    const totalMass = replaced.total;

    let verdict: Verdict<ServiceVerdict>;

    if (inferences.length === 0 || totalMass < SERVICE_THRESHOLDS.minimumMass) {
      // Absence of evidence is never evidence of originality.
      verdict = provenance.conclude<ServiceVerdict>({
        module: ModuleId.SERVICE_EVIDENCE,
        subject,
        value: ServiceVerdict.CANNOT_DETERMINE,
        determinacy: Determinacy.INDETERMINATE,
        confidence: 0,
        rationale:
          inferences.length === 0
            ? 'No service evidence of any kind was obtainable for this component.'
            : 'Service evidence exists but is too weak to support a conclusion.',
        inferenceIds: inferences.map((i) => i.id),
      });
    } else {
      const replacedShare = replaced.positive / totalMass;
      const originalShare = replaced.negative / totalMass;

      if (replacedShare >= SERVICE_THRESHOLDS.replaced) {
        const scored = verdictConfidence({
          supporting: replaced.supporting,
          opposingMass: replaced.negative,
          ledger,
        });
        verdict = provenance.conclude<ServiceVerdict>({
          module: ModuleId.SERVICE_EVIDENCE,
          subject,
          value: ServiceVerdict.REPLACED_LIKELY,
          determinacy: Determinacy.DETERMINED,
          confidence: Math.max(scored.confidence, 0.25),
          rationale: strongest(replaced.supporting),
          inferenceIds: replaced.supporting.map((i) => i.id),
        });
      } else if (originalShare >= SERVICE_THRESHOLDS.original) {
        const scored = verdictConfidence({
          supporting: replaced.opposing,
          opposingMass: replaced.positive,
          ledger,
        });
        verdict = provenance.conclude<ServiceVerdict>({
          module: ModuleId.SERVICE_EVIDENCE,
          subject,
          value: ServiceVerdict.ORIGINAL_LIKELY,
          determinacy: Determinacy.DETERMINED,
          confidence: Math.max(scored.confidence, 0.25),
          rationale: strongest(replaced.opposing),
          inferenceIds: replaced.opposing.map((i) => i.id),
        });
      } else {
        verdict = provenance.conclude<ServiceVerdict>({
          module: ModuleId.SERVICE_EVIDENCE,
          subject,
          value: ServiceVerdict.CANNOT_DETERMINE,
          determinacy: Determinacy.INDETERMINATE,
          confidence: 0,
          rationale: 'Evidence points in conflicting directions; no conclusion is defensible.',
          inferenceIds: inferences.map((i) => i.id),
        });
      }
    }

    verdicts.push(verdict);
    components.push({
      subject,
      verdict: verdict.value,
      confidence: verdict.confidence,
      authenticity,
      rationale: verdict.rationale,
      evidenceIds: verdict.evidenceIds,
      inferenceIds: verdict.inferenceIds,
    });
  }

  // --- Module aggregation --------------------------------------------------
  const applicableWeight = applicable.reduce((sum, s) => sum + (COMPONENT_WEIGHTS[s] ?? 0.02), 0);
  const determinedWeight = components
    .filter((c) => c.verdict !== ServiceVerdict.CANNOT_DETERMINE)
    .reduce((sum, c) => sum + (COMPONENT_WEIGHTS[c.subject] ?? 0.02), 0);
  const coverage = applicableWeight > 0 ? round(determinedWeight / applicableWeight) : 0;

  const determined = components.filter((c) => c.verdict !== ServiceVerdict.CANNOT_DETERMINE);
  const meanConfidence =
    determined.length > 0
      ? determined.reduce(
          (sum, c) => sum + c.confidence * (COMPONENT_WEIGHTS[c.subject] ?? 0.02),
          0,
        ) / (determinedWeight || 1)
      : 0;

  if (!attestationPresent) {
    findings.push({
      code: 'SERVICE_NO_ATTESTATION',
      basis: FindingBasis.ABSENCE,
      severity: Severity.LOW,
      module: ModuleId.SERVICE_EVIDENCE,
      title: 'No Parts and Service History attestation captured',
      detail:
        'Apple exposes its own service records only on the device. Transcribing that screen is ' +
        'the single largest available increase in service-evidence coverage.',
      evidenceIds: [],
      inferenceIds: [],
    });
  }

  if (coverage < 0.5) {
    findings.push({
      code: 'SERVICE_COVERAGE_LOW',
      basis: FindingBasis.ABSENCE,
      severity: Severity.MEDIUM,
      module: ModuleId.SERVICE_EVIDENCE,
      title: `Service history determined for ${Math.round(coverage * 100)}% of component weight`,
      detail:
        'This inspection makes no claim about the components it could not assess. Absence of ' +
        'evidence is not evidence that a part is original.',
      evidenceIds: [],
      inferenceIds: [],
    });
  }

  const detail: ServiceDetail = {
    components,
    attestationPresent,
    serviceHistorySectionAbsent: sectionAbsent,
    replacedCount: components.filter((c) => c.verdict === ServiceVerdict.REPLACED_LIKELY).length,
    originalCount: components.filter((c) => c.verdict === ServiceVerdict.ORIGINAL_LIKELY).length,
    indeterminateCount: components.filter((c) => c.verdict === ServiceVerdict.CANNOT_DETERMINE).length,
  };

  return {
    result: {
      module: ModuleId.SERVICE_EVIDENCE,
      verdicts,
      inferences: allInferences,
      coverage,
      confidence: dampByCoverage(meanConfidence, coverage),
      detail,
    },
    findings,
    detail,
  };
}

const CRITICAL_SUBJECTS = new Set<EvidenceSubject>([
  EvidenceSubject.DISPLAY,
  EvidenceSubject.LOGIC_BOARD,
  EvidenceSubject.FACE_ID,
]);

export const isCritical = (subject: EvidenceSubject): boolean => CRITICAL_SUBJECTS.has(subject);

const COMPONENT_LABELS: Record<string, string> = {
  [EvidenceSubject.DISPLAY]: 'Display',
  [EvidenceSubject.BATTERY]: 'Battery',
  [EvidenceSubject.REAR_CAMERA]: 'Rear Camera',
  [EvidenceSubject.FRONT_CAMERA]: 'Front Camera',
  [EvidenceSubject.FACE_ID]: 'Face ID',
  [EvidenceSubject.TOUCH_ID]: 'Touch ID',
  [EvidenceSubject.REAR_HOUSING]: 'Rear Housing',
  [EvidenceSubject.LOGIC_BOARD]: 'Logic Board',
  [EvidenceSubject.LIDAR]: 'LiDAR Scanner',
  [EvidenceSubject.SPEAKER]: 'Speaker',
  [EvidenceSubject.MICROPHONE]: 'Microphone',
  [EvidenceSubject.TAPTIC_ENGINE]: 'Taptic Engine',
};

export const componentLabel = (subject: EvidenceSubject): string =>
  COMPONENT_LABELS[subject] ?? subject.replace(/_/g, ' ');

const strongest = (inferences: readonly Inference[]): string => {
  const top = [...inferences].sort((a, b) => b.weight * b.confidence - a.weight * a.confidence)[0];
  if (!top) return 'Derived from the combined evidence set.';
  const extra = inferences.length > 1 ? ` (+${inferences.length - 1} corroborating)` : '';
  return `${top.statement}${extra}.`;
};

const firstDefined = (...records: Array<EvidenceRecord | undefined>): EvidenceRecord | undefined =>
  records.find((record) => record !== undefined);
