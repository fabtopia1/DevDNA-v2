import {
  Determinacy,
  EvidenceKind,
  EvidenceSubject,
  FindingBasis,
  InferenceDirection,
  ModuleId,
  Severity,
  verdictConfidence,
  massFor,
  round,
  type EvidenceLedger,
  type EvidenceRecord,
  type Finding,
  type Inference,
  type ModuleResult,
  type ProvenanceEngine,
  type Verdict,
} from '@devdna/core';
import { DEFECT_CLASSES, SURFACE_SUBJECT, Surface, defectClass } from './taxonomy.js';
import { VIEWS_FOR_SURFACE } from './capture/views.js';
import { captureRecordsFor, classIdOf, defectRecordsFor } from './evidence.js';
import { calibrationFor, calibrationIsMeasured, isMeasured } from './detection/calibration.js';
import {
  extentFactor,
  isWearClass,
  surfaceScore,
  type ScorableDefect,
  type SurfaceAssessment,
} from './scoring.js';

/**
 * The PhysicalDNA condition module.
 *
 * A pure function of the evidence ledger, exactly like the SoftwareDNA modules:
 * it never sees an image, only the records that captured what was seen in one.
 * That is what makes a physical assessment reproducible from stored evidence
 * months later, without the photographs — and it is why the detector's output
 * had to become evidence rather than being consumed directly.
 */

export enum ConditionVerdict {
  SURFACE_UNDAMAGED = 'SURFACE_UNDAMAGED',
  SURFACE_LIGHT_WEAR = 'SURFACE_LIGHT_WEAR',
  SURFACE_DAMAGED = 'SURFACE_DAMAGED',
  SURFACE_SEVERELY_DAMAGED = 'SURFACE_SEVERELY_DAMAGED',
  CANNOT_DETERMINE = 'CANNOT_DETERMINE',
}

const VERDICT_BANDS = { undamaged: 95, lightWear: 75, damaged: 40 } as const;

export interface PhysicalDetail extends Record<string, unknown> {
  surfaces: SurfaceAssessment[];
  /** Surfaces with no usable image. Reported, never silently omitted. */
  notAssessed: Surface[];
  detectorCalibrated: boolean;
  /** Trust-relevant classes observed, for the Service Evidence bridge. */
  repairIndicators: Array<{ classId: string; surface: Surface; evidenceId: string }>;
}

/**
 * Rule strength for "photographed usably, nothing found".
 *
 * This is the number that decides how much a clean surface is worth, and it is
 * the detector's **recall**, not its precision. Precision bounds what a
 * detection means; recall bounds what an *absence* means, and a clean verdict
 * is entirely a claim about absence.
 *
 * Until recall is measured it is deliberately low. "We looked and saw nothing"
 * from an instrument whose miss rate nobody has measured is a weak claim, and
 * the architecture's founding rule — absence of evidence is not evidence of
 * soundness — applies to photographs exactly as it applies to service records.
 */
const UNMEASURED_CLEAN_CONFIDENCE = 0.35;

/** Class ids that can legitimately appear on a surface. Built once. */
const CLASSES_BY_SURFACE = new Map<Surface, string[]>(
  Object.values(Surface).map((surface) => [
    surface,
    DEFECT_CLASSES.filter((entry) => entry.surfaces.includes(surface)).map((entry) => entry.id),
  ]),
);

/**
 * How far a "nothing found here" claim can be believed, for one surface.
 *
 * Bounded by the *weakest* class on that surface: a surface is only as clean as
 * the defect we are worst at finding on it. Anything less strict would let a
 * well-measured scratch detector vouch for a crack detector nobody has tested.
 */
function cleanRuleConfidence(surface: Surface): number {
  const classes = CLASSES_BY_SURFACE.get(surface) ?? [];
  const calibrations = classes.map((id) => calibrationFor(id));
  if (calibrations.length === 0 || !calibrations.every(isMeasured)) {
    return UNMEASURED_CLEAN_CONFIDENCE;
  }
  return Math.min(...calibrations.map((c) => c!.recall));
}

export function runPhysicalModule(
  ledger: EvidenceLedger,
  provenance: ProvenanceEngine,
  at: string,
): { result: ModuleResult<ConditionVerdict>; findings: Finding[]; detail: PhysicalDetail } {
  const inferences: Inference[] = [];
  const findings: Finding[] = [];
  const verdicts: Verdict<ConditionVerdict>[] = [];
  const assessments: SurfaceAssessment[] = [];
  const repairIndicators: PhysicalDetail['repairIndicators'] = [];
  const detectorCalibrated = calibrationIsMeasured();

  const derive = (input: {
    rule: string;
    subject: EvidenceSubject;
    direction: InferenceDirection;
    statement: string;
    weight: number;
    ruleConfidence: number;
    evidenceIds: string[];
  }): Inference => {
    const inference = provenance.derive({
      module: ModuleId.PHYSICAL_CONDITION,
      subject: input.subject,
      rule: input.rule,
      direction: input.direction,
      statement: input.statement,
      weight: input.weight,
      ruleConfidence: input.ruleConfidence,
      evidenceIds: input.evidenceIds,
      at,
    });
    inferences.push(inference);
    return inference;
  };

  // --- Per surface ----------------------------------------------------------
  const perSurfaceInferences = new Map<Surface, Inference[]>();

  for (const surface of Object.values(Surface)) {
    const subject = SURFACE_SUBJECT[surface];
    const captures = captureRecordsFor(ledger, surface);
    const local: Inference[] = [];

    // Only the views that can actually show this surface count towards its
    // coverage. A rear-glass surface is not assessed by having photographed
    // the left edge, however many images the session contains.
    const qualifying = new Set(VIEWS_FOR_SURFACE[surface]);
    const usable = captures.accepted.filter((record) =>
      qualifying.has(viewOf(record) as never),
    );

    if (usable.length === 0) {
      // Absence of a usable image is recorded as an inference citing the
      // failures, so the abstention is supported rather than merely asserted.
      if (captures.failed.length > 0) {
        local.push(
          derive({
            rule: 'physical.view-unusable',
            subject,
            direction: InferenceDirection.REDUCES_DETERMINACY,
            statement:
              `No usable photograph of the ${humanise(surface)} was obtained; ` +
              `${captures.failed.length} attempt(s) failed image validation`,
            weight: 1,
            ruleConfidence: 1,
            evidenceIds: captures.failed.map((r) => r.id),
          }),
        );
      }

      verdicts.push(
        provenance.conclude<ConditionVerdict>({
          module: ModuleId.PHYSICAL_CONDITION,
          subject,
          value: ConditionVerdict.CANNOT_DETERMINE,
          determinacy: Determinacy.INDETERMINATE,
          confidence: 0,
          rationale:
            captures.failed.length > 0
              ? `Every photograph of the ${humanise(surface)} failed image validation, so no claim is made about its condition.`
              : `The ${humanise(surface)} was not photographed, so no claim is made about its condition.`,
          inferenceIds: local.map((i) => i.id),
        }),
      );

      assessments.push({
        surface,
        score: null,
        defects: [],
        wear: [],
        confidence: 0,
        assessable: false,
      });
      perSurfaceInferences.set(surface, local);
      continue;
    }

    // --- Defects on this surface -------------------------------------------
    const records = defectRecordsFor(ledger, surface).filter(
      (record) => surfaceOf(record) === surface,
    );

    const defects: ScorableDefect[] = [];
    const wear: ScorableDefect[] = [];

    for (const record of records) {
      const classId = classIdOf(record);
      const definition = defectClass(classId);
      if (!definition) continue;

      const relativeArea = areaOf(record);
      const scorable: ScorableDefect = { classId, relativeArea, evidenceId: record.id };
      if (isWearClass(classId)) wear.push(scorable);
      else defects.push(scorable);

      if (definition.trustRelevant) {
        repairIndicators.push({ classId, surface, evidenceId: record.id });
      }

      local.push(
        derive({
          rule: `physical.defect.${classId.toLowerCase().replace(/_/g, '-')}`,
          subject,
          direction: InferenceDirection.SUPPORTS_NEGATIVE,
          statement:
            `${definition.label} detected on the ${humanise(surface)}, covering ` +
            `${(relativeArea * 100).toFixed(1)}% of the frame`,
          weight: Math.min(1, definition.severityWeight * extentFactor(relativeArea)),
          // The rule "a detected defect indicates damage" is near-certain. What
          // is uncertain is the detection, and that enters through the record's
          // calibrated reliability rather than by being double-counted here.
          ruleConfidence: 0.95,
          evidenceIds: [record.id],
        }),
      );
    }

    if (records.length === 0) {
      local.push(
        derive({
          rule: 'physical.surface-photographed-clean',
          subject,
          direction: InferenceDirection.SUPPORTS_POSITIVE,
          statement:
            `The ${humanise(surface)} was photographed within specification and no defect ` +
            'was detected on it',
          weight: 0.9,
          ruleConfidence: cleanRuleConfidence(surface),
          evidenceIds: usable.map((r) => r.id),
        }),
      );
    }

    const score = surfaceScore(defects);
    const mass = massFor(local, InferenceDirection.SUPPORTS_NEGATIVE);
    const supporting = records.length === 0 ? mass.opposing : mass.supporting;
    const opposing = records.length === 0 ? mass.positive : mass.negative;
    const scored = verdictConfidence({ supporting, opposingMass: opposing, ledger });

    const value =
      score >= VERDICT_BANDS.undamaged
        ? ConditionVerdict.SURFACE_UNDAMAGED
        : score >= VERDICT_BANDS.lightWear
          ? ConditionVerdict.SURFACE_LIGHT_WEAR
          : score >= VERDICT_BANDS.damaged
            ? ConditionVerdict.SURFACE_DAMAGED
            : ConditionVerdict.SURFACE_SEVERELY_DAMAGED;

    verdicts.push(
      provenance.conclude<ConditionVerdict>({
        module: ModuleId.PHYSICAL_CONDITION,
        subject,
        value,
        determinacy: Determinacy.DETERMINED,
        confidence: Math.max(scored.confidence, 0.2),
        rationale:
          records.length === 0
            ? `The ${humanise(surface)} was photographed usably and no defect was detected.`
            : `${records.length} defect(s) detected on the ${humanise(surface)}: ` +
              summarise(records) +
              '.',
        inferenceIds: local.map((i) => i.id),
      }),
    );

    assessments.push({
      surface,
      score,
      defects,
      wear,
      confidence: Math.max(scored.confidence, 0.2),
      assessable: true,
    });
    perSurfaceInferences.set(surface, local);
  }

  // --- Findings -------------------------------------------------------------
  for (const assessment of assessments) {
    for (const defect of [...assessment.defects, ...assessment.wear]) {
      const definition = defectClass(defect.classId);
      if (!definition || definition.findingSeverity === Severity.INFO) continue;
      findings.push({
        code: `PHYSICAL_${defect.classId}`,
        severity: definition.findingSeverity,
        module: ModuleId.PHYSICAL_CONDITION,
        title: `${definition.label} on ${humanise(assessment.surface)}`,
        detail: definition.impact,
        basis: FindingBasis.EVIDENCE,
        evidenceIds: [defect.evidenceId],
        inferenceIds: [],
      });
    }
  }

  const notAssessed = assessments.filter((a) => !a.assessable).map((a) => a.surface);
  if (notAssessed.length > 0) {
    findings.push({
      code: 'PHYSICAL_SURFACES_NOT_ASSESSED',
      severity: notAssessed.length > 3 ? Severity.HIGH : Severity.MEDIUM,
      module: ModuleId.PHYSICAL_CONDITION,
      title: `${notAssessed.length} surface(s) could not be assessed`,
      detail:
        `No usable photograph was obtained of: ${notAssessed.map(humanise).join(', ')}. ` +
        'No claim is made about their condition. A shorter defect list does not mean a cleaner device.',
      basis: FindingBasis.ABSENCE,
      evidenceIds: [],
      inferenceIds: [],
    });
  }

  if (!detectorCalibrated) {
    findings.push({
      code: 'PHYSICAL_DETECTOR_UNCALIBRATED',
      severity: Severity.HIGH,
      module: ModuleId.PHYSICAL_CONDITION,
      title: 'Defect detector has no measured accuracy',
      detail:
        'No held-out benchmark has measured this detector’s precision or recall, so the ' +
        'absence of a detection carries unknown weight. The grade is capped accordingly.',
      basis: FindingBasis.ABSENCE,
      evidenceIds: [],
      inferenceIds: [],
    });
  }

  const determined = assessments.filter((a) => a.assessable);
  const coverage = round(determined.length / Math.max(1, assessments.length));
  const confidence =
    determined.length === 0
      ? 0
      : round(determined.reduce((sum, a) => sum + a.confidence, 0) / determined.length);

  return {
    result: {
      module: ModuleId.PHYSICAL_CONDITION,
      verdicts,
      inferences,
      coverage,
      confidence,
      detail: {
        surfaces: assessments,
        notAssessed,
        detectorCalibrated,
        repairIndicators,
      } satisfies PhysicalDetail,
    },
    findings,
    detail: {
      surfaces: assessments,
      notAssessed,
      detectorCalibrated,
      repairIndicators,
    },
  };
}

/** `ViewCaptured:FRONT` -> `FRONT`. */
const viewOf = (record: EvidenceRecord): string => record.key.split(':')[1] ?? '';

/** Recover the surface a detection record was attributed to, from its raw payload. */
function surfaceOf(record: EvidenceRecord): Surface | undefined {
  if (!record.raw) return undefined;
  try {
    return (JSON.parse(record.raw) as { surface?: Surface }).surface;
  } catch {
    return undefined;
  }
}

function areaOf(record: EvidenceRecord): number {
  if (!record.raw) return 0;
  try {
    const parsed = JSON.parse(record.raw) as {
      extent?: number | null;
      box?: { width: number; height: number };
    };
    if (typeof parsed.extent === 'number') return parsed.extent;
    if (parsed.box) return parsed.box.width * parsed.box.height;
  } catch {
    return 0;
  }
  return 0;
}

const humanise = (surface: Surface): string => surface.toLowerCase().replace(/_/g, ' ');

const summarise = (records: readonly EvidenceRecord[]): string =>
  [...new Set(records.map((r) => defectClass(classIdOf(r))?.label ?? classIdOf(r)))].join(', ');
