import { Surface, defectClass, DefectGroup } from './taxonomy.js';

/**
 * The PhysicalDNA score.
 *
 * Two rules shape it, and both are inherited from the trust engine because they
 * were right there and are right here:
 *
 *   1. **A surface that could not be assessed is excluded, not zeroed.** A
 *      device whose rear glass was never usably photographed must not score as
 *      though its rear glass were destroyed. It drops out of the weighted mean
 *      and reduces coverage instead.
 *   2. **Gates cap rather than subtract.** A flawless frame cannot buy back a
 *      shattered screen.
 *
 * One rule is specific to this domain and matters more than either: **damage
 * and wear are scored separately**. A handset with heavy pocket wear and no
 * damage is a different commercial proposition from one with a pristine finish
 * and a cracked lens, and a single "condition" number that cannot tell them
 * apart is useless to the people who trade them.
 */

export const SCORING_VERSION = '1.0.0';

export enum PhysicalPillar {
  DISPLAY = 'DISPLAY',
  FRAME = 'FRAME',
  CAMERA = 'CAMERA',
  REAR_GLASS = 'REAR_GLASS',
  BODY_WEAR = 'BODY_WEAR',
}

/** Pillar weights. */
export const PILLAR_WEIGHTS: Record<PhysicalPillar, number> = {
  [PhysicalPillar.DISPLAY]: 0.3,
  [PhysicalPillar.FRAME]: 0.2,
  [PhysicalPillar.CAMERA]: 0.2,
  [PhysicalPillar.REAR_GLASS]: 0.15,
  [PhysicalPillar.BODY_WEAR]: 0.15,
};

/**
 * Which surfaces make up each pillar, and how much each counts within it.
 *
 * BODY_WEAR has no surfaces of its own: it is assembled from the WEAR-group
 * defects found on the surfaces the other pillars already cover. That is what
 * keeps wear out of the damage pillars, so the same scratch field is never
 * charged twice.
 */
export const PILLAR_SURFACES: Record<PhysicalPillar, Array<{ surface: Surface; weight: number }>> = {
  [PhysicalPillar.DISPLAY]: [
    { surface: Surface.DISPLAY_ACTIVE_AREA, weight: 0.6 },
    { surface: Surface.FRONT_GLASS, weight: 0.4 },
  ],
  [PhysicalPillar.FRAME]: [
    { surface: Surface.FRAME, weight: 0.8 },
    { surface: Surface.CHARGE_PORT, weight: 0.2 },
  ],
  [PhysicalPillar.CAMERA]: [
    { surface: Surface.REAR_CAMERA, weight: 0.85 },
    { surface: Surface.FRONT_CAMERA, weight: 0.15 },
  ],
  [PhysicalPillar.REAR_GLASS]: [{ surface: Surface.REAR_GLASS, weight: 1 }],
  [PhysicalPillar.BODY_WEAR]: [],
};

/** Surfaces whose WEAR-group defects roll up into the body-wear pillar. */
export const BODY_WEAR_SURFACES: Surface[] = [
  Surface.FRONT_GLASS,
  Surface.REAR_GLASS,
  Surface.FRAME,
];

export enum ConditionGrade {
  PRISTINE = 'PRISTINE',
  EXCELLENT = 'EXCELLENT',
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  POOR = 'POOR',
  HEAVILY_DAMAGED = 'HEAVILY_DAMAGED',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
}

export const GRADE_BANDS = {
  pristine: 97,
  excellent: 85,
  good: 70,
  fair: 50,
  poor: 25,
} as const;

export const gradeFor = (score: number): ConditionGrade => {
  if (score >= GRADE_BANDS.pristine) return ConditionGrade.PRISTINE;
  if (score >= GRADE_BANDS.excellent) return ConditionGrade.EXCELLENT;
  if (score >= GRADE_BANDS.good) return ConditionGrade.GOOD;
  if (score >= GRADE_BANDS.fair) return ConditionGrade.FAIR;
  if (score >= GRADE_BANDS.poor) return ConditionGrade.POOR;
  return ConditionGrade.HEAVILY_DAMAGED;
};

/**
 * A defect as the scorer sees it: a class and how much of the surface it covers.
 */
export interface ScorableDefect {
  classId: string;
  /** Share of the frame the defect occupies, 0..1. */
  relativeArea: number;
  /** Evidence record this came from, carried through for explainability. */
  evidenceId: string;
}

/**
 * Area at which a defect is charged at its class's full severity.
 *
 * Six percent of the frame is a large defect on a phone. Beyond it the extent
 * factor saturates, because the difference between a crack across half the
 * panel and one across all of it is not what decides the price — the panel is
 * being replaced either way.
 */
export const REFERENCE_AREA = 0.06;

/**
 * The floor keeps a small defect from rounding away to nothing.
 *
 * A 2mm chip in the corner of a screen is genuinely damage, and a purely
 * area-proportional model would price it at almost zero. What extent modulates
 * is how much *worse* than the minimum a defect is, not whether it counts.
 */
export const EXTENT_FLOOR = 0.35;

export const extentFactor = (relativeArea: number): number => {
  const ratio = Math.min(1, Math.max(0, relativeArea) / REFERENCE_AREA);
  return EXTENT_FLOOR + (1 - EXTENT_FLOOR) * ratio;
};

/**
 * Accumulate defect penalties on one surface.
 *
 * Noisy-OR, the same combiner the confidence model uses for independent
 * corroboration:
 *
 *     penalty = 1 - Π (1 - severity_i x extent_i)
 *
 * It saturates, which is the behaviour the domain needs. Ten scratches are
 * worse than one and nowhere near ten times worse, and a linear sum would drive
 * a well-used but sound handset to zero while a single structural crack — the
 * thing that actually determines the price — barely moved the number.
 */
export function surfacePenalty(defects: readonly ScorableDefect[]): number {
  let complement = 1;
  for (const defect of defects) {
    const definition = defectClass(defect.classId);
    if (!definition) continue;
    const effect = Math.min(
      1,
      Math.max(0, definition.severityWeight * extentFactor(defect.relativeArea)),
    );
    complement *= 1 - effect;
  }
  return Math.min(1, Math.max(0, 1 - complement));
}

export const surfaceScore = (defects: readonly ScorableDefect[]): number =>
  Math.round(100 * (1 - surfacePenalty(defects)));

/** WEAR-group classes are scored in the body-wear pillar and nowhere else. */
export const isWearClass = (classId: string): boolean =>
  defectClass(classId)?.group === DefectGroup.WEAR;

export interface SurfaceAssessment {
  surface: Surface;
  /** Null when the surface could not be assessed at all. */
  score: number | null;
  /** Damage-group defects on this surface. */
  defects: ScorableDefect[];
  /** WEAR-group defects, scored in the body-wear pillar instead. */
  wear: ScorableDefect[];
  confidence: number;
  /** Whether at least one qualifying view passed validation. */
  assessable: boolean;
}

export interface PillarScore {
  pillar: PhysicalPillar;
  score: number | null;
  confidence: number;
  /**
   * Share of this pillar's own surface weight that was assessable, 0..1.
   *
   * Not the same as "did the pillar produce a score". The camera pillar can
   * score from the front camera alone while the rear camera — 85% of what the
   * pillar is about — was never usably photographed. Reporting that as full
   * coverage would be the exact failure this system exists to prevent: a
   * shorter list of findings reading as a cleaner device.
   */
  coverage: number;
  baseWeight: number;
  effectiveWeight: number;
  surfaces: Surface[];
}

export interface ConditionGate {
  code: string;
  cap: number;
  reason: string;
}

export interface PhysicalScore {
  score: number;
  /** Before gates, so a report can show what the caps cost. */
  rawScore: number;
  grade: ConditionGrade;
  confidence: number;
  /** Share of pillar weight that produced a score at all. */
  coverage: number;
  pillars: PillarScore[];
  gatesApplied: ConditionGate[];
  scoringVersion: string;
}

export interface ScoreInput {
  surfaces: SurfaceAssessment[];
  /** False until a benchmark run has measured the detector's precision/recall. */
  detectorCalibrated: boolean;
}

export function computePhysicalScore(input: ScoreInput): PhysicalScore {
  const bySurface = new Map(input.surfaces.map((entry) => [entry.surface, entry]));

  const pillars: PillarScore[] = Object.values(PhysicalPillar).map((pillar) =>
    pillar === PhysicalPillar.BODY_WEAR
      ? bodyWearPillar(input.surfaces)
      : damagePillar(pillar, bySurface),
  );

  const scoring = pillars.filter((p) => p.score !== null);
  const totalWeight = Object.values(PILLAR_WEIGHTS).reduce((sum, w) => sum + w, 0);

  // Confidence-damped weights, renormalised over the pillars that scored. The
  // floor stops a pillar we are unsure of from dropping out entirely and
  // quietly turning a whole-device grade into a frame-and-camera grade.
  const damped = (p: PillarScore): number => p.baseWeight * (0.4 + 0.6 * clamp01(p.confidence));
  const dampedTotal = scoring.reduce((sum, p) => sum + damped(p), 0);
  for (const pillar of pillars) {
    pillar.effectiveWeight =
      pillar.score === null || dampedTotal <= 0 ? 0 : round(damped(pillar) / dampedTotal);
  }

  const rawScore =
    scoring.length === 0
      ? 0
      : Math.round(scoring.reduce((sum, p) => sum + (p.score as number) * p.effectiveWeight, 0));

  // Confidence is measured over the whole intended picture, not just the part
  // that answered: a pillar that abstained contributes zero at its full weight.
  const confidence = round(
    pillars.reduce((sum, p) => sum + (p.score === null ? 0 : p.confidence) * p.baseWeight, 0) /
      totalWeight,
  );
  const coverage = round(
    pillars.reduce((sum, p) => sum + p.baseWeight * p.coverage, 0) / totalWeight,
  );

  const gates = evaluateGates(pillars, input.surfaces, coverage, input.detectorCalibrated);
  const cap = gates.reduce((min, gate) => Math.min(min, gate.cap), 100);
  const score = Math.min(rawScore, cap);

  const grade =
    coverage <= 0 || confidence < MINIMUM_REPORTABLE_CONFIDENCE
      ? ConditionGrade.INSUFFICIENT_EVIDENCE
      : gradeFor(score);

  return {
    score,
    rawScore,
    grade,
    confidence,
    coverage,
    pillars,
    gatesApplied: gates,
    scoringVersion: SCORING_VERSION,
  };
}

/** Below this, no grade is issued. Matches SoftwareDNA's reporting threshold. */
export const MINIMUM_REPORTABLE_CONFIDENCE = 0.45;

function damagePillar(
  pillar: PhysicalPillar,
  bySurface: Map<Surface, SurfaceAssessment>,
): PillarScore {
  const members = PILLAR_SURFACES[pillar];
  const assessed = members
    .map((member) => ({ member, assessment: bySurface.get(member.surface) }))
    .filter((entry): entry is { member: typeof entry.member; assessment: SurfaceAssessment } =>
      Boolean(entry.assessment?.assessable),
    );

  const totalMemberWeight = members.reduce((sum, m) => sum + m.weight, 0);

  if (assessed.length === 0) {
    return {
      pillar,
      score: null,
      confidence: 0,
      coverage: 0,
      baseWeight: PILLAR_WEIGHTS[pillar],
      effectiveWeight: 0,
      surfaces: members.map((m) => m.surface),
    };
  }

  const weight = assessed.reduce((sum, e) => sum + e.member.weight, 0);
  const score = Math.round(
    assessed.reduce((sum, e) => sum + surfaceScore(e.assessment.defects) * e.member.weight, 0) /
      weight,
  );
  const confidence = round(
    assessed.reduce((sum, e) => sum + e.assessment.confidence * e.member.weight, 0) / weight,
  );

  return {
    pillar,
    score,
    confidence,
    coverage: totalMemberWeight > 0 ? round(weight / totalMemberWeight) : 0,
    baseWeight: PILLAR_WEIGHTS[pillar],
    effectiveWeight: 0,
    surfaces: members.map((m) => m.surface),
  };
}

function bodyWearPillar(surfaces: readonly SurfaceAssessment[]): PillarScore {
  const contributing = surfaces.filter(
    (entry) => entry.assessable && BODY_WEAR_SURFACES.includes(entry.surface),
  );

  if (contributing.length === 0) {
    return {
      pillar: PhysicalPillar.BODY_WEAR,
      score: null,
      confidence: 0,
      coverage: 0,
      baseWeight: PILLAR_WEIGHTS[PhysicalPillar.BODY_WEAR],
      effectiveWeight: 0,
      surfaces: BODY_WEAR_SURFACES,
    };
  }

  const wear = contributing.flatMap((entry) => entry.wear);
  const confidence = round(
    contributing.reduce((sum, entry) => sum + entry.confidence, 0) / contributing.length,
  );

  return {
    pillar: PhysicalPillar.BODY_WEAR,
    score: surfaceScore(wear),
    confidence,
    coverage: round(contributing.length / BODY_WEAR_SURFACES.length),
    baseWeight: PILLAR_WEIGHTS[PhysicalPillar.BODY_WEAR],
    effectiveWeight: 0,
    surfaces: BODY_WEAR_SURFACES,
  };
}

function evaluateGates(
  pillars: readonly PillarScore[],
  surfaces: readonly SurfaceAssessment[],
  coverage: number,
  detectorCalibrated: boolean,
): ConditionGate[] {
  const gates: ConditionGate[] = [];

  /*
   * The gate that will be least popular internally and is the most important.
   *
   * An unvalidated detector has an unknown false-negative rate, so "we found
   * nothing" carries unknown weight. Awarding a top grade on that basis would
   * be the single most damaging thing this system could do to its own
   * credibility — the first customer to receive a "PRISTINE" handset with an
   * obvious crack would be right to stop believing every other number DevDNA
   * prints, including the SoftwareDNA ones that *are* measured.
   *
   * The gate removes itself the moment a benchmark run lands.
   */
  if (!detectorCalibrated) {
    gates.push({
      code: 'DETECTOR_UNCALIBRATED',
      cap: 84,
      reason:
        'The defect detector has no measured precision or recall on a held-out benchmark, ' +
        'so the absence of a detection cannot yet support a top grade.',
    });
  }

  /*
   * Severe damage gates on the *surface*, not the pillar.
   *
   * Gating on pillars was wrong and a test caught it. A structural crack takes
   * the front glass to 20, but the display pillar averages it with a perfect
   * active area and lands at 68 — comfortably above any pillar threshold. The
   * device has a smashed screen and the pillar arithmetic hides it.
   *
   * A destroyed surface is a fact about the device that no amount of averaging
   * against its neighbours should be able to dilute.
   */
  for (const surface of surfaces) {
    if (surface.score === null || !surface.assessable) continue;
    if (surface.score < 20) {
      gates.push({
        code: `${surface.surface}_DESTROYED`,
        cap: 40,
        reason: `The ${surface.surface.toLowerCase().replace(/_/g, ' ')} scored ${surface.score}; damage this severe determines the grade on its own.`,
      });
    } else if (surface.score < 40) {
      gates.push({
        code: `${surface.surface}_SEVERE_DAMAGE`,
        cap: 55,
        reason: `The ${surface.surface.toLowerCase().replace(/_/g, ' ')} scored ${surface.score}; severe damage to one surface caps the whole-device grade.`,
      });
    }
  }
  void pillars;

  if (coverage < 0.4) {
    gates.push({
      code: 'COVERAGE_INSUFFICIENT',
      cap: 70,
      reason: `Only ${Math.round(coverage * 100)}% of the device could be assessed.`,
    });
  } else if (coverage < 0.7) {
    gates.push({
      code: 'COVERAGE_PARTIAL',
      cap: 90,
      reason: `${Math.round(coverage * 100)}% of the device was assessed; the rest was not photographed usably.`,
    });
  } else if (coverage < 0.95) {
    gates.push({
      code: 'COVERAGE_NOT_TOTAL',
      cap: 96,
      reason: `${Math.round(coverage * 100)}% of the device was assessed; a flawless grade requires near-total coverage.`,
    });
  }

  return gates;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number, dp = 3): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};
