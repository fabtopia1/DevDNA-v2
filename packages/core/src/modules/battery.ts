import { EvidenceSubject, type EvidenceRecord } from '../evidence/types.js';
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
import { corroborate, round, clamp01 } from '../confidence/model.js';
import { resolveDevice } from '../catalog/devices.js';

/**
 * Module 4 - the Battery Intelligence Engine.
 *
 * Produces a wear grade, a health confidence, and a replacement likelihood, and
 * keeps every raw measurement it used.
 *
 * The replacement estimate is the part that earns its place commercially. A
 * shop does not really want to know "93% health"; it wants to know whether it
 * will be replacing this cell inside the warranty period it is about to offer.
 * That is a projection, so it is reported as a likelihood with its assumptions
 * stated, never as a fact.
 */

export enum BatteryVerdict {
  WITHIN_SPECIFICATION = 'WITHIN_SPECIFICATION',
  SERVICE_RECOMMENDED = 'SERVICE_RECOMMENDED',
  DEGRADED = 'DEGRADED',
  CANNOT_DETERMINE = 'CANNOT_DETERMINE',
}

/** Trade-facing wear grade. */
export enum WearGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  E = 'E',
  UNGRADED = 'UNGRADED',
}

export interface BatteryDetail extends Record<string, unknown> {
  /** Apple-equivalent Maximum Capacity, as a percentage. */
  maximumCapacityPercent: number | null;
  cycleCount: number | null;
  designCapacityMah: number | null;
  nominalChargeCapacityMah: number | null;
  currentChargePercent: number | null;
  ratedCycleLife: number;
  wearGrade: WearGrade;
  /** 0-1 belief in the health figure itself, from source count and quality. */
  healthConfidence: number;
  /** 0-1 probability the cell falls below 80% within the projection window. */
  replacementLikelihood: number | null;
  replacementWindowMonths: number;
  /** Percentage points of capacity lost per 100 cycles, where derivable. */
  wearRatePer100Cycles: number | null;
  /** Every measurement this module used, by evidence id. */
  rawEvidenceIds: string[];
  /** Which sources supplied health data, best first. */
  sourcesUsed: string[];
  assumptions: string[];
}

/** Cycles per year assumed when projecting future wear. */
export const ASSUMED_CYCLES_PER_YEAR = 300;
export const REPLACEMENT_WINDOW_MONTHS = 12;
/** Apple's own service threshold. */
export const SERVICE_THRESHOLD_PERCENT = 80;

export function runBatteryEngine(
  ledger: EvidenceLedger,
  provenance: ProvenanceEngine,
  at: string,
): { result: ModuleResult<BatteryVerdict>; findings: Finding[]; detail: BatteryDetail } {
  const inferences: Inference[] = [];
  const findings: Finding[] = [];
  const rawEvidenceIds: string[] = [];
  const assumptions: string[] = [];

  const productType = ledger.string(EvidenceSubject.DEVICE, 'ProductType') ?? null;
  const device = resolveDevice(productType);

  const derive = (input: {
    rule: string;
    direction: InferenceDirection;
    statement: string;
    weight: number;
    ruleConfidence: number;
    evidenceIds: string[];
  }): Inference => {
    const inference = provenance.derive({
      module: ModuleId.BATTERY_INTELLIGENCE,
      subject: EvidenceSubject.BATTERY,
      at,
      ...input,
    });
    inferences.push(inference);
    return inference;
  };

  const track = (record: EvidenceRecord | undefined): EvidenceRecord | undefined => {
    if (record) rawEvidenceIds.push(record.id);
    return record;
  };

  // --- Raw measurements ---------------------------------------------------
  const designRecord = track(ledger.best(EvidenceSubject.BATTERY, 'DesignCapacity'));
  const nominalRecord = track(ledger.best(EvidenceSubject.BATTERY, 'NominalChargeCapacity'));
  const cycleRecord = track(ledger.best(EvidenceSubject.BATTERY, 'CycleCount'));
  const reportedHealthRecord = track(ledger.best(EvidenceSubject.BATTERY, 'MaximumCapacityPercent'));
  const chargeRecord = track(ledger.best(EvidenceSubject.BATTERY, 'BatteryCurrentCapacity'));

  const designCapacityMah = designRecord ? Number(designRecord.value) : null;
  const nominalChargeCapacityMah = nominalRecord ? Number(nominalRecord.value) : null;
  const cycleCount = cycleRecord ? Number(cycleRecord.value) : null;
  const currentChargePercent = chargeRecord ? Number(chargeRecord.value) : null;

  // Health: prefer a directly reported figure, else compute it Apple's way.
  let maximumCapacityPercent: number | null = null;
  const healthEvidenceIds: string[] = [];

  if (reportedHealthRecord) {
    maximumCapacityPercent = clampPercent(Number(reportedHealthRecord.value));
    healthEvidenceIds.push(reportedHealthRecord.id);
  } else if (
    designRecord &&
    nominalRecord &&
    designCapacityMah !== null &&
    nominalChargeCapacityMah !== null &&
    designCapacityMah > 0
  ) {
    maximumCapacityPercent = clampPercent(
      Math.round((nominalChargeCapacityMah / designCapacityMah) * 100),
    );
    healthEvidenceIds.push(designRecord.id, nominalRecord.id);
  }

  const sourcesUsed = [
    ...new Set(
      [reportedHealthRecord, designRecord, nominalRecord, cycleRecord]
        .filter((r): r is EvidenceRecord => Boolean(r))
        .map((r) => r.provenance.source),
    ),
  ];

  // --- No health data at all: abstain -------------------------------------
  if (maximumCapacityPercent === null) {
    const failures = ledger.failures(EvidenceSubject.BATTERY);
    const verdict = provenance.conclude<BatteryVerdict>({
      module: ModuleId.BATTERY_INTELLIGENCE,
      subject: EvidenceSubject.BATTERY,
      value: BatteryVerdict.CANNOT_DETERMINE,
      determinacy: Determinacy.INDETERMINATE,
      confidence: 0,
      rationale:
        failures.length > 0
          ? 'Every battery health source refused or was unavailable on this device.'
          : 'No battery health measurement was present in the capture.',
      inferenceIds: [],
    });

    const failureIds = failures.map((f) => f.id).slice(0, 3);
    findings.push({
      code: 'BATTERY_HEALTH_UNAVAILABLE',
      // Where the device told us *why* it refused, that refusal is the
      // evidence. Where it simply returned nothing, this is a pure absence.
      basis: failureIds.length > 0 ? FindingBasis.EVIDENCE : FindingBasis.ABSENCE,
      severity: Severity.MEDIUM,
      module: ModuleId.BATTERY_INTELLIGENCE,
      title: 'Battery health could not be read',
      detail:
        'Neither the diagnostics registry nor the device analytics returned capacity data. On ' +
        'recent iOS builds this is common. Read Maximum Capacity from Settings > Battery and ' +
        'attach it as an attestation to close this gap.',
      evidenceIds: failureIds,
      inferenceIds: [],
    });

    const detail: BatteryDetail = {
      maximumCapacityPercent: null,
      cycleCount,
      designCapacityMah,
      nominalChargeCapacityMah,
      currentChargePercent,
      ratedCycleLife: device.ratedCycleLife,
      wearGrade: WearGrade.UNGRADED,
      healthConfidence: 0,
      replacementLikelihood: null,
      replacementWindowMonths: REPLACEMENT_WINDOW_MONTHS,
      wearRatePer100Cycles: null,
      rawEvidenceIds,
      sourcesUsed,
      assumptions: [],
    };

    return {
      result: {
        module: ModuleId.BATTERY_INTELLIGENCE,
        verdicts: [verdict],
        inferences: [],
        coverage: 0,
        confidence: 0,
        detail,
      },
      findings,
      detail,
    };
  }

  // --- Health inference ----------------------------------------------------
  const healthy = maximumCapacityPercent >= SERVICE_THRESHOLD_PERCENT;
  derive({
    rule: healthy ? 'battery.health-within-threshold' : 'battery.health-below-threshold',
    direction: healthy ? InferenceDirection.SUPPORTS_POSITIVE : InferenceDirection.SUPPORTS_NEGATIVE,
    statement: `Maximum capacity is ${maximumCapacityPercent}%, ${
      healthy ? 'at or above' : 'below'
    } Apple's ${SERVICE_THRESHOLD_PERCENT}% service threshold`,
    weight: healthy ? 0.6 : 0.85,
    ruleConfidence: 0.9,
    evidenceIds: healthEvidenceIds,
  });

  // --- Cycle inference -----------------------------------------------------
  const ratedRecord = ledger.best(EvidenceSubject.BATTERY, 'RatedCycleLife');

  if (cycleCount !== null && cycleRecord && ratedRecord) {
    const overRated = cycleCount > device.ratedCycleLife;
    derive({
      rule: overRated ? 'battery.cycles-exceed-rating' : 'battery.cycles-within-rating',
      direction: overRated
        ? InferenceDirection.SUPPORTS_NEGATIVE
        : InferenceDirection.SUPPORTS_POSITIVE,
      statement: `Cycle count is ${cycleCount} against a ${device.ratedCycleLife}-cycle rating`,
      weight: overRated ? 0.6 : 0.4,
      ruleConfidence: 0.85,
      evidenceIds: [cycleRecord.id, ratedRecord.id],
    });
  }

  // --- Wear grade ----------------------------------------------------------
  const wearGrade = gradeWear(maximumCapacityPercent, cycleCount, device.ratedCycleLife);

  // --- Wear rate and replacement projection --------------------------------
  let wearRatePer100Cycles: number | null = null;
  let replacementLikelihood: number | null = null;

  if (maximumCapacityPercent < SERVICE_THRESHOLD_PERCENT) {
    // Already past the threshold: replacement is not a projection, it is due.
    replacementLikelihood = 1;
    assumptions.push('Cell is already below the 80% service threshold, so replacement is due now.');
  } else if (cycleCount !== null && cycleCount >= 25) {
    // Observed wear rate, extrapolated forward at an assumed usage rate. The
    // 25-cycle floor avoids dividing by a near-zero cycle count and turning
    // measurement noise into a confident prediction.
    const lostPercent = 100 - maximumCapacityPercent;
    wearRatePer100Cycles = round((lostPercent / cycleCount) * 100, 2);

    const projectedLoss = (lostPercent / cycleCount) * ASSUMED_CYCLES_PER_YEAR;
    const projectedHealth = maximumCapacityPercent - projectedLoss;
    const margin = projectedHealth - SERVICE_THRESHOLD_PERCENT;

    // Logistic on the projected margin: a cell projected to land exactly on the
    // threshold is a coin flip, and confidence falls away smoothly either side.
    replacementLikelihood = round(clamp01(1 / (1 + Math.exp(margin / 2.5))), 2);

    assumptions.push(
      `Assumes ${ASSUMED_CYCLES_PER_YEAR} charge cycles per year over ${REPLACEMENT_WINDOW_MONTHS} months.`,
      `Observed wear is ${wearRatePer100Cycles} percentage points per 100 cycles.`,
    );
  } else if (cycleCount !== null) {
    assumptions.push(
      `Cycle count of ${cycleCount} is too low to derive a reliable wear rate, so no projection is offered.`,
    );
  } else {
    assumptions.push('Cycle count was unavailable, so no wear rate could be derived.');
  }

  // --- Health confidence ---------------------------------------------------
  // Corroboration across independent sources, then damped when the cycle count
  // is missing: a health figure with no cycle context is a weaker basis for any
  // commercial decision than one with both.
  const { confidence: corroborated } = corroborate(inferences, ledger);
  const healthConfidence = round(
    clamp01(corroborated * (cycleCount === null ? 0.75 : 1)),
  );

  // --- Verdict -------------------------------------------------------------
  const value =
    maximumCapacityPercent < 70
      ? BatteryVerdict.DEGRADED
      : maximumCapacityPercent < SERVICE_THRESHOLD_PERCENT
        ? BatteryVerdict.SERVICE_RECOMMENDED
        : BatteryVerdict.WITHIN_SPECIFICATION;

  const supporting = inferences.filter((i) =>
    value === BatteryVerdict.WITHIN_SPECIFICATION
      ? i.direction === InferenceDirection.SUPPORTS_POSITIVE
      : i.direction === InferenceDirection.SUPPORTS_NEGATIVE,
  );

  const verdict = provenance.conclude<BatteryVerdict>({
    module: ModuleId.BATTERY_INTELLIGENCE,
    subject: EvidenceSubject.BATTERY,
    value,
    determinacy: Determinacy.DETERMINED,
    confidence: Math.max(healthConfidence, 0.25),
    rationale:
      `Maximum capacity ${maximumCapacityPercent}%` +
      (cycleCount !== null ? ` after ${cycleCount} cycles` : ', cycle count unavailable') +
      `; wear grade ${wearGrade}.`,
    inferenceIds: (supporting.length > 0 ? supporting : inferences).map((i) => i.id),
  });

  // --- Findings ------------------------------------------------------------
  if (value === BatteryVerdict.SERVICE_RECOMMENDED) {
    findings.push({
      code: 'BATTERY_SERVICE_RECOMMENDED',
      basis: FindingBasis.EVIDENCE,
      severity: Severity.MEDIUM,
      module: ModuleId.BATTERY_INTELLIGENCE,
      title: `Battery at ${maximumCapacityPercent}% maximum capacity`,
      detail: `Below Apple's ${SERVICE_THRESHOLD_PERCENT}% threshold. Price in a replacement cell.`,
      evidenceIds: healthEvidenceIds,
      inferenceIds: verdict.inferenceIds,
    });
  }
  if (value === BatteryVerdict.DEGRADED) {
    findings.push({
      code: 'BATTERY_DEGRADED',
      basis: FindingBasis.EVIDENCE,
      severity: Severity.HIGH,
      module: ModuleId.BATTERY_INTELLIGENCE,
      title: `Battery severely degraded at ${maximumCapacityPercent}%`,
      detail: 'The cell has lost more than 30% of its original capacity and needs replacing.',
      evidenceIds: healthEvidenceIds,
      inferenceIds: verdict.inferenceIds,
    });
  }
  if (cycleCount === null) {
    const cycleFailureIds = ledger.failures(EvidenceSubject.BATTERY).map((f) => f.id).slice(0, 2);
    findings.push({
      code: 'BATTERY_CYCLES_UNAVAILABLE',
      basis: cycleFailureIds.length > 0 ? FindingBasis.EVIDENCE : FindingBasis.ABSENCE,
      severity: Severity.LOW,
      module: ModuleId.BATTERY_INTELLIGENCE,
      title: 'Cycle count could not be read',
      detail:
        'Cycle count is exposed only through the diagnostics registry and device analytics. ' +
        'Without it no wear rate or replacement projection can be derived.',
      evidenceIds: cycleFailureIds,
      inferenceIds: [],
    });
  }
  if (replacementLikelihood !== null && replacementLikelihood >= 0.5 && value === BatteryVerdict.WITHIN_SPECIFICATION) {
    findings.push({
      code: 'BATTERY_REPLACEMENT_PROJECTED',
      basis: FindingBasis.EVIDENCE,
      severity: Severity.MEDIUM,
      module: ModuleId.BATTERY_INTELLIGENCE,
      title: `Battery projected to need replacement within ${REPLACEMENT_WINDOW_MONTHS} months`,
      detail:
        `At the observed wear rate the cell is ${Math.round(replacementLikelihood * 100)}% likely ` +
        `to fall below ${SERVICE_THRESHOLD_PERCENT}% inside the projection window. ` +
        assumptions.join(' '),
      evidenceIds: healthEvidenceIds,
      inferenceIds: verdict.inferenceIds,
    });
  }

  // Coverage: health and cycles are the two facts this module needs.
  const coverage = round((healthEvidenceIds.length > 0 ? 0.6 : 0) + (cycleCount !== null ? 0.4 : 0));

  const detail: BatteryDetail = {
    maximumCapacityPercent,
    cycleCount,
    designCapacityMah,
    nominalChargeCapacityMah,
    currentChargePercent,
    ratedCycleLife: device.ratedCycleLife,
    wearGrade,
    healthConfidence,
    replacementLikelihood,
    replacementWindowMonths: REPLACEMENT_WINDOW_MONTHS,
    wearRatePer100Cycles,
    rawEvidenceIds,
    sourcesUsed,
    assumptions,
  };

  return {
    result: {
      module: ModuleId.BATTERY_INTELLIGENCE,
      verdicts: [verdict],
      inferences,
      coverage,
      confidence: round(clamp01(healthConfidence * (0.6 + 0.4 * coverage))),
      detail,
    },
    findings,
    detail,
  };
}

/**
 * Wear grade.
 *
 * Health dominates because it is what the trade prices; cycles demote a grade
 * when they are disproportionately high for the capacity remaining, which is
 * the signature of a cell about to fall off a cliff.
 */
export function gradeWear(
  maximumCapacityPercent: number,
  cycleCount: number | null,
  ratedCycleLife: number,
): WearGrade {
  let grade: WearGrade;
  if (maximumCapacityPercent >= 95) grade = WearGrade.A;
  else if (maximumCapacityPercent >= 88) grade = WearGrade.B;
  else if (maximumCapacityPercent >= 80) grade = WearGrade.C;
  else if (maximumCapacityPercent >= 70) grade = WearGrade.D;
  else grade = WearGrade.E;

  if (cycleCount !== null && ratedCycleLife > 0) {
    const ratio = cycleCount / ratedCycleLife;
    // A cell past its rated life drops one grade even if capacity still reads
    // well: remaining capacity is a lagging indicator of a worn cell.
    if (ratio > 1 && grade !== WearGrade.E) grade = demote(grade);
  }
  return grade;
}

const ORDER = [WearGrade.A, WearGrade.B, WearGrade.C, WearGrade.D, WearGrade.E];
const demote = (grade: WearGrade): WearGrade => {
  const index = ORDER.indexOf(grade);
  return index >= 0 && index < ORDER.length - 1 ? (ORDER[index + 1] as WearGrade) : grade;
};

const clampPercent = (value: number): number =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
