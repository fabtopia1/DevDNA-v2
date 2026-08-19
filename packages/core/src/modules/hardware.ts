import { EvidenceSubject } from '../evidence/types.js';
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
import { DESIGN_CAPACITY_TOLERANCE, hardwareSpecFor } from '../catalog/hardware-specs.js';
import { inferMarketingCapacityGb, resolveDevice } from '../catalog/devices.js';
import { parseVersion } from '../catalog/ios-releases.js';
import { massFor } from './support.js';

/**
 * Module 2 - the Hardware Consistency Engine.
 *
 * Compares what the device *reports about itself* against what the detected
 * model is *known to be*, and reports the differences as anomalies.
 *
 * The expectations come from the hardware catalog and are written into the
 * ledger as evidence before they are used, so every anomaly cites both the
 * observed value and the expectation it was judged against. A technician who
 * disagrees with a verdict can then argue with the catalog entry rather than
 * with an opaque conclusion.
 *
 * When the model is not in the catalog the engine returns CANNOT_DETERMINE. It
 * never invents a baseline: comparing a device against a guess would produce
 * anomalies that say more about DevDNA than about the handset.
 */

export enum HardwareVerdict {
  SPECIFICATION_MATCH = 'SPECIFICATION_MATCH',
  SPECIFICATION_ANOMALY = 'SPECIFICATION_ANOMALY',
  CANNOT_DETERMINE = 'CANNOT_DETERMINE',
}

export interface HardwareAnomaly {
  check: string;
  observed: string;
  expected: string;
  severity: Severity;
  explanation: string;
}

export interface HardwareDetail extends Record<string, unknown> {
  modelCatalogued: boolean;
  productType: string | null;
  expectedChip: string | null;
  observedCapacityGb: number | null;
  expectedCapacitiesGb: number[] | null;
  anomalies: HardwareAnomaly[];
  checksPerformed: string[];
  checksUnavailable: string[];
}

const CHECKS = [
  'board-id',
  'capacity-tier',
  'cpu-architecture',
  'battery-design-capacity',
  'ios-ceiling',
] as const;

export function runHardwareEngine(
  ledger: EvidenceLedger,
  provenance: ProvenanceEngine,
  at: string,
): { result: ModuleResult<HardwareVerdict>; findings: Finding[]; detail: HardwareDetail } {
  const inferences: Inference[] = [];
  const findings: Finding[] = [];
  const anomalies: HardwareAnomaly[] = [];
  const performed: string[] = [];
  const unavailable: string[] = [];

  const productTypeRecord = ledger.best(EvidenceSubject.DEVICE, 'ProductType');
  const productType = productTypeRecord ? String(productTypeRecord.value) : null;
  const spec = hardwareSpecFor(productType);
  const device = resolveDevice(productType);

  const derive = (input: {
    rule: string;
    subject: EvidenceSubject;
    direction: InferenceDirection;
    statement: string;
    weight: number;
    ruleConfidence: number;
    evidenceIds: string[];
  }): Inference => {
    const inference = provenance.derive({ module: ModuleId.HARDWARE_CONSISTENCY, at, ...input });
    inferences.push(inference);
    return inference;
  };

  // No catalogued expectations means nothing to compare against. Abstain.
  if (!spec || !productTypeRecord) {
    const verdict = provenance.conclude<HardwareVerdict>({
      module: ModuleId.HARDWARE_CONSISTENCY,
      subject: EvidenceSubject.DEVICE,
      value: HardwareVerdict.CANNOT_DETERMINE,
      determinacy: Determinacy.INDETERMINATE,
      confidence: 0,
      rationale: productType
        ? `${productType} is not in the hardware catalog, so no expected specification exists to compare against.`
        : 'The device did not report a product type.',
      inferenceIds: [],
    });

    findings.push({
      code: 'HARDWARE_MODEL_NOT_CATALOGUED',
      basis: FindingBasis.ABSENCE,
      severity: Severity.MEDIUM,
      module: ModuleId.HARDWARE_CONSISTENCY,
      title: productType
        ? `No specification on file for ${productType}`
        : 'Device reported no product type',
      detail:
        'Hardware consistency could not be assessed. This is expected for models released after ' +
        'the catalog was last updated, and is a coverage gap rather than a fault in the device.',
      // The claim is that no catalog expectation exists, which cites nothing.
      evidenceIds: [],
      inferenceIds: [],
    });

    return {
      result: {
        module: ModuleId.HARDWARE_CONSISTENCY,
        verdicts: [verdict],
        inferences: [],
        coverage: 0,
        confidence: 0,
        detail: {
          modelCatalogued: false,
          productType,
          expectedChip: null,
          observedCapacityGb: null,
          expectedCapacitiesGb: null,
          anomalies: [],
          checksPerformed: [],
          checksUnavailable: [...CHECKS],
        },
      },
      findings,
      detail: {
        modelCatalogued: false,
        productType,
        expectedChip: null,
        observedCapacityGb: null,
        expectedCapacitiesGb: null,
        anomalies: [],
        checksPerformed: [],
        checksUnavailable: [...CHECKS],
      },
    };
  }

  // --- Check 1: board identifier -----------------------------------------
  const boardRecord = ledger.best(EvidenceSubject.DEVICE, 'HardwareModel');
  const expectedBoards = ledger.best(EvidenceSubject.DEVICE, 'ExpectedBoardIds');
  if (boardRecord && expectedBoards) {
    performed.push('board-id');
    const observed = String(boardRecord.value);
    const expectedRecord = expectedBoards;

    const matches = spec.boardIds.some((id) => id.toLowerCase() === observed.toLowerCase());
    if (matches) {
      derive({
        rule: 'hardware.board-id-expected',
        subject: EvidenceSubject.DEVICE,
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: `Board identifier ${observed} is one Apple shipped for ${spec.productType}`,
        weight: 0.6,
        ruleConfidence: 0.9,
        evidenceIds: [boardRecord.id, expectedRecord.id],
      });
    } else {
      const inference = derive({
        rule: 'hardware.board-id-unexpected',
        subject: EvidenceSubject.DEVICE,
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `Board identifier ${observed} does not belong to ${spec.productType} (expected ${spec.boardIds.join(' or ')})`,
        weight: 0.85,
        ruleConfidence: 0.9,
        evidenceIds: [boardRecord.id, expectedRecord.id],
      });
      anomalies.push({
        check: 'board-id',
        observed,
        expected: spec.boardIds.join(' or '),
        severity: Severity.HIGH,
        explanation:
          'The logic board reports an identifier from a different model. This is consistent with ' +
          'a transplanted board or a modified product type.',
      });
      findings.push({
        code: 'HARDWARE_BOARD_ID_MISMATCH',
        basis: FindingBasis.EVIDENCE,
        severity: Severity.HIGH,
        module: ModuleId.HARDWARE_CONSISTENCY,
        title: 'Logic board identifier does not match the reported model',
        detail: `The device reports ${productType} but carries board ${observed}.`,
        evidenceIds: [boardRecord.id, expectedRecord.id],
        inferenceIds: [inference.id],
      });
    }
  } else {
    unavailable.push('board-id');
  }

  // --- Check 2: storage capacity tier ------------------------------------
  const capacityRecord = ledger.best(EvidenceSubject.DEVICE, 'TotalDiskCapacity');
  const observedCapacityGb = capacityRecord
    ? inferMarketingCapacityGb(Number(capacityRecord.value))
    : null;

  const expectedCapacities = ledger.best(EvidenceSubject.DEVICE, 'ExpectedCapacitiesGb');
  if (capacityRecord && observedCapacityGb !== null && expectedCapacities) {
    performed.push('capacity-tier');
    const expectedRecord = expectedCapacities;

    if (spec.capacitiesGb.includes(observedCapacityGb)) {
      derive({
        rule: 'hardware.capacity-tier-expected',
        subject: EvidenceSubject.DEVICE,
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: `${observedCapacityGb} GB is a tier ${spec.productType} was sold in`,
        weight: 0.4,
        ruleConfidence: 0.85,
        evidenceIds: [capacityRecord.id, expectedRecord.id],
      });
    } else {
      const inference = derive({
        rule: 'hardware.capacity-tier-unexpected',
        subject: EvidenceSubject.DEVICE,
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `${observedCapacityGb} GB is not a tier ${spec.productType} was sold in (${spec.capacitiesGb.join('/')} GB)`,
        weight: 0.7,
        ruleConfidence: 0.8,
        evidenceIds: [capacityRecord.id, expectedRecord.id],
      });
      anomalies.push({
        check: 'capacity-tier',
        observed: `${observedCapacityGb} GB`,
        expected: `${spec.capacitiesGb.join(' / ')} GB`,
        severity: Severity.HIGH,
        explanation:
          'Storage capacity does not correspond to any tier this model was sold in, which is a ' +
          'known signature of substituted storage.',
      });
      findings.push({
        code: 'HARDWARE_CAPACITY_NOT_OFFERED',
        basis: FindingBasis.EVIDENCE,
        severity: Severity.HIGH,
        module: ModuleId.HARDWARE_CONSISTENCY,
        title: `${observedCapacityGb} GB was never offered for this model`,
        detail:
          `${spec.productType} shipped in ${spec.capacitiesGb.join(', ')} GB. Substituted or ` +
          'misreported storage is a common modification on grey-market stock.',
        evidenceIds: [capacityRecord.id, expectedRecord.id],
        inferenceIds: [inference.id],
      });
    }
  } else {
    unavailable.push('capacity-tier');
  }

  // --- Check 3: CPU architecture ------------------------------------------
  const cpuRecord = ledger.best(EvidenceSubject.DEVICE, 'CPUArchitecture');
  const expectedCpu = ledger.best(EvidenceSubject.DEVICE, 'ExpectedCpuArchitecture');
  if (cpuRecord && expectedCpu) {
    performed.push('cpu-architecture');
    const observed = String(cpuRecord.value);
    const expectedRecord = expectedCpu;

    if (observed.toLowerCase() === spec.cpuArchitecture) {
      derive({
        rule: 'hardware.cpu-architecture-expected',
        subject: EvidenceSubject.DEVICE,
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: `CPU architecture ${observed} matches the ${spec.chip}`,
        weight: 0.45,
        ruleConfidence: 0.9,
        evidenceIds: [cpuRecord.id, expectedRecord.id],
      });
    } else {
      const inference = derive({
        rule: 'hardware.cpu-architecture-unexpected',
        subject: EvidenceSubject.DEVICE,
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `CPU architecture ${observed} does not match the ${spec.chip} (expected ${spec.cpuArchitecture})`,
        weight: 0.8,
        ruleConfidence: 0.9,
        evidenceIds: [cpuRecord.id, expectedRecord.id],
      });
      anomalies.push({
        check: 'cpu-architecture',
        observed,
        expected: spec.cpuArchitecture,
        severity: Severity.HIGH,
        explanation: 'The processor architecture is not the one this model shipped with.',
      });
      findings.push({
        code: 'HARDWARE_CPU_MISMATCH',
        basis: FindingBasis.EVIDENCE,
        severity: Severity.HIGH,
        module: ModuleId.HARDWARE_CONSISTENCY,
        title: 'Processor architecture does not match the reported model',
        detail: `Expected ${spec.cpuArchitecture} for the ${spec.chip}; device reports ${observed}.`,
        evidenceIds: [cpuRecord.id, expectedRecord.id],
        inferenceIds: [inference.id],
      });
    }
  } else {
    unavailable.push('cpu-architecture');
  }

  // --- Check 4: battery design capacity -----------------------------------
  // A genuine cell reports a design capacity within a few percent of spec.
  // This is a specification-conformity question; whether the cell was
  // *replaced* is the Service Evidence Engine's call, made on other evidence.
  const designRecord = ledger.best(EvidenceSubject.BATTERY, 'DesignCapacity');
  const expectedDesign = ledger.best(EvidenceSubject.BATTERY, 'ExpectedDesignCapacity');
  if (designRecord && expectedDesign) {
    performed.push('battery-design-capacity');
    const observed = Number(designRecord.value);
    const expectedRecord = expectedDesign;

    const deviation = Math.abs(observed - spec.designCapacityMah) / spec.designCapacityMah;
    if (deviation <= DESIGN_CAPACITY_TOLERANCE) {
      derive({
        rule: 'hardware.design-capacity-expected',
        subject: EvidenceSubject.BATTERY,
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: `Battery design capacity ${observed} mAh is within tolerance of the ${spec.designCapacityMah} mAh original`,
        weight: 0.5,
        ruleConfidence: 0.85,
        evidenceIds: [designRecord.id, expectedRecord.id],
      });
    } else {
      const inference = derive({
        rule: 'hardware.design-capacity-deviation',
        subject: EvidenceSubject.BATTERY,
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement:
          `Battery design capacity ${observed} mAh deviates ${Math.round(deviation * 100)}% from ` +
          `the ${spec.designCapacityMah} mAh original`,
        weight: 0.65,
        ruleConfidence: 0.8,
        evidenceIds: [designRecord.id, expectedRecord.id],
      });
      anomalies.push({
        check: 'battery-design-capacity',
        observed: `${observed} mAh`,
        expected: `${spec.designCapacityMah} mAh +/- ${Math.round(DESIGN_CAPACITY_TOLERANCE * 100)}%`,
        severity: Severity.MEDIUM,
        explanation:
          'The installed cell reports a design capacity the original never had, which is typical ' +
          'of a third-party pack.',
      });
      findings.push({
        code: 'HARDWARE_DESIGN_CAPACITY_DEVIATION',
        basis: FindingBasis.EVIDENCE,
        severity: Severity.MEDIUM,
        module: ModuleId.HARDWARE_CONSISTENCY,
        title: 'Battery design capacity does not match the original cell',
        detail:
          `The cell reports ${observed} mAh where ${spec.productType} shipped with ` +
          `${spec.designCapacityMah} mAh.`,
        evidenceIds: [designRecord.id, expectedRecord.id],
        inferenceIds: [inference.id],
      });
    }
  } else {
    unavailable.push('battery-design-capacity');
  }

  // --- Check 5: iOS version ceiling ---------------------------------------
  // A device cannot run a major iOS version its hardware never supported. If it
  // claims to, something in the software stack is misreporting.
  const versionRecord = ledger.best(EvidenceSubject.SYSTEM_SOFTWARE, 'ProductVersion');
  const expectedCeiling = ledger.best(EvidenceSubject.SYSTEM_SOFTWARE, 'MaxSupportedIosMajor');
  if (versionRecord && device.recognised && expectedCeiling) {
    performed.push('ios-ceiling');
    const major = parseVersion(String(versionRecord.value))?.[0] ?? null;
    const expectedRecord = expectedCeiling;

    if (major !== null && major > device.maxIosMajor) {
      const inference = derive({
        rule: 'hardware.ios-above-ceiling',
        subject: EvidenceSubject.SYSTEM_SOFTWARE,
        direction: InferenceDirection.SUPPORTS_NEGATIVE,
        statement: `Device reports iOS ${major}, above the iOS ${device.maxIosMajor} ceiling for ${device.marketingName}`,
        weight: 0.75,
        ruleConfidence: 0.85,
        evidenceIds: [versionRecord.id, expectedRecord.id],
      });
      anomalies.push({
        check: 'ios-ceiling',
        observed: `iOS ${major}`,
        expected: `iOS ${device.maxIosMajor} or lower`,
        severity: Severity.HIGH,
        explanation:
          'This hardware cannot run the iOS version it reports, so the software stack is ' +
          'misreporting either the version or the model.',
      });
      findings.push({
        code: 'HARDWARE_IOS_ABOVE_CEILING',
        basis: FindingBasis.EVIDENCE,
        severity: Severity.HIGH,
        module: ModuleId.HARDWARE_CONSISTENCY,
        title: 'Reported iOS version exceeds what this model supports',
        detail: `${device.marketingName} supports up to iOS ${device.maxIosMajor}.`,
        evidenceIds: [versionRecord.id, expectedRecord.id],
        inferenceIds: [inference.id],
      });
    } else if (major !== null) {
      derive({
        rule: 'hardware.ios-within-ceiling',
        subject: EvidenceSubject.SYSTEM_SOFTWARE,
        direction: InferenceDirection.SUPPORTS_POSITIVE,
        statement: `iOS ${major} is within the supported range for ${device.marketingName}`,
        weight: 0.3,
        ruleConfidence: 0.85,
        evidenceIds: [versionRecord.id, expectedRecord.id],
      });
    }
  } else {
    unavailable.push('ios-ceiling');
  }

  // --- Conclude -----------------------------------------------------------
  const negative = massFor(inferences, InferenceDirection.SUPPORTS_NEGATIVE);
  const positive = massFor(inferences, InferenceDirection.SUPPORTS_POSITIVE);

  let verdict: Verdict<HardwareVerdict>;
  if (inferences.length === 0) {
    verdict = provenance.conclude<HardwareVerdict>({
      module: ModuleId.HARDWARE_CONSISTENCY,
      subject: EvidenceSubject.DEVICE,
      value: HardwareVerdict.CANNOT_DETERMINE,
      determinacy: Determinacy.INDETERMINATE,
      confidence: 0,
      rationale: 'No comparable specification could be read from the device.',
      inferenceIds: [],
    });
  } else if (negative.positive > 0) {
    const scored = verdictConfidence({
      supporting: negative.supporting,
      opposingMass: negative.negative,
      ledger,
    });
    verdict = provenance.conclude<HardwareVerdict>({
      module: ModuleId.HARDWARE_CONSISTENCY,
      subject: EvidenceSubject.DEVICE,
      value: HardwareVerdict.SPECIFICATION_ANOMALY,
      determinacy: Determinacy.DETERMINED,
      confidence: Math.max(scored.confidence, 0.3),
      rationale: `${anomalies.length} specification anomal${anomalies.length === 1 ? 'y' : 'ies'}: ${anomalies
        .map((a) => a.check)
        .join(', ')}.`,
      inferenceIds: negative.supporting.map((i) => i.id),
    });
  } else {
    const scored = verdictConfidence({ supporting: positive.supporting, opposingMass: 0, ledger });
    verdict = provenance.conclude<HardwareVerdict>({
      module: ModuleId.HARDWARE_CONSISTENCY,
      subject: EvidenceSubject.DEVICE,
      value: HardwareVerdict.SPECIFICATION_MATCH,
      determinacy: Determinacy.DETERMINED,
      confidence: scored.confidence,
      rationale: `All ${performed.length} comparable specification${performed.length === 1 ? '' : 's'} match ${spec.productType}.`,
      inferenceIds: positive.supporting.map((i) => i.id),
    });
  }

  const coverage = round(performed.length / CHECKS.length);
  const detail: HardwareDetail = {
    modelCatalogued: true,
    productType,
    expectedChip: spec.chip,
    observedCapacityGb,
    expectedCapacitiesGb: spec.capacitiesGb,
    anomalies,
    checksPerformed: performed,
    checksUnavailable: unavailable,
  };

  return {
    result: {
      module: ModuleId.HARDWARE_CONSISTENCY,
      verdicts: [verdict],
      inferences,
      coverage,
      confidence: dampByCoverage(verdict.confidence, coverage),
      detail,
    },
    findings,
    detail,
  };
}
